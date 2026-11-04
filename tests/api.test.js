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

test("signed-in pages and the API are never cached, static files still are", async () => {
  const customer = await call("POST", "/api/login", { body: { email: "ravi@nexthlon.test", password: "pitch2024" } });
  const admin = await call("POST", "/api/admin/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } });

  const profile = await fetch(base + "/profile", { headers: { Cookie: customer.cookie }, redirect: "manual" });
  assert.equal(profile.status, 200);
  assert.match(profile.headers.get("cache-control") || "", /no-store/);

  const dashboard = await fetch(base + "/admin", { headers: { Cookie: admin.cookie }, redirect: "manual" });
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.headers.get("cache-control") || "", /no-store/);

  const me = await fetch(base + "/api/me", { headers: { Cookie: customer.cookie } });
  assert.equal(me.status, 200);
  assert.match(me.headers.get("cache-control") || "", /no-store/);
  assert.equal(me.headers.get("pragma"), "no-cache");

  const css = await fetch(base + "/css/style.css");
  assert.equal(css.status, 200);
  assert.doesNotMatch(css.headers.get("cache-control") || "", /no-store/);
});

// ---------- Admin product management ----------
const { deleteImages } = require("../services/imageService");

// A real 1x1 PNG, and a text file pretending to be one.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const FAKE_PNG = Buffer.from("this is not an image at all");

async function sendForm(method, path, { fields = {}, files = [], cookie } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) form.append("images", new Blob([file.data], { type: file.type || "image/png" }), file.name);
  const response = await fetch(base + path, { method, headers: { Origin: base, Cookie: cookie, Accept: "application/json" }, body: form });
  return { status: response.status, data: await response.json() };
}

const productFields = { name: "Summit Hiking Pole", category: "Hiking", brand: "Nexthlon", price: "1500", mrp: "2000", stock: "8", description: "Light carbon pole." };
let adminCookieForProducts;
let createdProduct;

test("admin product APIs are for admins only", async () => {
  assert.equal((await call("GET", "/api/admin/products")).status, 401);
  const customer = await call("POST", "/api/login", { body: { email: "ravi@nexthlon.test", password: "pitch2024" } });
  assert.equal((await call("GET", "/api/admin/products", { cookie: customer.cookie })).status, 403);
  assert.equal((await sendForm("POST", "/api/admin/products", { fields: productFields, files: [{ name: "a.png", data: PNG }], cookie: customer.cookie })).status, 403);
  adminCookieForProducts = (await call("POST", "/api/admin/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } })).cookie;
});

test("creating a product checks fields and the real image type", async () => {
  const bad = await sendForm("POST", "/api/admin/products", {
    fields: { ...productFields, price: "0", mrp: "abc", stock: "2.5", name: "No" }, cookie: adminCookieForProducts
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.price && bad.data.errors.mrp && bad.data.errors.stock && bad.data.errors.name && bad.data.errors.images);

  const fake = await sendForm("POST", "/api/admin/products", { fields: productFields, files: [{ name: "evil.png", data: FAKE_PNG }], cookie: adminCookieForProducts });
  assert.equal(fake.status, 400);
  assert.match(fake.data.errors.images, /not a real/);

  const wrongType = await sendForm("POST", "/api/admin/products", { fields: productFields, files: [{ name: "x.gif", data: PNG, type: "image/gif" }], cookie: adminCookieForProducts });
  assert.equal(wrongType.status, 400);

  const tooBig = await sendForm("POST", "/api/admin/products", { fields: productFields, files: [{ name: "big.png", data: Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]) }], cookie: adminCookieForProducts });
  assert.equal(tooBig.status, 400);
  assert.match(tooBig.data.errors.images, /2 MB/);

  const tooMany = await sendForm("POST", "/api/admin/products", { fields: productFields, files: Array.from({ length: 5 }, (_, i) => ({ name: `${i}.png`, data: PNG })), cookie: adminCookieForProducts });
  assert.equal(tooMany.status, 400);
});

test("admin creates a product: slug and discount come from the server", async () => {
  const res = await sendForm("POST", "/api/admin/products", {
    fields: { ...productFields, discountPercent: "90", slug: "hacked" },
    files: [{ name: "a.png", data: PNG }, { name: "b.png", data: PNG }],
    cookie: adminCookieForProducts
  });
  assert.equal(res.status, 201);
  createdProduct = res.data.product;
  assert.equal(createdProduct.slug, "summit-hiking-pole");
  assert.equal(createdProduct.discountPercent, 25);
  assert.equal(createdProduct.images.length, 2);
  assert.match(createdProduct.image, /^\/uploads\/products\/[a-f0-9]{32}\.png$/);

  const again = await sendForm("POST", "/api/admin/products", { fields: productFields, files: [{ name: "c.png", data: PNG }], cookie: adminCookieForProducts });
  assert.equal(again.data.product.slug, "summit-hiking-pole-2");
  assert.equal((await fetch(base + again.data.product.image)).status, 200);
  await call("PATCH", `/api/admin/products/${again.data.product.id}/listing`, { body: { isListed: false }, cookie: adminCookieForProducts });
  await deleteImages(again.data.product.images);
});

test("admin edits a product: main photo, removing photos and price rules", async () => {
  const [first, second] = createdProduct.images;
  const res = await sendForm("PATCH", `/api/admin/products/${createdProduct.id}`, {
    fields: { ...productFields, price: "1800", keepImages: JSON.stringify([second]), mainImage: second },
    cookie: adminCookieForProducts
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.product.images, [second]);
  assert.equal(res.data.product.discountPercent, 10);
  assert.equal((await fetch(base + first)).status, 404);

  const stranger = await sendForm("PATCH", `/api/admin/products/${createdProduct.id}`, {
    fields: { ...productFields, keepImages: JSON.stringify(["https://evil.example/x.png"]) }, cookie: adminCookieForProducts
  });
  assert.equal(stranger.status, 400);
  const mrpLow = await sendForm("PATCH", `/api/admin/products/${createdProduct.id}`, {
    fields: { ...productFields, mrp: "100", keepImages: JSON.stringify([second]) }, cookie: adminCookieForProducts
  });
  assert.ok(mrpLow.data.errors.mrp);
  createdProduct = res.data.product;
});

test("unlisting hides a product from shoppers but keeps it for admins", async () => {
  assert.equal((await call("GET", `/api/products/${createdProduct.slug}`)).status, 200);
  assert.equal((await call("PATCH", `/api/admin/products/${createdProduct.id}/listing`, { body: { isListed: "no" }, cookie: adminCookieForProducts })).status, 400);
  const off = await call("PATCH", `/api/admin/products/${createdProduct.id}/listing`, { body: { isListed: false }, cookie: adminCookieForProducts });
  assert.equal(off.data.product.status, "unlisted");
  assert.equal((await call("GET", `/api/products/${createdProduct.slug}`)).status, 404);
  assert.equal((await call("GET", `/products/${createdProduct.slug}`)).status, 404);
  assert.equal((await call("GET", "/api/products?q=summit")).data.products.length, 0);
  assert.ok(await Product.exists({ _id: createdProduct.id }));

  const unlisted = await call("GET", "/api/admin/products?status=unlisted", { cookie: adminCookieForProducts });
  assert.equal(unlisted.data.products.length, 2);
  const search = await call("GET", "/api/admin/products?q=summit&sort=price_desc", { cookie: adminCookieForProducts });
  assert.equal(search.data.products.length, 2);
  assert.equal(search.data.pagination.limit, 10);

  await call("PATCH", `/api/admin/products/${createdProduct.id}/listing`, { body: { isListed: true }, cookie: adminCookieForProducts });
  assert.equal((await call("GET", `/api/products/${createdProduct.slug}`)).status, 200);
});

test("admin product pages are guarded and render", async () => {
  assert.equal((await call("GET", "/admin/products")).location, "/admin/login?next=%2Fadmin%2Fproducts");
  for (const path of ["/admin/products", "/admin/products?status=out&category=Hiking", "/admin/products/new", `/admin/products/${createdProduct.id}/edit`]) {
    assert.equal((await call("GET", path, { cookie: adminCookieForProducts })).status, 200, path);
  }
  assert.equal((await call("GET", "/admin/products/not-an-id/edit", { cookie: adminCookieForProducts })).status, 404);
  await deleteImages(createdProduct.images);
});

// ---------- Store pages ----------
test("store: A to Z sort, price range and only listed products", async () => {
  const sorted = await call("GET", "/api/products?sort=name_asc");
  const names = sorted.data.products.map(p => p.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));

  const range = await call("GET", "/api/products?min=1000&max=2000");
  assert.ok(range.data.products.every(p => p.price >= 1000 && p.price <= 2000));

  const page = await call("GET", "/products?category=Running&sort=name_asc&min=100");
  assert.equal(page.status, 200);
  assert.match(page.data, /Name: A to Z/);
  assert.match(page.data, /From ₹100/);
});

test("store: product page shows breadcrumbs, prices, stock and the zoomable gallery", async () => {
  const res = await call("GET", "/products/nexthlon-trail-shoe");
  assert.equal(res.status, 200);
  assert.match(res.data, /aria-label="Breadcrumb"[\s\S]*All gear[\s\S]*Running/);
  assert.match(res.data, /<s>₹3,999<\/s>/);
  assert.match(res.data, /25% off/);
  assert.match(res.data, /Only 4 left/);
  assert.match(res.data, /data-zoom/);
  const missing = await call("GET", "/products/no-such-thing");
  assert.equal(missing.status, 404);
  assert.match(missing.data, /This trail ends here/);
});
