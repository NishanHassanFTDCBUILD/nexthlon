// Cash on Delivery confirmation by code (E2). Own database ("_cod_code"); runs only with TEST_MONGODB_URI.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("COD code database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const Order = require("../models/Order");
const PhoneCode = require("../models/PhoneCode");
const categoryService = require("../services/categoryService");
const settingsService = require("../services/settingsService");
const messageService = require("../services/messageService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_cod_code`;
let server;
let base;
let ball;
const outbox = [];

async function call(cookie, method, url, body) {
  const headers = { Accept: "application/json", Origin: base, "Content-Type": "application/json" };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return { status: res.status, cookies: set.map(line => line.split(";")[0]).join("; "), data: await res.json().catch(() => ({})) };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The COD code test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  messageService.useTestOutbox(outbox);
  const football = await categoryService.ensureCategory("Football");
  categoryService.invalidate();
  ball = await Product.create({ name: "Code Ball", slug: "code-ball", category: football._id, brand: "Nexthlon", basePrice: 59900, mrp: 69900, stock: 50, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  messageService.useTestOutbox(null);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("cod code: when on, the first COD order to a phone needs the code sent to it; then that phone is trusted", async () => {
  const signup = await call("", "POST", "/api/signup", { name: "Code Buyer", email: "code.buyer@cod.test", password: "secure2024run", confirmPassword: "secure2024run" });
  const cookie = signup.cookies;
  const address = await call(cookie, "POST", "/api/addresses", { fullName: "Code Buyer", phone: "9876543210", line1: "1 MG Road", city: "Kochi", state: "Kerala", pincode: "682001" });
  const addressId = (address.data.address || address.data.addresses[0])._id;
  const place = async extra => {
    await call(cookie, "POST", "/api/cart/items", { productId: String(ball._id), quantity: 1 });
    return call(cookie, "POST", "/api/orders", { addressId, paymentMethod: "cod", ...extra });
  };

  assert.equal((await place()).status, 201, "off by default: no code");
  await settingsService.set("codOtp", 1);

  const needed = await place();
  assert.equal(needed.status, 400);
  assert.equal(needed.data.code, "cod_code_needed");

  const sent = await call(cookie, "POST", "/api/checkout/cod-code", { addressId });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.match(sent.data.sentTo, /^\+91 98\*{6}10$/, "the phone is shown masked");
  assert.equal((await call(cookie, "POST", "/api/checkout/cod-code", { addressId })).status, 429, "30 seconds between codes");
  const code = outbox.at(-1).code;
  assert.equal(outbox.at(-1).to, "919876543210");
  assert.match(code, /^[0-9]{6}$/);
  assert.ok(!(await PhoneCode.findOne({}).lean()).codeHash.includes(code), "only a hash is stored");

  const wrong = await place({ codCode: code === "000000" ? "111111" : "000000" });
  assert.equal(wrong.data.code, "cod_code_wrong");
  const right = await place({ codCode: code });
  assert.equal(right.status, 201, JSON.stringify(right.data));
  assert.equal(await PhoneCode.countDocuments({}), 0, "a used code is gone");

  assert.equal((await place()).status, 201, "the same phone is trusted for 90 days");
  assert.equal(await Order.countDocuments({ paymentMethod: "cod" }), 3);
});
