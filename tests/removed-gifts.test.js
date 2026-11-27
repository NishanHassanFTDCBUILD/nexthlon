require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cart = require('../services/cartService');
const {validatePlaceOrder, validateProduct} = require('../utils/validators');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('retired gift cards cannot enter cart or checkout, but ordinary products still can', () => {
  const product = {isListed: true, categoryListed: true, stock: 10};
  assert.equal(cart.isAvailable(product), true);
  assert.equal(cart.isAvailable({...product, giftCard: true}), false);
  assert.equal(
    cart.quantityProblem({...product, giftCard: true}, 1),
    'This product is no longer available.',
  );
  assert.deepEqual(LISTED_PRODUCT.giftCard, {$ne: true});
});

test('gift recipient and gift-product requests are ignored by current validators', () => {
  const result = validatePlaceOrder({
    addressId: '64b0000000000000000000a1',
    paymentMethod: 'cod',
    giftRecipient: {name: 'Someone', email: 'someone@example.test'},
  });
  assert.equal(Object.hasOwn(result.value, 'giftRecipient'), false);
  assert.equal(
    Object.hasOwn(validateProduct({giftCard: true}).value, 'giftCard'),
    false,
  );
});

test('gift customer/admin routes, forms, scripts and order-email hooks are removed', () => {
  for (const file of [
    'routes/pageRoutes.js',
    'routes/walletRoutes.js',
    'routes/adminRoutes.js',
    'routes/adminPageRoutes.js',
    'config/adminNav.js',
    'views/partials/account-start.ejs',
    'views/partials/admin-end.ejs',
    'views/pages/checkout.ejs',
    'views/admin/product-form.ejs',
    'jobs/handlers.js',
    'public/js/checkout.js',
    'services/shoppingAssistantService.js',
  ]) {
    assert.doesNotMatch(
      read(file),
      /gift-cards|giftCardController|giftRecipient|data-gift-|name="giftCard"/,
    );
  }
});
