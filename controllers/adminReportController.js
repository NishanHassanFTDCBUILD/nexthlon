// Admin exports. Read-only; the data is streamed row by row, so a large export never sits in memory.
const Order = require('../models/Order');
const dashboardService = require('../services/dashboardService');
const analyticsService = require('../services/analyticsService');
const {row} = require('../utils/csv');
const {asyncHandler} = require('../utils/http');

const rupees = (paise) => (Number(paise || 0) / 100).toFixed(2);

// GET /api/admin/reports/sales.csv?range=7d|30d|month|year|today|custom&from=&to=
// One line per order placed in the range, money in rupees.
const salesCsv = asyncHandler(async (req, res) => {
  const range = dashboardService.readRange(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nexthlon-sales-${range.fromDay}-to-${range.toDay}.csv"`,
  );
  // A byte order mark, so Excel reads the ₹ sign and Indian names correctly.
  res.write('﻿');
  res.write(
    row([
      'Order',
      'Placed (IST)',
      'Customer',
      'City',
      'State',
      'Items',
      'Units',
      'Payment method',
      'Payment status',
      'Order status',
      'Subtotal (Rs)',
      'Discount (Rs)',
      'Coupon',
      'Coupon discount (Rs)',
      'Delivery (Rs)',
      'Wallet used (Rs)',
      'Total charged (Rs)',
      'Refunded (Rs)',
    ]),
  );
  const cursor = Order.find({createdAt: {$gte: range.from, $lt: range.to}})
    .sort({createdAt: 1})
    .select(
      'orderId createdAt address items subtotal discount couponCode couponDiscount deliveryFee walletUsed total refundedAmount paymentMethod paymentStatus orderStatus',
    )
    .lean()
    .cursor();
  for await (const order of cursor) {
    const placed = new Date(order.createdAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    res.write(
      row([
        order.orderId,
        placed,
        order.address && order.address.fullName,
        order.address && order.address.city,
        order.address && order.address.state,
        order.items.length,
        order.items.reduce((sum, item) => sum + item.quantity, 0),
        order.paymentMethod,
        order.paymentStatus,
        order.orderStatus,
        rupees(order.subtotal),
        rupees(order.discount),
        order.couponCode,
        rupees(order.couponDiscount),
        rupees(order.deliveryFee),
        rupees(order.walletUsed),
        rupees(order.total),
        rupees(order.refundedAmount),
      ]),
    );
  }
  res.end();
});

// GET /api/admin/reports/analytics.csv?range=&by=&from=&to=
// Everything the Analytics page shows, as one file: the headline totals, then each table, each
// under its own heading, so it opens tidily in Excel or Sheets.
const analyticsCsv = asyncHandler(async (req, res) => {
  const data = await analyticsService.analytics(req.query);
  const {range, group} = data;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="nexthlon-analytics-${range.fromDay}-to-${range.toDay}.csv"`,
  );
  res.write('﻿');

  const section = (title) => res.write(row([title]));
  // A blank line between the blocks, in the same CRLF style the rows use.
  const blank = () => res.write(String.fromCharCode(13, 10));

  section(
    `Nexthlon analytics: ${range.fromDay} to ${range.toDay} (${group.label})`,
  );
  blank();

  section('Totals');
  res.write(row(['Measure', 'Value', 'Change vs previous period (%)']));
  data.cards.forEach((card) => {
    const value = card.format === 'money' ? rupees(card.value) : card.value;
    res.write(
      row([card.label, value, card.change === null ? '' : card.change]),
    );
  });
  blank();

  section('Revenue and orders over time');
  res.write(
    row([
      group.label.replace('By ', '').replace('Automatic', 'Period'),
      'Orders',
      'Revenue (Rs)',
      'Average order value (Rs)',
    ]),
  );
  data.timeline.forEach((point) =>
    res.write(
      row([
        point.label,
        point.orders,
        rupees(point.revenue),
        rupees(point.aov),
      ]),
    ),
  );
  blank();

  section('New vs returning customers (orders)');
  res.write(row(['Period', 'From new customers', 'From returning customers']));
  data.newReturning.forEach((point) =>
    res.write(row([point.label, point.newCustomers, point.returning])),
  );
  blank();

  section('Top products by revenue');
  res.write(row(['Product', 'Units', 'Orders', 'Revenue (Rs)']));
  data.topProducts.byRevenue.forEach((p) =>
    res.write(row([p.name, p.units, p.orders, rupees(p.revenue)])),
  );
  blank();

  section('Top products by units');
  res.write(row(['Product', 'Units', 'Orders', 'Revenue (Rs)']));
  data.topProducts.byUnits.forEach((p) =>
    res.write(row([p.name, p.units, p.orders, rupees(p.revenue)])),
  );
  blank();

  section('Top categories');
  res.write(row(['Category', 'Units', 'Revenue (Rs)']));
  data.topCategories.forEach((c) =>
    res.write(row([c.name, c.units, rupees(c.revenue)])),
  );
  blank();

  section('Payment methods');
  res.write(
    row([
      'Method',
      'Orders',
      'Paid orders',
      'Share (%)',
      'Amount charged (Rs)',
    ]),
  );
  data.payments.forEach((m) =>
    res.write(row([m.key, m.count, m.paid, m.share, rupees(m.amount)])),
  );
  blank();

  section('Conversion (carts to orders)');
  res.write(row(['Step', 'Count']));
  res.write(row(['Shoppers with items in a cart', data.funnel.carts]));
  res.write(row(['Orders placed', data.funnel.orders]));
  res.write(row(['Orders paid', data.funnel.paid]));
  res.write(row(['Carts that never became an order', data.funnel.abandoned]));
  res.end();
});

module.exports = {salesCsv, analyticsCsv};
