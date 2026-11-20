// Order events -> customer emails. Registered at start-up (jobs/handlers.js); each runs as a background job.
// To react to an order event in another way (a stock alert, a push notification), add another listener next to this
// one: nothing in the order code changes.
const events = require('../index');
const orderMail = require('../../services/orderMailService');

// An order is placed (cash on delivery and wallet orders at checkout; online orders once the payment arrives).
events.on('order.placed', 'email', ({orderId}) =>
  orderMail.sendOrderEmail('placed', orderId),
);

// The order moved along its journey. "Confirmed" has no email of its own: the order email already said so.
const STATUS_EMAIL = {
  shipped: 'shipped',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
};
events.on('order.status_changed', 'email', ({orderId, status}) =>
  STATUS_EMAIL[status]
    ? orderMail.sendOrderEmail(STATUS_EMAIL[status], orderId)
    : undefined,
);

// A tracking number was added to an order that had already shipped (before shipping, the shipped email carries it).
events.on(
  'order.shipment_added',
  'email',
  ({orderId, shipmentId, alreadyShipped}) =>
    alreadyShipped
      ? orderMail.sendOrderEmail('tracking', orderId, {}, shipmentId)
      : undefined,
);

events.on('order.cancelled', 'email', ({orderId, itemIds = [], reason = ''}) =>
  orderMail.sendOrderEmail(
    'cancelled',
    orderId,
    {itemIds, reason},
    itemIds.join(','),
  ),
);

events.on(
  'order.refunded',
  'email',
  ({orderId, seq, amount, parts = [], reason = ''}) =>
    orderMail.sendOrderEmail(
      'refunded',
      orderId,
      {amount, parts, reason},
      String(seq),
    ),
);

events.on('order.return_requested', 'email', ({orderId, seq}) =>
  orderMail.sendOrderEmail('return_requested', orderId, {}, String(seq)),
);

events.on(
  'order.return_decided',
  'email',
  ({orderId, decision, note = '', seq}) =>
    orderMail.sendOrderEmail(
      'return_decided',
      orderId,
      {decision, note},
      String(seq),
    ),
);

// B5: a parcel the courier is bringing back (refused or undeliverable). Once it is back, the cancelled
// and refunded emails follow from the usual events.
events.on('order.rto', 'email', ({orderId, stage}) =>
  stage === 'initiated' ? orderMail.sendOrderEmail('rto', orderId) : undefined,
);
