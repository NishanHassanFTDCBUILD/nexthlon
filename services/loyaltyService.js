// Loyalty tiers: Bronze, Silver and Gold, by what a customer has paid for in the last 12 months.
// The perk: Silver and Gold get free delivery on every order (pricing.deliveryFeeFor). Bronze pays the normal fee.
const mongoose = require('mongoose');
const Order = require('../models/Order');

const DAY = 24 * 60 * 60 * 1000;
const TIERS = Object.freeze([
  {key: 'bronze', name: 'Bronze', minPaise: 0, freeDelivery: false},
  {key: 'silver', name: 'Silver', minPaise: 1000000, freeDelivery: true}, // ₹10,000
  {key: 'gold', name: 'Gold', minPaise: 3000000, freeDelivery: true}, // ₹30,000
]);

// The tier a spend (in paise) reaches, and the next one with how much more it needs.
function tierFor(spendPaise) {
  let current = TIERS[0];
  for (const tier of TIERS) if (spendPaise >= tier.minPaise) current = tier;
  const next = TIERS.find((t) => t.minPaise > current.minPaise) || null;
  return {
    tier: current.key,
    name: current.name,
    freeDelivery: current.freeDelivery,
    spendPaise,
    nextName: next ? next.name : null,
    toNextPaise: next ? next.minPaise - spendPaise : 0,
  };
}

// Paid orders in the last 365 days. Refunds are not taken off here (a refund is rare; the figure is a status guide).
async function forUser(userId, now = new Date()) {
  // Guests and missing ids are Bronze: there is no spend to count.
  if (!userId || !mongoose.isValidObjectId(userId)) return tierFor(0);
  const since = new Date(now.getTime() - 365 * DAY);
  const [row] = await Order.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(String(userId)),
        paymentStatus: {$in: ['paid', 'partially_refunded']},
        createdAt: {$gte: since},
      },
    },
    {$group: {_id: null, spend: {$sum: '$total'}}},
  ]);
  return tierFor(row ? row.spend : 0);
}

module.exports = {TIERS, tierFor, forUser};
