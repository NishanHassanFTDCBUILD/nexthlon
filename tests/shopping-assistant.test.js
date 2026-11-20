// Shopping assistant: reading a shopper's sentence (price limits, needs, topics) and the replies that need no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const assistant = require('../services/shoppingAssistantService');

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
