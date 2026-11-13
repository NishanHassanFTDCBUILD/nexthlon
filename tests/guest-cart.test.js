// Guest cart end-to-end: a visitor fills a cart without an account (kept by an httpOnly cookie, stored
// only as a hash), sees it on the cart page and in the header, and it moves into their account when they
// sign up or sign in, within the usual limits. Checkout and "save for later" still need an account.
// Own database (the test database name + "_guestcart"); runs only when TEST_MONGODB_URI is set.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("guest cart tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const GuestCart = require("../models/GuestCart");
const Cart = require("../models/Cart");
const User = require("../models/User");
const categoryService = require("../services/categoryService");
const { hashOf } = require("../middleware/guestCart");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_guestcart`;

let server;
let base;
let shoe;
let socks;

// Keeps every cookie the server sets, like a browser would.
function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    take(response) {
      const all = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
      all.filter(Boolean).forEach(line => {
        const [pair, ...attrs] = line.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        const expired = attrs.some(a => /expires=thu, 01 jan 1970/i.test(a)) || value === "";
        if (expired) cookies.delete(name);
        else cookies.set(name, value);
      });
    },
    get: name => cookies.get(name)
  };
}

async function call(cookies, method, path, body) {
  const headers = { Accept: "application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  cookies.take(response);
  const type = response.headers.get("content-type") || "";
  return { status: response.status, data: type.includes("json") ? await response.json() : await response.text(), location: response.headers.get("location"), setCookie: response.headers.get("set-cookie") || "" };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The guest cart test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({ name: "Guest Trail Shoe", slug: "guest-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 299900, mrp: 399900, stock: 4, image: "/img/favicon.svg" });
  socks = await Product.create({ name: "Guest Trail Socks", slug: "guest-trail-socks", category: running._id, brand: "Nexthlon", basePrice: 49900, mrp: 59900, stock: 20, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("guest cart: browsing makes no cart; the first add makes one, kept as a hash behind an httpOnly cookie", async () => {
  const browser = jar();
  const empty = await call(browser, "GET", "/api/cart");
  assert.equal(empty.status, 200);
  assert.equal(empty.data.cart.summary.count, 0);
  assert.equal(browser.get("nx_cart"), undefined, "reading the cart does not make a cookie");

  const added = await call(browser, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 2 });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.cart.summary.count, 2);
  assert.match(added.setCookie, /nx_cart=[A-Za-z0-9_-]{43};.*HttpOnly/i);
  assert.match(added.setCookie, /SameSite=Lax/i);

  const token = browser.get("nx_cart");
  const stored = await GuestCart.findOne({});
  assert.equal(stored.tokenHash, hashOf(token), "only the hash is stored");
  assert.notEqual(stored.tokenHash, token);
  assert.equal(await GuestCart.countDocuments({ tokenHash: token }), 0);

  // The same rules as an account cart: stock and the limit of 5.
  const tooMany = await call(browser, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 3 });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.data.code, "cart_room");
  const changed = await call(browser, "PATCH", `/api/cart/items/${shoe._id}`, { quantity: 1 });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.cart.summary.count, 1);
});

test("guest cart: another browser cannot see it, and a forged cookie is just an empty cart", async () => {
  const owner = jar();
  await call(owner, "POST", "/api/cart/items", { productId: String(socks._id), quantity: 1 });
  const stranger = jar();
  assert.equal((await call(stranger, "GET", "/api/cart")).data.cart.summary.count, 0);
  const forged = jar();
  forged.take({ headers: { get: () => "nx_cart=not-a-real-token; Path=/" } });
  const res = await call(forged, "GET", "/api/cart");
  assert.equal(res.status, 200);
  assert.equal(res.data.cart.summary.count, 0);
});

test("guest cart: the cart page and header count work for guests; checkout and save-for-later need an account", async () => {
  const browser = jar();
  await call(browser, "POST", "/api/cart/items", { productId: String(socks._id), quantity: 3 });
  const page = await call(browser, "GET", "/cart");
  assert.equal(page.status, 200);
  assert.match(page.data, /Guest Trail Socks/);
  assert.match(page.data, /data-cart-count[^>]*>3</, "the header badge counts the guest cart");
  assert.doesNotMatch(page.data, /data-cart-save/, "no save for later without a wishlist");

  const checkout = await call(browser, "GET", "/checkout");
  assert.equal(checkout.status, 302);
  assert.match(checkout.location, /^\/login\?next=%2Fcheckout/);

  const save = await call(browser, "POST", `/api/cart/items/${socks._id}/save-for-later`);
  assert.equal(save.status, 401);
});

test("guest cart: signing up moves it into the new account and clears the cookie", async () => {
  const browser = jar();
  await call(browser, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 2 });
  const token = browser.get("nx_cart");
  const signup = await call(browser, "POST", "/api/signup", { name: "Guest Shopper", email: "guest.shopper@guestcart.test", password: "guest2024run", confirmPassword: "guest2024run" });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  assert.match(signup.data.message, /items in your cart are saved to your account/);
  assert.equal(browser.get("nx_cart"), undefined, "the guest cookie is cleared");

  const cart = await call(browser, "GET", "/api/cart");
  assert.equal(cart.data.cart.summary.count, 2);
  const user = await User.findOne({ email: "guest.shopper@guestcart.test" });
  assert.equal((await Cart.findOne({ user: user._id })).items.length, 1);
  assert.equal(await GuestCart.countDocuments({ tokenHash: hashOf(token) }), 0, "the guest cart is deleted");
});

test("guest cart: signing in adds to the account's cart, never above the limit", async () => {
  // The account already holds 3 shoes (stock is 4).
  const account = jar();
  await call(account, "POST", "/api/signup", { name: "Mira Rao", email: "mira@guestcart.test", password: "guest2024run", confirmPassword: "guest2024run" });
  await call(account, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 3 });
  await call(account, "POST", "/api/logout");

  // As a guest she adds 2 more shoes and some socks, then signs in.
  const browser = jar();
  await call(browser, "POST", "/api/cart/items", { productId: String(shoe._id), quantity: 2 });
  await call(browser, "POST", "/api/cart/items", { productId: String(socks._id), quantity: 1 });
  const token = browser.get("nx_cart");
  const login = await call(browser, "POST", "/api/login", { email: "mira@guestcart.test", password: "guest2024run" });
  assert.equal(login.status, 200, JSON.stringify(login.data));

  const cart = (await call(browser, "GET", "/api/cart")).data.cart;
  const qty = id => (cart.items.find(item => item.productId === String(id)) || {}).quantity;
  assert.equal(qty(shoe._id), 4, "3 + 2 is capped at the stock of 4");
  assert.equal(qty(socks._id), 1);
  assert.equal(await GuestCart.countDocuments({ tokenHash: hashOf(token) }), 0, "the guest cart is deleted");
});

test("guest cart: a guest cart expires on its own after 30 days", async () => {
  const indexes = await GuestCart.collection.indexes();
  const ttl = indexes.find(index => index.key.updatedAt === 1);
  assert.equal(ttl.expireAfterSeconds, 30 * 24 * 60 * 60);
});
