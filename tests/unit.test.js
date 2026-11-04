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
  assert.deepEqual(value, { name: "Asha Nair", email: "asha@example.com", password: "trail2024" });
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
