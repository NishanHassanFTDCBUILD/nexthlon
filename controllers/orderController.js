const checkoutService = require("../services/checkoutService");
const orderService = require("../services/orderService");
const { validatePlaceOrder, validateCancel, validateReturn, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { STATUS_LABELS } = require("../utils/orderRules");

function checked(validate, body) {
  const { errors, value } = validate(body);
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

// What the API returns for an order. Money is in paise.
function toPublicOrder(order) {
  return {
    orderId: order.orderId,
    status: order.orderStatus,
    statusLabel: STATUS_LABELS[order.orderStatus] || order.orderStatus,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    items: order.items.map(item => ({
      id: String(item._id),
      productId: String(item.product),
      name: item.name,
      slug: item.slug,
      image: item.image,
      price: item.price,
      mrp: item.mrp,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      status: item.status
    })),
    address: order.address,
    mrpTotal: order.mrpTotal,
    subtotal: order.subtotal,
    discount: order.discount,
    couponCode: order.couponCode,
    couponDiscount: order.couponDiscount,
    deliveryFee: order.deliveryFee,
    walletUsed: order.walletUsed,
    total: order.total,
    refundedAmount: order.refundedAmount,
    createdAt: order.createdAt
  };
}

// POST /api/checkout/quote   The order as it would be placed now, from live prices.
const quote = asyncHandler(async (req, res) => {
  const result = await checkoutService.buildQuote(req.user._id);
  res.json({ quote: { totals: result.totals, problems: result.problems, codAllowed: result.codAllowed, codLimit: result.codLimit, itemCount: result.lines.length } });
});

// POST /api/orders   body: { addressId, paymentMethod: "cod" }
const placeOrder = asyncHandler(async (req, res) => {
  const value = checked(validatePlaceOrder, req.body);
  const order = await checkoutService.placeOrder(req.user._id, value);
  res.status(201).json({ message: "Your order is placed.", order: toPublicOrder(order), redirect: `/orders/${order.orderId}/success` });
});

// GET /api/orders?status=&period=&q=&page=
const listOrders = asyncHandler(async (req, res) => {
  const { orders, filters, pagination } = await orderService.listOrders(req.user._id, req.query);
  res.json({ orders: orders.map(toPublicOrder), filters, pagination });
});

// GET /api/orders/:orderId
const getOrder = asyncHandler(async (req, res) => {
  res.json({ order: toPublicOrder(await orderService.getOwnedOrder(req.user._id, req.params.orderId)) });
});

// POST /api/orders/:orderId/cancel   body: { reason?, refundMethod? }
const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.user._id, req.params.orderId, checked(validateCancel, req.body));
  res.json({ message: "Your order is cancelled.", order: toPublicOrder(order) });
});

// POST /api/orders/:orderId/items/:itemId/cancel   body: { reason?, refundMethod? }
const cancelItem = asyncHandler(async (req, res) => {
  const order = await orderService.cancelItem(req.user._id, req.params.orderId, req.params.itemId, checked(validateCancel, req.body));
  res.json({ message: "That item is cancelled.", order: toPublicOrder(order) });
});

// POST /api/orders/:orderId/return   body: { reason, note? }
const requestReturn = asyncHandler(async (req, res) => {
  const order = await orderService.requestReturn(req.user._id, req.params.orderId, checked(validateReturn, req.body));
  res.json({ message: "Return requested. We will arrange a pickup and keep you posted.", order: toPublicOrder(order) });
});

module.exports = { toPublicOrder, quote, placeOrder, listOrders, getOrder, cancelOrder, cancelItem, requestReturn };
