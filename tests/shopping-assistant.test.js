// Shopping assistant: reading a shopper's sentence (price limits, needs, topics) and the replies that need no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const assistant = require('../services/shoppingAssistantService');
const Product = require('../models/Product');

test('assistant: "under ₹3,000" and "below 2k" become price limits in whole rupees', () => {
  assert.deepEqual(assistant.parsePrice('waterproof jacket under ₹3,000'), {
    max: 3000,
    min: null,
  });
  assert.deepEqual(assistant.parsePrice('running shoes below 2k'), {
    max: 2000,
    min: null,
  });
  assert.deepEqual(assistant.parsePrice('tent over Rs 500'), {
    max: null,
    min: 500,
  });
  assert.deepEqual(assistant.parsePrice('just a jacket'), {
    max: null,
    min: null,
  });
});

test('assistant: a need like "monsoon trek" is turned into catalogue words', () => {
  const {terms} = assistant.productTerms(
    'waterproof jacket for a monsoon trek under ₹3,000',
  );
  assert.ok(terms.includes('waterproof'));
  assert.ok(terms.includes('jacket'));
  assert.ok(terms.includes('rain'));
  assert.ok(terms.includes('trekking'));
  assert.ok(!terms.includes('under'), 'filler words are dropped');
});

test('assistant: a store question gets the store answer and a link, with no products', async () => {
  const reply = await assistant.answer('how do I return an item?');
  assert.equal(reply.products.length, 0);
  assert.equal(reply.handoff, false);
  assert.equal(reply.links[0].href, '/refund-policy');
});

test('assistant: delivery answer uses the store settings, not a made-up figure', async () => {
  const {STORE} = require('../config/store');
  const reply = await assistant.answer('what is the delivery charge?');
  const free = `₹${Math.round(STORE.freeDeliveryMin / 100).toLocaleString('en-IN')}`;
  assert.ok(reply.reply.includes(free), reply.reply);
  assert.equal(reply.links[0].href, '/shipping-policy');
});

test('assistant: a greeting is answered without a search', async () => {
  const reply = await assistant.answer('hi');
  assert.match(reply.reply, /Hi!/);
  assert.equal(reply.products.length, 0);
});

test('assistant: a message with no meaning hands over to the team', async () => {
  const reply = await assistant.answer('the the the');
  assert.equal(reply.handoff, true);
  assert.equal(reply.links[0].href, '/contact');
});

test('assistant: an empty question asks for one, without an error', async () => {
  const reply = await assistant.answer('   ');
  assert.equal(reply.handoff, false);
  assert.ok(reply.reply.length > 0);
});

test('assistant: a requested word no product mentions is reported as missing', () => {
  const products = [
    {
      name: 'Lightweight Running Jacket',
      category: 'Running',
      brand: 'Nexthlon',
      description: 'Light',
    },
  ];
  assert.deepEqual(assistant.missingWords(['shoes', 'running'], products), [
    'shoes',
  ]);
  assert.deepEqual(assistant.missingWords(['running'], products), []);
});

for (const [question, href, expected] of [
  ['What is Nexthlon?', '/about', /sports gear store/i],
  ['Where is your store located?', '/about', /Kozhikode|business address/i],
  ['Can I cancel a paid order?', '/refund-policy', /before shipment.*wallet/is],
  [
    'Hi, how do I return an item?',
    '/refund-policy',
    /days of delivery.*wallet/is,
  ],
  ['My item arrived damaged', '/account/help', /photos.*cannot approve/is],
  [
    'Can I withdraw my wallet money to a bank?',
    '/refund-policy',
    /cannot.*withdrawn/is,
  ],
  [
    'How do I use wallet credit?',
    '/account/wallet',
    /partial wallet.*Cash on Delivery/is,
  ],
  [
    'How long does delivery take?',
    '/shipping-policy',
    /after dispatch.*estimates/is,
  ],
  ['Where is my order?', '/track', /cannot look up your private order/is],
  [
    'Money deducted but no order confirmed',
    '/contact',
    /before paying again/is,
  ],
  ['Can I pay using UPI?', '/account/orders', /Razorpay/],
  ['Is COD available?', '/account/orders', /only when eligible/i],
  ['How do I choose a shoe size?', '/find-my-size', /measurements/],
  ['How do I create an account?', '/signup', /Create an account/],
  ['I forgot my password', '/account/security', /reset option/],
  [
    'How do I edit my delivery address?',
    '/account/addresses',
    /does not automatically change/is,
  ],
  ['How does the cart work?', '/cart', /Stock, discounts and the final total/],
  ['How do I save a wishlist?', '/account/lists', /does not reserve/],
  ['Where can I find coupons?', '/account/coupons', /cannot invent a coupon/],
  ['How does referral work?', '/account/referral', /first order is delivered/],
  [
    'When will sold out products return?',
    '/products',
    /cannot promise a restock date/,
  ],
  [
    'Can I see a product video?',
    '/products',
    /same gallery.*360-spin.*removed/is,
  ],
  ['How do customer reviews work?', '/products', /published customer ratings/],
  ['Where is my invoice?', '/account/orders', /invoice or receipt/],
  ['How can I delete my account?', '/privacy', /cannot delete your account/],
  [
    'How do I manage notifications?',
    '/account/notifications',
    /communication options/,
  ],
  ['How can I edit my profile?', '/account/profile', /personal details/],
  ['Where are the sport guides?', '/guides', /articles currently published/],
  ['I want to contact a human', '/contact', /Support hours/],
]) {
  test(`assistant store help: ${question}`, async (t) => {
    t.mock.method(Product, 'find', () => {
      throw new Error(
        'Public store guidance must not query personal data or the catalogue',
      );
    });
    const result = await assistant.answer(question);
    assert.match(result.reply, expected);
    assert.ok(
      result.links.some((link) => link.href === href),
      JSON.stringify(result.links),
    );
    assert.deepEqual(result.products, []);
    assert.ok(result.links.every((link) => link.href.startsWith('/')));
  });
}

test('assistant answers multiple policy questions and uses updated store settings', async (t) => {
  const {STORE} = require('../config/store');
  const previous = {
    returnDays: STORE.returnDays,
    freeDeliveryMin: STORE.freeDeliveryMin,
  };
  t.after(() => Object.assign(STORE, previous));
  STORE.returnDays = 14;
  STORE.freeDeliveryMin = 75050;
  const result = await assistant.answer(
    'Explain Nexthlon returns and delivery',
  );
  assert.match(result.reply, /14 days/);
  assert.match(result.reply, /750\.5/);
  assert.match(result.reply, /wallet/);
  assert.equal(result.links.length, 2);
  assert.ok(
    !result.reply.includes('sports gear store'),
    'specific questions take priority over the brand overview',
  );
});

test('assistant does not expose placeholder contacts or invent personal account values', async () => {
  const support = await assistant.answer('Contact support');
  assert.doesNotMatch(support.reply, /\[support@|00000 00000|\[Name/);
  const wallet = await assistant.answer('What is my wallet balance?');
  assert.match(wallet.reply, /cannot read your personal balance/i);
  const payment = await assistant.answer('Payment failed and money deducted');
  assert.equal(payment.handoff, true);
  assert.match(payment.reply, /cannot confirm a bank reversal/i);
  assert.equal(payment.links.length, 1);
});

test('assistant product search respects budget and public stock filters, and supports browsing', async (t) => {
  const queries = [];
  t.mock.method(Product, 'find', (query) => {
    queries.push(query);
    const chain = {
      sort: () => chain,
      limit: () => chain,
      populate: () => chain,
      lean: async () => [
        {
          _id: 'shoe',
          slug: 'running-shoes',
          name: 'Running Shoes',
          brand: 'Nexthlon',
          price: 150000,
          mrp: 200000,
          stock: 3,
          category: {name: 'Running', slug: 'running'},
          description: 'Running shoes',
        },
      ],
    };
    return chain;
  });
  const result = await assistant.answer(
    'Recommend running shoes under Rs 2000',
  );
  assert.equal(result.products[0].slug, 'running-shoes');
  assert.equal(queries[0].isListed, true);
  assert.equal(queries[0].categoryListed, true);
  assert.deepEqual(queries[0].stock, {$gt: 0});
  assert.deepEqual(queries[0].price, {$lte: 200000});
  assert.match(result.reply, /1 match/);
  assert.doesNotMatch(result.reply, /couldn't find/);
  const browse = await assistant.answer('Show me all products');
  assert.equal(browse.products.length, 1);
  assert.equal(queries[1].$or, undefined);
});
