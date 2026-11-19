// Adds the starter products from data/products.json. Products that already exist are left alone.
// The file lists prices in rupees and categories by name; they are stored as paise and category records.
// Run: npm run seed:products
const mongoose = require('mongoose');
const config = require('../config/env');
const Product = require('../models/Product');
const products = require('../data/products.json');
const {runMigrations} = require('../services/migrationService');
const categoryService = require('../services/categoryService');
const {priceFor} = require('../utils/pricing');

async function seedProducts() {
  await mongoose.connect(config.mongoUri);
  await runMigrations();
  const operations = [];
  for (const item of products) {
    const category = await categoryService.ensureCategory(
      item.category,
      item.image,
    );
    const basePrice = Math.round(item.price * 100);
    const mrp = Math.round(item.mrp * 100);
    const pricing = priceFor({
      basePrice,
      mrp,
      offerPercent: 0,
      categoryOffer: category.offerPercent || 0,
    });
    operations.push({
      updateOne: {
        filter: {slug: item.slug},
        update: {
          $setOnInsert: {
            ...item,
            category: category._id,
            basePrice,
            mrp,
            offerPercent: 0,
            categoryOffer: category.offerPercent || 0,
            categoryListed: category.isListed !== false,
            bestOffer: pricing.bestOffer,
            price: pricing.price,
            discountPercent: pricing.discountPercent,
            ratingAverage: 0,
            ratingCount: 0,
            isListed: true,
            pricesInPaise: true,
          },
        },
        upsert: true,
      },
    });
  }
  const result = await Product.bulkWrite(operations, {ordered: false});
  categoryService.invalidate();
  console.log(
    `Products added: ${result.upsertedCount}. Already there: ${products.length - result.upsertedCount}.`,
  );
}

seedProducts()
  .catch((error) => {
    console.error(`Could not add products: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
