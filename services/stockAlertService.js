// Back-in-stock alerts (E3). A shopper asks to be emailed when a sold-out product (or one size or colour of
// it) is back; when stock returns, each of them gets one email.
//
//   subscribe(productId, { email, variantId, user })  saves the wish (asking twice is fine)
//   sweep()      finds waiting alerts whose product is back, and queues one email job for each.
//                Runs every 10 minutes (jobs/handlers.js) and straight after an admin restocks (kick()).
//   notify(id)   the email job: claims the alert first, so two workers never send the same email
//   stop(id, sig) the "stop this alert" link in the email; signed, so nobody can stop someone else's
//
// The email goes to whoever asked, signed in or not. Only the address they typed is kept, and only until
// 90 days after the email went out (the TTL index on models/StockAlert.js).
const crypto = require("crypto");
const mongoose = require("mongoose");
const config = require("../config/env");
const StockAlert = require("../models/StockAlert");
const Product = require("../models/Product");
const mailService = require("./mailService");
const queue = require("../jobs/queue");
const { renderEmail, siteUrl, absoluteUrl } = require("../utils/emailLayout");
const { sizedUrl } = require("../utils/images");
const { formatPaise } = require("../utils/money");
const { findOption, optionLabel, hasOptions } = require("../utils/options");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { HttpError } = require("../utils/http");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// One address can wait for at most this many products at once (stops a script filling the table).
const MAX_WAITING_PER_EMAIL = 25;
const SWEEP_BATCH = 500;

const signature = id => crypto.createHmac("sha256", String(config.jwtSecret)).update(`stock-alert:${id}`).digest("base64url").slice(0, 32);
const stopUrl = (base, id) => `${base}/stock-alerts/stop?id=${id}&sig=${signature(id)}`;

function inStock(product, variantId) {
  if (!product || product.stock <= 0) return false;
  if (!variantId) return true;
  const option = findOption(product, variantId);
  return Boolean(option && option.stock > 0);
}

async function subscribe(productId, { email, variantId = null, user = null } = {}) {
  const address = String(email || (user && user.email) || "").trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 254) throw new HttpError(400, "Enter a valid email address.", { email: "Enter a valid email address." });
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findOne({ _id: productId, ...LISTED_PRODUCT }).select("name stock variants").lean();
  if (!product) throw new HttpError(404, "Product not found.");
  let variant = null;
  if (variantId) {
    const option = findOption(product, variantId);
    if (!option) throw new HttpError(400, "Choose a size or colour of this product.", { variantId: "Choose an option." });
    variant = option._id;
  }
  if (inStock(product, variant)) {
    throw new HttpError(400, variant || !hasOptions(product) ? "Good news: it is in stock right now." : "Some sizes are in stock: choose yours, or pick the sold-out one to be told.", null, "in_stock");
  }
  const waiting = await StockAlert.countDocuments({ email: address, notifiedAt: null });
  if (waiting >= MAX_WAITING_PER_EMAIL) throw new HttpError(429, `You are already waiting for ${MAX_WAITING_PER_EMAIL} products. We will email you as they come back.`, null, "alert_limit");
  // Asking again: an alert that already went out starts waiting again.
  await StockAlert.updateOne(
    { email: address, product: product._id, variant },
    { $set: { notifiedAt: null, user: user ? user._id : null } },
    { upsert: true }
  );
  const label = variant ? optionLabel(findOption(product, variant)) : "";
  return { email: address, product: product.name, option: label };
}

// Every waiting alert whose product (or option) is back: one email job each.
async function sweep({ limit = SWEEP_BATCH } = {}) {
  const productIds = await StockAlert.distinct("product", { notifiedAt: null });
  if (!productIds.length) return 0;
  const products = await Product.find({ _id: { $in: productIds }, ...LISTED_PRODUCT, stock: { $gt: 0 } }).select("stock variants").lean();
  let queued = 0;
  for (const product of products) {
    if (queued >= limit) break;
    const alerts = await StockAlert.find({ product: product._id, notifiedAt: null }).select("_id variant").limit(limit - queued).lean();
    for (const alert of alerts) {
      if (!inStock(product, alert.variant)) continue;
      await queue.enqueue("stock.alert", { alertId: String(alert._id) }, { dedupeKey: `stock.alert:${alert._id}` });
      queued += 1;
    }
  }
  return queued;
}

// Right after a restock: a sweep within seconds instead of waiting for the next 10-minute run.
function kick() {
  const slot = Math.floor(Date.now() / 30000);
  return queue.enqueue("stock.sweep", {}, { dedupeKey: `stock.sweep:${slot}`, maxAttempts: 2 }).catch(() => null);
}

async function notify(alertId) {
  if (!mongoose.isValidObjectId(alertId)) return "missing";
  const alert = await StockAlert.findById(alertId).lean();
  if (!alert || alert.notifiedAt) return "done";
  const product = await Product.findOne({ _id: alert.product, ...LISTED_PRODUCT }).lean();
  if (!inStock(product, alert.variant)) return "sold-again";
  // Claim it: only one worker gets past this line for one alert.
  const claimed = await StockAlert.findOneAndUpdate({ _id: alert._id, notifiedAt: null }, { $set: { notifiedAt: new Date() } });
  if (!claimed) return "done";
  const base = siteUrl();
  const option = alert.variant ? optionLabel(findOption(product, alert.variant)) : "";
  const link = `${base}/products/${product.slug}${alert.variant ? `?option=${alert.variant}` : ""}`;
  const { html, text } = renderEmail({
    preheader: `${product.name} is back in stock.`,
    heading: "It's back in stock",
    paragraphs: [`Good news: ${product.name}${option ? ` (${option})` : ""} is back. Stock can go quickly, so grab it while it lasts.`],
    sections: [{ type: "items", items: [{ name: product.name, detail: option || product.brand || "", image: absoluteUrl(sizedUrl(product.image, 200), base), price: formatPaise(product.price) }] }],
    button: { label: "Get it now", url: link },
    note: `You asked us to email you when this came back, so this is the only email for it. Didn't ask? Someone may have typed your address: remove it here ${stopUrl(base, alert._id)}`
  });
  try {
    await mailService.send({ to: alert.email, subject: `Back in stock: ${product.name}`, html, text, headers: { "List-Unsubscribe": `<${stopUrl(base, alert._id)}>` } });
  } catch (error) {
    // Not sent: give the claim back so the retry can send it.
    await StockAlert.updateOne({ _id: alert._id }, { $set: { notifiedAt: null } });
    throw error;
  }
  // Signed-in shoppers also get a push notification on devices they allowed (E5).
  if (alert.user) await require("./pushService").sendToUser(alert.user, { title: "Back in stock", body: `${product.name}${option ? ` (${option})` : ""} is back. Grab it before it goes.`, url: link.replace(base, ""), tag: `stock-${product._id}` }).catch(() => 0);
  return "sent";
}

async function stop(id, sig) {
  if (!mongoose.isValidObjectId(id) || typeof sig !== "string") return null;
  const expected = Buffer.from(signature(id));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const alert = await StockAlert.findByIdAndDelete(id).lean();
  if (!alert) return { product: null };
  const product = await Product.findById(alert.product).select("slug name").lean();
  return { product };
}

// The product page: which options this shopper is already waiting for (so the button says so).
async function waitingFor(productId, email) {
  if (!email || !mongoose.isValidObjectId(productId)) return [];
  const rows = await StockAlert.find({ product: productId, email: String(email).toLowerCase(), notifiedAt: null }).select("variant").lean();
  return rows.map(row => (row.variant ? String(row.variant) : "any"));
}

module.exports = { subscribe, sweep, kick, notify, stop, waitingFor, signature, stopUrl, inStock, MAX_WAITING_PER_EMAIL };
