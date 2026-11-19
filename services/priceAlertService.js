// Price-drop alerts. A signed-in customer watches a product; when its price falls below the price they
// were last told about, they get one email for that drop, and the watch moves to the new price.
//
//   watch(userId, productId)     start watching (asking again is fine)
//   unwatch(userId, productId)   stop watching
//   isWatching(userId, productId)
//   sweep()   finds watches whose product is cheaper now and queues one email for each (every 30 min)
//   notify(watchId)   the email job; claims the drop first so one drop is only ever emailed once
const mongoose = require('mongoose');
const PriceWatch = require('../models/PriceWatch');
const Product = require('../models/Product');
const User = require('../models/User');
const mailService = require('./mailService');
const queue = require('../jobs/queue');
const {renderEmail, siteUrl, absoluteUrl} = require('../utils/emailLayout');
const {sizedUrl} = require('../utils/images');
const {formatPaise} = require('../utils/money');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {HttpError} = require('../utils/http');

const SWEEP_BATCH = 500;

async function watch(userId, productId) {
  if (!mongoose.isValidObjectId(productId))
    throw new HttpError(404, 'Product not found.');
  const product = await Product.findOne({_id: productId, ...LISTED_PRODUCT})
    .select('price')
    .lean();
  if (!product) throw new HttpError(404, 'Product not found.');
  await PriceWatch.updateOne(
    {user: userId, product: product._id},
    {$setOnInsert: {user: userId, product: product._id, price: product.price}},
    {upsert: true},
  );
  return {watching: true, message: 'We will email you if the price drops.'};
}

async function unwatch(userId, productId) {
  if (mongoose.isValidObjectId(productId))
    await PriceWatch.deleteOne({user: userId, product: productId});
  return {watching: false, message: 'Price alert turned off.'};
}

async function isWatching(userId, productId) {
  if (!userId || !mongoose.isValidObjectId(productId)) return false;
  return Boolean(await PriceWatch.exists({user: userId, product: productId}));
}

async function sweep() {
  const cheaper = await PriceWatch.aggregate([
    {
      $lookup: {
        from: 'products',
        localField: 'product',
        foreignField: '_id',
        as: 'p',
      },
    },
    {$unwind: '$p'},
    {
      $match: {
        'p.isListed': true,
        'p.categoryListed': true,
        $expr: {$lt: ['$p.price', '$price']},
      },
    },
    {$project: {_id: 1, price: 1, current: '$p.price'}},
    {$limit: SWEEP_BATCH},
  ]);
  for (const row of cheaper) {
    await queue.enqueue(
      'price.drop',
      {watchId: String(row._id)},
      {dedupeKey: `price.drop:${row._id}:${row.current}`},
    );
  }
  return cheaper.length;
}

async function notify(watchId) {
  if (!mongoose.isValidObjectId(watchId)) return 'missing';
  const row = await PriceWatch.findById(watchId).lean();
  if (!row) return 'done';
  const product = await Product.findOne({
    _id: row.product,
    ...LISTED_PRODUCT,
  }).lean();
  if (!product || product.price >= row.price) return 'not-lower';
  const user = await User.findById(row.user)
    .select('email name isBlocked role')
    .lean();
  if (!user || user.isBlocked || user.role !== 'customer') return 'skip';
  // Claim this drop: only one worker gets past this line for one price.
  const claimed = await PriceWatch.findOneAndUpdate(
    {_id: row._id, price: row.price},
    {$set: {price: product.price}},
  );
  if (!claimed) return 'done';
  const base = siteUrl();
  const link = `${base}/products/${product.slug}`;
  const {html, text} = renderEmail({
    preheader: `${product.name} is now ${formatPaise(product.price)}.`,
    heading: 'The price dropped',
    paragraphs: [
      `${product.name} is now ${formatPaise(product.price)}, down from ${formatPaise(row.price)}. You asked us to tell you about drops, so this is the only email for this change.`,
    ],
    sections: [
      {
        type: 'items',
        items: [
          {
            name: product.name,
            detail: product.brand || '',
            image: absoluteUrl(sizedUrl(product.image, 200), base),
            price: formatPaise(product.price),
          },
        ],
      },
    ],
    button: {label: 'See the new price', url: link},
    note: 'Turn price alerts off on the product page any time.',
  });
  try {
    await mailService.send({
      to: user.email,
      subject: `Price drop: ${product.name}`,
      html,
      text,
    });
  } catch (error) {
    await PriceWatch.updateOne({_id: row._id}, {$set: {price: row.price}});
    throw error;
  }
  return 'sent';
}

module.exports = {watch, unwatch, isWatching, sweep, notify};
