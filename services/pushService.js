// Push notifications (E5): order updates and back-in-stock alerts on the phone or computer, even with the
// store closed. Needs VAPID keys (npm run push:keys prints a pair); without them the store simply offers
// no notifications. Only same-site links are ever opened from a notification (public/sw.js).
const webpush = require('web-push');
const config = require('../config/env');
const logger = require('../utils/logger');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const {HttpError} = require('../utils/http');

let sender = null;
let testOutbox = null;
function useTestOutbox(outbox) {
  testOutbox = outbox;
}
function useSenderForTests(fake) {
  sender = fake;
}

const enabled = () => Boolean(testOutbox || sender || config.push.enabled);
function getSender() {
  if (sender) return sender;
  if (!config.push.enabled) return null;
  webpush.setVapidDetails(
    config.push.subject,
    config.push.publicKey,
    config.push.privateKey,
  );
  sender = {
    send: (subscription, payload) =>
      webpush.sendNotification(subscription, payload, {TTL: 24 * 60 * 60}),
  };
  return sender;
}

const MAX_PER_USER = 10;

async function subscribe(userId, body = {}, device = '') {
  if (!enabled())
    throw new HttpError(503, 'Notifications are not set up on this store yet.');
  const endpoint = String(body.endpoint || '');
  const keys = body.keys || {};
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    url = null;
  }
  if (
    !url ||
    url.protocol !== 'https:' ||
    endpoint.length > 1000 ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string' ||
    keys.p256dh.length > 200 ||
    keys.auth.length > 100
  ) {
    throw new HttpError(400, 'That notification subscription is not valid.');
  }
  await PushSubscription.updateOne(
    {endpoint},
    {
      $set: {
        user: userId,
        keys: {p256dh: keys.p256dh, auth: keys.auth},
        device: String(device).slice(0, 80),
      },
    },
    {upsert: true},
  );
  // Keep the newest 10 devices per customer.
  const extra = await PushSubscription.find({user: userId})
    .sort({updatedAt: -1})
    .skip(MAX_PER_USER)
    .select('_id')
    .lean();
  if (extra.length)
    await PushSubscription.deleteMany({
      _id: {$in: extra.map((row) => row._id)},
    });
  return {ok: true};
}

async function unsubscribe(userId, endpoint) {
  await PushSubscription.deleteOne({
    user: userId,
    endpoint: String(endpoint || ''),
  });
  return {ok: true};
}

// { title, body, url, tag }. Returns how many devices it reached. Dead subscriptions are removed.
async function sendToUser(userId, message) {
  if (!enabled()) return 0;
  const url =
    typeof message.url === 'string' &&
    message.url.startsWith('/') &&
    !message.url.startsWith('//')
      ? message.url
      : '/';
  const payload = JSON.stringify({
    title: String(message.title).slice(0, 80),
    body: String(message.body || '').slice(0, 200),
    url,
    tag: message.tag || '',
  });
  const subscriptions = await PushSubscription.find({user: userId}).lean();
  let sent = 0;
  for (const sub of subscriptions) {
    if (testOutbox) {
      testOutbox.push({
        user: String(userId),
        endpoint: sub.endpoint,
        ...JSON.parse(payload),
      });
      sent += 1;
      continue;
    }
    try {
      await getSender().send({endpoint: sub.endpoint, keys: sub.keys}, payload);
      await PushSubscription.updateOne(
        {_id: sub._id},
        {$set: {lastSentAt: new Date()}},
      );
      sent += 1;
    } catch (error) {
      if (error && (error.statusCode === 404 || error.statusCode === 410))
        await PushSubscription.deleteOne({_id: sub._id});
      else
        logger.warn('push.failed', {status: error && error.statusCode, error});
    }
  }
  return sent;
}

const ORDER_PUSH = {
  placed: (order) => ({
    title: 'Order placed',
    body: `We got order ${order.orderId}. We'll tell you when it ships.`,
  }),
  shipped: (order) => ({
    title: 'Your order is on its way',
    body: `Order ${order.orderId} has shipped. Tap to track it.`,
  }),
  out_for_delivery: (order) => ({
    title: 'Arriving today',
    body: `Order ${order.orderId} is out for delivery.`,
  }),
  delivered: (order) => ({
    title: 'Delivered',
    body: `Order ${order.orderId} has arrived. Enjoy!`,
  }),
};

async function sendOrderPush(kind, orderId) {
  const build = ORDER_PUSH[kind];
  if (!build || !enabled()) return 0;
  const Order = require('../models/Order');
  const order = await Order.findOne({orderId}).select('orderId user').lean();
  if (!order) return 0;
  const user = await User.findById(order.user)
    .select('notifyPrefs isDeleted')
    .lean();
  if (
    !user ||
    user.isDeleted ||
    (kind !== 'placed' &&
      user.notifyPrefs &&
      user.notifyPrefs.orderUpdates === false)
  )
    return 0;
  return sendToUser(order.user, {
    ...build(order),
    url: `/orders/${order.orderId}`,
    tag: `order-${order.orderId}`,
  });
}

module.exports = {
  enabled,
  subscribe,
  unsubscribe,
  sendToUser,
  sendOrderPush,
  useTestOutbox,
  useSenderForTests,
  ORDER_PUSH,
};
