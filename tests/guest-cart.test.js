// Signed-out visitors and the cart: putting anything in a cart (and Buy now) needs a signed-in account,
// so a guest's add, change or remove is refused with 401 and makes no cookie; the cart page sends them to
// sign in and back. Carts that guests filled before this rule (kept by an httpOnly cookie, stored only as
// a hash) still move into the account at sign-up or sign-in, within the usual limits.
// Own database (the test database name + "_guestcart"); runs only when TEST_MONGODB_URI is set.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'guest cart tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const crypto = require('crypto');
const mongoose = require('mongoose');
const app = require('../app');
const Product = require('../models/Product');
const GuestCart = require('../models/GuestCart');
const Cart = require('../models/Cart');
const User = require('../models/User');
const categoryService = require('../services/categoryService');
const {hashOf} = require('../middleware/guestCart');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_guestcart`;

let server;
let base;
let shoe;
let socks;

// Keeps every cookie the server sets, like a browser would.
function jar() {
  const cookies = new Map();
  return {
    header: () =>
      [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
    take(response) {
      const all =
        typeof response.headers.getSetCookie === 'function'
          ? response.headers.getSetCookie()
          : [response.headers.get('set-cookie') || ''];
      all.filter(Boolean).forEach((line) => {
        const [pair, ...attrs] = line.split(';');
        const at = pair.indexOf('=');
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        const expired =
          attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a)) ||
          value === '';
        if (expired) cookies.delete(name);
        else cookies.set(name, value);
      });
    },
    set: (name, value) => cookies.set(name, value),
    get: (name) => cookies.get(name),
  };
}

async function call(cookies, method, path, body) {
  const headers = {Accept: 'application/json', Origin: base};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  cookies.take(response);
  const type = response.headers.get('content-type') || '';
  return {
    status: response.status,
    data: type.includes('json') ? await response.json() : await response.text(),
    location: response.headers.get('location'),
    setCookie: response.headers.get('set-cookie') || '',
  };
}

// A guest cart made before sign-in was required: the browser holds the token, the database its hash.
async function legacyGuestCart(browser, items) {
  const token = crypto.randomBytes(32).toString('base64url');
  await GuestCart.create({tokenHash: hashOf(token), items});
  browser.set('nx_cart', token);
  browser.set('nx_has_cart', '1');
  return token;
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error(
      "The guest cart test database must have 'test' in its name.",
    );
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Guest Trail Shoe',
    slug: 'guest-trail-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 299900,
    mrp: 399900,
    stock: 4,
    image: '/img/favicon.svg',
  });
  socks = await Product.create({
    name: 'Guest Trail Socks',
    slug: 'guest-trail-socks',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 49900,
    mrp: 59900,
    stock: 20,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('signed out: adding, changing and removing cart items need a sign-in, and make no cart or cookie', async () => {
  const browser = jar();
  const before = await GuestCart.countDocuments({});
  const added = await call(browser, 'POST', '/api/cart/items', {
    productId: String(shoe._id),
    quantity: 1,
  });
  assert.equal(added.status, 401, JSON.stringify(added.data));
  assert.equal(browser.get('nx_cart'), undefined, 'no guest cookie is made');
  assert.equal(
    (await call(browser, 'PATCH', `/api/cart/items/${shoe._id}`, {quantity: 2}))
      .status,
    401,
  );
  assert.equal(
    (await call(browser, 'DELETE', `/api/cart/items/${shoe._id}`)).status,
    401,
  );
  assert.equal((await call(browser, 'DELETE', '/api/cart')).status, 401);
  assert.equal(
    (await call(browser, 'POST', `/api/cart/items/${socks._id}/save-for-later`))
      .status,
    401,
  );
  assert.equal(
    await GuestCart.countDocuments({}),
    before,
    'no guest cart is stored',
  );

  // Reading stays open (the header badge asks), and is simply empty.
  const empty = await call(browser, 'GET', '/api/cart');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.cart.summary.count, 0);
  assert.equal((await call(browser, 'GET', '/api/cart/count')).data.count, 0);
});

test('signed out: Buy now needs a sign-in, and the cart and checkout pages send you to sign in and back', async () => {
  const browser = jar();
  const buy = await call(browser, 'POST', '/api/buy-now', {
    productId: String(shoe._id),
    quantity: 1,
  });
  assert.equal(buy.status, 401);

  const page = await call(browser, 'GET', '/cart');
  assert.equal(page.status, 302);
  assert.match(page.location, /^\/login\?next=%2Fcart/);

  const checkout = await call(browser, 'GET', '/checkout');
  assert.equal(checkout.status, 302);
  assert.match(checkout.location, /^\/login\?next=%2Fcheckout/);
});

test('signed out: the product page tells guests to sign in to buy', async () => {
  const page = await call(jar(), 'GET', `/products/${shoe.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /Sign in<\/a> to add to your cart or buy now/);
  assert.doesNotMatch(page.data, /No account needed/);
});

test('an older guest cart moves into a new account at sign-up and the cookie is cleared', async () => {
  const browser = jar();
  const token = await legacyGuestCart(browser, [
    {product: shoe._id, quantity: 2},
  ]);
  const signup = await call(browser, 'POST', '/api/signup', {
    name: 'Guest Shopper',
    email: 'guest.shopper@guestcart.test',
    password: 'guest2024run',
    confirmPassword: 'guest2024run',
  });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  assert.match(
    signup.data.message,
    /items in your cart are saved to your account/,
  );
  assert.equal(
    browser.get('nx_cart'),
    undefined,
    'the guest cookie is cleared',
  );

  const cart = await call(browser, 'GET', '/api/cart');
  assert.equal(cart.data.cart.summary.count, 2);
  const user = await User.findOne({email: 'guest.shopper@guestcart.test'});
  assert.equal((await Cart.findOne({user: user._id})).items.length, 1);
  assert.equal(
    await GuestCart.countDocuments({tokenHash: hashOf(token)}),
    0,
    'the guest cart is deleted',
  );
});

test("an older guest cart adds to the account's cart at sign-in, never above the stock", async () => {
  // The account already holds 3 shoes (stock is 4).
  const account = jar();
  await call(account, 'POST', '/api/signup', {
    name: 'Mira Rao',
    email: 'mira@guestcart.test',
    password: 'guest2024run',
    confirmPassword: 'guest2024run',
  });
  const own = await call(account, 'POST', '/api/cart/items', {
    productId: String(shoe._id),
    quantity: 3,
  });
  assert.equal(own.status, 201, JSON.stringify(own.data));
  await call(account, 'POST', '/api/logout');

  const browser = jar();
  const token = await legacyGuestCart(browser, [
    {product: shoe._id, quantity: 2},
    {product: socks._id, quantity: 1},
  ]);
  const login = await call(browser, 'POST', '/api/login', {
    email: 'mira@guestcart.test',
    password: 'guest2024run',
  });
  assert.equal(login.status, 200, JSON.stringify(login.data));

  const cart = (await call(browser, 'GET', '/api/cart')).data.cart;
  const qty = (id) =>
    (cart.items.find((item) => item.productId === String(id)) || {}).quantity;
  assert.equal(qty(shoe._id), 4, '3 + 2 is capped at the stock of 4');
  assert.equal(qty(socks._id), 1);
  assert.equal(
    await GuestCart.countDocuments({tokenHash: hashOf(token)}),
    0,
    'the guest cart is deleted',
  );
});

test('a forged guest cookie is just an empty cart', async () => {
  const forged = jar();
  forged.set('nx_cart', 'not-a-real-token');
  const res = await call(forged, 'GET', '/api/cart');
  assert.equal(res.status, 200);
  assert.equal(res.data.cart.summary.count, 0);
});

test('an older guest cart expires on its own after 30 days', async () => {
  const indexes = await GuestCart.collection.indexes();
  const ttl = indexes.find((index) => index.key.updatedAt === 1);
  assert.equal(ttl.expireAfterSeconds, 30 * 24 * 60 * 60);
});
