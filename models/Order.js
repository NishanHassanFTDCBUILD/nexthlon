const mongoose = require("mongoose");
const { ORDER_STATUSES, PAYMENT_STATUSES } = require("../utils/orderRules");

// An order keeps a SNAPSHOT of every item (name, image, price, M.R.P.) and of the address at the
// moment it was placed, so later product or address changes never rewrite it. Money is in paise.
const orderItemSchema = new mongoose.Schema({
  product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  brand: { type: String, default: "" },
  image: { type: String, default: "" },
  // The size or colour bought, for products that have them: its id (stock goes back to it on a cancel
  // or return), and its label and SKU as they were at the time ("Size 9 · Red"). Empty on older orders
  // and on products without options.
  variant: { type: mongoose.Schema.Types.ObjectId, default: null },
  option: { type: String, default: "" },
  sku: { type: String, default: "" },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ORDER_STATUSES, default: "placed" },
  cancelReason: { type: String, default: "" },
  returnReason: { type: String, default: "" },
  // GST on this line as invoiced (services/gstService.js): value is what was paid after its share of
  // any coupon; taxable + cgst + sgst + igst = value. Missing on orders from before GST invoices.
  tax: { type: new mongoose.Schema({
    hsn: String, rate: Number, discount: Number, value: Number, taxable: Number, cgst: Number, sgst: Number, igst: Number
  }, { _id: false }), default: undefined }
});

// The GST money of one line (an item, or delivery).
const taxLineSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, default: null },
  name: String, hsn: String, rate: Number, quantity: Number, value: Number, taxable: Number, cgst: Number, sgst: Number, igst: Number
}, { _id: false });

// A credit note: invoiced items cancelled or returned, with the tax that goes back.
const creditNoteSchema = new mongoose.Schema({
  number: { type: String, required: true },
  date: { type: Date, default: Date.now },
  reason: { type: String, default: "" },
  lines: { type: [taxLineSchema], default: [] },
  delivery: { type: taxLineSchema, default: null },
  taxable: Number, cgst: Number, sgst: Number, igst: Number, value: Number
}, { _id: false });

// The order's GST, fixed when it was placed, so later rate or address changes never alter an invoice.
const gstSchema = new mongoose.Schema({
  scheme: { type: String, enum: ["regular", "composition"], default: "regular" },
  sellerState: String,
  sellerGstin: String,
  placeOfSupply: String,
  interstate: Boolean,
  taxable: Number, cgst: Number, sgst: Number, igst: Number, tax: Number, value: Number,
  delivery: { type: taxLineSchema, default: null },
  // Given when the order is confirmed (cash on delivery / wallet: at once; online: when paid).
  invoiceNo: { type: String, default: "" },
  invoiceDate: { type: Date, default: null }
}, { _id: false });

const addressSnapshotSchema = new mongoose.Schema({
  fullName: String,
  phone: String,
  line1: String,
  line2: String,
  landmark: String,
  city: String,
  state: String,
  pincode: String
}, { _id: false });

const historySchema = new mongoose.Schema({
  status: { type: String, required: true },
  note: { type: String, default: "" },
  by: { type: String, enum: ["customer", "admin", "system"], default: "system" },
  at: { type: Date, default: Date.now }
}, { _id: false });

const refundSchema = new mongoose.Schema({
  operationKey: { type: String, default: "" },
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ["wallet", "original"], required: true },
  status: { type: String, enum: ["pending", "processed", "failed"], default: "processed" },
  reason: { type: String, default: "" },
  razorpayRefundId: { type: String, default: "" },
  at: { type: Date, default: Date.now }
}, { _id: false });

// Admin: a parcel handed to a courier.
// One scan from the courier: "In transit", at "Bengaluru Hub", at this time.
const trackingEventSchema = new mongoose.Schema({
  status: { type: String, required: true, maxlength: 60 },
  location: { type: String, default: "", maxlength: 120 },
  at: { type: Date, default: Date.now }
}, { _id: false });

const shipmentSchema = new mongoose.Schema({
  courier: { type: String, required: true, trim: true, maxlength: 60 },
  trackingNumber: { type: String, required: true, trim: true, maxlength: 60 },
  expectedAt: { type: Date, default: null },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  at: { type: Date, default: Date.now },
  // B5: who booked it ("manual" when typed in by the admin) and the courier platform's own ids.
  provider: { type: String, enum: ["manual", "shiprocket"], default: "manual" },
  providerOrderId: { type: String, default: "", maxlength: 40 },
  providerShipmentId: { type: String, default: "", maxlength: 40 },
  labelUrl: { type: String, default: "", maxlength: 500 },
  // The courier's latest word, and every scan the tracking webhook reported (newest last).
  status: { type: String, default: "", maxlength: 60 },
  events: { type: [trackingEventSchema], default: [] }
});

// Admin: an internal note (never shown to the customer).
const noteSchema = new mongoose.Schema({
  body: { type: String, required: true, trim: true, maxlength: 1000 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  byName: { type: String, default: "", maxlength: 60 },
  at: { type: Date, default: Date.now }
});

// Admin: the answer to a return request.
const returnDecisionSchema = new mongoose.Schema({
  status: { type: String, enum: ["approved", "rejected"], required: true },
  note: { type: String, default: "", maxlength: 500 },
  refundMethod: { type: String, enum: ["wallet", "original", ""], default: "" },
  refunded: { type: Number, default: 0, min: 0 },
  by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  at: { type: Date, default: Date.now }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  items: { type: [orderItemSchema], validate: list => list.length > 0 },
  address: { type: addressSnapshotSchema, required: true },
  mrpTotal: { type: Number, required: true, min: 0 },
  subtotal: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  couponCode: { type: String, default: "" },
  couponDiscount: { type: Number, default: 0, min: 0 },
  // E2: taken off for paying online (store setting at the time). Shared across items like the coupon.
  prepaidDiscount: { type: Number, default: 0, min: 0 },
  deliveryFee: { type: Number, default: 0, min: 0 },
  walletUsed: { type: Number, default: 0, min: 0 },
  // What is left to pay after the wallet: cash on delivery, or the online payment.
  total: { type: Number, required: true, min: 0 },
  // Where the items came from: the cart, or a single "Buy now" product (the cart is then left alone).
  source: { type: String, enum: ["cart", "buynow"], default: "cart" },
  paymentMethod: { type: String, enum: ["cod", "razorpay", "wallet"], required: true },
  paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: "pending" },
  orderStatus: { type: String, enum: ORDER_STATUSES, default: "placed" },
  statusHistory: { type: [historySchema], default: [] },
  // True once stock has been taken for this order (online payments take it on payment).
  stockReserved: { type: Boolean, default: false },
  deliveredAt: { type: Date, default: null },
  cancelReason: { type: String, default: "" },
  returnReason: { type: String, default: "" },
  returnNote: { type: String, default: "" },
  returnPhotos: { type: [String], default: [] },
  refundedAmount: { type: Number, default: 0, min: 0 },
  refunds: { type: [refundSchema], default: [] },
  // Durable work journals, saved with the change and resumed after a restart.
  refundOperations: { type: [new mongoose.Schema({
    key: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, enum: ["wallet", "original"], required: true },
    reason: { type: String, default: "" },
    parts: { type: [refundSchema], default: [] },
    gatewayStarted: { type: Boolean, default: false },
    gatewayStartedAt: { type: Date, default: null },
    recorded: { type: Boolean, default: false },
    done: { type: Boolean, default: false }
  }, { _id: false })], default: [] },
  settlements: { type: [new mongoose.Schema({
    key: { type: String, required: true },
    itemIds: { type: [String], default: [] },
    restoreStock: { type: Boolean, default: false },
    refund: { type: Number, default: 0 },
    method: { type: String, default: "wallet" },
    reason: { type: String, default: "" },
    event: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    done: { type: Boolean, default: false }
  }, { _id: false })], default: [] },
  paymentFulfilled: { type: Boolean, default: false },
  paymentFulfillmentStarted: { type: Boolean, default: false },
  paymentStockFailed: { type: Boolean, default: false },
  razorpay: {
    orderId: { type: String, default: "" },
    paymentId: { type: String, default: "" }
  },
  shipments: { type: [shipmentSchema], default: [] },
  // B5: the courier could not deliver and is bringing the parcel back ("initiated"), or it is back with us
  // ("received": the items are cancelled, stock returns and a paid order is refunded).
  rto: {
    stage: { type: String, enum: ["", "initiated", "received"], default: "" },
    reason: { type: String, default: "", maxlength: 200 },
    at: { type: Date, default: null }
  },
  notes: { type: [noteSchema], default: [] },
  returnDecision: { type: returnDecisionSchema, default: null },
  gst: { type: gstSchema, default: undefined },
  creditNotes: { type: [creditNoteSchema], default: [] }
}, { timestamps: true, optimisticConcurrency: true });

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
// Admin filters and the money ledger.
orderSchema.index({ createdAt: -1 });
orderSchema.index({ paymentStatus: 1, createdAt: -1 });
orderSchema.index({ paymentMethod: 1, createdAt: -1 });
orderSchema.index({ "address.city": 1, createdAt: -1 });
orderSchema.index({ "refunds.at": -1 }, { sparse: true });
orderSchema.index({ "razorpay.orderId": 1 }, { sparse: true });
// The courier tracking webhook finds the order by its AWB (tracking number).
orderSchema.index({ "shipments.trackingNumber": 1 }, { sparse: true });
// "Frequently bought together" (recommendationService): orders that contain a product, newest first.
orderSchema.index({ "items.product": 1, createdAt: -1 });
// GST: an invoice number is never used twice.
orderSchema.index({ "gst.invoiceNo": 1 }, { unique: true, partialFilterExpression: { "gst.invoiceNo": { $type: "string", $gt: "" } } });

module.exports = mongoose.model("Order", orderSchema);
