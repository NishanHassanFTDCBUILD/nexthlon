// Return reasons for a period: why items came back (the reason the customer gave), how many, and what
// they were worth. Counts items that have a return reason, by the day the order was placed (India time).
const Order = require('../models/Order');
const {period} = require('./salesBreakdownService');
const {row} = require('../utils/csv');

async function report(query = {}, now = new Date()) {
  const p = period(query, now);
  const rows = await Order.aggregate([
    {
      $match: {
        createdAt: {$gte: p.start, $lt: p.end},
        'items.returnReason': {$nin: ['', null]},
      },
    },
    {$unwind: '$items'},
    {$match: {'items.returnReason': {$nin: ['', null]}}},
    {
      $group: {
        _id: '$items.returnReason',
        items: {$sum: '$items.quantity'},
        value: {$sum: '$items.lineTotal'},
      },
    },
    {$sort: {items: -1}},
  ]);
  const totalItems = rows.reduce((sum, r) => sum + r.items, 0);
  const reasons = rows.map((r) => ({
    reason: r._id,
    items: r.items,
    value: r.value,
    share: totalItems ? Math.round((r.items / totalItems) * 1000) / 10 : 0,
  }));
  return {
    from: p.from,
    to: p.to,
    reasons,
    totals: {
      items: totalItems,
      value: reasons.reduce((sum, r) => sum + r.value, 0),
    },
  };
}

const rupees = (paise) => (Number(paise || 0) / 100).toFixed(2);

function toCsv(data) {
  const lines = [row(['Reason', 'Items', 'Share (%)', 'Value (Rs)'])];
  data.reasons.forEach((r) =>
    lines.push(row([r.reason, r.items, r.share, rupees(r.value)])),
  );
  lines.push(
    row(['Total', data.totals.items, '100', rupees(data.totals.value)]),
  );
  return lines.join('');
}

module.exports = {report, toCsv};
