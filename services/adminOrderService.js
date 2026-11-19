// Admin: orders and returns. Lists with filters and search, forward-only status changes (one or in
// bulk), item cancellation, shipments, internal notes, manual refunds and return decisions.
// The order rules live in utils/orderRules.js and orderService; money moves through refundService.
const mongoose = require('mongoose');
const events = require('../events');
const Order = require('../models/Order');
const User = require('../models/User');
const orderService = require('./orderService');
const refundService = require('./refundService');
const rules = require('../utils/orderRules');
const {codRisk} = require('../utils/codRisk');
const {HttpError} = require('../utils/http');
const {escapeRegex} = require('./productService');
const settlementService = require('./settlementService');
const {readListQuery} = require('../utils/listQuery');

const PAGE_SIZE = 20;
const EXPORT_LIMIT = 20000;
const IST_MS = 330 * 60 * 1000;
const ORDER_SORTS = {
  newest: {label: 'Newest first', order: {createdAt: -1, _id: -1}},
  oldest: {label: 'Oldest first', order: {createdAt: 1, _id: 1}},
  amount_desc: {
    label: 'Amount: high to low',
    order: {total: -1, createdAt: -1},
  },
  amount_asc: {label: 'Amount: low to high', order: {total: 1, createdAt: -1}},
};
const METHODS = ['razorpay', 'cod', 'wallet'];
const RETURN_FILTERS = ['requested', 'approved', 'rejected', 'all'];

// A YYYY-MM-DD India date as the moment it starts, or null.
function istDay(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    typeof text === 'string' ? text : '',
  );
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - IST_MS,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}
const rupeesToPaise = (value) =>
  /^\d{1,7}$/.test(String(value ?? '').trim()) ? Number(value) * 100 : null;
const cleanText = (value, max) =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').slice(0, max)
    : '';

// Every list filter, read safely from the query string (unknown values fall back to "any").
function readOrderList(query = {}) {
  return readListQuery(query, {
    pageSize: PAGE_SIZE,
    defaultSort: 'newest',
    sorts: ORDER_SORTS,
    searchMax: 60,
    cleanSearch: (value) => cleanText(value, 60),
    fields: {
      status: {values: rules.ORDER_STATUSES, default: 'all', label: 'Status'},
      method: {values: METHODS, default: 'all', label: 'Method'},
      payment: {
        values: rules.PAYMENT_STATUSES,
        default: 'all',
        label: 'Payment',
      },
      from: {validate: istDay, label: 'From'},
      to: {validate: istDay, label: 'To'},
      min: {
        validate: (value) => rupeesToPaise(value) !== null,
        clean: (value) => String(Number(value)),
        label: 'Minimum amount',
      },
      max: {
        validate: (value) => rupeesToPaise(value) !== null,
        clean: (value) => String(Number(value)),
        label: 'Maximum amount',
      },
      city: {
        maxLength: 40,
        clean: (value) => cleanText(value, 40),
        label: 'City',
      },
    },
  });
}

function readOrderFilters(query = {}) {
  const {limit: _limit, ...filters} = readOrderList(query).filters;
  return filters;
}

// Customers whose name, email or phone matches (for searching orders by customer).
async function matchingUserIds(q) {
  if (!q) return [];
  const pattern = new RegExp(escapeRegex(q), 'i');
  const users = await User.find({
    role: 'customer',
    $or: [{name: pattern}, {email: pattern}, {phone: pattern}],
  })
    .select('_id')
    .limit(50)
    .lean();
  return users.map((user) => user._id);
}

async function buildOrderFilter(filters) {
  const filter = {};
  if (filters.status !== 'all') filter.orderStatus = filters.status;
  if (filters.method !== 'all') filter.paymentMethod = filters.method;
  if (filters.payment !== 'all') filter.paymentStatus = filters.payment;
  if (filters.from || filters.to) {
    filter.createdAt = {};
    if (filters.from) filter.createdAt.$gte = istDay(filters.from);
    if (filters.to)
      filter.createdAt.$lt = new Date(
        istDay(filters.to).getTime() + 24 * 60 * 60 * 1000,
      );
  }
  if (filters.min || filters.max) {
    filter.total = {};
    if (filters.min) filter.total.$gte = Number(filters.min) * 100;
    if (filters.max) filter.total.$lte = Number(filters.max) * 100;
  }
  if (filters.city)
    filter['address.city'] = new RegExp(`^${escapeRegex(filters.city)}`, 'i');
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    const users = await matchingUserIds(filters.q);
    filter.$or = [
      {orderId: pattern},
      {'address.fullName': pattern},
      {'address.phone': pattern},
      ...(users.length ? [{user: {$in: users}}] : []),
    ];
  }
  return filter;
}

const LIST_FIELDS =
  'orderId user items.name items.quantity items.status total walletUsed refundedAmount paymentMethod paymentStatus orderStatus createdAt address.fullName address.city address.state address.phone shipments rto.stage tags';

// What we know about each customer's past orders, for the cash-on-delivery risk (utils/codRisk.js).
// One query for the whole page, not one per order.
async function customerHistory(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return new Map();
  const [counts, accounts] = await Promise.all([
    Order.aggregate([
      {$match: {user: {$in: ids.map((id) => new mongoose.Types.ObjectId(id))}}},
      {
        $group: {
          _id: '$user',
          delivered: {
            $sum: {$cond: [{$eq: ['$orderStatus', 'delivered']}, 1, 0]},
          },
          cancelled: {
            $sum: {$cond: [{$eq: ['$orderStatus', 'cancelled']}, 1, 0]},
          },
          returned: {
            $sum: {
              $cond: [{$in: ['$rto.stage', ['initiated', 'received']]}, 1, 0],
            },
          },
        },
      },
    ]),
    User.find({_id: {$in: ids}})
      .select('createdAt')
      .lean(),
  ]);
  const byUser = new Map(counts.map((row) => [String(row._id), row]));
  const now = Date.now();
  return new Map(
    accounts.map((account) => {
      const row = byUser.get(String(account._id)) || {};
      return [
        String(account._id),
        {
          deliveredOrders: row.delivered || 0,
          cancelledOrders: row.cancelled || 0,
          returnedOrders: row.returned || 0,
          accountAgeDays:
            (now - new Date(account.createdAt).getTime()) / 86400000,
        },
      ];
    }),
  );
}

// The cash-on-delivery risk for one order, given the customer's history.
function riskOf(order, history) {
  const who =
    history.get(
      String(order.user && order.user._id ? order.user._id : order.user),
    ) || {};
  return codRisk({
    paymentMethod: order.paymentMethod,
    total: order.total,
    ...who,
  });
}

// The shipping promise (utils/orderRules.js SHIP_WITHIN_HOURS). An order still waiting to ship
// after it is late.
const LATE_STATUSES = ['placed', 'confirmed'];
function shipByOf(order) {
  if (!order.createdAt) return null;
  return new Date(
    new Date(order.createdAt).getTime() +
      rules.SHIP_WITHIN_HOURS * 60 * 60 * 1000,
  );
}
function isLate(order, now = new Date()) {
  const by = shipByOf(order);
  return Boolean(by && LATE_STATUSES.includes(order.orderStatus) && now > by);
}

function toListRow(order) {
  return {
    orderId: order.orderId,
    customer: order.address ? order.address.fullName : '',
    city: order.address ? order.address.city : '',
    state: order.address ? order.address.state : '',
    phone: order.address ? order.address.phone : '',
    items: order.items.reduce((sum, item) => sum + item.quantity, 0),
    firstItem: order.items[0] ? order.items[0].name : '',
    total: order.total,
    charged: order.total + (order.walletUsed || 0),
    refunded: order.refundedAmount || 0,
    method: order.paymentMethod,
    payment: order.paymentStatus,
    status: order.orderStatus,
    next: rules.nextStatuses(order.orderStatus),
    shipped: (order.shipments || []).length > 0,
    createdAt: order.createdAt,
    late: isLate(order),
    shipBy: shipByOf(order),
    tags: order.tags || [],
  };
}

async function listOrders(query = {}) {
  const list = readOrderList(query);
  const {filters, size} = list;
  const filter = await buildOrderFilter(filters);
  const [orders, total, statusCounts] = await Promise.all([
    Order.find(filter)
      .sort(list.order)
      .skip(list.skip)
      .limit(size)
      .select(LIST_FIELDS)
      .lean(),
    Order.countDocuments(filter),
    Order.aggregate([{$group: {_id: '$orderStatus', count: {$sum: 1}}}]),
  ]);
  const history = await customerHistory(orders.map((o) => o.user));
  return {
    orders: orders.map((o) => ({...toListRow(o), risk: riskOf(o, history)})),
    filters,
    counts: Object.fromEntries(statusCounts.map((row) => [row._id, row.count])),
    chips: list.chips,
    sorts: list.sorts,
    pagination: list.pagination(total),
  };
}

// For exports: the same filter and order, as a stream of rows (up to 20,000).
async function exportOrders(query = {}) {
  const filters = readOrderFilters(query);
  const filter = await buildOrderFilter(filters);
  const cursor = Order.find(filter)
    .sort(ORDER_SORTS[filters.sort].order)
    .limit(EXPORT_LIMIT)
    .select(
      `${LIST_FIELDS} subtotal discount couponCode couponDiscount deliveryFee razorpay.paymentId`,
    )
    .lean()
    .cursor();
  return (async function* rows() {
    for await (const order of cursor) {
      yield {
        ...toListRow(order),
        subtotal: order.subtotal,
        discount: order.discount,
        couponCode: order.couponCode,
        couponDiscount: order.couponDiscount,
        deliveryFee: order.deliveryFee,
        walletUsed: order.walletUsed,
        paymentId: order.razorpay ? order.razorpay.paymentId : '',
      };
    }
  })();
}

async function findOrder(orderId) {
  const id = String(orderId || '')
    .trim()
    .toUpperCase();
  if (!/^NX-\d{4}-\d{6}$/.test(id))
    throw new HttpError(404, 'Order not found.');
  const order = await Order.findOne({orderId: id});
  if (!order) throw new HttpError(404, 'Order not found.');
  return order;
}

// The order page: the order, its customer and what an admin may do next.
// Replaces the order's labels. Only the fixed list is accepted.
async function setTags(orderId, tags) {
  const order = await findOrder(orderId);
  const wanted = [...new Set(Array.isArray(tags) ? tags : [])];
  const bad = wanted.filter((tag) => !rules.ORDER_TAGS.includes(tag));
  if (bad.length)
    throw new HttpError(
      400,
      'Choose from: ' + rules.ORDER_TAGS.join(', ') + '.',
      {tags: 'Choose from: ' + rules.ORDER_TAGS.join(', ') + '.'},
    );
  const before = order.tags || [];
  order.tags = wanted;
  await order.save();
  return {order, before, after: wanted};
}

async function getOrder(orderId) {
  const order = await findOrder(orderId);
  const customer = await User.findById(order.user)
    .select('name email phone createdAt isBlocked')
    .lean();
  const paidSoFar =
    (order.walletUsed || 0) +
    (rules.PAID_STATUSES.includes(order.paymentStatus) ? order.total : 0);
  const risk = riskOf(order, await customerHistory([order.user]));
  return {
    order,
    risk,
    customer,
    next: rules.nextStatuses(rules.deriveOrderStatus(order.items)),
    cancellable: order.items
      .filter(rules.canCancelItem)
      .map((item) => String(item._id)),
    refundable: Math.max(0, paidSoFar - (order.refundedAmount || 0)),
    returnItems: order.items
      .filter((item) => item.status === 'return_requested')
      .map((item) => String(item._id)),
    returnValue: rules.refundFor(
      order,
      order.items
        .filter((item) => item.status === 'return_requested')
        .map((item) => item._id),
    ),
    canReverse:
      order.paymentMethod === 'razorpay' &&
      Boolean(order.razorpay && order.razorpay.paymentId),
  };
}

const snapshot = (order) => ({
  status: order.orderStatus,
  payment: order.paymentStatus,
  refunded: order.refundedAmount,
});

// Forward-only, along placed → confirmed → shipped → out for delivery → delivered.
async function updateStatus(orderId, status) {
  const order = await findOrder(orderId);
  const before = snapshot(order);
  await orderService.advanceStatus(order, status, 'admin');
  return {order, before, after: snapshot(order)};
}

// Several orders at once. Each one is checked on its own; the ones that can't move are listed.
async function bulkStatus(orderIds, status) {
  const done = [];
  const skipped = [];
  for (const orderId of orderIds) {
    try {
      const {order} = await updateStatus(orderId, status);
      done.push(order.orderId);
    } catch (error) {
      skipped.push({
        orderId,
        reason: error.status ? error.message : 'Something went wrong.',
      });
    }
  }
  return {done, skipped};
}

// Cancel some items (or every cancellable one): stock goes back, money is refunded as for customers.
async function cancelItems(orderId, {itemIds, reason, refundMethod}) {
  const order = await findOrder(orderId);
  if (
    order.settlements.some(
      (entry) => !entry.done && entry.event === 'order.cancelled',
    )
  ) {
    const resumed = await settlementService.resume(order._id);
    const stillRequested = resumed.items.some(
      (item) =>
        rules.canCancelItem(item) &&
        (!itemIds.length || itemIds.includes(String(item._id))),
    );
    if (stillRequested)
      return cancelItems(orderId, {
        itemIds: itemIds.filter((id) =>
          resumed.items.some(
            (item) => String(item._id) === id && rules.canCancelItem(item),
          ),
        ),
        reason,
        refundMethod,
      });
    return {
      order: resumed,
      before: snapshot(order),
      after: snapshot(resumed),
      names: [],
    };
  }
  const before = snapshot(order);
  const items = itemIds.length
    ? itemIds.map((id) =>
        mongoose.isValidObjectId(id) ? order.items.id(id) : null,
      )
    : order.items.filter(rules.canCancelItem);
  if (!items.length || items.some((item) => !item))
    throw new HttpError(404, 'That item is not in this order.');
  const blocked = items.find((item) => !rules.canCancelItem(item));
  if (blocked)
    throw new HttpError(
      400,
      `${blocked.name} can no longer be cancelled (it is ${rules.STATUS_LABELS[blocked.status].toLowerCase()}).`,
    );
  const updated = await orderService.cancelItems(order, items, {
    reason: reason || 'Cancelled by Nexthlon',
    by: 'admin',
    refundMethod,
  });
  return {
    order: updated,
    before,
    after: snapshot(updated),
    names: items.map((item) => item.name),
  };
}

async function addShipment(
  orderId,
  {courier, trackingNumber, expectedAt, markShipped},
  actor,
) {
  const order = await findOrder(orderId);
  if (['cancelled', 'returned'].includes(order.orderStatus))
    throw new HttpError(400, "A cancelled or returned order can't be shipped.");
  const alreadyShipped = ['shipped', 'out_for_delivery', 'delivered'].includes(
    order.orderStatus,
  );
  order.shipments.push({
    courier,
    trackingNumber,
    expectedAt,
    addedBy: actor._id,
  });
  order.statusHistory.push({
    status: 'shipment_added',
    by: 'admin',
    note: `${courier} ${trackingNumber}`,
  });
  await order.save();
  const shipmentId = String(order.shipments[order.shipments.length - 1]._id);
  await events.emit(
    'order.shipment_added',
    {orderId: order.orderId, shipmentId, alreadyShipped},
    {key: shipmentId},
  );
  // "Mark as shipped" moves the order forward too, when that is the next allowed step.
  if (
    markShipped &&
    rules.nextStatuses(rules.deriveOrderStatus(order.items)).includes('shipped')
  ) {
    await orderService.advanceStatus(order, 'shipped', 'admin');
  }
  return {order, shipment: order.shipments[order.shipments.length - 1]};
}

async function addNote(orderId, body, actor) {
  const order = await findOrder(orderId);
  order.notes.push({body, by: actor._id, byName: actor.name});
  await order.save();
  return {order, note: order.notes[order.notes.length - 1]};
}

// A refund outside a cancellation or return (goodwill, a price adjustment...). Never more than
// what was actually paid and not yet refunded.
async function manualRefund(orderId, {amount, method, reason, key}) {
  const order = await findOrder(orderId);
  const before = snapshot(order);
  const refunds = await refundService.issueRefund(order, amount, {
    method,
    key,
    reason: reason || `Refund for ${order.orderId}`,
  });
  return {order, before, after: snapshot(order), refunds};
}

// ---------- Returns ----------
const RETURN_SORTS = {
  updated: {label: 'Recently changed', order: {updatedAt: -1}},
  oldest: {label: 'Oldest change', order: {updatedAt: 1}},
};
function readReturnList(query = {}) {
  return readListQuery(query, {
    pageSize: PAGE_SIZE,
    searchMax: 60,
    cleanSearch: (value) => cleanText(value, 60),
    defaultSort: 'updated',
    sorts: RETURN_SORTS,
    fields: {
      status: {values: RETURN_FILTERS, default: 'requested', label: 'Status'},
    },
  });
}
function readReturnFilters(query = {}) {
  const {
    sort: _sort,
    limit: _limit,
    ...filters
  } = readReturnList(query).filters;
  return filters;
}

async function listReturns(query = {}) {
  const list = readReturnList(query);
  const {filters, size} = list;
  const byStatus = {
    requested: {orderStatus: 'return_requested'},
    approved: {'returnDecision.status': 'approved'},
    rejected: {'returnDecision.status': 'rejected'},
    all: {
      $or: [{orderStatus: 'return_requested'}, {returnDecision: {$ne: null}}],
    },
  };
  const filter = {...byStatus[filters.status]};
  if (filters.q) {
    const pattern = new RegExp(escapeRegex(filters.q), 'i');
    filter.$and = [{$or: [{orderId: pattern}, {'address.fullName': pattern}]}];
  }
  const [orders, total, counts] = await Promise.all([
    Order.find(filter)
      .sort(list.order)
      .skip(list.skip)
      .limit(size)
      .select(
        'orderId items total walletUsed paymentMethod paymentStatus orderStatus returnReason returnNote returnPhotos returnDecision updatedAt deliveredAt address.fullName address.city',
      )
      .lean(),
    Order.countDocuments(filter),
    Promise.all([
      Order.countDocuments(byStatus.requested),
      Order.countDocuments(byStatus.approved),
      Order.countDocuments(byStatus.rejected),
    ]),
  ]);
  return {
    returns: orders.map((order) => {
      const requested = order.items.filter(
        (item) => item.status === 'return_requested',
      );
      const returned = order.items.filter((item) => item.status === 'returned');
      return {
        orderId: order.orderId,
        customer: order.address ? order.address.fullName : '',
        city: order.address ? order.address.city : '',
        items: (requested.length ? requested : returned).map(
          (item) =>
            `${item.name}${item.option ? ` (${item.option})` : ''} × ${item.quantity}`,
        ),
        value: rules.itemsValue(
          order,
          (requested.length ? requested : returned).map((item) => item._id),
        ),
        reason: order.returnReason,
        note: order.returnNote,
        photos: order.returnPhotos || [],
        status:
          order.orderStatus === 'return_requested'
            ? 'requested'
            : order.returnDecision
              ? order.returnDecision.status
              : 'requested',
        decision: order.returnDecision,
        method: order.paymentMethod,
        updatedAt: order.updatedAt,
      };
    }),
    filters,
    counts: {requested: counts[0], approved: counts[1], rejected: counts[2]},
    chips: list.chips,
    sorts: list.sorts,
    pagination: list.pagination(total),
  };
}

function settle(order, note) {
  const status = rules.deriveOrderStatus(order.items);
  if (status !== order.orderStatus) {
    order.orderStatus = status;
    order.statusHistory.push({status, by: 'admin', note});
  }
}

// Approve: the items count as returned, their stock goes back on the shelf, and their value is
// refunded (to the wallet, or to the card/UPI for online payments). Reject: the items go back to
// "delivered" and the customer sees the note.
async function decideReturn(orderId, {decision, note, refundMethod}, actor) {
  const order = await findOrder(orderId);
  if (
    order.settlements.some(
      (entry) => !entry.done && entry.event === 'order.return_decided',
    )
  ) {
    if (decision !== 'approve')
      throw new HttpError(
        409,
        'This return approval has already been saved and is still processing.',
      );
    const resumed = await settlementService.resume(order._id);
    return {
      order: resumed,
      before: snapshot(order),
      after: snapshot(resumed),
      refund: resumed.returnDecision.refunded,
      items: [],
    };
  }
  settlementService.assertSettled(order);
  const items = order.items.filter(
    (item) => item.status === 'return_requested',
  );
  if (!items.length)
    throw new HttpError(
      400,
      'This order has no return waiting for a decision.',
    );
  const before = snapshot(order);
  let refund = 0;

  if (decision === 'approve') {
    refund = rules.refundFor(
      order,
      items.map((item) => item._id),
    );
    items.forEach((item) => {
      item.status = 'returned';
    });
    const method = refundMethod || 'wallet';
    order.returnDecision = {
      status: 'approved',
      note,
      refundMethod: refund > 0 ? method : '',
      refunded: refund,
      by: actor._id,
      at: new Date(),
    };
    settle(order, note || 'Return approved');
    const itemIds = items.map((item) => String(item._id)).sort();
    order.settlements.push({
      key: `return:${order._id}:${itemIds.join(':')}`,
      itemIds,
      restoreStock: true,
      refund,
      method,
      reason: `Return approved for ${order.orderId}`,
      event: 'order.return_decided',
      payload: {
        orderId: order.orderId,
        decision,
        note: note || '',
        seq: order.statusHistory.length,
      },
    });
    await order.save();
    const updated = await settlementService.resume(order._id);
    return {
      order: updated,
      before,
      after: snapshot(updated),
      refund,
      items: items.map((item) => item.name),
    };
  } else {
    items.forEach((item) => {
      item.status = 'delivered';
    });
    order.returnDecision = {
      status: 'rejected',
      note,
      refundMethod: '',
      refunded: 0,
      by: actor._id,
      at: new Date(),
    };
    order.statusHistory.push({status: 'return_rejected', by: 'admin', note});
    settle(order, note);
    await order.save();
  }
  const seq = order.statusHistory.length;
  await events.emit(
    'order.return_decided',
    {orderId: order.orderId, decision, note: note || '', seq},
    {key: `${order.orderId}:${seq}`},
  );
  return {
    order,
    before,
    after: snapshot(order),
    refund,
    items: items.map((item) => item.name),
  };
}

module.exports = {
  setTags,
  PAGE_SIZE,
  ORDER_SORTS,
  METHODS,
  RETURN_FILTERS,
  readOrderFilters,
  listOrders,
  exportOrders,
  findOrder,
  getOrder,
  updateStatus,
  bulkStatus,
  cancelItems,
  addShipment,
  addNote,
  manualRefund,
  readReturnFilters,
  listReturns,
  decideReturn,
};
