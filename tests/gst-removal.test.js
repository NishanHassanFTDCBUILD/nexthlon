require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const Order = require('../models/Order');
const checkout = require('../services/checkoutService');
const gst = require('../services/gstService');
const invoices = require('../services/invoiceService');
const PDFDocument = require('pdfkit');
const {PassThrough} = require('node:stream');

test('new checkout saves unchanged totals without consulting tax rates or storing GST', async (t) => {
  t.mock.method(gst, 'taxForOrder', () => {
    throw new Error('Retired tax calculation called');
  });
  t.mock.method(Order, 'create', async ([data]) => [data]);
  const totals = {
    mrpTotal: 120000,
    subtotal: 100000,
    discount: 20000,
    couponDiscount: 0,
    prepaidDiscount: 0,
    deliveryFee: 4000,
    walletUsed: 0,
    total: 104000,
  };
  const result = await checkout.saveOrder({
    userId: '64b000000000000000000001',
    orderId: 'NX-2026-000001',
    quote: {
      totals,
      lines: [
        {
          productId: '64b000000000000000000002',
          name: 'Ball',
          price: 100000,
          mrp: 120000,
          quantity: 1,
          lineTotal: 100000,
        },
      ],
    },
    address: {state: 'Kerala'},
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    stockReserved: true,
  });
  assert.equal(result.total, totals.total);
  assert.equal(result.subtotal, totals.subtotal);
  assert.equal(result.gst, undefined);
  assert.equal(result.items[0].tax, undefined);
});

test('new order receipt has no GST claims and historical invoice identifiers stay intact', async (t) => {
  const texts = [];
  const original = PDFDocument.prototype.text;
  t.mock.method(PDFDocument.prototype, 'text', function (text, ...args) {
    texts.push(String(text));
    return original.call(this, text, ...args);
  });
  const output = new PassThrough();
  output.resume();
  const finished = new Promise((resolve, reject) => {
    output.on('end', resolve);
    output.on('error', reject);
  });
  invoices.writeInvoice(
    {
      orderId: 'NX-2026-000001',
      createdAt: new Date(),
      address: {
        fullName: 'Test customer',
        city: 'Kochi',
        state: 'Kerala',
        pincode: '682001',
        phone: '9876543210',
      },
      items: [
        {
          name: 'Ball',
          quantity: 1,
          mrp: 120000,
          price: 100000,
          lineTotal: 100000,
        },
      ],
      mrpTotal: 120000,
      discount: 20000,
      deliveryFee: 0,
      total: 100000,
      orderStatus: 'placed',
      paymentMethod: 'wallet',
      paymentStatus: 'paid',
    },
    output,
  );
  await finished;
  assert.match(texts.join(' '), /Order receipt/);
  assert.doesNotMatch(texts.join(' '), /GST|GSTIN|Tax invoice/);
  assert.equal(
    invoices.invoiceNumber({gst: {invoiceNo: 'NX/26-27/000001'}}),
    'NX/26-27/000001',
  );
  assert.throws(
    () =>
      invoices.assertInvoiceReady({
        paymentMethod: 'razorpay',
        paymentStatus: 'pending',
      }),
    /after payment/,
  );
});
