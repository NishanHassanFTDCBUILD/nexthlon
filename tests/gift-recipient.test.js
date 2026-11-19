// Gift cards for someone else: the codes go to the recipient, the buyer gets a receipt without them, and a bad
// recipient is ignored. Own database (the test database name + "_giftrecipient"); runs only with TEST_MONGODB_URI.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {validatePlaceOrder} = require('../utils/validators');

test('gift recipient: a valid name and email are kept; a bad email is ignored, not an error', () => {
  const good = validatePlaceOrder({
    addressId: 'a',
    paymentMethod: 'razorpay',
    giftRecipient: {
      name: ' Asha ',
      email: 'ASHA@Example.test ',
      message: 'Happy birthday!',
    },
  });
  assert.deepEqual(good.value.giftRecipient, {
    name: 'Asha',
    email: 'asha@example.test',
    message: 'Happy birthday!',
  });
  const bad = validatePlaceOrder({
    addressId: 'a',
    paymentMethod: 'razorpay',
    giftRecipient: {name: 'Asha', email: 'nope'},
  });
  assert.equal(bad.value.giftRecipient, null);
  assert.equal(
    bad.errors.giftRecipient,
    undefined,
    'a bad recipient is simply not used, not an error',
  );
});

const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const GiftCard = require('../models/GiftCard');
const mailService = require('../services/mailService');
const giftCardService = require('../services/giftCardService');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'gift recipient database tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
} else {
  const dbUrl = new URL(process.env.TEST_MONGODB_URI);
  dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_giftrecipient`;

  let buyer;
  let voucher;

  test.before(async () => {
    await mongoose.connect(dbUrl.toString());
    await mongoose.connection.db.dropDatabase();
    buyer = await User.create({
      name: 'Gift Giver',
      email: 'giver@example.test',
      passwordHash: 'x'.repeat(60),
      role: 'customer',
    });
    voucher = await Product.create({
      name: 'Nexthlon Gift Card 1000',
      slug: 'gift-card-1000',
      brand: 'Nexthlon',
      category: new mongoose.Types.ObjectId(),
      description: 'A gift card.',
      image: 'https://example.test/gift.jpg',
      basePrice: 100000,
      price: 100000,
      mrp: 100000,
      stock: 99,
      giftCard: true,
    });
  });

  test.after(async () => {
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
  });

  test('gift recipient: the codes go to the recipient, and the buyer gets a receipt without them', async (t) => {
    const sent = [];
    t.mock.method(mailService, 'send', async (m) => {
      sent.push(m);
      return {ok: true};
    });
    await Order.create({
      orderId: 'NX-GIFT-1',
      user: buyer._id,
      items: [
        {
          product: voucher._id,
          name: voucher.name,
          slug: voucher.slug,
          price: 100000,
          mrp: 100000,
          quantity: 2,
          lineTotal: 200000,
          status: 'placed',
        },
      ],
      address: {
        name: 'Gift Giver',
        phone: '9876543210',
        line1: '1 Road',
        city: 'Kochi',
        state: 'Kerala',
        pincode: '682001',
      },
      mrpTotal: 200000,
      subtotal: 200000,
      total: 200000,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      orderStatus: 'placed',
      giftRecipient: {
        name: 'Asha',
        email: 'asha@example.test',
        message: 'Enjoy!',
      },
    });
    const issued = await giftCardService.issueForOrder('NX-GIFT-1');
    assert.equal(issued, 2);
    const cards = await GiftCard.find({
      order: (await Order.findOne({orderId: 'NX-GIFT-1'}))._id,
    }).lean();
    assert.equal(cards.length, 2);

    const toRecipient = sent.find((m) => m.to === 'asha@example.test');
    assert.ok(toRecipient, 'the recipient is emailed');
    for (const card of cards)
      assert.match(toRecipient.text, new RegExp(card.code));
    const toBuyer = sent.find((m) => m.to === 'giver@example.test');
    assert.ok(toBuyer, 'the buyer gets a receipt');
    for (const card of cards)
      assert.doesNotMatch(
        toBuyer.text,
        new RegExp(card.code),
        'the buyer receipt has no codes',
      );
  });
}
