const mongoose = require("mongoose");
const User = require("../models/User");
const Product = require("../models/Product");
const { LOW_STOCK_LIMIT } = require("../config/catalog");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");

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
  return publicCustomer(user);
}

module.exports = { getDashboardStats, listCustomers, setCustomerBlocked };
