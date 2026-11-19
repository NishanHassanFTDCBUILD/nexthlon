// Gift cards: once an order is placed and paid, its gift cards are issued (services/giftCardService.js).
// An order that is not paid yet issues nothing; the event is run again when it is paid.
const events = require('../index');
const giftCardService = require('../../services/giftCardService');

events.on('order.placed', 'gift-cards', ({orderId}) =>
  giftCardService.issueForOrder(orderId),
);
