// Deals of the Day: the admin's list and form, and the rule that puts a deal's price on its product.
//
// How a deal reaches the price a shopper pays:
//   1. An admin saves a deal (product, percent, start, end).
//   2. syncDealPrices copies the percent of every running deal onto its product (Product.dealOffer)
//      and clears it from products whose deal has stopped, working the prices out again
//      (utils/pricing.js PRICE_PIPELINE: the best of the product, category and deal offers).
//   3. It runs after every admin change and once a minute (jobs/handlers.js "deal-sync"), so a
//      deal starts and ends on time without anyone pressing a button.
// The cart, checkout and payment read Product.price, so they all charge the deal price.
const mongoose = require('mongoose');
const Deal = require('../models/Deal');
const Product = require('../models/Product');
const {PRICE_PIPELINE} = require('../utils/pricing');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {HttpError} = require('../utils/http');
const logger = require('../utils/logger');
const {pageSize} = require('../utils/paging');

const PAGE_SIZE = 20;
const STATUSES = ['all', 'live', 'scheduled', 'ended', 'disabled'];
const STATUS_LABELS = {
  all: 'All',
  live: 'Live now',
  scheduled: 'Starts later',
  ended: 'Ended',
  disabled: 'Turned off',
};
const SORTS = {
  starts: {label: 'Starting soonest', order: {startsAt: 1, sortOrder: 1}},
  newest: {label: 'Newest first', order: {createdAt: -1}},
  order: {label: 'Home page order', order: {sortOrder: 1, startsAt: 1}},
  percent: {label: 'Biggest discount', order: {percent: -1, startsAt: 1}},
};

const toPage = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
};
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The one word an admin cares about, in the order the store decides it.
function statusOf(deal, now = new Date()) {
  if (!deal.isActive) return 'disabled';
  if (now >= new Date(deal.endsAt)) return 'ended';
  if (now < new Date(deal.startsAt)) return 'scheduled';
  return 'live';
}

// The status filter as a database query, so paging and counting stay right.
function statusFilter(status, now) {
  if (status === 'disabled') return {isActive: false};
  if (status === 'ended') return {isActive: true, endsAt: {$lte: now}};
  if (status === 'scheduled') return {isActive: true, startsAt: {$gt: now}};
  if (status === 'live')
    return {isActive: true, startsAt: {$lte: now}, endsAt: {$gt: now}};
  return {};
}

// A date for a datetime-local input, in Indian time ("2026-11-19T09:30").
function toLocalInput(date) {
  if (!date) return '';
  const ist = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 16);
}

function toAdminDeal(deal, now = new Date()) {
  const product =
    deal.product && deal.product.name
      ? {
          id: String(deal.product._id),
          name: deal.product.name,
          slug: deal.product.slug,
          image: deal.product.image,
          basePrice: deal.product.basePrice,
          mrp: deal.product.mrp,
          price: deal.product.price,
          stock: deal.product.stock,
          isListed: deal.product.isListed !== false,
        }
      : null;
  return {
    id: String(deal._id),
    productId: product ? product.id : String(deal.product || ''),
    product,
    percent: deal.percent,
    // What the product costs during the deal when the deal is its best offer.
    dealPrice: product
      ? Math.floor((product.basePrice * (100 - deal.percent)) / 100 + 0.5)
      : 0,
    startsAt: deal.startsAt,
    endsAt: deal.endsAt,
    startsInput: toLocalInput(deal.startsAt),
    endsInput: toLocalInput(deal.endsAt),
    isActive: deal.isActive !== false,
    sortOrder: deal.sortOrder || 0,
    note: deal.note || '',
    status: statusOf(deal, now),
    createdAt: deal.createdAt,
  };
}

function readFilters(query = {}) {
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '',
    status: STATUSES.includes(query.status) ? query.status : 'all',
    sort: Object.hasOwn(SORTS, query.sort) ? query.sort : 'starts',
    page: toPage(query.page),
  };
}

const PRODUCT_FIELDS = 'name slug image basePrice mrp price stock isListed';

// GET the admin list: filters, totals per status, and one page of deals.
async function listDeals(query = {}, now = new Date()) {
  const size = pageSize(query, PAGE_SIZE);
  const filters = readFilters(query);
  filters.limit = size === PAGE_SIZE ? '' : size;
  const filter = statusFilter(filters.status, now);
  if (filters.q) {
    const ids = await Product.find({
      name: new RegExp(escapeRegex(filters.q), 'i'),
    }).distinct('_id');
    filter.product = {$in: ids};
  }
  const [rows, total, counts] = await Promise.all([
    Deal.find(filter)
      .sort(SORTS[filters.sort].order)
      .skip((filters.page - 1) * size)
      .limit(size)
      .populate('product', PRODUCT_FIELDS)
      .lean(),
    Deal.countDocuments(filter),
    Promise.all(
      ['live', 'scheduled', 'ended', 'disabled'].map((status) =>
        Deal.countDocuments(statusFilter(status, now)),
      ),
    ),
  ]);
  const [live, scheduled, ended, disabled] = counts;
  return {
    deals: rows.map((deal) => toAdminDeal(deal, now)),
    filters,
    totals: {live, scheduled, ended, disabled},
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / size)),
      total,
      limit: size,
    },
  };
}

async function findDeal(dealId) {
  if (!mongoose.isValidObjectId(dealId))
    throw new HttpError(404, 'Deal not found.');
  const deal = await Deal.findById(dealId).populate('product', PRODUCT_FIELDS);
  if (!deal) throw new HttpError(404, 'Deal not found.');
  return deal;
}

async function getDeal(dealId) {
  return toAdminDeal((await findDeal(dealId)).toObject());
}

// The products an admin can pick in the form, by name.
function productChoices() {
  return Product.find({})
    .sort({name: 1})
    .limit(1000)
    .select('name basePrice mrp isListed')
    .lean()
    .then((rows) =>
      rows.map((p) => ({
        id: String(p._id),
        name: p.name,
        basePrice: p.basePrice,
        mrp: p.mrp,
        isListed: p.isListed !== false,
      })),
    );
}

// The product must exist, and it may not have two switched-on deals at the same moment:
// the shopper would never know which one they got.
async function checkDeal(value, exceptId = null) {
  const product = await Product.exists({_id: value.product});
  if (!product)
    throw new HttpError(400, 'Choose a product.', {
      product: 'Choose a product.',
    });
  if (!value.isActive) return;
  const clash = await Deal.exists({
    product: value.product,
    isActive: true,
    startsAt: {$lt: value.endsAt},
    endsAt: {$gt: value.startsAt},
    ...(exceptId ? {_id: {$ne: exceptId}} : {}),
  });
  if (clash) {
    const message =
      'This product already has a deal during these times. Change the times or turn the other deal off.';
    throw new HttpError(409, message, {startsAt: message});
  }
}

async function createDeal(value) {
  await checkDeal(value);
  const deal = await Deal.create(value);
  await syncDealPrices();
  return getDeal(deal._id);
}

async function updateDeal(dealId, value) {
  const deal = await findDeal(dealId);
  await checkDeal(value, deal._id);
  Object.assign(deal, value);
  await deal.save();
  await syncDealPrices();
  return getDeal(deal._id);
}

async function setActive(dealId, isActive) {
  const deal = await findDeal(dealId);
  if (isActive)
    await checkDeal(
      {
        product: deal.product._id || deal.product,
        startsAt: deal.startsAt,
        endsAt: deal.endsAt,
        isActive: true,
      },
      deal._id,
    );
  deal.isActive = isActive;
  await deal.save();
  await syncDealPrices();
  return getDeal(deal._id);
}

// A deal holds no money history (orders keep their own prices), so deleting is a real delete.
async function deleteDeal(dealId) {
  const deal = await findDeal(dealId);
  const before = toAdminDeal(deal.toObject());
  await deal.deleteOne();
  await syncDealPrices();
  return before;
}

// The heart of it: make every product's dealOffer match the deals running right now.
// Safe to run any number of times, on any number of servers: it only ever sets the right value.
async function syncDealPrices(now = new Date()) {
  const running = await Deal.find(statusFilter('live', now))
    .select('product percent')
    .lean();
  // One product, one deal (checkDeal makes sure), but take the biggest to be safe.
  const wanted = new Map();
  for (const deal of running) {
    const key = String(deal.product);
    wanted.set(key, Math.max(wanted.get(key) || 0, deal.percent));
  }

  // Products that have a deal on them but should not (it ended, or was turned off or deleted).
  const stale = await Product.find({
    dealOffer: {$gt: 0},
    _id: {$nin: [...wanted.keys()]},
  }).distinct('_id');
  if (stale.length)
    await Product.updateMany({_id: {$in: stale}}, [
      {$set: {dealOffer: 0}},
      ...PRICE_PIPELINE,
    ]);

  // Products whose deal percent is missing or different. Grouped by percent: one update each.
  const byPercent = new Map();
  for (const [id, percent] of wanted) {
    if (!byPercent.has(percent)) byPercent.set(percent, []);
    byPercent.get(percent).push(id);
  }
  let applied = 0;
  for (const [percent, ids] of byPercent) {
    const result = await Product.updateMany(
      {_id: {$in: ids}, dealOffer: {$ne: percent}},
      [{$set: {dealOffer: percent}}, ...PRICE_PIPELINE],
    );
    applied += result.modifiedCount || 0;
  }
  if (applied || stale.length)
    logger.info('deals.synced', {applied, cleared: stale.length});
  return {applied, cleared: stale.length, running: wanted.size};
}

// The home page row: products with a deal running now, in the admin's order, and when the first
// of them ends (for the countdown). Empty when no admin deal is running.
async function liveDealProducts(now = new Date(), limit = 10) {
  const deals = await Deal.find(statusFilter('live', now))
    .sort({sortOrder: 1, startsAt: 1})
    .limit(50)
    .populate({path: 'product', match: {...LISTED_PRODUCT}})
    .lean();
  const seen = new Set();
  const products = [];
  let endsAt = null;
  for (const deal of deals) {
    if (!deal.product || seen.has(String(deal.product._id))) continue;
    seen.add(String(deal.product._id));
    products.push(deal.product);
    if (!endsAt || deal.endsAt < endsAt) endsAt = deal.endsAt;
    if (products.length >= limit) break;
  }
  return {products, endsAt};
}

module.exports = {
  PAGE_SIZE,
  STATUSES,
  STATUS_LABELS,
  SORTS,
  statusOf,
  toLocalInput,
  listDeals,
  getDeal,
  productChoices,
  createDeal,
  updateDeal,
  setActive,
  deleteDeal,
  syncDealPrices,
  liveDealProducts,
};
