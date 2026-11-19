// Everything the job worker (and the event system) knows how to do, registered in one place. Required once at
// start-up, by the app and by the stand-alone worker, so a job saved by one can be run by the other.
const registry = require('./registry');

// Event listeners (each becomes a job type "event:<event>:<name>").
require('../events/listeners/orderEmails');
require('../events/listeners/orderWhatsApp');
require('../events/listeners/questionEmails');

// Back-in-stock alerts (E3): one email per alert, and the sweep that finds alerts whose product is back.
const stockAlertService = require('../services/stockAlertService');
registry.register('stock.alert', ({alertId}) =>
  stockAlertService.notify(alertId),
);
registry.register('stock.sweep', () => stockAlertService.sweep(), {
  maxAttempts: 2,
});
registry.schedule('stock-sweep', {
  everyMs: 10 * 60 * 1000,
  type: 'stock.sweep',
});

// Price-drop alerts: one email per drop, and a sweep every 30 minutes that finds drops.
const priceAlertService = require('../services/priceAlertService');
registry.register('price.drop', ({watchId}) =>
  priceAlertService.notify(watchId),
);
registry.register('price.sweep', () => priceAlertService.sweep(), {
  maxAttempts: 2,
});
registry.schedule('price-sweep', {
  everyMs: 30 * 60 * 1000,
  type: 'price.sweep',
});

// Resume interrupted payment, cancellation, return and refund work after restarts.
registry.register('commerce.recover', () =>
  require('../services/commerceRecoveryService').sweep(),
);
registry.schedule('commerce-recovery', {
  everyMs: 60 * 1000,
  type: 'commerce.recover',
});

// Deals of the Day: every minute, start the deals whose time has come and end the ones that are
// over, so the price a shopper pays changes on time (services/dealService.js).
registry.register(
  'deal.sync',
  () => require('../services/dealService').syncDealPrices(),
  {maxAttempts: 2},
);
registry.schedule('deal-sync', {
  everyMs: 60 * 1000,
  type: 'deal.sync',
});
