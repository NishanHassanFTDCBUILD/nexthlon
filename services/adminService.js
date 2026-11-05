const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Question = require("../models/Question");
const { LOW_STOCK_LIMIT } = require("../config/catalog");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");
const refreshTokenService = require("./refreshTokenService");

const PAGE_SIZE = 15;

async function getDashboardStats() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [
    customers, blockedCustomers, newCustomers,
    products, lowStock, outOfStock,
    recentCustomers, lowStockProducts
  ] = await Promise.all([
    User.countDocuments({ role: "customer" }),
    User.countDocuments({ role: "customer", isBlocked: true }),
    User.countDocuments({ role: "customer", createdAt: { $gte: weekAgo } }),
    Product.countDocuments({ ...Product.LISTED }),
    Product.countDocuments({ ...Product.LISTED, stock: { $gt: 0, $lte: LOW_STOCK_LIMIT } }),
    Product.countDocuments({ ...Product.LISTED, stock: 0 }),
    User.find({ role: "customer" }).sort({ createdAt: -1 }).limit(6).lean(),
    Product.find({ ...Product.LISTED, stock: { $lte: LOW_STOCK_LIMIT } })
      .sort({ stock: 1, name: 1 }).limit(6).select("name slug stock image category").populate("category", "name").lean()
  ]);

  return {
    stats: { customers, blockedCustomers, newCustomers, products, lowStock, outOfStock },
    recentCustomers: recentCustomers.map(publicCustomer),
    lowStockProducts
  };
}

function publicCustomer(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || "",
    isBlocked: Boolean(user.isBlocked),
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

async function listCustomers(query = {}) {
  const page = toPositiveInt(query.page, 1);
  const q = typeof query.q === "string" ? query.q.trim().slice(0, 80) : "";
  const status = ["active", "blocked"].includes(query.status) ? query.status : "all";

  const filter = { role: "customer" };
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ name: pattern }, { email: pattern }, { phone: pattern }];
  }
  if (status !== "all") filter.isBlocked = status === "blocked";

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    User.countDocuments(filter)
  ]);

  return {
    customers: users.map(publicCustomer),
    pagination: { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE },
    filters: { q, status }
  };
}

// Only customers can be blocked, so an admin can never lock out another admin by mistake.
async function setCustomerBlocked(userId, isBlocked) {
  if (!mongoose.isValidObjectId(userId)) throw new HttpError(404, "Customer not found.");
  const user = await User.findOneAndUpdate(
    { _id: userId, role: "customer" },
    { $set: { isBlocked } },
    { new: true }
  ).lean();
  if (!user) throw new HttpError(404, "Customer not found.");
  // Blocking takes effect at once for pages and APIs (middleware/auth.js reads isBlocked on every
  // request), and revoking the refresh tokens means the browser cannot renew its way back in.
  if (isBlocked) await refreshTokenService.revokeAllForUser(user._id, "blocked");
  return publicCustomer(user);
}

// ---------- Top bar: global search and the notification bell ----------

// Up to 5 orders, products and customers matching the text (order id, names, email or phone).
async function globalSearch(term) {
  const pattern = new RegExp(escapeRegex(term), "i");
  const [orders, products, customers] = await Promise.all([
    Order.find({ $or: [{ orderId: pattern }, { "address.fullName": pattern }, { "address.phone": pattern }] })
      .sort({ createdAt: -1 }).limit(5).select("orderId total orderStatus createdAt address.fullName").lean(),
    Product.find({ $or: [{ name: pattern }, { brand: pattern }] })
      .sort({ name: 1 }).limit(5).select("name brand stock isListed image").lean(),
    User.find({ role: "customer", isDeleted: { $ne: true }, $or: [{ name: pattern }, { email: pattern }, { phone: pattern }] })
      .sort({ createdAt: -1 }).limit(5).select("name email phone isBlocked").lean()
  ]);
  return {
    orders: orders.map(o => ({ orderId: o.orderId, customer: (o.address && o.address.fullName) || "", total: o.total, status: o.orderStatus, createdAt: o.createdAt })),
    products: products.map(p => ({ id: String(p._id), name: p.name, brand: p.brand || "", stock: p.stock, isListed: p.isListed !== false })),
    customers: customers.map(c => ({ id: String(c._id), name: c.name, email: c.email, phone: c.phone || "", isBlocked: Boolean(c.isBlocked) }))
  };
}

// What needs the team's attention. Each item links to a section of the console (by key).
async function notifications(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [newOrders, toConfirm, returns, lowStock, outOfStock, unanswered] = await Promise.all([
    Order.countDocuments({ createdAt: { $gte: dayAgo } }),
    Order.countDocuments({ orderStatus: "placed" }),
    Order.countDocuments({ orderStatus: "return_requested" }),
    Product.countDocuments({ ...Product.LISTED, stock: { $gt: 0, $lte: LOW_STOCK_LIMIT } }),
    Product.countDocuments({ ...Product.LISTED, stock: 0 }),
    Question.countDocuments({ isHidden: false, answered: false })
  ]);
  const items = [
    { key: "new-orders", label: "New orders in the last 24 hours", count: newOrders, section: "orders", icon: "package-check" },
    { key: "to-confirm", label: "Orders waiting to be confirmed", count: toConfirm, section: "orders", icon: "clock" },
    { key: "returns", label: "Return requests", count: returns, section: "returns", icon: "rotate-ccw" },
    { key: "low-stock", label: "Products low on stock", count: lowStock, section: "products?status=low", icon: "alert" },
    { key: "out-of-stock", label: "Products out of stock", count: outOfStock, section: "products?status=out", icon: "box" },
    { key: "questions", label: "Questions waiting for an answer", count: unanswered, section: "questions?answered=no", icon: "help" }
  ];
  // The badge counts what someone has to act on (new orders are only news).
  const total = toConfirm + returns + lowStock + outOfStock + unanswered;
  return { items, total };
}

module.exports = { getDashboardStats, listCustomers, setCustomerBlocked, globalSearch, notifications };
