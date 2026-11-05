// Upgrades data saved by older versions of Nexthlon. Runs at every start; each step only touches
// documents that still need it, so running it again changes nothing.
const Product = require("../models/Product");
const Cart = require("../models/Cart");
const RefreshToken = require("../models/RefreshToken");
const categoryService = require("./categoryService");
const referralService = require("./referralService");

async function runMigrations() {
  await Product.migrateListedFlag();
  await Product.migrateToPaise();
  await categoryService.migrateProductCategories();
  // Carts no longer keep the price at the time of adding; prices always come from the product.
  await Cart.collection.updateMany({ "items.priceAtAdd": { $exists: true } }, { $unset: { "items.$[].priceAtAdd": "" } });
  await Product.syncIndexes();
  // Makes sure the refresh tokens' TTL index exists, so MongoDB clears out expired rows by itself.
  await RefreshToken.syncIndexes();
  // Customers who joined before referrals existed get their own code.
  await referralService.migrateCodes();
}

module.exports = { runMigrations };
