// Adds the starter products from data/products.json. Products that already exist are left alone.
// Run: npm run seed:products
const mongoose = require("mongoose");
const config = require("../config/env");
const Product = require("../models/Product");
const products = require("../data/products.json");

async function seedProducts() {
  await mongoose.connect(config.mongoUri);
  const operations = products.map(item => ({
    updateOne: {
      filter: { slug: item.slug },
      update: {
        $setOnInsert: {
          ...item,
          discountPercent: Product.discountFor(item.price, item.mrp),
          isActive: true
        }
      },
      upsert: true
    }
  }));
  const result = await Product.bulkWrite(operations, { ordered: false });
  console.log(`Products added: ${result.upsertedCount}. Already there: ${products.length - result.upsertedCount}.`);
}

seedProducts()
  .catch(error => {
    console.error(`Could not add products: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
