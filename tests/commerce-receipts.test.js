require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const Wallet = require("../models/Wallet");
const Transaction = require("../models/WalletTransaction");
const Product = require("../models/Product");
const wallet = require("../services/walletService");
const stock = require("../services/stockService");

test("wallet balance receipt survives a failed history write and repairs it on retry", async t => {
  let entry, balance = 0, fail = true;
  const receipts = new Set();
  t.mock.method(Transaction, "create", async ([value]) => {
    if (entry) throw Object.assign(new Error("duplicate key"), { code: 11000 });
    entry = { _id: "credit-1", ...value }; return [entry];
  });
  t.mock.method(Transaction, "findOne", () => ({ session: async () => entry }));
  t.mock.method(Transaction, "updateOne", async (_filter, update) => {
    if (fail) { fail = false; throw new Error("ledger unavailable after credit"); }
    Object.assign(entry, update.$set);
  });
  t.mock.method(Wallet, "updateOne", async () => ({}));
  t.mock.method(Wallet, "findOneAndUpdate", async (_filter, update) => {
    const receipt = update.$addToSet.creditReceipts;
    if (receipts.has(receipt)) return null;
    receipts.add(receipt); balance += update.$inc.balance;
    return { balance };
  });
  t.mock.method(Wallet, "findOne", () => ({ session: async () => ({ balance }) }));
  await assert.rejects(wallet.credit("customer", 10000, { reason: "Refund", key: "refund-1" }), /ledger unavailable/);
  await wallet.credit("customer", 10000, { reason: "Refund", key: "refund-1" });
  assert.equal(balance, 10000);
  assert.equal(entry.applied, true);
  assert.equal(entry.balanceAfter, 10000);
});

test("stock retries use the same atomic receipt for reservation and rollback", async t => {
  const items = new Map([["ball", { stock: 2, receipts: new Set() }], ["empty", { stock: 0, receipts: new Set() }]]);
  t.mock.method(Product, "updateOne", async (filter, update) => {
    const item = items.get(filter._id);
    if (!item || item.receipts.has(filter.stockReceipts.$ne)) return { modifiedCount: 0 };
    if (filter.$and && !item.receipts.has(filter.$and[0].stockReceipts)) return { modifiedCount: 0 };
    if (filter.stock && item.stock < filter.stock.$gte) return { modifiedCount: 0 };
    // Enforce that the real service puts the receipt in the same update as stock.
    assert.ok(update.$addToSet.stockReceipts);
    item.stock += update.$inc.stock; item.receipts.add(update.$addToSet.stockReceipts);
    return { modifiedCount: 1 };
  });
  t.mock.method(Product, "exists", async filter => items.get(filter._id)?.receipts.has(filter.stockReceipts));
  const lines = [{ product: "ball", quantity: 1 }, { product: "empty", quantity: 1 }];
  for (let i = 0; i < 2; i++) await assert.rejects(stock.takeStockOnce(lines, "payment-1"));
  assert.equal(items.get("ball").stock, 1);
  for (let i = 0; i < 2; i++) await stock.returnStockOnce(lines, "rollback-1", "payment-1");
  assert.equal(items.get("ball").stock, 2);
  assert.equal(items.get("empty").stock, 0);
});
