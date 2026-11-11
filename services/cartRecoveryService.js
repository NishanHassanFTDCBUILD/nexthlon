// Abandoned carts: carts with items that nobody has touched for 24 hours or more, their value at
// today's prices, a reminder email (at most one a day, only to customers who accept offer
// emails) and the recovery rate (reminded carts whose customer ordered afterwards).
const mongoose = require("mongoose");
const Cart = require("../models/Cart");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const mailService = require("./mailService");
const queue = require("../jobs/queue");
const { renderEmail, siteUrl, absoluteUrl } = require("../utils/emailLayout");
const { sizedUrl } = require("../utils/images");
const { HttpError } = require("../utils/http");
const { toPositiveInt } = require("./productService");
const { formatPaise } = require("../utils/money");

const PAGE_SIZE = 20;
const IDLE_HOURS = 24;
const HOUR = 60 * 60 * 1000;
const REMIND_EVERY_HOURS = 24;
const SORTS = { value: { value: -1, updatedAt: 1 }, oldest: { updatedAt: 1 }, newest: { updatedAt: -1 } };

// Carts idle since before `cutoff`, with the customer and the live value of the items.
function abandonedPipeline(cutoff) {
  return [
    { $match: { "items.0": { $exists: true }, updatedAt: { $lte: cutoff } } },
    { $lookup: { from: User.collection.name, localField: "user", foreignField: "_id", as: "customer", pipeline: [{ $project: { name: 1, email: 1, notifyPrefs: 1, isBlocked: 1, isDeleted: 1 } }] } },
    { $set: { customer: { $first: "$customer" } } },
    { $match: { "customer.isDeleted": { $ne: true } } },
    { $lookup: { from: Product.collection.name, localField: "items.product", foreignField: "_id", as: "products", pipeline: [{ $project: { name: 1, price: 1, image: 1, slug: 1, stock: 1, isListed: 1 } }] } },
    { $set: {
      lines: { $map: { input: "$items", as: "item", in: {
        quantity: "$$item.quantity",
        product: { $first: { $filter: { input: "$products", as: "p", cond: { $eq: ["$$p._id", "$$item.product"] } } } }
      } } }
    } },
    { $set: { value: { $sum: { $map: { input: "$lines", as: "line", in: { $multiply: ["$$line.quantity", { $ifNull: ["$$line.product.price", 0] }] } } } } } },
    { $project: { products: 0, items: 0 } }
  ];
}

function readFilters(query = {}) {
  return { sort: Object.hasOwn(SORTS, query.sort) ? query.sort : "value", page: toPositiveInt(query.page, 1) };
}

function canRemind(cart, now) {
  const customer = cart.customer || {};
  if (customer.isBlocked) return { ok: false, why: "Blocked customer" };
  if (customer.notifyPrefs && customer.notifyPrefs.offers === false) return { ok: false, why: "Turned off offer emails" };
  if (cart.reminderSentAt && now - new Date(cart.reminderSentAt) < REMIND_EVERY_HOURS * HOUR) return { ok: false, why: "Reminded in the last 24 hours" };
  return { ok: true, why: "" };
}

async function stats(now = new Date()) {
  const monthAgo = new Date(now.getTime() - 30 * 24 * HOUR);
  const [totals] = await Cart.aggregate([...abandonedPipeline(new Date(now.getTime() - IDLE_HOURS * HOUR)), { $group: { _id: null, carts: { $sum: 1 }, value: { $sum: "$value" } } }]);
  const [recovery] = await Cart.aggregate([
    { $match: { reminderSentAt: { $gte: monthAgo } } },
    { $lookup: { from: Order.collection.name, let: { user: "$user", at: "$reminderSentAt" }, as: "after", pipeline: [
      { $match: { $expr: { $and: [{ $eq: ["$user", "$$user"] }, { $gt: ["$createdAt", "$$at"] }] } } },
      { $limit: 1 },
      { $project: { _id: 1 } }
    ] } },
    { $group: { _id: null, reminded: { $sum: 1 }, recovered: { $sum: { $cond: [{ $gt: [{ $size: "$after" }, 0] }, 1, 0] } } } }
  ]);
  const reminded = recovery ? recovery.reminded : 0;
  const recovered = recovery ? recovery.recovered : 0;
  return {
    carts: totals ? totals.carts : 0,
    value: totals ? totals.value : 0,
    reminded,
    recovered,
    rate: reminded ? Math.round((recovered / reminded) * 1000) / 10 : 0
  };
}

async function listAbandoned(query = {}, now = new Date()) {
  const filters = readFilters(query);
  const cutoff = new Date(now.getTime() - IDLE_HOURS * HOUR);
  const [result] = await Cart.aggregate([
    ...abandonedPipeline(cutoff),
    { $facet: {
      rows: [{ $sort: SORTS[filters.sort] }, { $skip: (filters.page - 1) * PAGE_SIZE }, { $limit: PAGE_SIZE }],
      count: [{ $count: "n" }]
    } }
  ]);
  const total = result.count[0] ? result.count[0].n : 0;
  return {
    carts: result.rows.map(cart => {
      const remind = canRemind(cart, now);
      return {
        id: String(cart._id),
        customer: cart.customer ? { id: String(cart.customer._id), name: cart.customer.name, email: cart.customer.email } : null,
        lines: cart.lines.filter(line => line.product).map(line => ({ name: line.product.name, image: line.product.image, slug: line.product.slug, quantity: line.quantity, price: line.product.price, available: line.product.isListed !== false && line.product.stock > 0 })),
        value: cart.value,
        idleSince: cart.updatedAt,
        idleHours: Math.floor((now - new Date(cart.updatedAt)) / HOUR),
        reminderSentAt: cart.reminderSentAt,
        reminderCount: cart.reminderCount || 0,
        canRemind: remind.ok,
        whyNot: remind.why
      };
    }),
    stats: await stats(now),
    filters,
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

// "Send a reminder": checks it is allowed and puts it in the queue (the admin is not kept waiting for an email
// server, and a failed send is retried). The check is made again when the job runs, because carts change.
async function remind(cartId, _options = {}, now = new Date()) {
  if (!mongoose.isValidObjectId(cartId)) throw new HttpError(404, "Cart not found.");
  const [cart] = await Cart.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(cartId) } }, ...abandonedPipeline(new Date(now.getTime() - IDLE_HOURS * HOUR))]);
  if (!cart) throw new HttpError(404, "This cart is not abandoned (it is empty, or was used in the last 24 hours).");
  const allowed = canRemind(cart, now);
  if (!allowed.ok) throw new HttpError(400, `No reminder sent: ${allowed.why.toLowerCase()}.`);
  // One job per cart per day: pressing the button twice queues it once.
  await queue.enqueue("cart.remind", { cartId: String(cart._id) }, { dedupeKey: `cart.remind:${cart._id}:${Math.floor(now.getTime() / (REMIND_EVERY_HOURS * HOUR))}` });
  return { cart: { id: String(cart._id), customer: cart.customer.name, value: cart.value }, queued: true };
}

// The job: builds the email and sends it. Cart reminders are marketing, so they carry a List-Unsubscribe header
// and only go to customers who accept offer emails (checked here, not only when queued).
async function sendReminder(cartId, now = new Date()) {
  if (!mongoose.isValidObjectId(cartId)) return "missing";
  const [cart] = await Cart.aggregate([{ $match: { _id: new mongoose.Types.ObjectId(cartId) } }, ...abandonedPipeline(new Date(now.getTime() - IDLE_HOURS * HOUR))]);
  if (!cart) return "not-abandoned";
  if (!canRemind(cart, now).ok) return "not-allowed";

  const base = siteUrl();
  const lines = cart.lines.filter(line => line.product);
  if (!lines.length) return "empty";
  const first = cart.customer.name.split(" ")[0];
  const { html, text } = renderEmail({
    preheader: "Your cart is waiting.",
    heading: "You left something in your cart",
    paragraphs: [`Hi ${first}, these are still in your Nexthlon cart:`],
    sections: [
      { type: "items", items: lines.map(line => ({ name: line.product.name, detail: `Qty ${line.quantity}`, image: absoluteUrl(sizedUrl(line.product.image, 200), base), price: formatPaise(line.product.price * line.quantity) })) },
      { type: "facts", rows: [["Cart total", formatPaise(cart.value), { strong: true }]] }
    ],
    button: { label: "Pick up where you left off", url: `${base}/cart` },
    note: "Prices and stock can change, so grab them while they last. You get this because offer emails are on: turn them off any time in Your account > Notifications."
  });
  await mailService.send({
    to: cart.customer.email,
    subject: "You left something in your cart",
    html,
    text,
    headers: { "List-Unsubscribe": `<${base}/account/notifications>` }
  });
  // The cart's own "last changed" time is not touched (so it stays in the abandoned list), only the reminder fields.
  await Cart.updateOne({ _id: cart._id }, { $set: { reminderSentAt: now }, $inc: { reminderCount: 1 } }, { timestamps: false });
  return "sent";
}

// The hourly sweep (only with CART_RECOVERY_AUTO=true): a reminder job for every abandoned cart that is due.
async function queueDueReminders(now = new Date(), { limit = 100 } = {}) {
  const carts = await Cart.aggregate([...abandonedPipeline(new Date(now.getTime() - IDLE_HOURS * HOUR)), { $sort: { value: -1 } }, { $limit: limit * 3 }]);
  let queued = 0;
  for (const cart of carts) {
    if (queued >= limit) break;
    if (!canRemind(cart, now).ok || !cart.customer || cart.value <= 0) continue;
    await queue.enqueue("cart.remind", { cartId: String(cart._id) }, { dedupeKey: `cart.remind:${cart._id}:${Math.floor(now.getTime() / (REMIND_EVERY_HOURS * HOUR))}` });
    queued += 1;
  }
  return queued;
}

module.exports = { PAGE_SIZE, IDLE_HOURS, SORTS, readFilters, listAbandoned, stats, remind, sendReminder, queueDueReminders, canRemind };
