// Storefront languages: English and Hindi, with English as the fallback.
const test = require('node:test');
const assert = require('node:assert/strict');
const {langFrom, translator, STRINGS} = require('../config/strings');

test('languages: only English and Hindi are accepted; anything else is English', () => {
  assert.equal(langFrom('hi'), 'hi');
  assert.equal(langFrom('en'), 'en');
  assert.equal(langFrom('de'), 'en');
  assert.equal(langFrom(undefined), 'en');
});

test('languages: Hindi strings come back in Hindi, and a missing one falls back to English', () => {
  const hi = translator('hi');
  assert.equal(hi('cart'), STRINGS.hi.cart);
  assert.notEqual(hi('cart'), 'Cart');
  assert.equal(hi('no-such-key'), 'no-such-key');
  assert.equal(translator('xx')('cart'), 'Cart');
});

test('languages: every English key has a Hindi string, so no label is left in English by mistake', () => {
  for (const key of Object.keys(STRINGS.en)) {
    assert.ok(STRINGS.hi[key], `missing Hindi for ${key}`);
  }
});
