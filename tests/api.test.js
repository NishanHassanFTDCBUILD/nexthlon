// End-to-end API tests against a real MongoDB test database.
// They only run when TEST_MONGODB_URI is set, and they refuse any database whose name lacks "test".
//   PowerShell:  $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/nexthlon_test"; npm test
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("API tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const { hashPassword } = require("../services/authService");

let server;
let base;

async function call(method, path, { body, cookie, origin = true, bearer } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin === true) headers.Origin = base;
  else if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/nx_token=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return {
    status: response.status,
    data,
    location: response.headers.get("location"),
    setCookie,
    cookie: match && match[1] ? `nx_token=${match[1]}` : null
  };
}

test.before(async () => {
  const name = new URL(process.env.TEST_MONGODB_URI).pathname.slice(1);
  if (!/test/i.test(name)) throw new Error("TEST_MONGODB_URI must point at a database with 'test' in its name.");
  await mongoose.connect(process.env.TEST_MONGODB_URI);
  await mongoose.connection.dropDatabase();
  await User.syncIndexes();
  await User.create({ name: "Store Admin", email: "admin@nexthlon.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  await Product.create({
    name: "Nexthlon Trail Shoe", slug: "nexthlon-trail-shoe", category: "Running", brand: "Nexthlon",
    price: 2999, mrp: 3999, stock: 4, image: "https://images.unsplash.com/photo-1542291026-7eec264c27ff"
  });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

const asha = { name: "Asha Nair", email: "asha@nexthlon.test", password: "trail2024", confirmPassword: "trail2024" };
let ashaCookie;

test("health check works", async () => {
  const res = await call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.equal(res.data.status, "ok");
});

test("signup rejects bad input with field errors", async () => {
  const res = await call("POST", "/api/signup", { body: { name: "A", email: "nope", password: "x" } });
  assert.equal(res.status, 400);
  assert.ok(res.data.errors.name && res.data.errors.email && res.data.errors.password);
});

test("signup creates a customer, signs them in, and hides the password hash", async () => {
  const res = await call("POST", "/api/signup", { body: asha });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.role, "customer");
  assert.equal(res.data.user.passwordHash, undefined);
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Lax/i);
  ashaCookie = res.cookie;
  const stored = await User.findOne({ email: asha.email }).select("+passwordHash");
  assert.notEqual(stored.passwordHash, asha.password);
  assert.match(stored.passwordHash, /^\$2[aby]\$12\$/);
});

test("the same email cannot sign up twice", async () => {
  const res = await call("POST", "/api/signup", { body: { ...asha, email: "ASHA@nexthlon.test" } });
  assert.equal(res.status, 409);
});

test("login checks the password and the account type", async () => {
  assert.equal((await call("POST", "/api/login", { body: { email: asha.email, password: "wrong-pass1" } })).status, 401);
  assert.equal((await call("POST", "/api/login", { body: { email: "nobody@nexthlon.test", password: "trail2024" } })).status, 401);
  assert.equal((await call("POST", "/api/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/login", { body: { email: asha.email, password: asha.password } })).status, 403);
  const ok = await call("POST", "/api/login", { body: { email: asha.email, password: asha.password } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  ashaCookie = ok.cookie;
});

test("protected API needs a valid token, from the cookie or a Bearer header", async () => {
  assert.equal((await call("GET", "/api/me")).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: "nx_token=not-a-real-token" })).status, 401);
  const viaCookie = await call("GET", "/api/me", { cookie: ashaCookie });
  assert.equal(viaCookie.status, 200);
  assert.equal(viaCookie.data.user.email, asha.email);
  const token = ashaCookie.split("=")[1];
  assert.equal((await call("GET", "/api/me", { bearer: token })).status, 200);
});

test("changing data from another website is blocked", async () => {
  const body = { name: "Hacked Name" };
  assert.equal((await call("PATCH", "/api/profile", { body, cookie: ashaCookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await call("PATCH", "/api/profile", { body, cookie: ashaCookie, origin: false })).status, 403);
});

test("customers can update their profile, with validation", async () => {
  const bad = await call("PATCH", "/api/profile", { body: { name: "Asha Nair", phone: "12345" }, cookie: ashaCookie });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.phone);
  const ok = await call("PATCH", "/api/profile", { body: { name: "Asha K Nair", phone: "9876543210", role: "admin" }, cookie: ashaCookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.name, "Asha K Nair");
  assert.equal(ok.data.user.role, "customer");
});

const homeAddress = { fullName: "Asha Nair", phone: "9876543210", line1: "12 MG Road", city: "Kochi", state: "Kerala", pincode: "682001" };

test("address book: add, default rules, edit, ownership and delete", async () => {
  const first = await call("POST", "/api/addresses", { body: homeAddress, cookie: ashaCookie });
  assert.equal(first.status, 201);
  assert.equal(first.data.address.isDefault, true);

  const second = await call("POST", "/api/addresses", { body: { ...homeAddress, line1: "4 Beach Road", isDefault: true }, cookie: ashaCookie });
  assert.equal(second.data.address.isDefault, true);
  let list = await call("GET", "/api/addresses", { cookie: ashaCookie });
  assert.equal(list.data.addresses.length, 2);
  assert.equal(list.data.addresses.filter(a => a.isDefault).length, 1);
  assert.equal(list.data.addresses[0].line1, "4 Beach Road");

  const edited = await call("PATCH", `/api/addresses/${first.data.address._id}`, { body: { ...homeAddress, city: "Ernakulam" }, cookie: ashaCookie });
  assert.equal(edited.data.address.city, "Ernakulam");

  const ravi = await call("POST", "/api/signup", { body: { name: "Ravi Kumar", email: "ravi@nexthlon.test", password: "pitch2024", confirmPassword: "pitch2024" } });
  assert.equal((await call("DELETE", `/api/addresses/${first.data.address._id}`, { cookie: ravi.cookie })).status, 404);
  assert.equal((await call("PATCH", `/api/addresses/${first.data.address._id}`, { body: homeAddress, cookie: ravi.cookie })).status, 404);

  assert.equal((await call("DELETE", `/api/addresses/${second.data.address._id}`, { cookie: ashaCookie })).status, 200);
  list = await call("GET", "/api/addresses", { cookie: ashaCookie });
  assert.equal(list.data.addresses.length, 1);
  assert.equal(list.data.addresses[0].isDefault, true);
});

test("customers cannot use admin APIs", async () => {
  assert.equal((await call("GET", "/api/admin/customers", { cookie: ashaCookie })).status, 403);
  assert.equal((await call("GET", "/api/admin/dashboard")).status, 401);
});

test("admin can list, block and unblock customers, and blocking works at once", async () => {
  const login = await call("POST", "/api/admin/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } });
  assert.equal(login.status, 200);
  const adminCookie = login.cookie;

  const dash = await call("GET", "/api/admin/dashboard", { cookie: adminCookie });
  assert.equal(dash.data.stats.customers, 2);
  assert.equal(dash.data.stats.lowStock, 1);

  const list = await call("GET", "/api/admin/customers?q=asha", { cookie: adminCookie });
  assert.equal(list.data.customers.length, 1);
  const ashaId = list.data.customers[0].id;
  assert.equal(list.data.customers[0].passwordHash, undefined);

  assert.equal((await call("PATCH", `/api/admin/customers/${ashaId}/block`, { body: { isBlocked: "yes" }, cookie: adminCookie })).status, 400);
  const blocked = await call("PATCH", `/api/admin/customers/${ashaId}/block`, { body: { isBlocked: true }, cookie: adminCookie });
  assert.equal(blocked.data.customer.isBlocked, true);

  assert.equal((await call("GET", "/api/me", { cookie: ashaCookie })).status, 403);
  assert.equal((await call("POST", "/api/login", { body: { email: asha.email, password: asha.password } })).status, 403);

  const adminSelf = await User.findOne({ email: "admin@nexthlon.test" });
  assert.equal((await call("PATCH", `/api/admin/customers/${adminSelf._id}/block`, { body: { isBlocked: true }, cookie: adminCookie })).status, 404);

  await call("PATCH", `/api/admin/customers/${ashaId}/block`, { body: { isBlocked: false }, cookie: adminCookie });
  assert.equal((await call("GET", "/api/me", { cookie: ashaCookie })).status, 200);
});

test("changing the password signs out older tokens", async () => {
  const wrong = await call("PATCH", "/api/profile/password", { body: { currentPassword: "nope12345", newPassword: "summit2025", confirmPassword: "summit2025" }, cookie: ashaCookie });
  assert.equal(wrong.status, 400);
  const changed = await call("PATCH", "/api/profile/password", { body: { currentPassword: asha.password, newPassword: "summit2025", confirmPassword: "summit2025" }, cookie: ashaCookie });
  assert.equal(changed.status, 200);
  assert.equal((await call("GET", "/api/me", { cookie: ashaCookie })).status, 401);
  assert.equal((await call("GET", "/api/me", { cookie: changed.cookie })).status, 200);
  ashaCookie = changed.cookie;
});

test("logout clears the cookie", async () => {
  const res = await call("POST", "/api/logout", { cookie: ashaCookie });
  assert.equal(res.status, 200);
  assert.match(res.setCookie, /nx_token=;/);
});

test("product API: list, search, detail and categories", async () => {
  const list = await call("GET", "/api/products?category=Running&inStock=1");
  assert.equal(list.data.products.length, 1);
  assert.equal(list.data.products[0].discountPercent, 25);
  assert.equal((await call("GET", "/api/products/search")).status, 400);
  assert.equal((await call("GET", "/api/products/search?q=trail")).data.products.length, 1);
  assert.equal((await call("GET", "/api/products/nexthlon-trail-shoe")).status, 200);
  assert.equal((await call("GET", "/api/products/missing-item")).status, 404);
  assert.equal((await call("GET", "/api/categories")).data.categories[0].name, "Running");
  assert.equal((await call("GET", "/api/nothing-here")).status, 404);
});

test("pages: guards and redirects", async () => {
  const profile = await call("GET", "/profile");
  assert.equal(profile.status, 302);
  assert.equal(profile.location, "/login?next=%2Fprofile");

  const fresh = await call("POST", "/api/login", { body: { email: "ravi@nexthlon.test", password: "pitch2024" } });
  assert.equal((await call("GET", "/login", { cookie: fresh.cookie })).location, "/");
  assert.equal((await call("GET", "/profile", { cookie: fresh.cookie })).status, 200);
  assert.equal((await call("GET", "/admin", { cookie: fresh.cookie })).status, 403);
  assert.equal((await call("GET", "/admin")).location, "/admin/login?next=%2Fadmin");

  for (const path of ["/", "/products", "/products?q=trail&sort=price_asc", "/products/nexthlon-trail-shoe", "/login", "/signup", "/admin/login"]) {
    assert.equal((await call("GET", path)).status, 200, path);
  }
  assert.equal((await call("GET", "/products/missing-item")).status, 404);
});
