// Checkout that converts (C3): arrival dates on the page, the phone pay bar and price sheet markup, and
// failures that carry a code the page turns into a fix button. Own database ("_checkoutux").
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("checkout tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const categoryService = require("../services/categoryService");
const settingsService = require("../services/settingsService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_checkoutux`;

let server;
let base;
let ball;
let shopper;
let addressId;

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    take(response) {
      (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : []).forEach(line => {
        const [pair, ...attrs] = line.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (attrs.some(a => /expires=thu, 01 jan 1970/i.test(a)) || value === "") cookies.delete(name);
        else cookies.set(name, value);
      });
    }
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
  return { status: response.status, data: type.includes("json") ? await response.json() : await response.text() };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The checkout test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const football = await categoryService.ensureCategory("Football");
  categoryService.invalidate();
  ball = await Product.create({ name: "Checkout Match Ball", slug: "checkout-match-ball", category: football._id, brand: "Nexthlon", basePrice: 79900, mrp: 99900, stock: 50, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  shopper = jar();
  const signup = await call(shopper, "POST", "/api/signup", { name: "Thumb Shopper", email: "thumb@checkout.test", password: "thumbs2024run", confirmPassword: "thumbs2024run" });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const address = await call(shopper, "POST", "/api/addresses", { fullName: "Thumb Shopper", phone: "9876543210", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" });
  addressId = (address.data.address || address.data.addresses[0]).id || (address.data.address || address.data.addresses[0])._id;
  await call(shopper, "POST", "/api/addresses", { fullName: "Thumb Shopper", phone: "9876543210", line1: "Army camp", city: "Delhi", state: "Delhi", pincode: "910001" });
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("checkout: each address shows when it arrives, and the Pay button repeats it", async () => {
  await call(shopper, "POST", "/api/cart/items", { productId: String(ball._id), quantity: 1 });
  const page = await call(shopper, "GET", "/checkout");
  assert.equal(page.status, 200);
  assert.match(page.data, /data-eta="[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} – /, "a metro PIN code has a date");
  assert.match(page.data, /class="address-eta"><svg[^>]*>[\s\S]*?<\/svg><span>Arrives <strong>/);
  assert.match(page.data, /class="address-eta is-off">[\s\S]*?Army Post Office/, "an APO address says it can't be delivered");
  assert.match(page.data, /data-pay-eta >|data-pay-eta>/);
});

test("checkout: the phone pay bar and the price sheet are on the page, wired to each other", async () => {
  const page = (await call(shopper, "GET", "/checkout")).data;
  assert.match(page, /<div class="pay-bar" data-pay-bar>/);
  assert.match(page, /data-summary-open aria-controls="checkout-side" aria-expanded="false"/);
  assert.match(page, /<div class="checkout-side" id="checkout-side" data-summary-sheet/);
  assert.match(page, /data-summary-close aria-label="Close price details"/);
  assert.match(page, /class="pay-bar-total"[\s\S]*?data-sum="total"/, "the bar's total updates with the others");
});

test("checkout: failures carry a code the page turns into a fix", async () => {
  // Over the Cash on Delivery limit.
  await settingsService.set("codLimit", 50000);
  const overLimit = await call(shopper, "POST", "/api/orders", { addressId, paymentMethod: "cod" });
  assert.equal(overLimit.status, 400);
  assert.equal(overLimit.data.code, "cod_limit");
  await settingsService.set("codLimit", 1000000);

  // An item that went away after it was put in the cart.
  await Product.updateOne({ _id: ball._id }, { $set: { isListed: false } });
  const gone = await call(shopper, "POST", "/api/orders", { addressId, paymentMethod: "cod" });
  assert.equal(gone.status, 409);
  assert.equal(gone.data.code, "items_unavailable");
  await Product.updateOne({ _id: ball._id }, { $set: { isListed: true } });

  // The page knows every code it may get.
  const script = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "js", "checkout.js"), "utf8");
  for (const code of ["items_unavailable", "coupon_invalid", "cod_limit", "cod_open_limit", "wallet_short", "gateway"]) {
    assert.match(script, new RegExp(`\\b${code}:`), code);
  }
});
