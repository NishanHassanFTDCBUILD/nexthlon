// Monthly revenue goal: the target for a month (India time), and how far paid sales have got to it.
// Stored as one Setting per month (key goal:YYYY-MM), in paise. Progress counts paid, not cancelled
// orders in that month, the same rule as the sales breakdown.
const Setting = require('../models/Setting');
const Order = require('../models/Order');
const rules = require('../utils/orderRules');
const {monthRange, currentMonth} = require('./gstReportService');
const {HttpError} = require('../utils/http');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_GOAL = 1000000000; // ₹1 crore a month, in paise

const keyOf = (month) => `goal:${month}`;

async function goalFor(month) {
  if (!MONTH.test(month))
    throw new HttpError(400, 'Choose a month as YYYY-MM.');
  const row = await Setting.findOne({key: keyOf(month)}).lean();
  return row ? Number(row.value) : 0;
}

// Save the goal for a month, in rupees (0 clears it). Returns the old and new goal in paise.
async function setGoal(month, rupees) {
  if (!MONTH.test(month))
    throw new HttpError(400, 'Choose a month as YYYY-MM.');
  const value = Number(rupees);
  if (!Number.isInteger(value) || value < 0 || value * 100 > MAX_GOAL)
    throw new HttpError(
      400,
      'Enter a whole number of rupees from 0 to 1 crore.',
      {
        amount: 'Enter a whole number of rupees from 0 to 1 crore.',
      },
    );
  const before = await goalFor(month);
  const paise = value * 100;
  await Setting.updateOne(
    {key: keyOf(month)},
    {$set: {value: paise}},
    {upsert: true},
  );
  return {month, before, after: paise};
}

// Paid sales so far in the month, the goal, and the pace needed for the rest of it.
async function progress(month = currentMonth(), now = new Date()) {
  const {start, end} = monthRange(month);
  const [revenue, goal] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          createdAt: {$gte: start, $lt: end},
          paymentStatus: {$in: rules.PAID_STATUSES},
          orderStatus: {$ne: 'cancelled'},
        },
      },
      {$group: {_id: null, total: {$sum: '$total'}, orders: {$sum: 1}}},
    ]),
    goalFor(month),
  ]);
  const total = revenue[0] ? revenue[0].total : 0;
  const orders = revenue[0] ? revenue[0].orders : 0;
  const pct = goal
    ? Math.min(999, Math.round((total / goal) * 1000) / 10)
    : null;
  // Days left in the month, India time (the end is the start of next month).
  const daysLeft = Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
  const remaining = Math.max(0, goal - total);
  return {
    month,
    revenue: total,
    orders,
    goal,
    percent: pct,
    reached: goal > 0 && total >= goal,
    daysLeft,
    perDayNeeded: goal && daysLeft ? Math.ceil(remaining / daysLeft) : 0,
  };
}

module.exports = {goalFor, setGoal, progress, MAX_GOAL};
