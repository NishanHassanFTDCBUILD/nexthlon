// The customer wallet. Money is in paise.
// The balance only changes here, with ONE atomic update each time:
//   credit  $inc balance by +amount
//   debit   $inc balance by -amount, only if balance >= amount (so it can never go below 0)
// Every change also writes a WalletTransaction with the balance right after it.
// Pass a session to run inside the caller's MongoDB transaction; on a single server pass the
// caller's undo() instead, so a failed order puts the money back.
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const { HttpError } = require("../utils/http");
const { toPositiveInt } = require("./productService");
const logger = require("../utils/logger");

const PAGE_SIZE = 10;

function assertAmount(amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error(`Wallet amounts must be whole paise above 0 (got ${amount}).`);
}

async function getBalance(userId) {
  const wallet = await Wallet.findOne({ user: userId }).select("balance").lean();
  return wallet ? wallet.balance : 0;
}

// Adds money. With a key, the same credit can never happen twice (the key is unique).
// Returns the transaction, or null when this key was already credited.
async function credit(userId, amount, { reason, kind = "refund", orderId = "", key, session = null } = {}) {
  assertAmount(amount);
  let entry;
  try {
    [entry] = await WalletTransaction.create([{ user: userId, type: "credit", amount, kind, reason, orderId, key, applied: false }], { session });
  } catch (error) {
    if (error.code !== 11000 || !key) throw error;
    entry = await WalletTransaction.findOne({ key }).session(session);
    if (!entry || String(entry.user) !== String(userId) || entry.amount !== amount || entry.type !== "credit") {
      throw new HttpError(409, "This wallet operation conflicts with an earlier credit.");
    }
    if (entry.applied !== false) return null;
  }
  // The receipt and balance move together. A crash before the history update is
  // recoverable: retrying the same key repairs history without another credit.
  try {
    await Wallet.updateOne({ user: userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const receipt = String(entry._id);
  let wallet = await Wallet.findOneAndUpdate(
    { user: userId, creditReceipts: { $ne: receipt } },
    { $inc: { balance: amount }, $addToSet: { creditReceipts: receipt } },
    { new: true, session }
  );
  if (!wallet) wallet = await Wallet.findOne({ user: userId }).session(session);
  entry.balanceAfter = wallet.balance;
  await WalletTransaction.updateOne({ _id: entry._id }, { $set: { balanceAfter: wallet.balance, applied: true } }, { session });
  logger.info("wallet.credit", { user: String(userId), amount, kind, order: orderId });
  return entry;
}

// Takes money out, only if there is enough. Throws 409 when the balance has changed.
async function debit(userId, amount, { reason, kind = "order", orderId = "", session = null, undo = null } = {}) {
  assertAmount(amount);
  const wallet = await Wallet.findOneAndUpdate(
    { user: userId, balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true, session }
  );
  if (!wallet) throw new HttpError(409, "Your wallet balance has changed. Please check the amount and try again.");
  if (undo) undo(() => Wallet.updateOne({ user: userId }, { $inc: { balance: amount } }));
  const [entry] = await WalletTransaction.create([{ user: userId, type: "debit", amount, kind, reason, orderId, balanceAfter: wallet.balance }], { session });
  if (undo) undo(() => WalletTransaction.deleteOne({ _id: entry._id }));
  logger.info("wallet.debit", { user: String(userId), amount, kind, order: orderId });
  return entry;
}

function toPublicTransaction(entry) {
  return {
    id: String(entry._id),
    type: entry.type,
    kind: entry.kind,
    amount: entry.amount,
    reason: entry.reason,
    orderId: entry.orderId || "",
    balanceAfter: entry.balanceAfter,
    createdAt: entry.createdAt
  };
}

// The balance and one page of history, newest first.
async function getWallet(userId, query = {}) {
  const page = toPositiveInt(query.page, 1);
  const type = ["credit", "debit"].includes(query.type) ? query.type : "all";
  const filter = { user: new mongoose.Types.ObjectId(String(userId)), applied: { $ne: false } };
  if (type !== "all") filter.type = type;
  const [balance, entries, total, sums] = await Promise.all([
    getBalance(userId),
    WalletTransaction.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    WalletTransaction.countDocuments(filter),
    WalletTransaction.aggregate([{ $match: { user: filter.user, applied: { $ne: false } } }, { $group: { _id: "$type", amount: { $sum: "$amount" } } }])
  ]);
  const sum = kind => (sums.find(row => row._id === kind) || { amount: 0 }).amount;
  return {
    balance,
    totals: { credited: sum("credit"), debited: sum("debit") },
    transactions: entries.map(toPublicTransaction),
    filters: { type },
    pagination: { page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

module.exports = { PAGE_SIZE, getBalance, credit, debit, getWallet, toPublicTransaction };
