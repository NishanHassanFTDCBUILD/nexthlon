const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/WalletTransaction");
const walletService = require("./walletService");
const audit = require("./auditService");
const { HttpError } = require("../utils/http");
const { rupeesToPaise } = require("../utils/money");
const { runExclusive } = require("../utils/exclusive");

function validateAdjustment(body = {}) {
  body = body && typeof body === "object" ? body : {};
  const amount = rupeesToPaise(body.amount);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const errors = {};
  if (!["credit", "debit"].includes(body.type)) errors.type = "Choose Add credit or Remove credit.";
  if (!amount || amount > 10_000_000) errors.amount = "Enter an amount from ₹0.01 to ₹1,00,000, with at most two decimal places.";
  if (reason.length < 3 || reason.length > 160) errors.reason = "Enter a reason of 3 to 160 characters.";
  if (typeof body.requestId !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.requestId)) errors.form = "Reload this page before adjusting the wallet.";
  if (Object.keys(errors).length) throw new HttpError(400, Object.values(errors)[0], errors);
  return { type: body.type, amount, reason, requestId: body.requestId.toLowerCase() };
}

async function customer(userId) {
  if (!mongoose.isValidObjectId(userId)) throw new HttpError(404, "Customer not found.");
  const user = await User.findOne({ _id: userId, role: "customer", isDeleted: { $ne: true } }).select("name email isBlocked").lean();
  if (!user) throw new HttpError(404, "Customer not found.");
  return user;
}

async function details(userId, query = {}) {
  const user = await customer(userId);
  return { customer: { id: String(user._id), name: user.name, email: user.email, isBlocked: Boolean(user.isBlocked) }, ...await walletService.getWallet(userId, query) };
}

async function adjust(userId, body, actor) {
  if (!actor || actor.actorRole !== "admin" || !actor.actor) throw new HttpError(403, "Only admins can adjust wallet credit.");
  const value = validateAdjustment(body);
  await customer(userId);
  const key = `admin-wallet:${actor.actor}:${value.requestId}`;
  return runExclusive(key, async () => {
    let entry;
    try {
      [entry] = await Transaction.create([{ user: userId, type: value.type, amount: value.amount, reason: value.reason, kind: "admin", admin: actor.actor, key, applied: false }]);
    } catch (error) {
      if (error.code !== 11000) throw error;
      entry = await Transaction.findOne({ key });
      if (!entry || String(entry.user) !== String(userId) || entry.type !== value.type || entry.amount !== value.amount || entry.reason !== value.reason) {
        throw new HttpError(409, "This request was already used for a different adjustment. Reload the page.");
      }
    }
    if (entry.applied !== false) return { transaction: walletService.toPublicTransaction(entry), repeated: true };
    // Store the receipt in the same atomic update as the balance. A crash before the
    // history write can then be retried safely, including across server processes.
    if (value.type === "credit") {
      try { await Wallet.updateOne({ user: userId }, { $setOnInsert: { balance: 0 } }, { upsert: true }); }
      catch (error) { if (error.code !== 11000) throw error; }
    }
    const receipt = String(entry._id);
    const filter = { user: userId, adjustmentReceipts: { $ne: receipt } };
    if (value.type === "debit") filter.balance = { $gte: value.amount };
    let wallet = await Wallet.findOneAndUpdate(filter, {
      $inc: { balance: value.type === "credit" ? value.amount : -value.amount },
      $addToSet: { adjustmentReceipts: receipt }
    }, { new: true });
    if (!wallet) {
      wallet = await Wallet.findOne({ user: userId, adjustmentReceipts: receipt });
      if (!wallet) throw new HttpError(409, "There is not enough wallet credit to remove that amount.", { amount: "The amount exceeds the available wallet balance." });
    }
    await Transaction.updateOne({ _id: entry._id }, { $set: { applied: true, balanceAfter: wallet.balance } });
    await audit.record({ ...actor, action: "wallet.adjusted", target: `user:${userId}`, after: { type: value.type, amount: value.amount, reason: value.reason, balance: wallet.balance, transaction: receipt } });
    return { transaction: walletService.toPublicTransaction({ ...entry.toObject(), applied: true, balanceAfter: wallet.balance }), repeated: false };
  });
}

module.exports = { validateAdjustment, customer, details, adjust };
