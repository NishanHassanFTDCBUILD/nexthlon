// Upgrades data saved by older versions of Nexthlon. Runs at every start; each step only touches
// documents that still need it, so running it again changes nothing.
const Product = require("../models/Product");
const Cart = require("../models/Cart");
const RefreshToken = require("../models/RefreshToken");
const Review = require("../models/Review");
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
  await allowSeveralReviews();
}

// Reviews used to be one per customer per product, enforced by a unique index. Customers may now
// post up to 5, so the old unique index is dropped (no review is touched) and the plain one is made.
async function allowSeveralReviews() {
  const indexes = await Review.collection.indexes().catch(() => []);
  const old = indexes.find(index => index.unique && index.key && index.key.product === 1 && index.key.user === 1);
  if (old) await Review.collection.dropIndex(old.name);
  await Review.syncIndexes();
}

module.exports = { runMigrations };
