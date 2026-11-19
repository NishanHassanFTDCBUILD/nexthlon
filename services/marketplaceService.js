// Marketplace listings (E8): one feed of the store's products for Amazon, Flipkart and Myntra (their
// seller tools import CSV or JSON), and a sync endpoint so a marketplace order can take stock off our shelf.
// Nothing here calls a marketplace. Their seller accounts and API keys are needed for that step, and are
// set up by the store owner (see docs/MARKETPLACES.md).
const crypto = require('crypto');
const config = require('../config/env');
const Product = require('../models/Product');
const inventoryService = require('./inventoryService');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {siteUrl, absoluteUrl} = require('../utils/emailLayout');
const {sizedUrl} = require('../utils/images');
const {HttpError} = require('../utils/http');

const COLUMNS = [
  'sku',
  'product_id',
  'title',
  'brand',
  'option',
  'price_inr',
  'mrp_inr',
  'stock',
  'availability',
  'image_url',
  'link',
  'hsn',
  'gst_rate',
  'country_of_origin',
];

// Spreadsheets run a cell that starts with = + - or @ as a formula. Such cells are prefixed with an apostrophe.
const cell = (value) => {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const rupees = (paise) => (Math.round(Number(paise) || 0) / 100).toFixed(2);

// One row per product, or per size/colour option, so a marketplace knows the stock of each.
function rowsFor(products) {
  const base = siteUrl();
  const rows = [];
  for (const p of products) {
    const image = absoluteUrl(sizedUrl(p.image, 800), base);
    const link = `${base}/products/${p.slug}`;
    const common = {
      product_id: String(p._id),
      title: p.name,
      brand: p.brand,
      price_inr: rupees(p.price),
      mrp_inr: rupees(Math.max(p.mrp, p.price)),
      image_url: image,
      link,
      hsn: (p.tax && p.tax.hsn) || '',
      gst_rate: p.tax && Number.isInteger(p.tax.rate) ? p.tax.rate : '',
      country_of_origin: p.countryOfOrigin || 'India',
    };
    if (p.variants && p.variants.length) {
      for (const v of p.variants) {
        const option = [v.size ? `Size ${v.size}` : '', v.colour || '']
          .filter(Boolean)
          .join(' · ');
        rows.push({
          ...common,
          sku: v.sku || `${p._id}-${v._id}`,
          option,
          stock: v.stock,
          availability: v.stock > 0 ? 'in stock' : 'out of stock',
        });
      }
    } else {
      rows.push({
        ...common,
        sku: p.sku || String(p._id),
        option: '',
        stock: p.stock,
        availability: p.stock > 0 ? 'in stock' : 'out of stock',
      });
    }
  }
  return rows;
}

async function feed() {
  const products = await Product.find({...LISTED_PRODUCT})
    .select(
      'name brand price mrp image slug sku stock variants tax countryOfOrigin',
    )
    .lean();
  return rowsFor(products);
}

function toCsv(rows) {
  return (
    [
      COLUMNS.join(','),
      ...rows.map((row) => COLUMNS.map((key) => cell(row[key])).join(',')),
    ].join('\r\n') + '\r\n'
  );
}

// Auth for marketplace calls: a shared secret in x-api-key, compared in constant time (like the courier hook).
function authorised(header) {
  const expected = config.marketplace.token;
  if (!expected) return false;
  const a = Buffer.from(String(header || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A sale on the marketplace takes units off our stock. Sets the exact count for the SKU (never below 0).
async function syncStock(sku, stock) {
  const wanted = Number(stock);
  if (!sku || !Number.isInteger(wanted) || wanted < 0 || wanted > 100000)
    throw new HttpError(
      400,
      'Send a sku and a whole stock count from 0 to 100000.',
    );
  const bySku = await Product.findOne({sku: String(sku), ...LISTED_PRODUCT})
    .select('_id')
    .lean();
  const byOption = bySku
    ? null
    : await Product.findOne({'variants.sku': String(sku), ...LISTED_PRODUCT})
        .select('_id variants')
        .lean();
  const product = bySku || byOption;
  if (!product) throw new HttpError(404, 'No product has that SKU.');
  const option = byOption
    ? byOption.variants.find((v) => v.sku === String(sku))
    : null;
  const result = await inventoryService.adjustStock(String(product._id), {
    action: 'count',
    units: wanted,
    note: 'Marketplace stock sync',
    optionId: option ? String(option._id) : null,
  });
  return {sku: String(sku), stock: result.after};
}

module.exports = {feed, rowsFor, toCsv, authorised, syncStock, COLUMNS, cell};
