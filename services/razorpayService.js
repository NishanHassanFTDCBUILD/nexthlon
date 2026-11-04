// The only place that talks to Razorpay. The key secret and webhook secret stay on the server;
// the browser only ever gets the public key id. Signatures are checked with HMAC-SHA256 and
// compared with crypto.timingSafeEqual, so the comparison time gives nothing away.
const crypto = require("crypto");
const Razorpay = require("razorpay");
const config = require("../config/env");
const { HttpError } = require("../utils/http");

let client = null;

function isEnabled() {
  return Boolean(config.razorpay.enabled);
}

function getClient() {
  if (!isEnabled()) throw new HttpError(503, "Online payment is not available right now. Please choose Cash on Delivery.");
  if (!client) client = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
  return client;
}

// Tests swap in a fake client so no real API calls are made.
function setClient(fake) {
  client = fake;
}

function hmac(secret, text) {
  return crypto.createHmac("sha256", secret).update(text).digest("hex");
}

function safeEqual(expected, given) {
  if (typeof given !== "string" || !/^[a-f0-9]{64}$/i.test(given)) return false;
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(given.toLowerCase(), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Checkout signature: HMAC-SHA256 of "order_id|payment_id" with the key secret.
function verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, signature) {
  if (!config.razorpay.keySecret) return false;
  return safeEqual(hmac(config.razorpay.keySecret, `${razorpayOrderId}|${razorpayPaymentId}`), signature);
}

// Webhook signature: HMAC-SHA256 of the raw request body with the webhook secret.
function verifyWebhookSignature(rawBody, signature) {
  if (!config.razorpay.webhookSecret || !Buffer.isBuffer(rawBody)) return false;
  return safeEqual(hmac(config.razorpay.webhookSecret, rawBody), signature);
}

// amount is in paise; receipt is our order id (NX-2026-000123).
async function createOrder({ amount, receipt, notes = {} }) {
  return getClient().orders.create({ amount, currency: "INR", receipt, notes });
}

async function refundPayment(paymentId, amount, notes = {}) {
  return getClient().payments.refund(paymentId, { amount, speed: "normal", notes });
}

// Payment events are logged with ids and amounts only. Never card numbers, UPI ids or contact details.
function logEvent(event, details) {
  if (process.env.NODE_ENV === "test") return;
  const parts = Object.entries(details).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => `${key}=${value}`);
  console.info(`[payments] ${event} ${parts.join(" ")}`);
}

module.exports = { isEnabled, setClient, verifyPaymentSignature, verifyWebhookSignature, createOrder, refundPayment, logEvent, hmac };
