// GST on orders (B4): the tax worked out when an order is saved, the invoice number when the order is
// confirmed, and credit notes when invoiced items are cancelled or returned. The rules themselves are in
// utils/gst.js; this file applies them to orders and keeps the numbering safe.
//
// Numbering: GST needs one unbroken series per financial year. Numbers come from an atomic counter, and
// an order (or credit note) first CLAIMS its slot with a conditional update, so a retry or a second
// caller never takes a number that then goes unused.
const crypto = require("crypto");
const Order = require("../models/Order");
const Product = require("../models/Product");
const counterService = require("./counterService");
const { STORE } = require("../config/store");
const { taxOf, orderTax, financialYear } = require("../utils/gst");

const INVOICE_PREFIX = "NX";
const CREDIT_PREFIX = "CN";

// The GST block of a new order, from its lines (quote lines or order item snapshots) and money.
async function taxForOrder({ lines, couponDiscount = 0, deliveryFee = 0, buyerState }) {
  const products = await Product.find({ _id: { $in: lines.map(line => line.productId || line.product) } })
    .select("name tax category")
    .populate("category", "name")
    .lean();
  const byId = new Map(products.map(product => [String(product._id), product]));
  const taxed = orderTax({
    lines: lines.map(line => {
      const product = byId.get(String(line.productId || line.product)) || { name: line.name };
      return { lineTotal: line.lineTotal, price: line.price, quantity: line.quantity, tax: taxOf(product) };
    }),
    couponDiscount,
    deliveryFee,
    sellerState: STORE.state,
    buyerState
  });
  return {
    perLine: taxed.lines,
    gst: {
      scheme: STORE.gstScheme,
      sellerState: STORE.state,
      sellerGstin: STORE.gstin,
      placeOfSupply: taxed.placeOfSupply,
      interstate: taxed.interstate,
      ...taxed.totals,
      delivery: taxed.delivery,
      invoiceNo: "",
      invoiceDate: null
    }
  };
}

// Gives a confirmed order its invoice number (once). Safe to call again: an order that has one keeps it.
// Orders saved before GST invoices existed have no GST block and keep their simple invoice.
async function issueInvoice(orderId, when = new Date()) {
  const claim = `pending:${crypto.randomUUID()}`;
  const claimed = await Order.findOneAndUpdate(
    { _id: orderId, "gst.scheme": { $exists: true }, "gst.invoiceNo": "" },
    { $set: { "gst.invoiceNo": claim } },
    { new: true }
  );
  if (!claimed) return Order.findById(orderId);
  const year = financialYear(when);
  const seq = await counterService.nextNumber(`invoice-${year}`);
  const number = `${INVOICE_PREFIX}/${year}/${String(seq).padStart(6, "0")}`;
  return Order.findOneAndUpdate(
    { _id: orderId, "gst.invoiceNo": claim },
    { $set: { "gst.invoiceNo": number, "gst.invoiceDate": when } },
    { new: true }
  );
}

// A credit note for invoiced items that were cancelled or returned since the last note. The tax on each
// item is the one on the invoice, in proportion to the quantity (all of it here: items go back whole).
// A whole order cancelled before shipping also takes back the delivery charge.
async function syncCreditNotes(orderId, reason = "") {
  const order = await Order.findById(orderId).lean();
  if (!order || !order.gst || !order.gst.invoiceNo || order.gst.invoiceNo.startsWith("pending:")) return null;
  const covered = new Set((order.creditNotes || []).flatMap(note => note.lines.map(line => String(line.itemId))));
  const lines = order.items
    .filter(item => ["cancelled", "returned"].includes(item.status) && !covered.has(String(item._id)) && item.tax)
    .map(item => ({
      itemId: item._id,
      name: item.option ? `${item.name} (${item.option})` : item.name,
      hsn: item.tax.hsn,
      rate: item.tax.rate,
      quantity: item.quantity,
      value: item.tax.value,
      taxable: item.tax.taxable,
      cgst: item.tax.cgst,
      sgst: item.tax.sgst,
      igst: item.tax.igst
    }));
  if (!lines.length) return null;
  const deliveryBack = order.orderStatus === "cancelled" && order.gst.delivery && !(order.creditNotes || []).some(note => note.delivery);
  const delivery = deliveryBack ? { ...order.gst.delivery } : null;
  const all = delivery ? [...lines, delivery] : lines;
  const sum = key => all.reduce((total, line) => total + (line[key] || 0), 0);
  const claim = `pending:${crypto.randomUUID()}`;
  const note = {
    number: claim,
    date: new Date(),
    reason: reason || (lines.length && order.items.find(item => String(item._id) === String(lines[0].itemId)).status === "returned" ? "Goods returned" : "Order cancelled"),
    lines,
    delivery,
    taxable: sum("taxable"),
    cgst: sum("cgst"),
    sgst: sum("sgst"),
    igst: sum("igst"),
    value: sum("value")
  };
  // Only if no other call has covered these items in the meantime.
  const pushed = await Order.findOneAndUpdate(
    { _id: orderId, "creditNotes.lines.itemId": { $nin: lines.map(line => line.itemId) } },
    { $push: { creditNotes: note } },
    { new: true }
  );
  if (!pushed) return null;
  const year = financialYear(note.date);
  const seq = await counterService.nextNumber(`credit-${year}`);
  const number = `${CREDIT_PREFIX}/${year}/${String(seq).padStart(6, "0")}`;
  return Order.findOneAndUpdate(
    { _id: orderId, "creditNotes.number": claim },
    { $set: { "creditNotes.$.number": number } },
    { new: true }
  );
}

module.exports = { taxForOrder, issueInvoice, syncCreditNotes, INVOICE_PREFIX, CREDIT_PREFIX };
