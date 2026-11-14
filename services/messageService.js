// WhatsApp order updates (E1) and one-time codes by SMS or WhatsApp (E2).
//
// Like email: without a provider set up, development and tests write the message to the console (and to a
// test outbox), production skips WhatsApp updates quietly (email still goes) and refuses to send codes.
// Each update is sent once, whatever retries happen: the key is recorded in EmailLog ("wa:order:...").
// WhatsApp updates go only to customers who switched them on (My Account > Notifications), to the phone
// on the order's delivery address.
const config = require("../config/env");
const logger = require("../utils/logger");
const Order = require("../models/Order");
const User = require("../models/User");
const EmailLog = require("../models/EmailLog");
const { createWhatsAppProvider } = require("../providers/messaging/whatsapp");
const { createSmsProvider } = require("../providers/messaging/sms");
const { formatPaise } = require("../utils/money");

let whatsapp = null;
let sms = null;
let testOutbox = null;

const getWhatsApp = () => {
  if (!whatsapp && config.messaging.whatsapp.enabled) whatsapp = createWhatsAppProvider(config.messaging.whatsapp);
  return whatsapp;
};
const getSms = () => {
  if (!sms && config.messaging.sms.enabled) sms = createSmsProvider(config.messaging.sms);
  return sms;
};

// Tests: collect messages instead of sending, or swap in fake providers.
function useTestOutbox(outbox) { testOutbox = outbox; }
function useProvidersForTests({ whatsapp: fakeWhatsApp = null, sms: fakeSms = null } = {}) { whatsapp = fakeWhatsApp; sms = fakeSms; }

// "98765 43210", "+91-9876543210", "09876543210" -> "919876543210". Anything that is not an Indian mobile -> null.
function toIndianMobile(phone) {
  let digits = String(phone || "").replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return /^[6-9][0-9]{9}$/.test(digits) ? `91${digits}` : null;
}
const masked = to => `${String(to).slice(0, 4)}******${String(to).slice(-2)}`;

const canMessage = () => Boolean(testOutbox || getWhatsApp() || !config.isProduction);
const canSendCodes = () => Boolean(testOutbox || getSms() || getWhatsApp() || !config.isProduction);

async function deliverWhatsApp(message) {
  if (testOutbox) {
    testOutbox.push({ channel: "whatsapp", ...message });
    return { provider: "test", id: String(testOutbox.length) };
  }
  const provider = getWhatsApp();
  if (provider) return provider.send(message);
  if (config.isProduction) return { provider: "none", id: "" };
  logger.info("whatsapp.console", { to: masked(message.to), template: message.template });
  console.log(`\n[WhatsApp not sent: no provider set up]\nTo: ${message.to}\nTemplate: ${message.template}\n${message.params.map((p, i) => `{{${i + 1}}} ${p}`).join("\n")}\n`);
  return { provider: "console", id: "" };
}

// A one-time code: SMS first (cheapest, works on every phone), else WhatsApp's authentication template.
async function sendOtp(to, code) {
  if (testOutbox) {
    testOutbox.push({ channel: "otp", to, code });
    return { provider: "test" };
  }
  if (getSms()) return getSms().sendOtp({ to, code });
  if (getWhatsApp()) return getWhatsApp().send({ to, template: "nx_cod_otp", params: [code], button: code });
  if (config.isProduction) throw new Error("No SMS or WhatsApp provider is set up for one-time codes.");
  console.log(`\n[Code not sent: no SMS or WhatsApp provider set up]\nTo: ${to}\nCode: ${code}\n`);
  return { provider: "console" };
}

// ---------- Order updates ----------

const TEMPLATES = {
  placed: order => ({ template: "nx_order_placed", params: [order.orderId, formatPaise(order.total + (order.walletUsed || 0))] }),
  shipped: order => {
    const s = (order.shipments || [])[order.shipments.length - 1];
    return { template: "nx_order_shipped", params: [order.orderId, s ? s.courier : "our courier", s ? s.trackingNumber : "-"] };
  },
  out_for_delivery: order => ({ template: "nx_out_for_delivery", params: [order.orderId] }),
  delivered: order => ({ template: "nx_order_delivered", params: [order.orderId] })
};

// Returns "sent" | "skipped" (already sent) | "opted-out" | "no-phone" | "off" | "missing".
async function sendOrderUpdate(kind, orderId) {
  const build = TEMPLATES[kind];
  if (!build) return "missing";
  if (!canMessage()) return "off";
  const order = await Order.findOne({ orderId }).lean();
  if (!order) return "missing";
  const user = await User.findById(order.user).select("name notifyPrefs isDeleted").lean();
  if (!user || user.isDeleted || !(user.notifyPrefs && user.notifyPrefs.whatsapp)) return "opted-out";
  const to = toIndianMobile(order.address && order.address.phone);
  if (!to) return "no-phone";
  const key = `wa:order:${order.orderId}:${kind}`;
  if (await EmailLog.findOne({ key, sentAt: { $ne: null } }).lean()) return "skipped";
  const { template, params } = build(order);
  const first = String(user.name || "").split(" ")[0] || "there";
  await EmailLog.updateOne({ key }, { $setOnInsert: { key, kind: `whatsapp:${kind}`, to: masked(to), orderId: order.orderId } }, { upsert: true });
  const result = await deliverWhatsApp({ to, template, params: [first, ...params] });
  await EmailLog.updateOne({ key }, { $set: { sentAt: new Date(), provider: result.provider || "", providerId: result.id || "" } });
  return "sent";
}

// The "Chat with us on WhatsApp" link, or "" when no support number is set.
function supportLink(text = "") {
  const number = config.messaging.supportNumber;
  if (!number) return "";
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

module.exports = { toIndianMobile, sendOtp, sendOrderUpdate, supportLink, canMessage, canSendCodes, useTestOutbox, useProvidersForTests, TEMPLATES };
