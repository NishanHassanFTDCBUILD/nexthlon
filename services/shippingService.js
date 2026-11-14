// Shipping (B5): where we deliver, booking parcels, and following them to the door.
//
//   checkPincode(pin)          the delivery estimate (services/deliveryService.js rules), confirmed by the
//                              courier platform when Shiprocket is set up: can it deliver, and is COD there?
//   shipOrder(orderId)         one click in the admin: book with Shiprocket, take the AWB, mark as shipped
//   handleTrackingUpdate(body) the courier's scans -> the order moves along (shipped, out for delivery,
//                              delivered), each step sending its usual email (events/listeners/orderEmails.js)
//   markRto(orderId, stage)    the parcel was refused or could not be delivered: "initiated" while it comes
//                              back, "received" once it is here (items cancelled, stock back, paid orders refunded)
//
// With SHIPPING_PROVIDER=manual (the default) the admin types the courier and AWB as before, the PIN code
// check uses the rules alone, and RTO is a button in the admin. Nothing here needs Shiprocket to work.
const crypto = require("crypto");
const config = require("../config/env");
const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const shiprocket = require("./shipping/shiprocket");
const deliveryService = require("./deliveryService");
const orderService = require("./orderService");
const events = require("../events");
const rules = require("../utils/orderRules");
const logger = require("../utils/logger");
const { HttpError } = require("../utils/http");

const usesShiprocket = () => config.shipping.provider === "shiprocket";

// ---------- PIN codes ----------

// Answers per PIN code are kept for 6 hours (couriers change their areas rarely), up to 5,000 codes.
const PIN_TTL_MS = 6 * 60 * 60 * 1000;
const PIN_CACHE_MAX = 5000;
const pinCache = new Map();

async function courierCheck(pincode) {
  const hit = pinCache.get(pincode);
  if (hit && Date.now() - hit.at < PIN_TTL_MS) return hit.value;
  const value = await shiprocket.serviceability(pincode, { cod: true });
  if (pinCache.size >= PIN_CACHE_MAX) pinCache.delete(pinCache.keys().next().value);
  pinCache.set(pincode, { at: Date.now(), value });
  return value;
}

async function checkPincode(pincode, now = new Date()) {
  const estimate = deliveryService.estimateDelivery(pincode, now);
  if (!estimate || !estimate.deliverable) return estimate;
  if (!usesShiprocket() || !config.shipping.pickupPincode) return { ...estimate, cod: true, checked: "rules" };
  try {
    const courier = await courierCheck(estimate.pincode);
    if (!courier) return { pincode: estimate.pincode, deliverable: false, reason: "Our couriers don't deliver to this PIN code yet." };
    return { ...estimate, cod: courier.cod, checked: "courier" };
  } catch (error) {
    // The courier platform is down or slow: the rules still give an honest estimate.
    logger.warn("shipping.pincode_check_failed", { error });
    return { ...estimate, cod: true, checked: "rules" };
  }
}

// ---------- Booking ----------

async function findOrder(orderId) {
  const order = await Order.findOne({ orderId: String(orderId || "").trim() });
  if (!order) throw new HttpError(404, "Order not found.");
  return order;
}

async function shipOrder(orderId, actor) {
  if (!usesShiprocket()) throw new HttpError(400, "One-click shipping needs Shiprocket. Set SHIPPING_PROVIDER=shiprocket and its login, or add the courier and AWB by hand.", null, "shipping_manual");
  const order = await findOrder(orderId);
  if (["cancelled", "returned"].includes(order.orderStatus)) throw new HttpError(400, "A cancelled or returned order can't be shipped.");
  if (!rules.nextStatuses(order.orderStatus).includes("shipped")) throw new HttpError(400, "This order has already shipped.");
  if (order.paymentMethod === "razorpay" && !rules.PAID_STATUSES.includes(order.paymentStatus)) throw new HttpError(400, "This order is not paid yet.");
  if ((order.shipments || []).some(s => s.provider === "shiprocket")) throw new HttpError(409, "This order is already booked with Shiprocket.", null, "shipping_booked");
  const ids = order.items.map(item => item.product);
  const [user, products] = await Promise.all([
    User.findById(order.user).select("email").lean(),
    Product.find({ _id: { $in: ids } }).select("shipWeight").lean()
  ]);
  const weights = new Map(products.filter(p => p.shipWeight > 0).map(p => [String(p._id), p.shipWeight]));
  const booked = await shiprocket.book(order, user, weights);
  order.shipments.push({ ...booked, provider: "shiprocket", addedBy: actor ? actor._id : null, status: "Pickup scheduled" });
  order.statusHistory.push({ status: "shipment_added", by: "admin", note: `${booked.courier} ${booked.trackingNumber} (Shiprocket)` });
  await order.save();
  const shipment = order.shipments[order.shipments.length - 1];
  await events.emit("order.shipment_added", { orderId: order.orderId, shipmentId: String(shipment._id), alreadyShipped: false }, { key: String(shipment._id) });
  await orderService.advanceStatus(order, "shipped", "admin");
  return { order, shipment };
}

// ---------- Tracking ----------

// The courier's words -> where the order is. Anything else is kept as a scan but moves nothing.
function mapCourierStatus(text) {
  const status = String(text || "").toUpperCase().replace(/[_-]+/g, " ").trim();
  if (!status) return null;
  if (/^RTO\b.*DELIVERED|^RETURNED TO ORIGIN|^RTO RECEIVED/.test(status)) return { rto: "received" };
  if (/^RTO\b|RETURN TO ORIGIN/.test(status)) return { rto: "initiated" };
  if (/^DELIVERED$/.test(status)) return { status: "delivered" };
  if (/OUT FOR DELIVERY/.test(status)) return { status: "out_for_delivery" };
  if (/^(PICKED UP|SHIPPED|IN TRANSIT|REACHED AT DESTINATION|REACHED DESTINATION|DESTINATION HUB|IN TRANSIT\b.*)/.test(status)) return { status: "shipped" };
  if (/^UNDELIVERED|DELIVERY ATTEMPTED|FAILED DELIVERY/.test(status)) return { attempt: true };
  return null;
}

// Shiprocket sends its token in the x-api-key header. Compared in constant time.
function webhookAuthorised(header) {
  const expected = config.shipping.shiprocket.webhookToken;
  if (!expected) return false;
  const a = Buffer.from(String(header || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const parseAt = value => {
  if (!value) return new Date();
  // Shiprocket writes "2026-11-14 10:20:00" in IST.
  const ist = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(value).trim());
  if (ist) return new Date(Date.UTC(+ist[1], +ist[2] - 1, +ist[3], +ist[4], +ist[5], +(ist[6] || 0)) - 5.5 * 60 * 60 * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

async function handleTrackingUpdate(body = {}) {
  const awb = String(body.awb || body.awb_code || "").trim();
  if (!awb) return { ignored: "no_awb" };
  const order = await Order.findOne({ "shipments.trackingNumber": awb });
  if (!order) return { ignored: "unknown_awb" };
  const shipment = order.shipments.find(s => s.trackingNumber === awb);
  const text = String(body.current_status || body.shipment_status || "").slice(0, 60);

  // Keep the scans we have not seen yet (the webhook sends the whole list every time).
  const seen = new Set(shipment.events.map(e => `${e.status}|${e.at.getTime()}`));
  const scans = Array.isArray(body.scans) ? body.scans : [];
  scans.slice(-50).forEach(scan => {
    const status = String(scan["sr-status-label"] || scan.activity || "").slice(0, 60);
    if (!status) return;
    const at = parseAt(scan.date);
    if (seen.has(`${status}|${at.getTime()}`)) return;
    seen.add(`${status}|${at.getTime()}`);
    shipment.events.push({ status, location: String(scan.location || "").slice(0, 120), at });
  });
  if (text) {
    const at = parseAt(body.current_timestamp);
    if (!seen.has(`${text}|${at.getTime()}`)) shipment.events.push({ status: text, location: "", at });
    shipment.status = text;
  }
  shipment.events.sort((a, b) => a.at - b.at);
  if (shipment.events.length > 60) shipment.events.splice(0, shipment.events.length - 60);
  if (body.etd) {
    const etd = parseAt(body.etd);
    if (etd > new Date(Date.now() - 24 * 60 * 60 * 1000)) shipment.expectedAt = etd;
  }
  await order.save();

  const move = mapCourierStatus(text);
  if (!move) return { orderId: order.orderId, moved: null };
  if (move.rto) {
    await markRto(order.orderId, move.rto, { reason: `Courier: ${text}`, by: "system" });
    return { orderId: order.orderId, moved: `rto_${move.rto}` };
  }
  if (move.status) {
    const current = rules.deriveOrderStatus(order.items);
    if (rules.nextStatuses(current).includes(move.status)) {
      await orderService.advanceStatus(order, move.status, "system");
      return { orderId: order.orderId, moved: move.status };
    }
  }
  return { orderId: order.orderId, moved: null };
}

// ---------- Refused or undeliverable parcels (RTO) ----------

async function markRto(orderId, stage, { reason = "", by = "admin" } = {}) {
  if (!["initiated", "received"].includes(stage)) throw new HttpError(400, "Choose initiated or received.");
  const order = await findOrder(orderId);
  if (order.rto && order.rto.stage === "received") return order;
  const status = rules.deriveOrderStatus(order.items);
  if (!["shipped", "out_for_delivery"].includes(status) && !(stage === "received" && order.rto && order.rto.stage === "initiated")) {
    throw new HttpError(400, "Only a parcel on its way can come back to us.");
  }
  if (stage === "initiated") {
    if (order.rto && order.rto.stage === "initiated") return order;
    order.rto = { stage: "initiated", reason: reason.slice(0, 200), at: new Date() };
    order.statusHistory.push({ status: "rto_initiated", by, note: reason || "Coming back to us: not delivered" });
    await order.save();
    await events.emit("order.rto", { orderId: order.orderId, stage: "initiated" }, { key: `${order.orderId}:rto:initiated` });
    return order;
  }
  // Back with us: the items that were on their way are cancelled, their stock returns, and money that was
  // paid goes back the way it came (Cash on Delivery collected nothing, so nothing is refunded).
  order.rto = { stage: "received", reason: (reason || (order.rto && order.rto.reason) || "").slice(0, 200), at: new Date() };
  order.statusHistory.push({ status: "rto_received", by, note: "Parcel back with us" });
  const items = order.items.filter(item => ["shipped", "out_for_delivery", "confirmed", "placed"].includes(item.status));
  await orderService.cancelItems(order, items, {
    reason: "The courier could not deliver it and brought it back to us",
    by: by === "system" ? "system" : "admin",
    refundMethod: order.paymentMethod === "razorpay" ? "original" : "wallet"
  });
  await events.emit("order.rto", { orderId: order.orderId, stage: "received" }, { key: `${order.orderId}:rto:received` });
  return order;
}

// Couriers shout ("REACHED AT DESTINATION HUB"): customers read "Reached at destination hub". RTO stays RTO.
const sentence = text => {
  const value = String(text || "").trim();
  if (!value || value !== value.toUpperCase()) return value;
  const lower = value.toLowerCase();
  return (lower.charAt(0).toUpperCase() + lower.slice(1)).replace(/\b(rto|awb|cod)\b/gi, word => word.toUpperCase());
};

// The tracking view for the customer's order page: the latest shipment's scans, newest first.
function trackingFor(order) {
  const shipment = (order.shipments || [])[order.shipments.length - 1];
  if (!shipment) return null;
  return {
    courier: shipment.courier,
    trackingNumber: shipment.trackingNumber,
    status: sentence(shipment.status),
    expectedAt: shipment.expectedAt || null,
    url: shipment.provider === "shiprocket" ? `https://shiprocket.co/tracking/${encodeURIComponent(shipment.trackingNumber)}` : "",
    events: [...(shipment.events || [])].reverse().slice(0, 12).map(e => ({ status: sentence(e.status), location: e.location, at: e.at }))
  };
}

module.exports = { sentence, checkPincode, shipOrder, handleTrackingUpdate, markRto, mapCourierStatus, webhookAuthorised, trackingFor, parseAt, usesShiprocket, _pinCache: pinCache };
