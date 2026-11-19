// Abandoned-cart reminders. A signed-in customer who leaves a cart is emailed once after 1 hour and once more
// after 24 hours. Each reminder is for the cart as it was then: changing the cart starts a new cycle.
// Customers who turned off offers emails are never sent one.
//
//   sweep(now)   the job (every 15 minutes, jobs/handlers.js): claims each due reminder before it is sent
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const User = require('../models/User');
const mailService = require('./mailService');
const logger = require('../utils/logger');
const {renderEmail, siteUrl} = require('../utils/emailLayout');

const HOUR = 60 * 60 * 1000;
const FIRST_AFTER = HOUR;
const SECOND_AFTER = 24 * HOUR;
const BATCH = 300;

async function emailFor(cart, stage) {
  const products = await Product.find({
    _id: {$in: cart.items.map((i) => i.product)},
  })
    .select('name')
    .lean();
  const names = products.map((p) => p.name);
  const count = cart.items.reduce((n, i) => n + i.quantity, 0);
  const base = siteUrl();
  const lead =
    stage === '1h'
      ? 'You left a few things in your cart.'
      : 'Your cart is still waiting for you.';
  return renderEmail({
    preheader: `${count} item${count === 1 ? '' : 's'} waiting in your cart`,
    heading: 'Still thinking it over?',
    paragraphs: [
      lead,
      names.slice(0, 5).join(', ') + (names.length > 5 ? ' and more' : ''),
    ],
    button: {label: 'Go to your cart', url: `${base}/cart`},
    note: 'You get this because you have a cart with us. Turn offers emails off in your account to stop them.',
  });
}

async function sendOne(cart, user, stage) {
  const {html, text} = await emailFor(cart, stage);
  await mailService.send({
    to: user.email,
    subject:
      stage === '1h' ? 'You left something in your cart' : 'Still in your cart',
    html,
    text,
  });
}

async function sweep(now = new Date()) {
  const carts = await Cart.find({
    'items.0': {$exists: true},
    updatedAt: {$lte: new Date(now.getTime() - FIRST_AFTER)},
  })
    .select('user items updatedAt reminderVersion reminderStage')
    .limit(BATCH)
    .lean();
  let sent = 0;
  for (const cart of carts) {
    const version = new Date(cart.updatedAt);
    const old = now.getTime() - version.getTime() >= SECOND_AFTER;
    let stage = null;
    if (
      old &&
      cart.reminderStage === '1h' &&
      cart.reminderVersion &&
      new Date(cart.reminderVersion).getTime() === version.getTime()
    )
      stage = '24h';
    else if (
      !old &&
      !(
        cart.reminderVersion &&
        new Date(cart.reminderVersion).getTime() === version.getTime()
      )
    )
      stage = '1h';
    if (!stage) continue;

    const user = await User.findById(cart.user)
      .select('email isBlocked role notifyPrefs')
      .lean();
    if (!user || !user.email || user.isBlocked || user.role !== 'customer')
      continue;
    if (user.notifyPrefs && user.notifyPrefs.offers === false) continue;

    // Claim this reminder for this cart version before sending, so two runs never send it twice.
    const claimed = await Cart.updateOne(
      {
        _id: cart._id,
        updatedAt: version,
        reminderVersion: stage === '1h' ? {$ne: version} : version,
        reminderStage: stage === '1h' ? {$ne: '24h'} : '1h',
      },
      {$set: {reminderVersion: version, reminderStage: stage}},
      {timestamps: false},
    );
    if (claimed.modifiedCount !== 1) continue;
    try {
      await sendOne(cart, user, stage);
      sent += 1;
    } catch (error) {
      // Give the claim back so the next run can try again.
      await Cart.updateOne(
        {_id: cart._id},
        {
          $set: {
            reminderVersion: cart.reminderVersion || null,
            reminderStage: cart.reminderStage || '',
          },
        },
        {timestamps: false},
      );
      logger.warn('cart_reminder.failed', {
        cart: String(cart._id),
        message: error.message,
      });
    }
  }
  return sent;
}

module.exports = {sweep, FIRST_AFTER, SECOND_AFTER};
