// Sales by category and by state for a period (India time). Only paid orders count, and items that
// were cancelled or returned are left out. Money is in paise; the CSV shows rupees.
const Order = require('../models/Order');
const rules = require('../utils/orderRules');
const {row} = require('../utils/csv');
const {HttpError} = require('../utils/http');

const DAY = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IST = '+05:30';

const istDay = (date) => {
  const d = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  return d.toISOString().slice(0, 10);
};

// [from, to] as Date bounds: from is the start of its day, to the end of its day, in India time.
function period(query = {}, now = new Date()) {
  const to = DATE.test(query.to) ? query.to : istDay(now);
  const from = DATE.test(query.from)
    ? query.from
    : istDay(new Date(new Date(`${to}T00:00:00${IST}`).getTime() - 29 * DAY));
  const start = new Date(`${from}T00:00:00${IST}`);
  const end = new Date(new Date(`${to}T00:00:00${IST}`).getTime() + DAY);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end
  )
    throw new HttpError(
      400,
      'Choose a valid period: the start must be before the end.',
    );
  if (end - start > 366 * DAY)
    throw new HttpError(400, 'Choose a period of one year or less.');
  return {from, to, start, end};
}

async function breakdown(query = {}, now = new Date()) {
  const p = period(query, now);
  const base = {
    createdAt: {$gte: p.start, $lt: p.end},
    paymentStatus: {$in: rules.PAID_STATUSES},
    orderStatus: {$ne: 'cancelled'},
  };
  const [byCategory, byState] = await Promise.all([
    Order.aggregate([
      {$match: base},
      {$unwind: '$items'},
      {$match: {'items.status': {$nin: ['cancelled', 'returned']}}},
      {
        $lookup: {
          from: 'products',
          localField: 'items.product',
          foreignField: '_id',
          as: 'product',
          pipeline: [{$project: {category: 1}}],
        },
      },
      {$unwind: {path: '$product', preserveNullAndEmptyArrays: true}},
      {
        $group: {
          _id: '$product.category',
          units: {$sum: '$items.quantity'},
          revenue: {$sum: '$items.lineTotal'},
        },
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category',
          pipeline: [{$project: {name: 1}}],
        },
      },
      {$sort: {revenue: -1}},
    ]),
    Order.aggregate([
      {$match: base},
      {
        $group: {
          _id: {$ifNull: ['$address.state', 'Unknown']},
          orders: {$sum: 1},
          revenue: {$sum: '$total'},
        },
      },
      {$sort: {revenue: -1}},
    ]),
  ]);
  const categories = byCategory.map((r) => ({
    name: r.category[0] ? r.category[0].name : 'No category',
    units: r.units,
    revenue: r.revenue,
  }));
  const states = byState.map((r) => ({
    name: r._id,
    orders: r.orders,
    revenue: r.revenue,
  }));
  return {
    from: p.from,
    to: p.to,
    categories,
    states,
    totals: {
      revenue: categories.reduce((sum, c) => sum + c.revenue, 0),
      units: categories.reduce((sum, c) => sum + c.units, 0),
      orders: states.reduce((sum, s) => sum + s.orders, 0),
    },
  };
}

const rupees = (paise) => (Number(paise || 0) / 100).toFixed(2);

// One CSV: the category table, then the state table.
function toCsv(data) {
  const lines = [row(['Category', 'Units', 'Revenue (Rs)'])];
  data.categories.forEach((c) =>
    lines.push(row([c.name, c.units, rupees(c.revenue)])),
  );
  lines.push(row([]));
  lines.push(row(['State', 'Orders', 'Revenue (Rs)']));
  data.states.forEach((s) =>
    lines.push(row([s.name, s.orders, rupees(s.revenue)])),
  );
  return lines.join('');
}

module.exports = {breakdown, period, toCsv};
