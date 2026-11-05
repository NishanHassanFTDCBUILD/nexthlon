require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const v = require("../utils/validators");
const { signToken, verifyToken } = require("../services/tokenService");
const { originCheck } = require("../middleware/originCheck");
const { safeNextPath } = require("../utils/http");
const { readFilters } = require("../services/productService");

test("signup validation catches every bad field", () => {
  const { errors } = v.validateSignup({ name: "A", email: "bad", password: "short", confirmPassword: "x" });
  assert.deepEqual(Object.keys(errors).sort(), ["confirmPassword", "email", "name", "password"]);
});

test("signup validation cleans good input", () => {
  const { errors, value } = v.validateSignup({ name: "  Asha   Nair ", email: " ASHA@Example.com ", password: "trail2024", confirmPassword: "trail2024" });
  assert.equal(v.hasErrors(errors), false);
  assert.deepEqual(value, { name: "Asha Nair", email: "asha@example.com", password: "trail2024", referralCode: "" });
  assert.equal(v.validateSignup({ name: "Asha", email: "a@b.co", password: "trail2024", referralCode: " asha 7k2p " }).value.referralCode, "ASHA7K2P");
  assert.ok(v.validateSignup({ name: "Asha", email: "a@b.co", password: "trail2024", referralCode: "x!" }).errors.referralCode);
});

test("passwords need a letter and a number", () => {
  assert.ok(v.validateSignup({ name: "Asha", email: "a@b.co", password: "onlyletters" }).errors.password);
  assert.ok(v.validateSignup({ name: "Asha", email: "a@b.co", password: "12345678" }).errors.password);
});

test("address validation checks phone, PIN code and state", () => {
  const { errors } = v.validateAddress({ fullName: "Asha", phone: "12345", line1: "12", city: "K", state: "Atlantis", pincode: "012345" });
  assert.ok(errors.phone && errors.pincode && errors.state && errors.line1 && errors.city);
  const ok = v.validateAddress({ fullName: "Asha Nair", phone: "+91 98765 43210", line1: "12 MG Road", city: "Kochi", state: "Kerala", pincode: "682001", isDefault: "true" });
  assert.equal(v.hasErrors(ok.errors), false);
  assert.equal(ok.value.phone, "9876543210");
  assert.equal(ok.value.isDefault, true);
});

test("password change rejects reusing the same password", () => {
  const { errors } = v.validatePasswordChange({ currentPassword: "trail2024", newPassword: "trail2024", confirmPassword: "trail2024" });
  assert.ok(errors.newPassword);
});

test("tokens carry id, role and version, and reject tampering", () => {
  const token = signToken({ _id: "64b000000000000000000001", role: "customer", tokenVersion: 3 });
  const payload = verifyToken(token);
  assert.equal(payload.sub, "64b000000000000000000001");
  assert.equal(payload.role, "customer");
  assert.equal(payload.ver, 3);

  const [header, body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ ...payload, role: "admin" })).toString("base64url");
  assert.throws(() => verifyToken(`${header}.${forged}.${signature}`));
  assert.throws(() => verifyToken(jwt.sign({ role: "admin" }, "some-other-secret-that-is-also-long-enough")));
  assert.ok(body);
});

test("customer and admin tokens are separate: each only works for its own session", () => {
  const customer = signToken({ _id: "64b000000000000000000002", role: "customer", tokenVersion: 0 });
  const admin = signToken({ _id: "64b000000000000000000003", role: "admin", tokenVersion: 0 });
  assert.equal(verifyToken(customer, "customer").aud, "nexthlon-web");
  assert.equal(verifyToken(admin, "admin").aud, "nexthlon-admin");
  assert.throws(() => verifyToken(customer, "admin"));
  assert.throws(() => verifyToken(admin, "customer"));
  // Admin sessions last 8 hours.
  const { exp, iat } = verifyToken(admin, "admin");
  assert.equal(exp - iat, 8 * 60 * 60);
});

function runOriginCheck(req) {
  let result;
  originCheck(req, {}, error => { result = error || "ok"; });
  return result;
}

function fakeRequest({ method = "POST", origin, host = "localhost:3000", cookie, bearer }) {
  const headers = { origin, host, authorization: bearer ? "Bearer abc" : undefined };
  return { method, cookies: cookie ? { nx_token: "x" } : {}, get: name => headers[name.toLowerCase()] };
}

test("origin check blocks cross-site requests that carry the login cookie", () => {
  assert.equal(runOriginCheck(fakeRequest({ origin: "http://localhost:3000", cookie: true })), "ok");
  assert.equal(runOriginCheck(fakeRequest({ origin: "https://evil.example", cookie: true })).status, 403);
  assert.equal(runOriginCheck(fakeRequest({ cookie: true })).status, 403);
  assert.equal(runOriginCheck(fakeRequest({})), "ok");
  assert.equal(runOriginCheck(fakeRequest({ bearer: true, origin: "https://evil.example" })), "ok");
  assert.equal(runOriginCheck(fakeRequest({ method: "GET", origin: "https://evil.example", cookie: true })), "ok");
});

test("redirects only go to pages on this site", () => {
  assert.equal(safeNextPath("/profile"), "/profile");
  assert.equal(safeNextPath("//evil.example"), "/");
  assert.equal(safeNextPath("https://evil.example"), "/");
  assert.equal(safeNextPath("/\\evil.example"), "/");
  assert.equal(safeNextPath("/api/me"), "/");
});

test("product filters ignore bad values", () => {
  const filters = readFilters({ category: ["x"], brand: { $ne: "" }, min: "-5", max: "abc", discount: "15", rating: "9", sort: "$where", view: "huge", page: "0", q: ["a", "b"] });
  assert.deepEqual(filters, { q: "", category: "", brands: [], min: null, max: null, discount: 0, rating: 0, inStock: false, sort: "relevance", view: "grid", page: 1 });
  assert.deepEqual(readFilters({ min: "5000", max: "100" }).min, 100);
});

test("product list supports every shopper sort, including A to Z", () => {
  for (const sort of ["relevance", "price_asc", "price_desc", "newest", "rating", "name_asc", "discount"]) {
    assert.equal(readFilters({ sort }).sort, sort);
  }
});

test("filter links keep the current filters in the URL and drop empty ones", () => {
  const { linkBuilder } = require("../utils/queryString");
  const link = linkBuilder("/products", { q: "trail shoe", category: "Running", min: null, sort: "" });
  assert.equal(link({ page: 2 }), "/products?q=trail+shoe&category=Running&page=2");
  assert.equal(link({ category: "" }), "/products?q=trail+shoe");
});

test("account helpers: masked IPs, short browser names, and audit snapshots without secrets", () => {
  const { maskIp, clean } = require("../services/auditService");
  const { browserName } = require("../services/accountService");
  assert.equal(maskIp("103.21.244.17"), "103.21.x.x");
  assert.equal(maskIp("::ffff:10.0.0.5"), "10.0.x.x");
  assert.equal(maskIp("2405:201:abcd:1::7"), "2405:201:…");
  assert.equal(maskIp(""), "");
  assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"), "Chrome on Windows");
  assert.equal(browserName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130"), "Edge on Windows");
  assert.equal(browserName(""), "Unknown browser");
  assert.deepEqual(clean({ email: "a@b.in", password: "x", passwordHash: "y", tokenVersion: 3, otpCode: "1" }), { email: "a@b.in" });
  assert.equal(clean(null), null);
});

test("account validators: email change, preferences, list names, tickets and deleting the account", () => {
  const v = require("../utils/validators");
  assert.ok(v.validateEmailChange({ email: "bad", password: "" }).errors.email);
  assert.deepEqual(v.validateEmailChange({ email: " New@Mail.in ", password: "secret12" }).value, { email: "new@mail.in", password: "secret12" });
  assert.ok(v.validatePreferences({ offers: "true" }).errors.offers);
  assert.deepEqual(v.validatePreferences({ offers: false, hacker: true }).value, { offers: false });
  assert.ok(v.validatePreferences({}).errors.form);
  assert.ok(v.validateListName({ name: "Wishlist" }).errors.name);
  assert.ok(v.validateListName({ name: "x".repeat(41) }).errors.name);
  assert.equal(v.validateListName({ name: "  Gym   kit " }).value.name, "Gym kit");
  const ticket = v.validateTicket({ topic: "Order", subject: "Late parcel", message: "It has been a week now.", orderId: "nx-2026-000001" }, ["Order"]);
  assert.deepEqual(ticket.errors, {});
  assert.equal(ticket.value.orderId, "NX-2026-000001");
  assert.ok(v.validateTicket({ topic: "Order", subject: "Hi", message: "short", orderId: "<script>" }, ["Order"]).errors.orderId);
  assert.ok(v.validateTicketReply({ message: "ok", status: "closed" }, ["open", "pending", "resolved"]).errors.status);
  assert.ok(v.validateDeleteAccount({ password: "x", confirm: "yes" }).errors.confirm);
  assert.deepEqual(v.validateDeleteAccount({ password: "x", confirm: "delete" }).errors, {});
  assert.equal(v.validateAddress({ type: "Office" }).value.type, "home");
});

// ---------- Admin dashboard: date ranges, CSV safety, restock input ----------
const dashboardService = require("../services/dashboardService");
const csv = require("../utils/csv");

test("dashboard ranges are India-time periods with a previous period of the same length", () => {
  // 5 Nov 2026, 15:30 in India (10:00 UTC).
  const now = new Date("2026-11-05T10:00:00.000Z");
  const week = dashboardService.readRange({ range: "7d" }, now);
  assert.equal(week.from.toISOString(), "2026-10-29T18:30:00.000Z"); // 30 Oct 00:00 IST
  assert.equal(week.to.getTime(), now.getTime());
  assert.equal(week.prevTo.getTime(), now.getTime() - 7 * 86400000);
  assert.equal(week.bucket, "day");
  assert.equal(dashboardService.bucketStarts(week).length, 7);

  const today = dashboardService.readRange({ range: "today" }, now);
  assert.equal(today.from.toISOString(), "2026-11-04T18:30:00.000Z");
  assert.equal(today.bucket, "hour");
  assert.equal(dashboardService.bucketStarts(today).length, 16); // 00:00 to 15:00

  const month = dashboardService.readRange({ range: "month" }, now);
  assert.equal(month.from.toISOString(), "2026-10-31T18:30:00.000Z"); // 1 Nov IST
  assert.equal(month.prevFrom.toISOString(), "2026-09-30T18:30:00.000Z"); // 1 Oct IST

  const year = dashboardService.readRange({ range: "year" }, now);
  assert.equal(year.bucket, "month");
  assert.equal(dashboardService.bucketStarts(year).length, 11);

  const custom = dashboardService.readRange({ range: "custom", from: "2026-10-01", to: "2026-10-10" }, now);
  assert.equal(custom.key, "custom");
  assert.equal(custom.fromDay, "2026-10-01");
  assert.equal(custom.toDay, "2026-10-10");
  assert.equal(custom.prevFrom.toISOString(), "2026-09-20T18:30:00.000Z"); // 10 days before
  assert.equal(dashboardService.bucketStarts(custom).length, 10);

  // Bad input never breaks the page: it falls back to 7 days with a message.
  for (const query of [{ range: "custom", from: "2026-10-10", to: "2026-10-01" }, { range: "custom", from: "2026-02-31", to: "2026-03-01" },
    { range: "custom", from: "2026-11-01", to: "2026-12-01" }, { range: "custom", from: "2024-01-01", to: "2026-11-01" }, { range: "custom" }]) {
    const r = dashboardService.readRange(query, now);
    assert.equal(r.key, "7d", JSON.stringify(query));
    assert.ok(r.error, JSON.stringify(query));
  }
  assert.equal(dashboardService.readRange({ range: "$where" }, now).key, "7d");
  assert.equal(dashboardService.change(150, 100), 50);
  assert.equal(dashboardService.change(50, 100), -50);
  assert.equal(dashboardService.change(10, 0), null);
  assert.equal(dashboardService.change(0, 0), 0);
});

test("CSV cells are quoted and spreadsheet formulas are neutralised", () => {
  assert.equal(csv.cell('Say "hi"'), '"Say ""hi"""');
  assert.equal(csv.cell("=HYPERLINK(\"x\")"), "\"'=HYPERLINK(\"\"x\"\")\"");
  assert.equal(csv.cell("+91 98765"), "\"'+91 98765\"");
  assert.equal(csv.cell("-5"), "\"'-5\"");
  assert.equal(csv.cell("@SUM(A1)"), "\"'@SUM(A1)\"");
  assert.equal(csv.cell(-5), '"-5"'); // real numbers stay numbers
  assert.equal(csv.cell(null), '""');
  assert.equal(csv.row(["a", 1]), '"a","1"\r\n');
});

test("restock input: whole units from 1 to 10,000 only", () => {
  assert.equal(v.validateRestock({ add: 5 }).value.add, 5);
  assert.equal(v.validateRestock({ add: "10000" }).value.add, 10000);
  for (const add of [0, -1, 10001, 2.5, "abc", "", null, "1e3", { $gt: 0 }]) assert.ok(v.validateRestock({ add }).errors.add, String(add));
  assert.ok(v.validateAdminSearch({ q: "a" }).errors.q);
  assert.equal(v.validateAdminSearch({ q: "  Asha   Nair " }).value.q, "Asha Nair");
});
