require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const validators = require('../utils/validators');

const source = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('removed SMS/WhatsApp features have no providers, code services or phone-code pages left', () => {
  for (const file of [
    'services/codConfirmService.js',
    'services/messageService.js',
    'services/phoneSignInService.js',
    'controllers/phoneSignInController.js',
    'models/PhoneCode.js',
    'providers/messaging/sms.js',
    'providers/messaging/whatsapp.js',
    'events/listeners/orderWhatsApp.js',
    'public/js/phone-sign-in.js',
    'views/pages/phone-sign-in.ejs',
  ])
    assert.equal(fs.existsSync(path.join(__dirname, '..', file)), false, file);
});

test('checkout places COD orders without a confirmation-code endpoint or dialog', () => {
  assert.doesNotMatch(source('routes/orderRoutes.js'), /cod-code|sendCodCode/);
  assert.doesNotMatch(
    source('services/checkoutService.js'),
    /codConfirm|codCode|cod_code_needed/,
  );
  assert.doesNotMatch(
    source('public/js/checkout.js'),
    /placeWithCode|cod-code|askCode/,
  );
  assert.doesNotMatch(source('views/pages/checkout.ejs'), /cod-code|codCode/);
  const value = validators.validatePlaceOrder({
    addressId: '0123456789abcdef01234567',
    paymentMethod: 'cod',
    codCode: '123456',
  }).value;
  assert.equal(value.paymentMethod, 'cod');
  assert.equal(Object.hasOwn(value, 'codCode'), false);
});

test('SMS/DLT and WhatsApp setup and notification switches are removed', () => {
  for (const file of ['config/env.js', 'config/schema.js', '.env.example'])
    assert.doesNotMatch(source(file), /WHATSAPP_|MSG91_|readMessaging/);
  assert.doesNotMatch(source('views/admin/settings.ejs'), /codOtp|cod-otp/);
  assert.doesNotMatch(source('routes/adminRoutes.js'), /updateCodOtp|cod-otp/);
  assert.doesNotMatch(source('views/account/notifications.ejs'), /whatsapp/i);
  assert.doesNotMatch(
    source('routes/authRoutes.js'),
    /phoneSignIn|phone\/request|phone\/verify/,
  );
  assert.doesNotMatch(source('routes/pageRoutes.js'), /sign-in\/phone/);
  assert.doesNotMatch(source('views/pages/auth.ejs'), /sign-in\/phone/);
  assert.deepEqual(
    validators.validatePreferences({orderUpdates: true, whatsapp: true}).value,
    {orderUpdates: true},
  );
});

test('email and browser push updates remain registered, and admin email two-step sign-in remains', () => {
  const registry = require('../jobs/registry');
  require('../jobs/handlers');
  assert.ok(registry.handlerFor('event:order.placed:email'));
  assert.ok(registry.handlerFor('event:order.placed:push'));
  assert.ok(registry.handlerFor('event:order.status_changed:push'));
  assert.equal(registry.handlerFor('event:order.placed:whatsapp'), null);
  assert.match(source('routes/authRoutes.js'), /admin\/login\/2fa/);
});
