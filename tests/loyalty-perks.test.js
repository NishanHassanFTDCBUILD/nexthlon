// Loyalty perk: Silver and Gold pay no delivery fee; Bronze pays the normal fee. No database needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const {tierFor} = require('../services/loyaltyService');
const {deliveryFeeFor, orderTotals} = require('../utils/pricing');
const {STORE} = require('../config/store');

test('loyalty perk: Bronze has no free delivery, Silver and Gold do', () => {
  assert.equal(tierFor(0).freeDelivery, false);
  assert.equal(tierFor(1000000).freeDelivery, true);
  assert.equal(tierFor(3000000).freeDelivery, true);
});

test('loyalty perk: a Silver or Gold member pays no delivery fee, even on a small order', () => {
  const small = STORE.freeDeliveryMin - 100;
  assert.equal(deliveryFeeFor(small), STORE.deliveryFee);
  assert.equal(deliveryFeeFor(small, {freeDelivery: true}), 0);
  assert.equal(deliveryFeeFor(0, {freeDelivery: true}), 0);
});

test('loyalty perk: the order total carries the same free delivery as the cart', () => {
  const subtotal = STORE.freeDeliveryMin - 100;
  const bronze = orderTotals({subtotal, mrpTotal: subtotal});
  const gold = orderTotals({subtotal, mrpTotal: subtotal, freeDelivery: true});
  assert.equal(bronze.deliveryFee, STORE.deliveryFee);
  assert.equal(gold.deliveryFee, 0);
  assert.equal(bronze.payable - gold.payable, STORE.deliveryFee);
});
