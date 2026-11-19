// Admin APIs for orders, returns, the money ledger and refunds. Thin: validate,
// call the service, write the audit log, reply. Every change made here is audit-logged.
const adminOrderService = require('../services/adminOrderService');
const ledgerService = require('../services/ledgerService');
const auditService = require('../services/auditService');
const invoiceService = require('../services/invoiceService');
const shippingService = require('../services/shippingService');
const {sendWorkbook} = require('../utils/excel');
const {row} = require('../utils/csv');
const rules = require('../utils/orderRules');
const v = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

function checked(validate, body) {
  const {errors, value} = validate(body || {});
  if (v.hasErrors(errors))
    throw new HttpError(
      400,
      Object.values(errors)[0] || 'Please fix the highlighted fields.',
      errors,
    );
  return value;
}
const audit = (req, action, target, before, after) =>
  auditService.record({
    ...auditService.fromRequest(req),
    action,
    target,
    before,
    after,
  });
const stamp = () => new Date().toISOString().slice(0, 10);

// ---------- Orders ----------
const listOrders = asyncHandler(async (req, res) => {
  res.json(await adminOrderService.listOrders(req.query));
});

const ORDER_COLUMNS = [
  {header: 'Order', key: 'orderId', width: 18},
  {header: 'Placed', key: 'createdAt', width: 20, type: 'date'},
  {header: 'Customer', key: 'customer', width: 24},
  {header: 'Phone', key: 'phone', width: 14},
  {header: 'City', key: 'city', width: 16},
  {header: 'State', key: 'state', width: 16},
  {header: 'Units', key: 'items', width: 8, type: 'number'},
  {header: 'Order status', key: 'statusLabel', width: 18},
  {header: 'Payment method', key: 'method', width: 14},
  {header: 'Payment status', key: 'payment', width: 16},
  {header: 'Subtotal', key: 'subtotal', width: 14, type: 'money'},
  {header: 'Coupon', key: 'couponCode', width: 12},
  {header: 'Coupon discount', key: 'couponDiscount', width: 14, type: 'money'},
  {header: 'Delivery fee', key: 'deliveryFee', width: 12, type: 'money'},
  {header: 'Wallet used', key: 'walletUsed', width: 12, type: 'money'},
  {header: 'Total charged', key: 'total', width: 14, type: 'money'},
  {header: 'Refunded', key: 'refunded', width: 12, type: 'money'},
  {header: 'Razorpay payment', key: 'paymentId', width: 22},
];

// Streams rows as CSV (money in rupees) or Excel.
async function sendTable(res, {format, name, sheet, columns, rows}) {
  const filename = `${name}-${stamp()}.${format}`;
  if (format === 'xlsx')
    return sendWorkbook(res, {filename, sheet, columns, rows});
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.write('﻿');
  res.write(
    row(
      columns.map((col) =>
        col.type === 'money' ? `${col.header} (Rs)` : col.header,
      ),
    ),
  );
  for await (const item of rows) {
    res.write(
      row(
        columns.map((col) => {
          const value = item[col.key];
          if (col.type === 'money')
            return (Number(value || 0) / 100).toFixed(2);
          if (col.type === 'date')
            return value
              ? new Date(value).toLocaleString('en-IN', {
                  timeZone: 'Asia/Kolkata',
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })
              : '';
          return value;
        }),
      ),
    );
  }
  return res.end();
}

const exportOrders = asyncHandler(async (req, res) => {
  const rows = await adminOrderService.exportOrders(req.query);
  async function* labelled() {
    for await (const item of rows)
      yield {
        ...item,
        statusLabel: rules.STATUS_LABELS[item.status] || item.status,
      };
  }
  await sendTable(res, {
    format: req.params.format,
    name: 'nexthlon-orders',
    sheet: 'Orders',
    columns: ORDER_COLUMNS,
    rows: labelled(),
  });
});

const getOrder = asyncHandler(async (req, res) => {
  const data = await adminOrderService.getOrder(req.params.orderId);
  res.json({
    order: data.order,
    customer: data.customer,
    next: data.next,
    refundable: data.refundable,
  });
});

const setStatus = asyncHandler(async (req, res) => {
  const {status} = checked(v.validateStatusChange, req.body);
  const {order, before, after} = await adminOrderService.updateStatus(
    req.params.orderId,
    status,
  );
  await audit(req, 'order.status', `order:${order.orderId}`, before, after);
  res.json({
    message: `${order.orderId} is now ${rules.STATUS_LABELS[order.orderStatus].toLowerCase()}.`,
    status: order.orderStatus,
  });
});

const bulkStatus = asyncHandler(async (req, res) => {
  const {orderIds, status} = checked(v.validateBulkStatus, req.body);
  const result = await adminOrderService.bulkStatus(orderIds, status);
  await audit(
    req,
    'order.bulk_status',
    `orders:${result.done.length}`,
    {orderIds},
    {status, done: result.done, skipped: result.skipped.map((s) => s.orderId)},
  );
  const label = rules.STATUS_LABELS[status].toLowerCase();
  res.json({
    message: result.skipped.length
      ? `${result.done.length} moved to ${label}; ${result.skipped.length} could not move.`
      : `${result.done.length} ${result.done.length === 1 ? 'order' : 'orders'} moved to ${label}.`,
    ...result,
  });
});

const cancelItems = asyncHandler(async (req, res) => {
  const value = checked(v.validateAdminCancel, req.body);
  const {order, before, after, names} = await adminOrderService.cancelItems(
    req.params.orderId,
    value,
  );
  await audit(req, 'order.cancel', `order:${order.orderId}`, before, {
    ...after,
    items: names,
    reason: value.reason,
  });
  res.json({
    message: `Cancelled: ${names.join(', ')}.`,
    status: order.orderStatus,
  });
});

const addShipment = asyncHandler(async (req, res) => {
  const value = checked(v.validateShipment, req.body);
  const {order, shipment} = await adminOrderService.addShipment(
    req.params.orderId,
    value,
    req.user,
  );
  await audit(req, 'order.shipment', `order:${order.orderId}`, null, {
    courier: shipment.courier,
    trackingNumber: shipment.trackingNumber,
    status: order.orderStatus,
  });
  res.status(201).json({
    message: `Shipment added: ${shipment.courier} ${shipment.trackingNumber}.`,
    shipment,
    status: order.orderStatus,
  });
});

// POST /api/admin/orders/:orderId/ship   One click: booked with Shiprocket, AWB taken, marked as shipped (B5).
const shipNow = asyncHandler(async (req, res) => {
  const {order, shipment} = await shippingService.shipOrder(
    req.params.orderId,
    req.user,
  );
  await audit(req, 'order.shipment', `order:${order.orderId}`, null, {
    courier: shipment.courier,
    trackingNumber: shipment.trackingNumber,
    provider: 'shiprocket',
    status: order.orderStatus,
  });
  res.status(201).json({
    message: `Booked with ${shipment.courier}: AWB ${shipment.trackingNumber}.`,
    shipment,
    status: order.orderStatus,
  });
});

// POST /api/admin/orders/:orderId/rto   { stage: "initiated" | "received", reason }   A refused or undeliverable parcel.
const markRto = asyncHandler(async (req, res) => {
  const stage = String((req.body && req.body.stage) || '');
  const reason = String((req.body && req.body.reason) || '')
    .trim()
    .slice(0, 200);
  const order = await shippingService.markRto(req.params.orderId, stage, {
    reason,
    by: 'admin',
  });
  await audit(req, 'order.rto', `order:${order.orderId}`, null, {
    stage,
    reason,
    status: order.orderStatus,
  });
  res.json({
    message:
      stage === 'received'
        ? 'Marked as back with us. The items are cancelled, stock is back, and any payment is refunded.'
        : 'Marked as coming back to us.',
    status: order.orderStatus,
  });
});

const addNote = asyncHandler(async (req, res) => {
  const {body} = checked(v.validateOrderNote, req.body);
  const {order, note} = await adminOrderService.addNote(
    req.params.orderId,
    body,
    req.user,
  );
  await audit(req, 'order.note', `order:${order.orderId}`, null, {
    note: body.slice(0, 120),
  });
  res.status(201).json({message: 'Note added.', note});
});

const refund = asyncHandler(async (req, res) => {
  const value = checked(v.validateManualRefund, req.body);
  const requestKey = req.body && req.body.requestKey;
  if (
    requestKey !== undefined &&
    (typeof requestKey !== 'string' ||
      !/^[a-zA-Z0-9-]{16,80}$/.test(requestKey))
  )
    throw new HttpError(400, 'Invalid refund request identifier.');
  if (requestKey) value.key = `manual:${requestKey}`;
  const {order, before, after, refunds} = await adminOrderService.manualRefund(
    req.params.orderId,
    value,
  );
  await audit(req, 'order.refund', `order:${order.orderId}`, before, {
    ...after,
    amount: value.amount,
    method: value.method,
    reason: value.reason,
  });
  const toCard = refunds.some((entry) => entry.method === 'original');
  res.status(201).json({
    message: `${(value.amount / 100).toLocaleString('en-IN', {style: 'currency', currency: 'INR'})} refunded ${toCard ? 'to the original payment method' : "to the customer's wallet"}.`,
    refunds,
    refunded: order.refundedAmount,
  });
});

const invoicePdf = asyncHandler(async (req, res) => {
  const order = await adminOrderService.findOrder(req.params.orderId);
  invoiceService.assertInvoiceReady(order);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoiceService.fileNameFor(invoiceService.invoiceNumber(order))}"`,
  );
  invoiceService.writeInvoice(order, res);
});

// A GST credit note, by its number's position in the order (0, 1, ...).
const creditNotePdf = asyncHandler(async (req, res) => {
  const order = await adminOrderService.findOrder(req.params.orderId);
  const note = invoiceService.findCreditNote(order, req.params.index);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${invoiceService.fileNameFor(note.number)}"`,
  );
  invoiceService.writeCreditNote(order, note, res);
});

const packingSlipPdf = asyncHandler(async (req, res) => {
  const order = await adminOrderService.findOrder(req.params.orderId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="packing-slip-${order.orderId}.pdf"`,
  );
  invoiceService.writePackingSlip(order, res);
});

// ---------- Returns ----------
const listReturns = asyncHandler(async (req, res) => {
  res.json(await adminOrderService.listReturns(req.query));
});

const decideReturn = asyncHandler(async (req, res) => {
  const value = checked(v.validateReturnDecision, req.body);
  const result = await adminOrderService.decideReturn(
    req.params.orderId,
    value,
    req.user,
  );
  await audit(
    req,
    `return.${value.decision === 'approve' ? 'approved' : 'rejected'}`,
    `order:${result.order.orderId}`,
    result.before,
    {...result.after, refund: result.refund, note: value.note},
  );
  const money = (result.refund / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
  });
  res.json({
    message:
      value.decision === 'approve'
        ? `Return approved. Stock is back on the shelf${result.refund ? ` and ${money} was refunded` : ''}.`
        : 'Return rejected. The customer can see your note.',
    status: result.order.orderStatus,
    refund: result.refund,
  });
});

// ---------- Money ledger ----------
const listTransactions = asyncHandler(async (req, res) => {
  res.json(await ledgerService.listTransactions(req.query));
});

const TX_COLUMNS = [
  {header: 'Date', key: 'at', width: 20, type: 'date'},
  {header: 'Type', key: 'typeLabel', width: 18},
  {header: 'Direction', key: 'direction', width: 10},
  {header: 'Order', key: 'orderId', width: 18},
  {header: 'Customer', key: 'customerName', width: 22},
  {header: 'Email', key: 'customerEmail', width: 26},
  {header: 'Method', key: 'method', width: 12},
  {header: 'Amount', key: 'amount', width: 14, type: 'money'},
  {header: 'Status', key: 'status', width: 12},
  {header: 'Reference', key: 'reference', width: 26},
  {header: 'Note', key: 'note', width: 30},
  {header: 'Entry id', key: 'id', width: 34},
];

const exportTransactions = asyncHandler(async (req, res) => {
  const rows = await ledgerService.exportTransactions(req.query);
  await sendTable(res, {
    format: req.params.format,
    name: 'nexthlon-transactions',
    sheet: 'Transactions',
    columns: TX_COLUMNS,
    rows,
  });
});

const getTransaction = asyncHandler(async (req, res) => {
  res.json(await ledgerService.getTransaction(req.params.id));
});

const reconciliation = asyncHandler(async (req, res) => {
  res.json(await ledgerService.reconciliation(req.query));
});

const listRefunds = asyncHandler(async (req, res) => {
  res.json(await ledgerService.listRefunds(req.query));
});

module.exports = {
  listOrders,
  exportOrders,
  getOrder,
  setStatus,
  bulkStatus,
  cancelItems,
  addShipment,
  shipNow,
  markRto,
  addNote,
  refund,
  invoicePdf,
  creditNotePdf,
  packingSlipPdf,
  listReturns,
  decideReturn,
  listTransactions,
  exportTransactions,
  getTransaction,
  reconciliation,
  listRefunds,
};
