// Gift cards. A shopper buys a product marked as a gift card. When that order is paid, each card gets a code
// (XXXX-XXXX-XXXX) and the buyer is emailed the codes. Anyone signed in can redeem a code: its value goes into
// their wallet, and the wallet pays at checkout. A code works once, for a year.
//
//   issueForOrder(orderId)   after payment: one card per unit bought (safe to run twice)
//   redeem(userId, code)     signed-in customer: moves the value into the wallet
//   list(query)              admin
//   disable(cardId)          admin: a lost or wrongly issued card can no longer be redeemed
const crypto = require('crypto');
const GiftCard = require('../models/GiftCard');
const {pagination} = require('../utils/paging');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const walletService = require('./walletService');
const mailService = require('./mailService');
const {renderEmail, siteUrl} = require('../utils/emailLayout');
const {formatPaise} = require('../utils/money');
const {HttpError} = require('../utils/http');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const YEAR = 365 * 24 * 60 * 60 * 1000;

// 12 characters from a 32-letter alphabet (no 0, O, 1 or I), shown in three groups of four.
function newCode() {
  const bytes = crypto.randomBytes(12);
  let raw = '';
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

// What the shopper typed, as the stored form: letters and digits only, in upper case, grouped again.
function formatCode(input) {
  const raw = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (raw.length !== 12) return '';
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function issueForOrder(orderId, now = new Date()) {
  const order = await Order.findOne({orderId})
    .select('_id orderId user paymentStatus items giftRecipient')
    .lean();
  if (!order || order.paymentStatus !== 'paid') return 0;
  if (await GiftCard.exists({order: order._id})) return 0;

  const ids = [...new Set(order.items.map((item) => String(item.product)))];
  const giftProducts = await Product.find({_id: {$in: ids}, giftCard: true})
    .select('_id')
    .lean();
  const isGift = new Set(giftProducts.map((p) => String(p._id)));

  const cards = [];
  for (const item of order.items) {
    if (!isGift.has(String(item.product))) continue;
    for (let unit = 0; unit < (item.quantity || 1); unit += 1) {
      cards.push({
        code: newCode(),
        amount: item.price,
        order: order._id,
        purchaser: order.user,
        expiresAt: new Date(now.getTime() + YEAR),
      });
    }
  }
  if (!cards.length) return 0;
  await GiftCard.insertMany(cards);

  const buyer = await User.findById(order.user).select('email name').lean();
  const recipient =
    order.giftRecipient && order.giftRecipient.email
      ? order.giftRecipient
      : null;
  if (recipient) {
    const base = siteUrl();
    const {html, text} = renderEmail({
      preheader: `A gift card for you from ${buyer ? buyer.name : 'a friend'}.`,
      heading: 'You have a gift card',
      paragraphs: [
        recipient.message
          ? `"${recipient.message}"`
          : `${buyer ? buyer.name : 'Someone'} sent you a gift card from Nexthlon.`,
        ...cards.map((c) => `${c.code} · ${formatPaise(c.amount)}`),
        'Redeem a code at Nexthlon: it adds its value to a wallet, and the wallet pays at checkout. Codes work once and for a year.',
      ],
      button: {
        label: 'Redeem your gift card',
        url: `${base}/account/gift-card`,
      },
      note: 'Keep these codes private. Anyone with a code can redeem it.',
    });
    await mailService
      .send({
        to: recipient.email,
        subject: 'You have a gift card from Nexthlon',
        html,
        text,
      })
      .catch(() => null);
    if (buyer && buyer.email)
      await mailService
        .send({
          to: buyer.email,
          subject: `Your gift card was sent · ${order.orderId}`,
          html: renderEmail({
            preheader: 'Your gift card was sent.',
            heading: 'Gift card sent',
            paragraphs: [
              `We emailed ${cards.length} gift card code${cards.length > 1 ? 's' : ''} to ${recipient.name} at ${recipient.email}.`,
            ],
            button: {
              label: 'View your order',
              url: `${base}/account/orders/${order.orderId}`,
            },
          }).html,
          text: `Your gift card was sent to ${recipient.name} at ${recipient.email}.`,
        })
        .catch(() => null);
    return cards.length;
  }
  if (buyer && buyer.email) {
    const base = siteUrl();
    const lines = cards.map((c) => `${c.code} · ${formatPaise(c.amount)}`);
    const {html, text} = renderEmail({
      preheader: `${cards.length} gift card${cards.length > 1 ? 's' : ''} for order ${order.orderId}.`,
      heading: 'Your gift card' + (cards.length > 1 ? 's' : ''),
      paragraphs: [
        `Your order ${order.orderId} is paid. Each code below adds its value to a Nexthlon wallet once it is redeemed. Codes work once and for a year.`,
        ...lines,
      ],
      button: {label: 'Redeem a gift card', url: `${base}/account/gift-card`},
      note: 'Keep these codes private. Anyone with a code can redeem it.',
    });
    await mailService
      .send({
        to: buyer.email,
        subject: `Your gift card${cards.length > 1 ? 's' : ''} · ${order.orderId}`,
        html,
        text,
      })
      .catch(() => null);
  }
  return cards.length;
}

async function redeem(userId, input, now = new Date()) {
  const code = formatCode(input);
  if (!code)
    throw new HttpError(
      400,
      'Enter the 12-character code from your gift card email.',
      {
        code: 'Enter the 12-character code from your gift card email.',
      },
    );
  const card = await GiftCard.findOneAndUpdate(
    {code, status: 'active', expiresAt: {$gt: now}},
    {$set: {status: 'redeemed', redeemedBy: userId, redeemedAt: now}},
  ).lean();
  if (!card)
    throw new HttpError(
      400,
      'That gift card is not valid. It may have been used, switched off or expired.',
      {code: 'That gift card is not valid.'},
    );
  try {
    await walletService.credit(userId, card.amount, {
      reason: 'Gift card redeemed',
      kind: 'gift_card',
      key: `gift-card:${card._id}`,
    });
  } catch (error) {
    // The wallet did not take it: give the card back so it can be tried again.
    await GiftCard.updateOne(
      {_id: card._id},
      {$set: {status: 'active', redeemedBy: null, redeemedAt: null}},
    );
    throw error;
  }
  return {
    amount: card.amount,
    message: `${formatPaise(card.amount)} added to your wallet.`,
  };
}

async function list({status = ''} = {}) {
  const filter = ['active', 'redeemed', 'disabled'].includes(status)
    ? {status}
    : {};
  return GiftCard.find(filter)
    .sort({createdAt: -1})
    .limit(200)
    .populate('redeemedBy', 'name email')
    .lean();
}

// One page of gift cards for the admin table (newest first), with what the table footer needs.
async function listPage(query = {}) {
  const status = ['active', 'redeemed', 'disabled'].includes(query.status)
    ? query.status
    : '';
  const filter = status ? {status} : {};
  const pager = pagination(await GiftCard.countDocuments(filter), query);
  const cards = await GiftCard.find(filter)
    .sort({createdAt: -1, _id: -1})
    .skip((pager.page - 1) * pager.limit)
    .limit(pager.limit)
    .populate('redeemedBy', 'name email')
    .lean();
  return {cards, status, pagination: pager};
}

async function disable(cardId) {
  const card = await GiftCard.findOneAndUpdate(
    {_id: cardId, status: 'active'},
    {$set: {status: 'disabled'}},
    {new: true},
  ).lean();
  if (!card)
    throw new HttpError(409, 'Only an active gift card can be switched off.');
  return card;
}

module.exports = {
  listPage,
  issueForOrder,
  redeem,
  list,
  disable,
  formatCode,
  newCode,
};
