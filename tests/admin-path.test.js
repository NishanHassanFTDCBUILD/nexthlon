// The admin console at a private ADMIN_PATH: hidden from customers and guests, with its own session.
process.env.TEST_ADMIN_PATH = "/nx-console-test1";
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("admin path tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const { hashPassword } = require("../services/authService");

const ADMIN = "/nx-console-test1";
const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_adminpath`;

let server;
let base;

async function call(method, path, { body, cookie } = {}) {
  const headers = { Accept: "text/html,application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data, headers: response.headers, location: response.headers.get("location"), setCookie, cookie: match && match[2] ? `${match[1]}=${match[2]}` : null };
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await User.syncIndexes();
  await User.create({ name: "Console Admin", email: "admin@path.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("customer pages never link to the admin console", async () => {
  const customer = await call("POST", "/api/signup", { body: { name: "Lina Paul", email: "lina@path.test", password: "pathway2024", confirmPassword: "pathway2024" } });
  for (const [path, cookie] of [["/login", null], ["/signup", null], ["/", null], ["/products", null], ["/", customer.cookie], ["/account", customer.cookie]]) {
    const page = await call("GET", path, { cookie });
    assert.equal(page.status, 200, path);
    assert.doesNotMatch(page.data, /\/admin|nx-console|Admin console|Admin sign in|Store administrator/i, path);
  }
  const robots = await call("GET", "/robots.txt");
  assert.doesNotMatch(robots.data, /admin|nx-console/i);
});

test("the old /admin URLs are a plain 404 when ADMIN_PATH is set", async () => {
  for (const path of ["/admin", "/admin/login", "/admin/dashboard", "/admin/products"]) {
    const res = await call("GET", path);
    assert.equal(res.status, 404, path);
    assert.equal(res.location, null, path);
    assert.doesNotMatch(res.data, /nx-console/, path);
  }
});

test("guests and customers get a 404 on admin pages; only the login URL shows a form", async () => {
  const login = await call("GET", `${ADMIN}/login`);
  assert.equal(login.status, 200);
  assert.match(login.data, /data-endpoint="\/api\/admin\/login"/);
  assert.match(login.data, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");

  // A 404 inside the admin path looks exactly like any other 404 (nothing hints at the console).
  const hidden = await call("GET", `${ADMIN}/dashboard`);
  const elsewhere = await call("GET", "/no-such-page-here");
  assert.equal(hidden.status, 404);
  assert.equal(hidden.headers.get("x-robots-tag"), elsewhere.headers.get("x-robots-tag"));
  assert.doesNotMatch(hidden.data, /noindex|data-admin-path|nx-console/);
  assert.equal(hidden.data.replace(/\/nx-console-test1\/dashboard/g, ""), elsewhere.data.replace(/\/no-such-page-here/g, ""));

  const customer = await call("POST", "/api/login", { body: { email: "lina@path.test", password: "pathway2024" } });
  assert.match(customer.cookie, /^nx_token=/);
  for (const path of [ADMIN, `${ADMIN}/dashboard`, `${ADMIN}/users`, `${ADMIN}/products`, `${ADMIN}/tickets`]) {
    for (const cookie of [null, customer.cookie, customer.cookie.replace("nx_token", "nx_admin")]) {
      const res = await call("GET", path, { cookie });
      assert.equal(res.status, 404, `${path} ${cookie ? "customer" : "guest"}`);
      assert.equal(res.location, null);
    }
  }
});

test("an admin signs in at the new path with a separate 8-hour cookie, and signs out", async () => {
  // The customer sign-in refuses admins, and the admin sign-in refuses customers.
  assert.equal((await call("POST", "/api/login", { body: { email: "admin@path.test", password: "AdminPass123" } })).status, 403);
  assert.equal((await call("POST", "/api/admin/login", { body: { email: "lina@path.test", password: "pathway2024" } })).status, 403);

  const admin = await call("POST", "/api/admin/login", { body: { email: "admin@path.test", password: "AdminPass123" } });
  assert.equal(admin.status, 200);
  assert.match(admin.cookie, /^nx_admin=/);
  assert.match(admin.setCookie, /Max-Age=28800/);
  assert.match(admin.setCookie, /HttpOnly/);
  assert.match(admin.setCookie, /SameSite=Strict/);

  assert.equal((await call("GET", `${ADMIN}/login`, { cookie: admin.cookie })).location, `${ADMIN}/dashboard`);
  assert.equal((await call("GET", ADMIN, { cookie: admin.cookie })).location, `${ADMIN}/dashboard`);
  const dashboard = await call("GET", `${ADMIN}/dashboard`, { cookie: admin.cookie });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.data, new RegExp(`data-admin-path="${ADMIN}"`));
  assert.match(dashboard.data, new RegExp(`href="${ADMIN}/products"`));
  assert.match(dashboard.data, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal((await call("GET", `${ADMIN}/products`, { cookie: admin.cookie })).status, 200);
  assert.equal((await call("GET", "/api/admin/dashboard", { cookie: admin.cookie })).status, 200);

  // The admin cookie is never read by the store: there the admin is just a guest.
  assert.equal((await call("GET", "/account", { cookie: admin.cookie })).status, 302);
  assert.equal((await call("GET", "/api/me", { cookie: admin.cookie })).status, 401);

  const out = await call("POST", "/api/admin/logout", { cookie: admin.cookie });
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /nx_admin=;/);
});

test("after signing in, the admin login only sends the admin to pages inside the console", async () => {
  assert.match((await call("GET", `${ADMIN}/login?next=%2Faccount`)).data, new RegExp(`name="next" value="${ADMIN}/dashboard"`));
  assert.match((await call("GET", `${ADMIN}/login?next=${encodeURIComponent(`${ADMIN}/products`)}`)).data, new RegExp(`name="next" value="${ADMIN}/products"`));
});
