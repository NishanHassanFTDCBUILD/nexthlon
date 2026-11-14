const checkoutService = require("../services/checkoutService");
const codConfirmService = require("../services/codConfirmService");
const orderService = require("../services/orderService");
const buyNowService = require("../services/buyNowService");
const { validatePlaceOrder, validateCancel, validateReturn, readFlag, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");
const { STATUS_LABELS } = require("../utils/orderRules");
const imageService = require("../services/imageService");

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
      option: item.option || "",
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
    prepaidDiscount: order.prepaidDiscount || 0,
    deliveryFee: order.deliveryFee,
    walletUsed: order.walletUsed,
    total: order.total,
    refundedAmount: order.refundedAmount,
    createdAt: order.createdAt
  };
}

// POST /api/checkout/quote   body: { useWallet?, source?: "cart" | "buynow" }
// The order as it would be placed now: live prices, the coupon and the wallet balance.
const quote = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await checkoutService.buildQuote(req.user._id, { useWallet: readFlag(body.useWallet), source: buyNowService.readSource(body.source), payOnline: readFlag(body.payOnline) });
  res.json({ quote: checkoutService.publicQuote(result) });
});

// POST /api/buy-now   body: { productId, quantity, variantId (the size, when it has sizes) }
// Saves the one product to buy now (the cart is not touched) and sends the shopper to its checkout.
const buyNow = asyncHandler(async (req, res) => {
  const body = req.body || {};
  await buyNowService.start(req.user._id, body.productId, body.quantity, typeof body.variantId === "string" ? body.variantId : null);
  res.status(201).json({ redirect: "/checkout?buy=now" });
});

// POST /api/orders   body: { addressId, paymentMethod: "cod" | "wallet", useWallet? }
const placeOrder = asyncHandler(async (req, res) => {
  const value = checked(validatePlaceOrder, req.body);
  const order = await checkoutService.placeOrder(req.user._id, value);
  res.status(201).json({ message: "Your order is placed.", order: toPublicOrder(order), redirect: `/orders/${order.orderId}/success` });
});

// POST /api/checkout/cod-code   { addressId }   E2: sends the code that confirms a Cash on Delivery order.
const sendCodCode = asyncHandler(async (req, res) => {
  const address = await checkoutService.findAddress(req.user._id, String((req.body && req.body.addressId) || ""));
  const { sentTo } = await codConfirmService.send(req.user._id, address.phone);
  res.json({ message: `We sent a 6-digit code to ${sentTo}.`, sentTo });
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

// POST /api/orders/:orderId/return   body: { reason, note? } as JSON, or a form with up to 3 "photos"
// Photos are saved only after the order is found to be returnable.
const requestReturn = asyncHandler(async (req, res) => {
  const value = checked(validateReturn, req.body);
  const files = req.files || [];
  const fakes = imageService.findFakeImages(files);
  if (fakes.length) throw new HttpError(400, "Only real JPG, PNG or WEBP photos can be added.", { photos: "Only real JPG, PNG or WEBP photos can be added." });
  const order = await orderService.requestReturn(req.user._id, req.params.orderId, value, new Date(), {
    savePhotos: () => imageService.saveImages(files, "returns")
  });
  res.json({ message: "Return requested. We will arrange a pickup and keep you posted.", order: toPublicOrder(order) });
});

module.exports = { sendCodCode, toPublicOrder, quote, buyNow, placeOrder, listOrders, getOrder, cancelOrder, cancelItem, requestReturn };
