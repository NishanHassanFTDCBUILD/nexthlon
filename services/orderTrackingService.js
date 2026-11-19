// Guest order tracking: an order ID and the phone number used at checkout show a safe summary.
// A wrong ID or phone gets the same answer, so the page cannot be used to find someone else's order.
// The summary shows no name, address, payment or item details beyond a count.
const Order = require('../models/Order');
const {HttpError} = require('../utils/http');

// The last ten digits of a phone number, so "+91 98765 43210" and "9876543210" match.
const phoneDigits = (value) =>
  String(value || '')
    .replace(/\D/g, '')
    .slice(-10);

const label = (status) => {
  const words = String(status || '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unknown';
};

const NOT_FOUND =
  'We could not find an order with those details. Check the order ID and the phone number you used at checkout.';

async function track({orderId, phone} = {}) {
  const id = String(orderId || '')
    .trim()
    .toUpperCase()
    .slice(0, 30);
  const digits = phoneDigits(phone);
  if (!id || digits.length !== 10)
    throw new HttpError(
      400,
      'Enter the order ID and the 10-digit phone number you used at checkout.',
    );
  const order = await Order.findOne({orderId: id})
    .select(
      'orderId createdAt orderStatus statusHistory deliveredAt address.phone items shipments',
    )
    .lean();
  if (!order || phoneDigits(order.address && order.address.phone) !== digits)
    throw new HttpError(404, NOT_FOUND);

  const shipments = (order.shipments || []).map((s) => ({
    courier: s.courier,
    trackingNumber: s.trackingNumber,
    status: s.status || '',
    expectedAt: s.expectedAt || null,
    events: (s.events || [])
      .slice(-8)
      .reverse()
      .map((e) => ({
        status: e.status,
        location: e.location || '',
        at: e.at,
      })),
  }));
  return {
    orderId: order.orderId,
    placedAt: order.createdAt,
    status: order.orderStatus,
    statusLabel: label(order.orderStatus),
    deliveredAt: order.deliveredAt || null,
    itemCount: (order.items || []).reduce((n, i) => n + (i.quantity || 1), 0),
    timeline: (order.statusHistory || [])
      .slice(-12)
      .reverse()
      .map((h) => ({status: label(h.status), note: h.note || '', at: h.at})),
    shipments,
  };
}

module.exports = {track, phoneDigits, NOT_FOUND};
