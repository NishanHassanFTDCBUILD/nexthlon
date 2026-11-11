const mongoose = require("mongoose");
const events = require("../events");
const Address = require("../models/Address");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Counter = require("../models/Counter");
const cartService = require("./cartService");
const buyNowService = require("./buyNowService");
const couponService = require("./couponService");
const walletService = require("./walletService");
const stockService = require("./stockService");
const { HttpError } = require("../utils/http");
const { orderTotals } = require("../utils/pricing");
const { COD_LIMIT } = require("../utils/orderRules");

// Placed here at once. Online payment (razorpay) goes through paymentService.
// "wallet" is used when the wallet covers the whole amount.
const PAYMENT_METHODS = ["cod", "wallet"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// NX-2026-000123: the year (in India) and a running number for that year.
async function nextOrderId(now = new Date()) {
  const year = new Date(now.getTime() + IST_OFFSET_MS).getUTCFullYear();
  const seq = await Counter.next(`order-${year}`);
  return `NX-${year}-${String(seq).padStart(6, "0")}`;
}

async function findAddress(userId, addressId) {
  if (!mongoose.isValidObjectId(addressId)) throw new HttpError(400, "Choose a delivery address.", { addressId: "Choose a delivery address." });
  const address = await Address.findOne({ _id: addressId, user: userId }).lean();
  if (!address) throw new HttpError(400, "Choose a delivery address.", { addressId: "Choose a delivery address." });
  return address;
}

function addressSnapshot(address) {
  const { fullName, phone, line1, line2, landmark, city, state, pincode } = address;
  return { fullName, phone, line1, line2, landmark, city, state, pincode };
}

// The items being checked out: the whole cart, or (source "buynow") the one Buy now product.
// Both come back in the same shape, so everything after this treats them the same way.
async function itemsFor(userId, source) {
  if (source !== "buynow") return cartService.getCart(userId);
  const view = await buyNowService.getView(userId);
  if (!view) throw new HttpError(410, buyNowService.EXPIRED_MESSAGE);
  return view;
}

// The order as it would be placed right now, worked out on the server from the live items,
// the coupon chosen for them (checked again) and the live wallet balance.
// Nothing the browser sends about prices is ever used; it only says whether to use the wallet
// and whether this is the cart or a Buy now checkout.
async function buildQuote(userId, { useWallet = false, source = "cart" } = {}) {
  const [cart, walletBalance] = await Promise.all([itemsFor(userId, source), walletService.getBalance(userId)]);
  const lines = cart.items.filter(item => item.available);
  const problems = cart.items.filter(item => !item.available).map(item => `${item.name}: ${item.reason.toLowerCase()}`);
  const { summary } = cart;

  let coupon = null;
  let couponNotice = "";
  if (cart.couponCode) {
    const checked = await couponService.check(cart.couponCode, userId, summary.subtotal);
    if (checked.problem) couponNotice = `${cart.couponCode}: ${checked.problem}`;
    else coupon = checked.coupon;
  }
  const totals = orderTotals({
    itemCount: summary.itemCount,
    mrpTotal: summary.mrpTotal,
    subtotal: summary.subtotal,
    coupon,
    walletBalance,
    useWallet: Boolean(useWallet)
  });
  return {
    source: source === "buynow" ? "buynow" : "cart",
    items: cart.items,
    lines,
    problems,
    totals,
    coupon: coupon ? couponService.toPublicCoupon(coupon, { saving: totals.couponDiscount }) : null,
    couponCode: cart.couponCode || "",
    couponNotice,
    walletBalance,
    useWallet: totals.walletUsed > 0,
    coveredByWallet: totals.payable > 0 && totals.total === 0,
    codAllowed: totals.total > 0 && totals.total <= COD_LIMIT,
    codLimit: COD_LIMIT
  };
}

// The quote as the browser sees it.
function publicQuote(quote) {
  return {
    source: quote.source,
    totals: quote.totals,
    problems: quote.problems,
    coupon: quote.coupon,
    couponCode: quote.couponCode,
    couponNotice: quote.couponNotice,
    walletBalance: quote.walletBalance,
    useWallet: quote.useWallet,
    coveredByWallet: quote.coveredByWallet,
    codAllowed: quote.codAllowed,
    codLimit: quote.codLimit,
    itemCount: quote.lines.length
  };
}

function itemSnapshots(lines) {
  return lines.map(line => ({
    product: line.productId,
    name: line.name,
    slug: line.slug,
    brand: line.brand || "",
    image: line.image || "",
    price: line.price,
    mrp: Math.max(line.mrp, line.price),
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    status: "placed"
  }));
}

// Checks that the cart can be ordered, or throws a message for the shopper.
function assertOrderable(quote) {
  const buyNow = quote.source === "buynow";
  if (!quote.lines.length && !quote.problems.length) throw new HttpError(400, buyNow ? buyNowService.EXPIRED_MESSAGE : "Your cart is empty.");
  if (quote.problems.length) {
    throw new HttpError(409, buyNow
      ? `This product is no longer available (${quote.problems.join("; ")}).`
      : `Some items are no longer available (${quote.problems.join("; ")}). Remove them from your cart to continue.`);
  }
  if (quote.couponNotice) throw new HttpError(409, `${quote.couponNotice} Remove the coupon to continue.`);
}

// The money fields an order keeps (all from the quote).
function orderMoney(totals) {
  const { mrpTotal, subtotal, discount, couponCode, couponDiscount, deliveryFee, walletUsed, total } = totals;
  return { mrpTotal, subtotal, discount, couponCode, couponDiscount, deliveryFee, walletUsed, total };
}

// Saves an order together with what goes with it: one use of the coupon and the wallet debit.
// Runs inside the caller's transaction (session), or registers undo steps (undo) on a single server.
async function saveOrder({ userId, orderId, quote, address, paymentMethod, paymentStatus, stockReserved, note }, session, undo) {
  const _id = new mongoose.Types.ObjectId();
  const { totals } = quote;
  if (quote.coupon && totals.couponDiscount > 0) {
    const coupon = (await couponService.check(quote.coupon.code, userId, totals.subtotal)).coupon;
    if (!coupon) throw new HttpError(409, "Your coupon is no longer valid. Remove it to continue.");
    await couponService.redeem(coupon, userId, _id, totals.couponDiscount, { session, undo });
  }
  if (totals.walletUsed > 0) {
    await walletService.debit(userId, totals.walletUsed, { reason: `Paid for order ${orderId}`, kind: "order", orderId, session, undo });
  }
  const [order] = await Order.create([{
    _id,
    orderId,
    user: userId,
    items: itemSnapshots(quote.lines),
    address: addressSnapshot(address),
    ...orderMoney(totals),
    source: quote.source === "buynow" ? "buynow" : "cart",
    paymentMethod,
    paymentStatus,
    orderStatus: "placed",
    stockReserved,
    statusHistory: [{ status: "placed", by: "customer", note }]
  }], { session });
  if (undo) undo(() => Order.deleteOne({ _id }));
  return order;
}

// Places an order paid on delivery (COD) or fully from the wallet: re-checks everything, takes
// the stock atomically, uses the coupon, takes the wallet amount, saves the order with
// snapshots, then empties the cart (or, for Buy now, only the Buy now product: the cart stays).
// All of it happens, or none of it.
async function placeOrder(userId, { addressId, paymentMethod, useWallet = false, source = "cart" }) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new HttpError(400, "Choose a payment method.", { paymentMethod: "Choose a payment method." });
  }
  const address = await findAddress(userId, addressId);
  const quote = await buildQuote(userId, { useWallet, source });
  assertOrderable(quote);

  // When the wallet covers everything, there is nothing to collect: it is a wallet order.
  const method = quote.coveredByWallet ? "wallet" : paymentMethod;
  if (method === "wallet" && !quote.coveredByWallet) {
    throw new HttpError(400, "Your wallet balance does not cover this order. Choose another way to pay the rest.");
  }
  if (method === "cod" && !quote.codAllowed) {
    throw new HttpError(400, "Cash on Delivery is available for orders up to ₹5,000. Please choose another payment method.");
  }

  const stockLines = quote.lines.map(line => ({ product: line.productId, quantity: line.quantity, name: line.name }));
  const orderId = await nextOrderId();
  const placed = await stockService.withStock(stockLines, async (session, undo) => {
    const order = await saveOrder({
      userId,
      orderId,
      quote,
      address,
      paymentMethod: method,
      paymentStatus: method === "wallet" ? "paid" : "pending",
      stockReserved: true,
      note: method === "wallet" ? "Paid from the Nexthlon wallet" : quote.totals.walletUsed ? "Part paid from the wallet, the rest on delivery" : "Cash on Delivery"
    }, session, undo);
    if (quote.source === "buynow") await buyNowService.clear(userId, session);
    else await Cart.updateOne({ user: userId }, { $set: { items: [], couponCode: "" } }, { session });
    return order;
  });
  // Saved for good: tell the rest of the app (the confirmation email is one reaction).
  await events.emit("order.placed", { orderId: placed.orderId }, { key: placed.orderId });
  return placed;
}

module.exports = {
  PAYMENT_METHODS,
  nextOrderId,
  findAddress,
  addressSnapshot,
  buildQuote,
  publicQuote,
  itemSnapshots,
  assertOrderable,
  orderMoney,
  saveOrder,
  placeOrder
};
