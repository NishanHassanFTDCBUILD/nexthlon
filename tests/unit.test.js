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
