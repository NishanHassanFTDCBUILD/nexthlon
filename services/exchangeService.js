// Size exchange: a customer swaps a delivered item for another size of the same product, instead of a refund.
//
//   requestExchange(userId, orderId, itemId, variantId)   customer asks; nothing is held yet
//   decideExchange(orderId, itemId, 'approve'|'decline')  admin: approving takes the new size from stock
//   completeExchange(orderId, itemId)                    admin: the old item is back and the new one is sent;
//                                                        the old size goes back into stock
//
// The item's status and money are not changed: an exchange has no refund. Every step is written to the
// order's history so the customer and the team see the same record.
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Product = require('../models/Product');
const {HttpError} = require('../utils/http');
const {STORE} = require('../config/store');
const rules = require('../utils/orderRules');
const {findOption, optionLabel} = require('../utils/options');
const {runExclusive} = require('../utils/exclusive');
const User = require('../models/User');
const mailService = require('./mailService');
const logger = require('../utils/logger');
const {renderEmail, siteUrl} = require('../utils/emailLayout');

const isId = (value) => mongoose.isValidObjectId(value);

function findItem(order, itemId) {
  if (!isId(itemId)) return null;
  return order.items.id(itemId) || null;
}

// Tells the customer about a swap step. A mail failure is logged and never blocks the swap itself.
async function emailCustomer(order, item, heading, line) {
  try {
    const buyer = await User.findById(order.user).select('email name').lean();
    if (!buyer || !buyer.email) return;
    const {html, text} = renderEmail({
      preheader: `${heading}: ${item.name}`,
      heading,
      paragraphs: [line, `Order ${order.orderId}.`],
      button: {
        label: 'View your order',
        url: `${siteUrl()}/account/orders/${order.orderId}`,
      },
    });
    await mailService.send({
      to: buyer.email,
      subject: `${heading} · ${order.orderId}`,
      html,
      text,
    });
  } catch (error) {
    logger.warn('exchange.email_failed', {
      orderId: order.orderId,
      message: error.message,
    });
  }
}

function pushHistory(order, status, by, note, now) {
  order.statusHistory.push({status, by, note, at: now});
}

async function requestExchange(
  userId,
  orderId,
  itemId,
  variantId,
  now = new Date(),
) {
  const order = await Order.findOne({orderId: String(orderId), user: userId});
  if (!order) throw new HttpError(404, 'Order not found.');
  if (!rules.canRequestReturn(order, STORE.returnDays, now))
    throw new HttpError(
      400,
      `Exchanges can be requested within ${STORE.returnDays} days of delivery.`,
    );
  const item = findItem(order, itemId);
  if (!item || item.status !== 'delivered')
    throw new HttpError(400, 'Only a delivered item can be exchanged.');
  if (item.exchange && ['requested', 'approved'].includes(item.exchange.status))
    throw new HttpError(
      409,
      'An exchange for this item is already in progress.',
    );

  const product = await Product.findById(item.product).lean();
  const option = product ? findOption(product, variantId) : null;
  if (!option) throw new HttpError(400, 'Choose a size this product comes in.');
  if (item.variant && String(option._id) === String(item.variant))
    throw new HttpError(
      400,
      'Choose a different size from the one you bought.',
    );
  if (option.stock < item.quantity)
    throw new HttpError(409, 'That size is out of stock right now.');

  item.exchange = {
    variant: option._id,
    option: optionLabel(option),
    status: 'requested',
    requestedAt: now,
    decidedAt: null,
  };
  pushHistory(
    order,
    'exchange_requested',
    'customer',
    `${item.name}: ${item.option || 'standard'} to ${optionLabel(option)}`,
    now,
  );
  await order.save();
  await emailCustomer(
    order,
    item,
    'Size swap requested',
    `We have your request to swap ${item.name} to ${item.exchange.option}. We confirm it shortly.`,
  );
  return order;
}

async function decideExchange(orderId, itemId, decision, now = new Date()) {
  if (!['approve', 'decline'].includes(decision))
    throw new HttpError(400, 'The decision must be approve or decline.');
  const order = await Order.findOne({orderId: String(orderId)});
  if (!order) throw new HttpError(404, 'Order not found.');
  const item = findItem(order, itemId);
  if (!item || !item.exchange || item.exchange.status !== 'requested')
    throw new HttpError(
      409,
      'This item has no exchange waiting for a decision.',
    );

  if (decision === 'approve') {
    await runExclusive(`exchange:${item.product}`, async () => {
      const product = await Product.findById(item.product);
      const option = product
        ? product.variants.id(item.exchange.variant)
        : null;
      if (!option || option.stock < item.quantity)
        throw new HttpError(
          409,
          'That size is out of stock now. Decline the exchange or ask the customer.',
        );
      option.stock -= item.quantity;
      await product.save();
    });
    item.exchange.status = 'approved';
  } else {
    item.exchange.status = 'declined';
  }
  item.exchange.decidedAt = now;
  pushHistory(
    order,
    decision === 'approve' ? 'exchange_approved' : 'exchange_declined',
    'admin',
    `${item.name}: ${item.exchange.option}`,
    now,
  );
  await order.save();
  if (item.exchange.status === 'approved')
    await emailCustomer(
      order,
      item,
      'Size swap confirmed',
      `Your swap of ${item.name} to ${item.exchange.option} is confirmed. The new size is on its way.`,
    );
  else
    await emailCustomer(
      order,
      item,
      'Size swap not approved',
      `We could not approve the swap of ${item.name}. You keep your current size.`,
    );
  return order;
}

async function completeExchange(orderId, itemId, now = new Date()) {
  const order = await Order.findOne({orderId: String(orderId)});
  if (!order) throw new HttpError(404, 'Order not found.');
  const item = findItem(order, itemId);
  if (!item || !item.exchange || item.exchange.status !== 'approved')
    throw new HttpError(409, 'Only an approved exchange can be completed.');

  await runExclusive(`exchange:${item.product}`, async () => {
    // The old size is back on the shelf now that the parcel is back.
    if (item.variant) {
      const product = await Product.findById(item.product);
      const option = product ? product.variants.id(item.variant) : null;
      if (option) {
        option.stock += item.quantity;
        await product.save();
      }
    }
  });
  // The customer now has the new size, so the item records it.
  item.variant = item.exchange.variant;
  item.option = item.exchange.option;
  item.exchange.status = 'completed';
  item.exchange.decidedAt = now;
  pushHistory(
    order,
    'exchange_completed',
    'admin',
    `${item.name}: now ${item.exchange.option}`,
    now,
  );
  await order.save();
  await emailCustomer(
    order,
    item,
    'Size swap done',
    `Your ${item.name} is now in ${item.exchange.option}.`,
  );
  return order;
}

// For the customer's order page: each delivered item with the other sizes that are in stock.
// Keyed by item id, and empty when the swap is not open (too late, already asked, or no other size).
async function choicesFor(order, now = new Date()) {
  const open = rules.canRequestReturn(order, STORE.returnDays, now);
  const delivered = order.items.filter(
    (item) =>
      item.status === 'delivered' &&
      !(
        item.exchange &&
        ['requested', 'approved'].includes(item.exchange.status)
      ),
  );
  const products = await Product.find({
    _id: {$in: delivered.map((item) => item.product)},
  })
    .select('variants size colour')
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const choices = {};
  for (const item of delivered) {
    const product = byId.get(String(item.product));
    const options =
      open && product
        ? (product.variants || [])
            .filter(
              (v) =>
                v.stock > 0 && String(v._id) !== String(item.variant || ''),
            )
            .map((v) => ({id: String(v._id), label: optionLabel(v)}))
        : [];
    choices[String(item._id)] = {options};
  }
  return choices;
}

module.exports = {
  requestExchange,
  decideExchange,
  completeExchange,
  choicesFor,
};
