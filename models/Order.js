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
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  quantity: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ORDER_STATUSES, default: "placed" },
  cancelReason: { type: String, default: "" },
  returnReason: { type: String, default: "" }
});

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
  amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ["wallet", "original"], required: true },
  status: { type: String, enum: ["pending", "processed", "failed"], default: "processed" },
  reason: { type: String, default: "" },
  razorpayRefundId: { type: String, default: "" },
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
  deliveryFee: { type: Number, default: 0, min: 0 },
  walletUsed: { type: Number, default: 0, min: 0 },
  // What is left to pay after the wallet: cash on delivery, or the online payment.
  total: { type: Number, required: true, min: 0 },
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
  razorpay: {
    orderId: { type: String, default: "" },
    paymentId: { type: String, default: "" }
  }
}, { timestamps: true });

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, createdAt: -1 });
orderSchema.index({ "razorpay.orderId": 1 }, { sparse: true });

module.exports = mongoose.model("Order", orderSchema);
