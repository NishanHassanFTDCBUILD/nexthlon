// Browser push notifications are independent of SMS/WhatsApp providers.
const events = require('../index');
const pushService = require('../../services/pushService');
const STATUS = new Set(['shipped', 'out_for_delivery', 'delivered']);

events.on('order.placed', 'push', ({orderId}) =>
  pushService.sendOrderPush('placed', orderId),
);
events.on('order.status_changed', 'push', ({orderId, status}) =>
  STATUS.has(status) ? pushService.sendOrderPush(status, orderId) : undefined,
);
