// Customer 360: one customer's whole picture for the team. Read-only, except the private note.
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Wallet = require('../models/Wallet');
const Address = require('../models/Address');
const auditService = require('./auditService');
const {segmentsOf} = require('../utils/customerSegments');
const {HttpError} = require('../utils/http');

const DAY = 24 * 60 * 60 * 1000;

async function profile(userId, now = new Date()) {
  if (!mongoose.isValidObjectId(userId))
    throw new HttpError(404, 'Customer not found.');
  const user = await User.findOne({_id: userId, role: 'customer'})
    .select(
      'name email phone createdAt lastLoginAt isBlocked codBlocked adminNote emailVerifiedAt',
    )
    .lean();
  if (!user) throw new HttpError(404, 'Customer not found.');
  const id = new mongoose.Types.ObjectId(String(user._id));
  const [stats, recent, wallet, addresses] = await Promise.all([
    Order.aggregate([
      {$match: {user: id}},
      {
        $group: {
          _id: null,
          orders: {$sum: 1},
          delivered: {
            $sum: {$cond: [{$eq: ['$orderStatus', 'delivered']}, 1, 0]},
          },
          returned: {
            $sum: {
              $cond: [{$in: ['$rto.stage', ['initiated', 'received']]}, 1, 0],
            },
          },
          paidTotal: {
            $sum: {
              $cond: [
                {$in: ['$paymentStatus', ['paid', 'partially_refunded']]},
                '$total',
                0,
              ],
            },
          },
          lastOrder: {$max: '$createdAt'},
          spentRefunded: {$sum: '$refundedAmount'},
        },
      },
    ]),
    Order.find({user: id})
      .sort({createdAt: -1})
      .limit(10)
      .select(
        'orderId orderStatus paymentMethod paymentStatus total createdAt items.name',
      )
      .lean(),
    Wallet.findOne({user: id}).select('balance').lean(),
    Address.find({user: id}).sort({isDefault: -1, _id: -1}).limit(10).lean(),
  ]);
  const s = stats[0] || {};
  const lastOrderDays = s.lastOrder
    ? (now - new Date(s.lastOrder)) / DAY
    : null;
  const summary = {
    orders: s.orders || 0,
    delivered: s.delivered || 0,
    returned: s.returned || 0,
    paidTotal: s.paidTotal || 0,
    refunded: s.spentRefunded || 0,
    lastOrderAt: s.lastOrder || null,
    walletBalance: wallet ? wallet.balance : 0,
  };
  const segments = segmentsOf({
    joinedDays: (now - new Date(user.createdAt)) / DAY,
    orderCount: summary.orders,
    deliveredCount: summary.delivered,
    paidTotal: summary.paidTotal,
    lastOrderDays,
    returnedCount: summary.returned,
    blocked: Boolean(user.isBlocked),
  });
  return {
    customer: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone || '',
      joinedAt: user.createdAt,
      lastSignInAt: user.lastLoginAt || null,
      isBlocked: Boolean(user.isBlocked),
      codBlocked: Boolean(user.codBlocked),
      emailVerified: Boolean(user.emailVerifiedAt),
      note: user.adminNote || '',
    },
    summary,
    segments,
    recent: recent.map((o) => ({
      orderId: o.orderId,
      status: o.orderStatus,
      payment: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      total: o.total,
      createdAt: o.createdAt,
      items: (o.items || []).length,
      firstItem: o.items && o.items[0] ? o.items[0].name : '',
    })),
    addresses: addresses.map((a) => ({
      id: String(a._id),
      name: a.fullName,
      line1: a.line1,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      isDefault: Boolean(a.isDefault),
    })),
  };
}

// The team's private note on a customer. Audit-logged with what it said before.
async function setNote(userId, note, auditContext) {
  if (!mongoose.isValidObjectId(userId))
    throw new HttpError(404, 'Customer not found.');
  const clean = String(note || '')
    .trim()
    .slice(0, 1000);
  const user = await User.findOne({_id: userId, role: 'customer'}).select(
    'adminNote name',
  );
  if (!user) throw new HttpError(404, 'Customer not found.');
  const before = user.adminNote || '';
  user.adminNote = clean;
  await user.save();
  await auditService.record({
    ...auditContext,
    action: 'customer.note_changed',
    target: `user:${userId}`,
    before: {note: before.slice(0, 120)},
    after: {note: clean.slice(0, 120)},
  });
  return {name: user.name, note: clean};
}

module.exports = {profile, setNote};
