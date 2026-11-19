// Writes every order email as an HTML file with sample data, so you can open them in a browser (and shrink the
// window to phone width) without placing orders:   npm run emails:preview   ->  tmp/email-preview/index.html
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const {BUILDERS} = require('../services/orderMailService');
const {renderEmail} = require('../utils/emailLayout');
const Order = require('../models/Order');

const out = path.join(__dirname, '..', 'tmp', 'email-preview');
fs.mkdirSync(out, {recursive: true});

const price = 349900;
const order = new Order({
  orderId: 'NX-2026-000123',
  user: new mongoose.Types.ObjectId(),
  items: [
    {
      product: new mongoose.Types.ObjectId(),
      name: 'Nexthlon Trail Runner',
      brand: 'Nexthlon',
      price,
      mrp: 449900,
      quantity: 1,
      lineTotal: price,
      status: 'placed',
      image: '/img/favicon.svg',
    },
    {
      product: new mongoose.Types.ObjectId(),
      name: 'Dry-fit Running Tee',
      brand: 'Nexthlon',
      price: 79900,
      mrp: 99900,
      quantity: 2,
      lineTotal: 159800,
      status: 'placed',
      image: '/img/favicon.svg',
    },
  ],
  address: {
    fullName: 'Asha Nair',
    phone: '9876543210',
    line1: '12 MG Road',
    landmark: 'Near Metro',
    city: 'Kochi',
    state: 'Kerala',
    pincode: '682001',
  },
  mrpTotal: 649700,
  subtotal: price + 159800,
  couponCode: 'WELCOME10',
  couponDiscount: 20000,
  deliveryFee: 0,
  total: price + 159800 - 20000,
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  orderStatus: 'placed',
  shipments: [
    {
      courier: 'Blue Dart',
      trackingNumber: 'BD1234567890',
      expectedAt: new Date(Date.now() + 3 * 864e5),
    },
  ],
});
const user = {name: 'Asha Nair', email: 'asha@example.com'};
const extras = {
  cancelled: {itemIds: [], reason: 'Ordered by mistake'},
  refunded: {
    amount: 349900,
    parts: [{amount: 349900, method: 'original'}],
    reason: 'Cancelled',
  },
  return_decided: {
    decision: 'approve',
    note: 'Pickup tomorrow between 10 and 6.',
  },
};

const links = [];
for (const kind of Object.keys(BUILDERS)) {
  const {subject, content} = BUILDERS[kind](
    order,
    user,
    'http://localhost:3000',
    extras[kind] || {},
  );
  fs.writeFileSync(path.join(out, `${kind}.html`), renderEmail(content).html);
  links.push(
    `<li><a href="${kind}.html">${kind}</a> <small>${subject}</small></li>`,
  );
}
fs.writeFileSync(
  path.join(out, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>Email previews</title><ul style="font:16px sans-serif;line-height:2">${links.join('')}</ul>`,
);
console.log(`Wrote ${links.length} emails to ${out}`);
