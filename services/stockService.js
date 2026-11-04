const mongoose = require("mongoose");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");

// Taking stock is ATOMIC per product: "$inc stock by -qty, but only if stock >= qty" is one
// database operation, so two shoppers can never both buy the last item and stock never goes
// below 0. Several products are taken inside a MongoDB transaction when the server supports it
// (a replica set); on a single server, the ones already taken are put back if a later one fails.

let transactionSupport = null;

async function supportsTransactions() {
  if (transactionSupport === null) {
    try {
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      transactionSupport = Boolean(hello.setName || hello.msg === "isdbgrid");
    } catch {
      transactionSupport = false;
    }
  }
  return transactionSupport;
}

// lines: [{ product: id, quantity, name }]
async function takeStock(lines, session = null) {
  const taken = [];
  for (const line of lines) {
    const result = await Product.updateOne(
      { _id: line.product, ...Product.LISTED, stock: { $gte: line.quantity } },
      { $inc: { stock: -line.quantity } },
      { session }
    );
    if (result.modifiedCount !== 1) {
      if (!session) await returnStock(taken);
      const left = await Product.findById(line.product).select("stock").session(session).lean();
      const stock = left ? left.stock : 0;
      throw new HttpError(409, stock > 0
        ? `Only ${stock} of ${line.name} left now. Please update your cart.`
        : `${line.name} just sold out. Please remove it from your cart.`);
    }
    taken.push(line);
  }
  return taken;
}

// Puts stock back (cancelled or returned items, or an order that could not be saved).
async function returnStock(lines, session = null) {
  for (const line of lines) {
    await Product.updateOne({ _id: line.product }, { $inc: { stock: line.quantity } }, { session });
  }
}

// Takes the stock, then runs work(session). If work fails, the stock is given back:
// by the transaction rolling back, or by hand on a single server.
async function withStock(lines, work) {
  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        await takeStock(lines, session);
        result = await work(session);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
  await takeStock(lines);
  try {
    return await work(null);
  } catch (error) {
    await returnStock(lines);
    throw error;
  }
}

module.exports = { supportsTransactions, takeStock, returnStock, withStock };
