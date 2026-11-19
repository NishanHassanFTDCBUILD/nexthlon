// WhatsApp order updates (E1): only to customers who said yes, only to real Indian mobiles, once each,
// and the Cloud API request is shaped as Meta expects. Own database ("_whatsapp") for the order tests.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const messageService = require('../services/messageService');
const {createWhatsAppProvider} = require('../providers/messaging/whatsapp');

test('whatsapp: Indian mobiles in any common format, nothing else', () => {
  const to = messageService.toIndianMobile;
  assert.equal(to('98765 43210'), '919876543210');
  assert.equal(to('+91-98765-43210'), '919876543210');
  assert.equal(to('09876543210'), '919876543210');
  assert.equal(to('919876543210'), '919876543210');
  assert.equal(
    to('1234567890'),
    null,
    'landlines and made-up numbers are not sent to',
  );
  assert.equal(to(''), null);
});

test('whatsapp: the Cloud API gets an approved template with its parameters', async () => {
  let sent;
  const provider = createWhatsAppProvider(
    {token: 'tok', phoneNumberId: '123', language: 'en', apiVersion: 'v21.0'},
    async (url, options) => {
      sent = {url, options, body: JSON.parse(options.body)};
      return {
        ok: true,
        status: 200,
        json: async () => ({messages: [{id: 'wamid.1'}]}),
      };
    },
  );
  const result = await provider.send({
    to: '919876543210',
    template: 'nx_order_shipped',
    params: ['Asha', 'NX-1', 'Delhivery', 'AWB1'],
  });
  assert.equal(result.id, 'wamid.1');
  assert.equal(sent.url, 'https://graph.facebook.com/v21.0/123/messages');
  assert.equal(sent.options.headers.Authorization, 'Bearer tok');
  assert.equal(sent.body.template.name, 'nx_order_shipped');
  assert.deepEqual(
    sent.body.template.components[0].parameters.map((p) => p.text),
    ['Asha', 'NX-1', 'Delhivery', 'AWB1'],
  );

  const refusing = createWhatsAppProvider(
    {token: 't', phoneNumberId: '1', language: 'en', apiVersion: 'v21.0'},
    async () => ({
      ok: false,
      status: 400,
      json: async () => ({error: {message: 'not a WhatsApp number'}}),
    }),
  );
  await assert.rejects(
    refusing.send({to: '919876543210', template: 'x', params: []}),
    (error) => error.permanent === true,
  );
});

if (!process.env.TEST_MONGODB_URI) {
  test(
    'whatsapp database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const Order = require('../models/Order');
const User = require('../models/User');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_whatsapp`;
const outbox = [];

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The WhatsApp test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  messageService.useTestOutbox(outbox);
});

test.after(async () => {
  messageService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function orderFor(user, phone) {
  return Order.create({
    orderId: `NX-WA-${Math.random().toString(36).slice(2, 8)}`,
    user: user._id,
    items: [
      {
        product: new mongoose.Types.ObjectId(),
        name: 'Ball',
        slug: 'ball',
        price: 59900,
        mrp: 59900,
        quantity: 1,
        lineTotal: 59900,
        status: 'shipped',
      },
    ],
    address: {
      fullName: user.name,
      phone,
      line1: '1 Road',
      city: 'Kochi',
      state: 'Kerala',
      pincode: '682001',
    },
    mrpTotal: 59900,
    subtotal: 59900,
    total: 59900,
    paymentMethod: 'cod',
    orderStatus: 'shipped',
    shipments: [{courier: 'Delhivery', trackingNumber: 'AWB9'}],
  });
}

test('whatsapp: only customers who switched it on get updates, each one once', async () => {
  const quiet = await User.create({
    name: 'Quiet Person',
    email: 'quiet@wa.test',
    passwordHash: 'x'.repeat(60),
  });
  const keen = await User.create({
    name: 'Keen Buyer',
    email: 'keen@wa.test',
    passwordHash: 'x'.repeat(60),
    notifyPrefs: {whatsapp: true},
  });
  assert.equal(
    await messageService.sendOrderUpdate(
      'shipped',
      (await orderFor(quiet, '9876543210')).orderId,
    ),
    'opted-out',
  );
  assert.equal(
    await messageService.sendOrderUpdate(
      'shipped',
      (await orderFor(keen, '12345')).orderId,
    ),
    'no-phone',
  );

  const order = await orderFor(keen, '+91 98765 43210');
  assert.equal(
    await messageService.sendOrderUpdate('shipped', order.orderId),
    'sent',
  );
  assert.equal(
    await messageService.sendOrderUpdate('shipped', order.orderId),
    'skipped',
    'a retried job never sends twice',
  );
  assert.equal(outbox.length, 1);
  assert.deepEqual(outbox[0], {
    channel: 'whatsapp',
    to: '919876543210',
    template: 'nx_order_shipped',
    params: ['Keen', order.orderId, 'Delhivery', 'AWB9'],
  });
});
