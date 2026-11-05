// Admin exports. Read-only; the data is streamed row by row, so a large export never sits in memory.
const Order = require("../models/Order");
const dashboardService = require("../services/dashboardService");
const { row } = require("../utils/csv");
const { asyncHandler } = require("../utils/http");

const rupees = paise => (Number(paise || 0) / 100).toFixed(2);

// GET /api/admin/reports/sales.csv?range=7d|30d|month|year|today|custom&from=&to=
// One line per order placed in the range, money in rupees.
const salesCsv = asyncHandler(async (req, res) => {
  const range = dashboardService.readRange(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nexthlon-sales-${range.fromDay}-to-${range.toDay}.csv"`);
  // A byte order mark, so Excel reads the ₹ sign and Indian names correctly.
  res.write("﻿");
  res.write(row(["Order", "Placed (IST)", "Customer", "City", "State", "Items", "Units", "Payment method", "Payment status", "Order status",
    "Subtotal (Rs)", "Discount (Rs)", "Coupon", "Coupon discount (Rs)", "Delivery (Rs)", "Wallet used (Rs)", "Total charged (Rs)", "Refunded (Rs)"]));
  const cursor = Order.find({ createdAt: { $gte: range.from, $lt: range.to } })
    .sort({ createdAt: 1 })
    .select("orderId createdAt address items subtotal discount couponCode couponDiscount deliveryFee walletUsed total refundedAmount paymentMethod paymentStatus orderStatus")
    .lean()
    .cursor();
  for await (const order of cursor) {
    const placed = new Date(order.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    res.write(row([
      order.orderId, placed, order.address && order.address.fullName, order.address && order.address.city, order.address && order.address.state,
      order.items.length, order.items.reduce((sum, item) => sum + item.quantity, 0), order.paymentMethod, order.paymentStatus, order.orderStatus,
      rupees(order.subtotal), rupees(order.discount), order.couponCode, rupees(order.couponDiscount), rupees(order.deliveryFee),
      rupees(order.walletUsed), rupees(order.total), rupees(order.refundedAmount)
    ]));
  }
  res.end();
});

module.exports = { salesCsv };
