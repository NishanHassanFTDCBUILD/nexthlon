// Analytics: the numbers behind the admin's Analytics section.
//
// It reuses the dashboard's date handling (services/dashboardService.js) so a "day" is an Indian
// calendar day there and here. On top of the range it adds a grouping the admin can choose:
// by day, by week or by month. Money is in paise.
//
// What it answers:
//   revenue & orders over time        timeline
//   top-selling products              topProducts (by revenue and by units)
//   top categories                    topCategories
//   average order value               summary.aov, and aov per bucket in the timeline
//   new vs returning customers        newReturning
//   payment method split              payments (Razorpay / wallet / COD)
//   conversion (carts -> orders)      funnel
const Order = require("../models/Order");
const Cart = require("../models/Cart");
const User = require("../models/User");
const { PAID_STATUSES } = require("../utils/orderRules");
const { readRange, bucketStarts, bucketLabel, change } = require("./dashboardService");

const TZ = "Asia/Kolkata";
const DAY = 24 * 60 * 60 * 1000;
// How the admin may group the range. "auto" follows the range length, as the dashboard does.
const GROUPS = ["auto", "day", "week", "month"];
const GROUP_LABELS = { auto: "Automatic", day: "By day", week: "By week", month: "By month" };

const inRange = (field, from, to) => ({ [field]: { $gte: from, $lt: to } });
const truncate = (field, unit) => ({ $dateTrunc: { date: `$${field}`, unit, timezone: TZ } });
// Money actually received for a paid order: what was charged plus the wallet part, less refunds.
const WALLET = { $ifNull: ["$walletUsed", 0] };
const CHARGED = { $add: [{ $ifNull: ["$total", 0] }, WALLET] };
const PAID_AMOUNT = { $subtract: [CHARGED, { $ifNull: ["$refundedAmount", 0] }] };
const isPaid = { $in: ["$paymentStatus", PAID_STATUSES] };
// Items that really sold: the order is not cancelled and neither is the line.
const liveItems = match => [
  match,
  { $match: { orderStatus: { $ne: "cancelled" } } },
  { $unwind: "$items" },
  { $match: { "items.status": { $ne: "cancelled" } } }
];

// Reads ?by=day|week|month on top of the range. "week" needs a range of at least a week, and
// "day" is refused for a range of months, so a chart never ends up with 400 bars.
function readGroup(query = {}, range) {
  const asked = GROUPS.includes(query.by) ? query.by : "auto";
  if (asked === "auto") return { key: "auto", unit: range.bucket, label: GROUP_LABELS.auto };
  const spanDays = (range.to - range.from) / DAY;
  const tooMany = asked === "day" && spanDays > 120;
  const tooFew = (asked === "week" && spanDays < 7) || (asked === "month" && spanDays < 28);
  const unit = tooMany || tooFew ? range.bucket : asked;
  return { key: tooMany || tooFew ? "auto" : asked, unit, label: GROUP_LABELS[tooMany || tooFew ? "auto" : asked] };
}

// Every bucket start in the range, so empty days or weeks still show as zero.
// Weeks are handled here because the dashboard only needs hour, day and month.
function startsFor(range, unit) {
  if (unit !== "week") return bucketStarts({ ...range, bucket: unit });
  const starts = [];
  const [first] = bucketStarts({ ...range, bucket: "day" });
  if (!first) return starts;
  // $dateTrunc puts a week on the Sunday before it, so the first bucket starts there too.
  const shifted = new Date(first.getTime() + 330 * 60 * 1000);
  const weekStart = new Date(first.getTime() - shifted.getUTCDay() * DAY);
  for (let t = weekStart.getTime(); t < range.to.getTime(); t += 7 * DAY) starts.push(new Date(t));
  return starts;
}

const weekLabel = date => {
  const end = new Date(date.getTime() + 6 * DAY);
  return `${bucketLabel(date, "day")} – ${bucketLabel(end, "day")}`;
};
const labelFor = (date, unit) => (unit === "week" ? weekLabel(date) : bucketLabel(date, unit));

// ---------- The pieces ----------

// Revenue, orders and the average order value per bucket.
async function timeline(range, unit) {
  const rows = await Order.aggregate([
    { $match: inRange("createdAt", range.from, range.to) },
    { $group: {
      _id: truncate("createdAt", unit),
      orders: { $sum: 1 },
      revenue: { $sum: { $cond: [isPaid, PAID_AMOUNT, 0] } },
      paidOrders: { $sum: { $cond: [isPaid, 1, 0] } }
    } }
  ]);
  return startsFor(range, unit).map(start => {
    const row = rows.find(r => r._id && r._id.getTime() === start.getTime()) || {};
    const revenue = row.revenue || 0;
    return {
      label: labelFor(start, unit),
      orders: row.orders || 0,
      revenue,
      aov: row.paidOrders ? Math.round(revenue / row.paidOrders) : 0
    };
  });
}

// Orders from customers who had never ordered before, against the rest, per bucket.
async function newReturning(range, unit) {
  const rows = await Order.aggregate([
    { $match: inRange("createdAt", range.from, range.to) },
    { $lookup: { from: "orders", let: { user: "$user", at: "$createdAt" }, as: "earlier", pipeline: [
      { $match: { $expr: { $and: [{ $eq: ["$user", "$$user"] }, { $lt: ["$createdAt", "$$at"] }] } } },
      { $limit: 1 },
      { $project: { _id: 1 } }
    ] } },
    { $group: {
      _id: truncate("createdAt", unit),
      newCustomers: { $sum: { $cond: [{ $eq: [{ $size: "$earlier" }, 0] }, 1, 0] } },
      returning: { $sum: { $cond: [{ $gt: [{ $size: "$earlier" }, 0] }, 1, 0] } }
    } }
  ]);
  return startsFor(range, unit).map(start => {
    const row = rows.find(r => r._id && r._id.getTime() === start.getTime()) || {};
    return { label: labelFor(start, unit), newCustomers: row.newCustomers || 0, returning: row.returning || 0 };
  });
}

async function topProducts(range, limit = 10) {
  const rows = await Order.aggregate([
    ...liveItems({ $match: inRange("createdAt", range.from, range.to) }),
    { $group: { _id: "$items.product", name: { $last: "$items.name" }, slug: { $last: "$items.slug" }, revenue: { $sum: "$items.lineTotal" }, units: { $sum: "$items.quantity" }, orders: { $addToSet: "$_id" } } },
    { $project: { name: 1, slug: 1, revenue: 1, units: 1, orders: { $size: "$orders" } } },
    { $sort: { revenue: -1 } },
    { $limit: 50 }
  ]);
  const shape = row => ({ id: String(row._id), name: row.name, slug: row.slug || "", revenue: row.revenue, units: row.units, orders: row.orders });
  const byUnits = [...rows].sort((a, b) => b.units - a.units || b.revenue - a.revenue);
  return { byRevenue: rows.slice(0, limit).map(shape), byUnits: byUnits.slice(0, limit).map(shape) };
}

async function topCategories(range, limit = 8) {
  const rows = await Order.aggregate([
    ...liveItems({ $match: inRange("createdAt", range.from, range.to) }),
    { $lookup: { from: "products", localField: "items.product", foreignField: "_id", as: "product", pipeline: [{ $project: { category: 1 } }] } },
    { $lookup: { from: "categories", localField: "product.category", foreignField: "_id", as: "category", pipeline: [{ $project: { name: 1 } }] } },
    { $group: { _id: { $ifNull: [{ $first: "$category.name" }, "Other"] }, revenue: { $sum: "$items.lineTotal" }, units: { $sum: "$items.quantity" } } },
    { $sort: { revenue: -1 } },
    { $limit: limit }
  ]);
  return rows.map(row => ({ name: row._id, revenue: row.revenue, units: row.units }));
}

// How the money came in: Razorpay, wallet-only orders, or cash on delivery.
async function payments(range) {
  const rows = await Order.aggregate([
    { $match: inRange("createdAt", range.from, range.to) },
    { $group: { _id: "$paymentMethod", count: { $sum: 1 }, amount: { $sum: CHARGED }, paid: { $sum: { $cond: [isPaid, 1, 0] } } } },
    { $sort: { count: -1 } }
  ]);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map(row => ({
    key: row._id,
    count: row.count,
    paid: row.paid,
    amount: row.amount,
    share: total ? Math.round((row.count / total) * 1000) / 10 : 0
  }));
}

// Conversion, carts -> orders. A cart counts once it has had something in it during the range
// (Cart keeps one row per customer, so "carts" means "shoppers who filled a basket").
// Orders placed in the range are the step after it; what is left never became an order.
async function funnel(range) {
  const [carts, orders, paid] = await Promise.all([
    Cart.countDocuments({ "items.0": { $exists: true }, ...inRange("updatedAt", range.from, range.to) }),
    Order.countDocuments(inRange("createdAt", range.from, range.to)),
    Order.countDocuments({ paymentStatus: { $in: PAID_STATUSES }, ...inRange("createdAt", range.from, range.to) })
  ]);
  // A cart that became an order is counted in both steps, so the base is carts plus those orders
  // that started from a cart emptied in the same period.
  const baskets = Math.max(carts, orders);
  return {
    carts: baskets,
    orders,
    paid,
    cartToOrder: baskets ? Math.round((orders / baskets) * 1000) / 10 : 0,
    orderToPaid: orders ? Math.round((paid / orders) * 1000) / 10 : 0,
    abandoned: Math.max(baskets - orders, 0)
  };
}

// The headline totals for the range, each with the change against the period before it.
async function summary(range) {
  const totals = async (from, to) => {
    const [[money] = [], [units] = [], newCustomers] = await Promise.all([
      Order.aggregate([
        { $match: inRange("createdAt", from, to) },
        { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: { $cond: [isPaid, PAID_AMOUNT, 0] } }, paidOrders: { $sum: { $cond: [isPaid, 1, 0] } }, buyers: { $addToSet: "$user" } } }
      ]),
      Order.aggregate([
        ...liveItems({ $match: inRange("createdAt", from, to) }),
        { $group: { _id: null, units: { $sum: "$items.quantity" } } }
      ]),
      User.countDocuments({ role: "customer", ...inRange("createdAt", from, to) })
    ]);
    const orders = money ? money.orders : 0;
    const revenue = money ? money.revenue : 0;
    const paidOrders = money ? money.paidOrders : 0;
    return {
      revenue,
      orders,
      aov: paidOrders ? Math.round(revenue / paidOrders) : 0,
      units: units ? units.units : 0,
      buyers: money ? money.buyers.length : 0,
      newCustomers
    };
  };
  const [now, before, steps] = await Promise.all([
    totals(range.from, range.to),
    totals(range.prevFrom, range.prevTo),
    funnel(range)
  ]);
  const cards = [
    { key: "revenue", label: "Revenue (paid)", format: "money", value: now.revenue, change: change(now.revenue, before.revenue) },
    { key: "orders", label: "Orders", format: "number", value: now.orders, change: change(now.orders, before.orders) },
    { key: "aov", label: "Average order value", format: "money", value: now.aov, change: change(now.aov, before.aov) },
    { key: "units", label: "Units sold", format: "number", value: now.units, change: change(now.units, before.units) },
    { key: "buyers", label: "Customers who ordered", format: "number", value: now.buyers, change: change(now.buyers, before.buyers) },
    { key: "newCustomers", label: "New customers", format: "number", value: now.newCustomers, change: change(now.newCustomers, before.newCustomers) },
    { key: "cartToOrder", label: "Carts that became orders", format: "percent", value: steps.cartToOrder, change: null, hint: "Orders placed, out of the shoppers who filled a basket in this period" }
  ];
  return { cards, funnel: steps };
}

// Everything the Analytics page needs, for one range and grouping.
async function analytics(query = {}, now = new Date()) {
  const range = readRange(query, now);
  const group = readGroup(query, range);
  const [head, line, people, products, categories, methods] = await Promise.all([
    summary(range),
    timeline(range, group.unit),
    newReturning(range, group.unit),
    topProducts(range),
    topCategories(range),
    payments(range)
  ]);
  return {
    range,
    group,
    groups: GROUP_LABELS,
    cards: head.cards,
    funnel: head.funnel,
    timeline: line,
    newReturning: people,
    topProducts: products,
    topCategories: categories,
    payments: methods
  };
}

module.exports = { GROUPS, GROUP_LABELS, readGroup, startsFor, timeline, newReturning, topProducts, topCategories, payments, funnel, summary, analytics };
