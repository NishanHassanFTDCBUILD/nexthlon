// Order events -> WhatsApp updates (E1), next to the emails (orderEmails.js). Only for customers who
// switched WhatsApp updates on; each runs as a background job and is sent once.
const events = require('../index');
const messageService = require('../../services/messageService');

events.on('order.placed', 'whatsapp', ({orderId}) =>
  messageService.sendOrderUpdate('placed', orderId),
);
const STATUS = {
  shipped: 'shipped',
  out_for_delivery: 'out_for_delivery',
  delivered: 'delivered',
};
events.on('order.status_changed', 'whatsapp', ({orderId, status}) =>
  STATUS[status]
    ? messageService.sendOrderUpdate(STATUS[status], orderId)
    : undefined,
);

// Push notifications (E5) for the same moments, to devices the customer allowed.
const pushService = require('../../services/pushService');
events.on('order.placed', 'push', ({orderId}) =>
  pushService.sendOrderPush('placed', orderId),
);
events.on('order.status_changed', 'push', ({orderId, status}) =>
  STATUS[status]
    ? pushService.sendOrderPush(STATUS[status], orderId)
    : undefined,
);
