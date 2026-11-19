// GST (India) for invoices: rates, the split into CGST + SGST or IGST, and the invoice wording.
// Pure functions, no database, so every rule here is unit-tested (tests/gst.test.js). Money is in paise.
//
// How it works:
//   - Store prices INCLUDE GST. For each line, the taxable value is the price without tax:
//       taxable = amount × 100 / (100 + rate), tax = amount − taxable.
//   - A coupon lowers what was paid, so it is shared out across the lines (by their value) BEFORE the
//     tax is worked out. The wallet is a way of paying, not a discount, so it changes nothing here.
//   - Delivery is taxed at the highest rate among the items in the order.
//   - Seller and buyer in the same state: half CGST, half SGST. Different states: IGST.
//
// The rates and HSN codes suggested below are starting points only. Indian GST rates changed on
// 22 September 2025 (5% / 18% / 40% slabs); confirm every product's HSN and rate with a chartered accountant.

// The two-digit GST state codes (the first two digits of a GSTIN).
const STATE_CODES = {
  'Jammu and Kashmir': '01',
  'Himachal Pradesh': '02',
  Punjab: '03',
  Chandigarh: '04',
  Uttarakhand: '05',
  Haryana: '06',
  Delhi: '07',
  Rajasthan: '08',
  'Uttar Pradesh': '09',
  Bihar: '10',
  Sikkim: '11',
  'Arunachal Pradesh': '12',
  Nagaland: '13',
  Manipur: '14',
  Mizoram: '15',
  Tripura: '16',
  Meghalaya: '17',
  Assam: '18',
  'West Bengal': '19',
  Jharkhand: '20',
  Odisha: '21',
  Chhattisgarh: '22',
  'Madhya Pradesh': '23',
  Gujarat: '24',
  'Dadra and Nagar Haveli and Daman and Diu': '26',
  Maharashtra: '27',
  Karnataka: '29',
  Goa: '30',
  Lakshadweep: '31',
  Kerala: '32',
  'Tamil Nadu': '33',
  Puducherry: '34',
  'Andaman and Nicobar Islands': '35',
  Telangana: '36',
  'Andhra Pradesh': '37',
  Ladakh: '38',
};

// The GST slabs an admin may choose from.
const GST_RATES = [0, 5, 18, 40];

// A two-bracket rate (footwear, clothing): `rate` up to `above` paise per piece (value before tax),
// `rateAbove` beyond it. ₹2,500 per piece is the line for footwear and clothing since September 2025.
const PIECE_LIMIT = 250000;

// Suggested HSN and rate from a product's name and category, used when an admin has not set them.
const SUGGESTIONS = [
  {
    test: /\b(shoe|shoes|sneaker|boot|boots|spike|spikes|cleat|cleats|sandal|slipper|flip.?flop)s?\b/i,
    hsn: '6404',
    label: 'Sports footwear',
    rate: 5,
    rateAbove: 18,
    above: PIECE_LIMIT,
  },
  {
    test: /\b(sock|socks)\b/i,
    hsn: '6115',
    label: 'Socks',
    rate: 5,
    rateAbove: 18,
    above: PIECE_LIMIT,
  },
  {
    test: /\b(t-?shirt|tee|jersey|shirt|shorts|tights|leggings|jacket|hoodie|track ?suit|track ?pants|joggers|bra|vest|cap|swimsuit|trunks)\b/i,
    hsn: '6211',
    label: 'Sportswear',
    rate: 5,
    rateAbove: 18,
    above: PIECE_LIMIT,
  },
  {test: /\b(bicycle|cycle|bike)\b/i, hsn: '8712', label: 'Bicycles', rate: 5},
  {
    test: /\b(tent|tents|tarp|sleeping bag)\b/i,
    hsn: '6306',
    label: 'Tents and camping textiles',
    rate: 5,
  },
  {
    test: /\b(bag|backpack|rucksack|duffel)\b/i,
    hsn: '4202',
    label: 'Bags',
    rate: 18,
  },
  {test: /\b(bottle|flask)\b/i, hsn: '7323', label: 'Bottles', rate: 18},
  {test: /\b(watch|tracker)\b/i, hsn: '9102', label: 'Watches', rate: 18},
];
const GENERAL = {hsn: '9506', label: 'Sports goods', rate: 5};

function suggestTax(name = '', categoryName = '') {
  const text = `${name} ${categoryName}`;
  const match = SUGGESTIONS.find((rule) => rule.test.test(text)) || GENERAL;
  return {
    hsn: match.hsn,
    label: match.label,
    rate: match.rate,
    rateAbove: match.rateAbove ?? null,
    above: match.above ?? null,
  };
}

// The tax settings a product uses: its own when the admin set them, otherwise the suggestion.
function taxOf(product, categoryName = '') {
  const own = product && product.tax;
  if (own && own.hsn && Number.isInteger(own.rate)) {
    return {
      hsn: own.hsn,
      rate: own.rate,
      rateAbove: Number.isInteger(own.rateAbove) ? own.rateAbove : null,
      above: Number.isInteger(own.above) ? own.above : null,
      suggested: false,
    };
  }
  const name = product ? product.name : '';
  const category =
    categoryName ||
    (product && product.category && product.category.name) ||
    '';
  return {...suggestTax(name, category), suggested: true};
}

// The rate for one piece at this price (paise, tax included). With two brackets, the piece's value
// before tax (at the lower rate) decides: up to the limit, the lower rate; above it, the higher one.
function rateFor(tax, unitPrice) {
  if (tax.rateAbove === null || tax.rateAbove === undefined || !tax.above)
    return tax.rate;
  const beforeTax = Math.round((unitPrice * 100) / (100 + tax.rate));
  return beforeTax > tax.above ? tax.rateAbove : tax.rate;
}

// Splits an amount that includes tax into its taxable value and its tax.
function splitInclusive(amount, rate) {
  const taxable = Math.round((amount * 100) / (100 + rate));
  return {taxable, tax: amount - taxable};
}

// Shares `total` across `weights` in proportion, in whole paise, so the parts add up exactly
// (largest remainders get the leftover paise).
function shareOut(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!total || !sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  raw
    .map((value, index) => ({index, rest: value - parts[index]}))
    .sort((a, b) => b.rest - a.rest || a.index - b.index)
    .forEach(({index}) => {
      if (left > 0) {
        parts[index] += 1;
        left -= 1;
      }
    });
  return parts;
}

// Half CGST and half SGST inside the state, all IGST across states.
function splitTax(tax, interstate) {
  if (interstate) return {cgst: 0, sgst: 0, igst: tax};
  const cgst = Math.round(tax / 2);
  return {cgst, sgst: tax - cgst, igst: 0};
}

// The whole order's tax.
//   lines: [{ lineTotal, price, quantity, tax: { hsn, rate, rateAbove, above } }]
//   couponDiscount, deliveryFee: paise; sellerState, buyerState: state names.
// Returns { interstate, placeOfSupply, lines: [{ hsn, rate, discount, value, taxable, cgst, sgst, igst }],
//           delivery: {...} | null, totals: { taxable, cgst, sgst, igst, tax, value } }.
function orderTax({
  lines,
  couponDiscount = 0,
  deliveryFee = 0,
  sellerState,
  buyerState,
}) {
  const interstate =
    Boolean(sellerState && buyerState) && sellerState !== buyerState;
  const discounts = shareOut(
    Math.min(
      couponDiscount,
      lines.reduce((sum, line) => sum + line.lineTotal, 0),
    ),
    lines.map((line) => line.lineTotal),
  );
  const out = lines.map((line, index) => {
    const rate = rateFor(line.tax, line.price);
    const value = line.lineTotal - discounts[index];
    const {taxable, tax} = splitInclusive(value, rate);
    return {
      hsn: line.tax.hsn,
      rate,
      discount: discounts[index],
      value,
      taxable,
      ...splitTax(tax, interstate),
    };
  });
  let delivery = null;
  if (deliveryFee > 0) {
    const rate = out.reduce((max, line) => Math.max(max, line.rate), 0);
    const {taxable, tax} = splitInclusive(deliveryFee, rate);
    delivery = {
      hsn: '9965',
      rate,
      value: deliveryFee,
      taxable,
      ...splitTax(tax, interstate),
    };
  }
  const all = delivery ? [...out, delivery] : out;
  const sum = (key) => all.reduce((total, line) => total + line[key], 0);
  const totals = {
    taxable: sum('taxable'),
    cgst: sum('cgst'),
    sgst: sum('sgst'),
    igst: sum('igst'),
    value: sum('value'),
  };
  totals.tax = totals.cgst + totals.sgst + totals.igst;
  return {
    interstate,
    placeOfSupply: buyerState || '',
    lines: out,
    delivery,
    totals,
  };
}

// The Indian financial year an invoice belongs to (April to March, India time): "26-27".
function financialYear(date = new Date()) {
  const ist = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

// Amounts in words, the Indian way (lakh, crore): 123456 paise -> "One thousand two hundred thirty-four rupees and fifty-six paise".
const ONES = [
  '',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];
function belowHundred(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
}
function belowThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [
    hundreds ? `${ONES[hundreds]} hundred` : '',
    rest ? belowHundred(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}
function wholeInWords(n) {
  if (n === 0) return 'zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${wholeInWords(crore)} crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} thousand`);
  if (rest) parts.push(belowThousand(rest));
  return parts.join(' ');
}
function amountInWords(paise) {
  const rupees = Math.floor(paise / 100);
  const coins = paise % 100;
  const text = `${wholeInWords(rupees)} rupee${rupees === 1 ? '' : 's'}${coins ? ` and ${belowHundred(coins)} paise` : ''} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

module.exports = {
  STATE_CODES,
  GST_RATES,
  PIECE_LIMIT,
  suggestTax,
  taxOf,
  rateFor,
  splitInclusive,
  shareOut,
  splitTax,
  orderTax,
  financialYear,
  amountInWords,
};
