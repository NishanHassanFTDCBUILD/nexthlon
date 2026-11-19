// Loyalty tiers: Bronze, Silver and Gold, by what a customer has paid for in the last 12 months.
// Tiers are a status badge only. No perk is attached here: a discount or free delivery is a money
// decision the store owner makes, and it is added on purpose, not by this file.
const Order = require('../models/Order');

const DAY = 24 * 60 * 60 * 1000;
const TIERS = Object.freeze([
  {key: 'bronze', name: 'Bronze', minPaise: 0},
  {key: 'silver', name: 'Silver', minPaise: 1000000}, // ₹10,000
  {key: 'gold', name: 'Gold', minPaise: 3000000}, // ₹30,000
]);

// The tier a spend (in paise) reaches, and the next one with how much more it needs.
function tierFor(spendPaise) {
  let current = TIERS[0];
  for (const tier of TIERS) if (spendPaise >= tier.minPaise) current = tier;
  const next = TIERS.find((t) => t.minPaise > current.minPaise) || null;
  return {
    tier: current.key,
    name: current.name,
    spendPaise,
    nextName: next ? next.name : null,
    toNextPaise: next ? next.minPaise - spendPaise : 0,
  };
}

// Paid orders in the last 365 days. Refunds are not taken off here (a refund is rare; the figure is a status guide).
async function forUser(userId, now = new Date()) {
  const since = new Date(now.getTime() - 365 * DAY);
  const [row] = await Order.aggregate([
    {
      $match: {
        user: userId,
        paymentStatus: {$in: ['paid', 'partially_refunded']},
        createdAt: {$gte: since},
      },
    },
    {$group: {_id: null, spend: {$sum: '$total'}}},
  ]);
  return tierFor(row ? row.spend : 0);
}

module.exports = {TIERS, tierFor, forUser};
