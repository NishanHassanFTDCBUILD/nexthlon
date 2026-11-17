const mongoose = require("mongoose");
const events = require("../events");
const Order = require("../models/Order");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");
const { STORE } = require("../config/store");
const rules = require("../utils/orderRules");
const referralService = require("./referralService");
const logger = require("../utils/logger");
const settlementService = require("./settlementService");

const PAGE_SIZE = 10;
const LIST_FILTERS = {
  all: null,
  active: { orderStatus: { $in: ["placed", "confirmed", "shipped", "out_for_delivery"] } },
  delivered: { orderStatus: "delivered" },
  cancelled: { orderStatus: "cancelled" },
  returns: { orderStatus: { $in: ["return_requested", "returned"] } }
};
const PERIODS = { all: null, "30d": 30, "3m": 92, "1y": 365 };

// Refunds go through refundService (to the wallet, or back to the card/UPI). Tests can swap it.
function setRefundHandler(handler) {
  settlementService.setRefundHandler(handler);
}

function readListFilters(query = {}) {
  return {
    status: Object.hasOwn(LIST_FILTERS, query.status) ? query.status : "all",
    period: Object.hasOwn(PERIODS, query.period) ? query.period : "all",
    q: typeof query.q === "string" ? query.q.trim().slice(0, 60) : "",
    page: toPositiveInt(query.page, 1)
  };
}

async function listOrders(userId, query, now = new Date()) {
  const filters = readListFilters(query);
  const filter = { user: userId, ...(LIST_FILTERS[filters.status] || {}) };
  if (PERIODS[filters.period]) filter.createdAt = { $gte: new Date(now.getTime() - PERIODS[filters.period] * 24 * 60 * 60 * 1000) };
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), "i");
    filter.$or = [{ orderId: pattern }, { "items.name": pattern }];
  }
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip((filters.page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Order.countDocuments(filter)
  ]);
  return { orders, filters, pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE } };
}

// Every customer lookup includes the owner, so nobody can see or change another customer's order.
async function getOwnedOrder(userId, orderId) {
  const id = String(orderId || "").trim().toUpperCase();
  if (!/^NX-\d{4}-\d{6}$/.test(id)) throw new HttpError(404, "Order not found.");
  const order = await Order.findOne({ orderId: id, user: userId });
  if (!order) throw new HttpError(404, "Order not found.");
  return order;
}

function settleStatus(order, by, note) {
  const status = rules.deriveOrderStatus(order.items);
  if (status !== order.orderStatus) {
    order.orderStatus = status;
    order.statusHistory.push({ status, by, note });
  }
}

// Cancels these items: stock goes back, what is left to pay goes down, and money already paid
// (online or from the wallet) is refunded. A fully cancelled order gives its coupon use back.
async function cancelItems(order, items, { reason = "", by = "customer", refundMethod = "wallet" } = {}) {
  if (by !== "system") settlementService.assertSettled(order);
  if ((order.settlements || []).some(entry => !entry.done)) throw new HttpError(409, "The previous order change is still processing. Please try again shortly.");
  const { refund, dueReduction } = rules.settlementFor(order, items.map(item => item._id));
  // Cash on delivery collects less. An unpaid online order keeps its amount, so a payment that
  // still arrives later is recognised and refunded in full.
  if (dueReduction > 0 && order.paymentMethod === "cod") order.total -= dueReduction;
  for (const item of items) {
    item.status = "cancelled";
    item.cancelReason = reason;
  }
  if (items.length !== order.items.length) {
    order.statusHistory.push({ status: "item_cancelled", by, note: `${items.map(item => (item.option ? `${item.name} (${item.option})` : item.name)).join(", ")} cancelled${reason ? `: ${reason}` : ""}` });
  }
  settleStatus(order, by, reason);
  if (order.orderStatus === "cancelled") order.cancelReason = reason;
  // Cash on delivery whose remaining items the wallet already covers: nothing is left to collect.
  if (order.paymentMethod === "cod" && order.paymentStatus === "pending" && order.total === 0 && order.orderStatus !== "cancelled") {
    order.paymentStatus = "paid";
  }
  const itemIds = items.map(item => String(item._id)).sort();
  const key = `cancel:${order._id}:${itemIds.join(":")}`;
  order.settlements.push({ key, itemIds, restoreStock: order.stockReserved, refund,
    method: refundMethod, reason: `Cancelled: ${reason || "by request"}`,
    event: "order.cancelled", payload: { orderId: order.orderId, itemIds, reason, by } });
  // Optimistic concurrency makes exactly one snapshot win. No stock or money
  // changes before this status and its recovery work have been saved together.
  await order.save();
  return settlementService.resume(order._id);
}

async function cancelOrder(userId, orderId, { reason, refundMethod } = {}) {
  let order = await getOwnedOrder(userId, orderId);
  const recovering = order.settlements.some(entry => !entry.done && entry.event === "order.cancelled");
  if (recovering) order = await settlementService.resume(order._id);
  const items = order.items.filter(rules.canCancelItem);
  if (recovering && !items.length) return order;
  if (!items.length) throw new HttpError(400, "This order can no longer be cancelled.");
  return cancelItems(order, items, { reason, by: "customer", refundMethod });
}

async function cancelItem(userId, orderId, itemId, { reason, refundMethod } = {}) {
  const order = await getOwnedOrder(userId, orderId);
  const item = mongoose.isValidObjectId(itemId) ? order.items.id(itemId) : null;
  if (!item) throw new HttpError(404, "That item is not in this order.");
  if (order.settlements.some(entry => !entry.done && entry.event === "order.cancelled" && entry.itemIds.includes(String(item._id)))) return settlementService.resume(order._id);
  if (!rules.canCancelItem(item)) throw new HttpError(400, `${item.name} can no longer be cancelled.`);
  const unpaidOnline = order.paymentMethod === "razorpay" && !rules.PAID_STATUSES.includes(order.paymentStatus);
  const others = order.items.filter(line => line !== item && line.status !== "cancelled");
  if (unpaidOnline && others.length) throw new HttpError(400, "This order is not paid yet. Pay for it, or cancel the whole order.");
  return cancelItems(order, [item], { reason, by: "customer", refundMethod });
}

// savePhotos (optional) stores the customer's photos; it runs only once the return is allowed.
async function requestReturn(userId, orderId, { reason, note }, now = new Date(), { savePhotos = null } = {}) {
  const order = await getOwnedOrder(userId, orderId);
  if (!rules.canRequestReturn(order, STORE.returnDays, now)) {
    throw new HttpError(400, `Returns can be requested within ${STORE.returnDays} days of delivery.`);
  }
  if (savePhotos) order.returnPhotos = await savePhotos();
  order.items.forEach(item => {
    if (item.status === "delivered") {
      item.status = "return_requested";
      item.returnReason = reason;
    }
  });
  order.returnReason = reason;
  order.returnNote = note;
  settleStatus(order, "customer", reason);
  await order.save();
  const seq = order.statusHistory.length;
  await events.emit("order.return_requested", { orderId: order.orderId, seq }, { key: `${order.orderId}:${seq}` });
  return order;
}

// Moves an order forward (admin). Never backwards, and cancelled items stay cancelled.
// Cash on Delivery is marked paid when the order is delivered.
async function advanceStatus(order, nextStatus, by = "admin", now = new Date()) {
  settlementService.assertSettled(order);
  const current = rules.deriveOrderStatus(order.items);
  if (!rules.nextStatuses(current).includes(nextStatus)) {
    throw new HttpError(400, `An order that is "${rules.STATUS_LABELS[current] || current}" cannot move to "${rules.STATUS_LABELS[nextStatus] || nextStatus}".`);
  }
  const target = rules.FLOW.indexOf(nextStatus);
  order.items.forEach(item => {
    const at = rules.FLOW.indexOf(item.status);
    if (at >= 0 && at < target) item.status = nextStatus;
  });
  if (nextStatus === "delivered") {
    order.deliveredAt = now;
    if (order.paymentMethod === "cod" && order.paymentStatus === "pending") order.paymentStatus = "paid";
  }
  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, by, at: now });
  await order.save();
  // A first delivered order pays out a referral (only once per customer; never fails the delivery).
  if (nextStatus === "delivered") {
    await referralService.rewardOnDelivery(order.user).catch(error => logger.error("referral.reward_failed", { order: order.orderId, error }));
  }
  await events.emit("order.status_changed", { orderId: order.orderId, status: nextStatus, previous: current }, { key: `${order.orderId}:${nextStatus}` });
  return order;
}

// The tracking timeline: each step of the journey, with the time it happened (if it has).
function timelineFor(order) {
  const reached = new Map();
  order.statusHistory.forEach(entry => {
    if (!reached.has(entry.status)) reached.set(entry.status, entry.at);
  });
  const steps = rules.FLOW.map(status => ({ status, label: rules.STATUS_LABELS[status], at: reached.get(status) || null, done: reached.has(status) }));
  if (order.orderStatus === "cancelled") {
    const kept = steps.filter(step => step.done);
    kept.push({ status: "cancelled", label: "Cancelled", at: reached.get("cancelled") || null, done: true });
    return kept;
  }
  if (["return_requested", "returned"].includes(order.orderStatus)) {
    steps.push({ status: "return_requested", label: "Return requested", at: reached.get("return_requested") || null, done: true });
    steps.push({ status: "returned", label: "Returned", at: reached.get("returned") || null, done: reached.has("returned") });
  }
  return steps;
}

module.exports = {
  PAGE_SIZE,
  LIST_FILTERS,
  PERIODS,
  setRefundHandler,
  readListFilters,
  listOrders,
  getOwnedOrder,
  cancelItems,
  cancelOrder,
  cancelItem,
  requestReturn,
  advanceStatus,
  timelineFor
};
