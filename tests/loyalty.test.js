// Loyalty tiers from spend (paise), no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const {tierFor} = require('../services/loyaltyService');

test('loyalty: spend places a customer in Bronze, Silver or Gold', () => {
  assert.equal(tierFor(0).name, 'Bronze');
  assert.equal(tierFor(999999).name, 'Bronze');
  assert.equal(tierFor(1000000).name, 'Silver');
  assert.equal(tierFor(2999999).name, 'Silver');
  assert.equal(tierFor(3000000).name, 'Gold');
});

test('loyalty: says how much more reaches the next tier, and nothing past Gold', () => {
  const silver = tierFor(1500000);
  assert.equal(silver.nextName, 'Gold');
  assert.equal(silver.toNextPaise, 1500000);
  const gold = tierFor(9000000);
  assert.equal(gold.nextName, null);
  assert.equal(gold.toNextPaise, 0);
});
