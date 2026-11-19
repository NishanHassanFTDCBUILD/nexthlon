// Push notifications (E5). The push service is a fake: nothing leaves the machine. Own database ("_push").
require('./helpers');
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = 'mailto:test@push.test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('push: the service worker shows the notification and only opens this site', () => {
  const sw = fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(
    sw,
    /data\.url\.startsWith\('\/'\) &&\s+!data\.url\.startsWith\('\/\/'\)/,
    'no links to other sites',
  );
  assert.match(sw, /addEventListener\('notificationclick'/);
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'push database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Order = require('../models/Order');
const PushSubscription = require('../models/PushSubscription');
const pushService = require('../services/pushService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_push`;
let server;
let base;
const sent = [];

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The push test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  pushService.useSenderForTests({
    send: async (subscription, payload) => {
      if (subscription.endpoint.includes('gone')) {
        const error = new Error('gone');
        error.statusCode = 410;
        throw error;
      }
      sent.push({endpoint: subscription.endpoint, ...JSON.parse(payload)});
    },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('push: customers save their device; order updates reach it; dead devices are removed', async () => {
  const key = await fetch(`${base}/api/push/key`).then((r) => r.json());
  assert.equal(key.publicKey, keys.publicKey);

  const signup = await fetch(`${base}/api/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Origin: base,
    },
    body: JSON.stringify({
      name: 'Push Person',
      email: 'push@push.test',
      password: 'secure2024run',
      confirmPassword: 'secure2024run',
    }),
  });
  const cookie = signup.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  const subscribe = (body) =>
    fetch(`${base}/api/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: base,
        Cookie: cookie,
      },
      body: JSON.stringify(body),
    });
  assert.equal(
    (
      await subscribe({
        endpoint: 'http://not-secure.test/x',
        keys: {p256dh: 'a', auth: 'b'},
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await subscribe({
        endpoint: 'https://push.example.com/alive',
        keys: {p256dh: 'pk', auth: 'au'},
      })
    ).status,
    201,
  );
  const user = await User.findOne({email: 'push@push.test'});
  await PushSubscription.create({
    user: user._id,
    endpoint: 'https://push.example.com/gone',
    keys: {p256dh: 'x', auth: 'y'},
  });

  await Order.create({
    orderId: 'NX-PUSH-1',
    user: user._id,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'Ball',
        slug: 'ball',
        price: 100,
        mrp: 100,
        quantity: 1,
        lineTotal: 100,
        status: 'shipped',
      },
    ],
    address: {
      fullName: 'Push Person',
      phone: '9876543210',
      line1: '1',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 100,
    subtotal: 100,
    total: 100,
    paymentMethod: 'cod',
    orderStatus: 'shipped',
  });
  assert.equal(await pushService.sendOrderPush('shipped', 'NX-PUSH-1'), 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], {
    endpoint: 'https://push.example.com/alive',
    title: 'Your order is on its way',
    body: 'Order NX-PUSH-1 has shipped. Tap to track it.',
    url: '/orders/NX-PUSH-1',
    tag: 'order-NX-PUSH-1',
  });
  assert.equal(
    await PushSubscription.countDocuments({endpoint: /gone/}),
    0,
    'a device that turned notifications off is forgotten',
  );

  await User.updateOne(
    {_id: user._id},
    {$set: {'notifyPrefs.orderUpdates': false}},
  );
  assert.equal(
    await pushService.sendOrderPush('delivered', 'NX-PUSH-1'),
    0,
    'order updates switched off: no push',
  );
  assert.equal(
    await pushService.sendToUser(user._id, {
      title: 'x',
      url: 'https://evil.example/',
    }),
    1,
  );
  assert.equal(sent.at(-1).url, '/', 'links to other sites are replaced');
});
