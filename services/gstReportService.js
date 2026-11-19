// GST report for the accountant: every invoice issued in a month, with its taxable value and tax,
// as a CSV, plus totals. The figures are the ones stored on each order when its invoice was issued
// (services/invoiceService.js), so the report never recalculates tax. Money is stored in paise.
const Order = require('../models/Order');
const {row} = require('../utils/csv');
const {HttpError} = require('../utils/http');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const IST_OFFSET = '+05:30';

// The current month in India time, as YYYY-MM.
function currentMonth(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
}

// [start, end) of a calendar month in India time.
function monthRange(month) {
  if (!MONTH.test(month))
    throw new HttpError(400, 'Choose a month as YYYY-MM.', {
      month: 'Choose a month as YYYY-MM.',
    });
  const [y, m] = month.split('-').map(Number);
  const start = new Date(`${month}-01T00:00:00${IST_OFFSET}`);
  const next =
    m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const end = new Date(`${next}-01T00:00:00${IST_OFFSET}`);
  return {start, end};
}

const rupees = (paise) => (Number(paise || 0) / 100).toFixed(2);
const istDate = (date) => {
  const d = new Date(new Date(date).getTime() + 330 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const COLUMNS = [
  'Invoice number',
  'Invoice date',
  'Order number',
  'Buyer',
  'Place of supply',
  'Interstate',
  'Taxable value',
  'CGST',
  'SGST',
  'IGST',
  'Total tax',
  'Invoice value',
];

async function report(month, now = new Date()) {
  const chosen = month || currentMonth(now);
  const {start, end} = monthRange(chosen);
  const orders = await Order.find({
    'gst.invoiceNo': {$nin: ['', null]},
    'gst.invoiceDate': {$gte: start, $lt: end},
  })
    .sort({'gst.invoiceNo': 1})
    .select('orderId total address.fullName gst')
    .lean();
  const totals = {taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, value: 0};
  const lines = orders.map((o) => {
    const g = o.gst || {};
    const taxable = g.taxable || 0;
    const cgst = g.cgst || 0;
    const sgst = g.sgst || 0;
    const igst = g.igst || 0;
    const tax = g.tax || cgst + sgst + igst;
    const value = o.total || 0;
    totals.taxable += taxable;
    totals.cgst += cgst;
    totals.sgst += sgst;
    totals.igst += igst;
    totals.tax += tax;
    totals.value += value;
    return row([
      g.invoiceNo,
      istDate(g.invoiceDate),
      o.orderId,
      o.address ? o.address.fullName : '',
      g.placeOfSupply || '',
      g.interstate ? 'yes' : 'no',
      rupees(taxable),
      rupees(cgst),
      rupees(sgst),
      rupees(igst),
      rupees(tax),
      rupees(value),
    ]);
  });
  const totalLine = row([
    'Total',
    '',
    `${orders.length} invoices`,
    '',
    '',
    '',
    rupees(totals.taxable),
    rupees(totals.cgst),
    rupees(totals.sgst),
    rupees(totals.igst),
    rupees(totals.tax),
    rupees(totals.value),
  ]);
  return {
    month: chosen,
    count: orders.length,
    totals: Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, rupees(v)]),
    ),
    csv: row(COLUMNS) + lines.join('') + totalLine,
  };
}

module.exports = {report, currentMonth, monthRange, COLUMNS};
