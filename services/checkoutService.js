const mongoose = require("mongoose");
const Address = require("../models/Address");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Counter = require("../models/Counter");
const cartService = require("./cartService");
const stockService = require("./stockService");
const { HttpError } = require("../utils/http");
const { COD_LIMIT } = require("../utils/orderRules");

const PAYMENT_METHODS = ["cod"];
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

// The order as it would be placed right now, worked out on the server from the live cart.
// Nothing the browser sends about prices is ever used.
async function buildQuote(userId) {
  const cart = await cartService.getCart(userId);
  const lines = cart.items.filter(item => item.available);
  const problems = cart.items.filter(item => !item.available).map(item => `${item.name}: ${item.reason.toLowerCase()}`);
  const { summary } = cart;
  const totals = {
    itemCount: summary.itemCount,
    mrpTotal: summary.mrpTotal,
    subtotal: summary.subtotal,
    discount: summary.savings,
    couponDiscount: 0,
    deliveryFee: summary.deliveryFee,
    walletUsed: 0,
    total: summary.grandTotal
  };
  return { items: cart.items, lines, problems, totals, codAllowed: totals.total <= COD_LIMIT, codLimit: COD_LIMIT };
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

// Checks that the cart can be ordered. Returns the quote, or throws a message for the shopper.
function assertOrderable(quote) {
  if (!quote.lines.length && !quote.problems.length) throw new HttpError(400, "Your cart is empty.");
  if (quote.problems.length) {
    throw new HttpError(409, `Some items are no longer available (${quote.problems.join("; ")}). Remove them from your cart to continue.`);
  }
}

// Places a Cash on Delivery order: re-checks everything, takes the stock atomically,
// saves the order with snapshots, then empties the cart.
async function placeOrder(userId, { addressId, paymentMethod }) {
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    throw new HttpError(400, "Choose a payment method.", { paymentMethod: "Choose a payment method." });
  }
  const address = await findAddress(userId, addressId);
  const quote = await buildQuote(userId);
  assertOrderable(quote);
  if (paymentMethod === "cod" && !quote.codAllowed) {
    throw new HttpError(400, "Cash on Delivery is available for orders up to ₹5,000. Please choose another payment method.");
  }

  const stockLines = quote.lines.map(line => ({ product: line.productId, quantity: line.quantity, name: line.name }));
  const orderId = await nextOrderId();
  const order = await stockService.withStock(stockLines, async session => {
    const [created] = await Order.create([{
      orderId,
      user: userId,
      items: itemSnapshots(quote.lines),
      address: addressSnapshot(address),
      ...quote.totals,
      paymentMethod,
      paymentStatus: "pending",
      orderStatus: "placed",
      stockReserved: true,
      statusHistory: [{ status: "placed", by: "customer", note: "Cash on Delivery" }]
    }], { session });
    await Cart.updateOne({ user: userId }, { $set: { items: [] } }, { session });
    return created;
  });
  return order;
}

module.exports = { PAYMENT_METHODS, nextOrderId, findAddress, addressSnapshot, buildQuote, itemSnapshots, assertOrderable, placeOrder };
