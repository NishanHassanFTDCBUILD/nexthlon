// Adds a few sample coupons so checkout can be tried before the admin coupon screens exist.
// Existing codes are left alone, so running it again changes nothing.
// Run: npm run seed:coupons
const mongoose = require('mongoose');
const config = require('../config/env');
const Coupon = require('../models/Coupon');

const DAY = 24 * 60 * 60 * 1000;

function samples(now = new Date()) {
  const inDays = (days) => new Date(now.getTime() + days * DAY);
  return [
    {
      code: 'WELCOME10',
      description: '10% off your order, for every new and returning athlete.',
      type: 'percent',
      value: 10,
      maxDiscount: 50000,
      minOrder: 99900,
      endsAt: inDays(90),
      perUserLimit: 1,
    },
    {
      code: 'FLAT200',
      description: '₹200 off bigger baskets.',
      type: 'flat',
      value: 20000,
      minOrder: 199900,
      endsAt: inDays(60),
      perUserLimit: 2,
    },
    {
      code: 'SPORT15',
      description: '15% off, up to ₹1,000. Limited to the first 500 orders.',
      type: 'percent',
      value: 15,
      maxDiscount: 100000,
      minOrder: 299900,
      endsAt: inDays(30),
      usageLimit: 500,
      perUserLimit: 1,
    },
    {
      code: 'FIRSTRUN',
      description: '₹100 off any order.',
      type: 'flat',
      value: 10000,
      minOrder: 0,
      endsAt: inDays(120),
      perUserLimit: 1,
    },
  ];
}

async function seedCoupons() {
  await mongoose.connect(config.mongoUri);
  let added = 0;
  for (const coupon of samples()) {
    const result = await Coupon.updateOne(
      {code: coupon.code},
      {$setOnInsert: {...coupon, isActive: true}},
      {upsert: true, runValidators: true},
    );
    if (result.upsertedCount) added += 1;
  }
  console.log(
    `Sample coupons ready (${added} added): ${samples()
      .map((coupon) => coupon.code)
      .join(', ')}`,
  );
}

if (require.main === module) {
  seedCoupons()
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    })
    .finally(() => mongoose.disconnect());
}

module.exports = {samples};
