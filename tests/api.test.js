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
const Category = require("../models/Category");
const categoryService = require("../services/categoryService");

// Test products are written in rupees for readability; the store keeps paise.
const categoryIds = {};
async function categoryId(name) {
  if (!categoryIds[name]) {
    const category = await categoryService.ensureCategory(name);
    categoryIds[name] = category._id;
    categoryService.invalidate();
  }
  return categoryIds[name];
}
async function makeProduct({ category, price, mrp, ...rest }) {
  return Product.create({ ...rest, category: await categoryId(category), basePrice: price * 100, mrp: mrp * 100 });
}

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
  await Product.syncIndexes();
  await makeProduct({
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
  const list = await call("GET", "/api/products?category=running&inStock=1");
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
  productFields.category = String(await categoryId("Hiking"));
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
  for (const path of ["/admin/products", `/admin/products?status=out&category=${productFields.category}`, "/admin/products/new", `/admin/products/${createdProduct.id}/edit`]) {
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
  assert.ok(range.data.products.every(p => p.price >= 100000 && p.price <= 200000));

  const page = await call("GET", "/products?category=running&sort=name_asc&min=100");
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

// ---------- Cart ----------
const Cart = require("../models/Cart");
let shopperCookie;
let shoeId;

test("cart: only signed-in customers, and guests are sent to sign in", async () => {
  shoeId = String((await Product.findOne({ slug: "nexthlon-trail-shoe" }))._id);
  assert.equal((await call("GET", "/api/cart")).status, 401);
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: shoeId } })).status, 401);
  assert.equal((await call("GET", "/api/cart", { cookie: adminCookieForProducts })).status, 403);
  assert.equal((await call("GET", "/cart")).location, "/login?next=%2Fcart");
  const guestPage = await call("GET", "/products/nexthlon-trail-shoe");
  assert.match(guestPage.data, /href="\/login\?next=%2Fproducts%2Fnexthlon-trail-shoe"[^>]*>[\s\S]*?Add to cart/);

  const shopper = await call("POST", "/api/signup", { body: { name: "Meera Iyer", email: "meera@nexthlon.test", password: "court2024", confirmPassword: "court2024" } });
  shopperCookie = shopper.cookie;
  const empty = await call("GET", "/api/cart", { cookie: shopperCookie });
  assert.equal(empty.data.cart.items.length, 0);
  assert.equal((await call("GET", "/cart", { cookie: shopperCookie })).status, 200);
});

test("cart: adding twice raises the quantity, and the price always comes from the database", async () => {
  const first = await call("POST", "/api/cart/items", { body: { productId: shoeId, quantity: 1, price: 1, priceAtAdd: 1 }, cookie: shopperCookie });
  assert.equal(first.status, 201);
  assert.equal(first.data.cart.items[0].price, 299900);
  const second = await call("POST", "/api/cart/items", { body: { productId: shoeId, quantity: 2 }, cookie: shopperCookie });
  assert.equal(second.data.cart.items.length, 1);
  assert.equal(second.data.cart.items[0].quantity, 3);
  assert.equal(second.data.cart.summary.subtotal, 899700);
  assert.equal(second.data.cart.summary.count, 3);

  // The admin changes the price: the cart follows it straight away.
  await Product.updateOne({ _id: shoeId }, { $set: { basePrice: 250000, price: 250000 } });
  const repriced = await call("GET", "/api/cart", { cookie: shopperCookie });
  assert.equal(repriced.data.cart.summary.subtotal, 750000);
  await Product.updateOne({ _id: shoeId }, { $set: { basePrice: 299900, price: 299900 } });

  const page = await call("GET", "/products/nexthlon-trail-shoe", { cookie: shopperCookie });
  assert.match(page.data, /data-cart-count >3</);
});

test("cart: the stock limit and the 5-per-product limit are enforced on the server", async () => {
  const overStock = await call("POST", "/api/cart/items", { body: { productId: shoeId, quantity: 2 }, cookie: shopperCookie });
  assert.equal(overStock.status, 400);
  assert.match(overStock.data.message, /already have 3 in your cart\. You can add 1 more/);
  assert.equal((await call("PATCH", `/api/cart/items/${shoeId}`, { body: { quantity: 5 }, cookie: shopperCookie })).status, 400);
  assert.equal((await call("PATCH", `/api/cart/items/${shoeId}`, { body: { quantity: 0 }, cookie: shopperCookie })).status, 400);
  const four = await call("PATCH", `/api/cart/items/${shoeId}`, { body: { quantity: 4 }, cookie: shopperCookie });
  assert.equal(four.data.cart.items[0].quantity, 4);

  const plenty = await makeProduct({ name: "Grip Tape", slug: "grip-tape", category: "Tennis", price: 199, mrp: 249, stock: 40, image: "/img/favicon.svg" });
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: String(plenty._id), quantity: 6 }, cookie: shopperCookie })).status, 400);
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: String(plenty._id), quantity: 5 }, cookie: shopperCookie })).status, 201);
  const sixth = await call("POST", "/api/cart/items", { body: { productId: String(plenty._id), quantity: 1 }, cookie: shopperCookie });
  assert.equal(sixth.status, 400);
  assert.match(sixth.data.message, /most you can buy/);
  assert.equal((await call("DELETE", `/api/cart/items/${plenty._id}`, { cookie: shopperCookie })).status, 200);
  assert.equal((await call("DELETE", `/api/cart/items/${plenty._id}`, { cookie: shopperCookie })).status, 404);
});

test("cart: unlisted and out-of-stock products cannot be added, and show as unavailable", async () => {
  const hidden = await makeProduct({ name: "Old Racket", slug: "old-racket", category: "Tennis", price: 999, mrp: 999, stock: 5, image: "/img/favicon.svg", isListed: false });
  const soldOut = await makeProduct({ name: "Sold Out Cap", slug: "sold-out-cap", category: "Running", price: 299, mrp: 399, stock: 0, image: "/img/favicon.svg" });
  assert.match((await call("POST", "/api/cart/items", { body: { productId: String(hidden._id) }, cookie: shopperCookie })).data.message, /no longer available/);
  assert.match((await call("POST", "/api/cart/items", { body: { productId: String(soldOut._id) }, cookie: shopperCookie })).data.message, /out of stock/);
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: "64b000000000000000000099" }, cookie: shopperCookie })).status, 400);

  // A product in the cart is unlisted later: it stays visible but leaves the total.
  await Product.updateOne({ _id: shoeId }, { $set: { isListed: false } });
  const after = await call("GET", "/api/cart", { cookie: shopperCookie });
  assert.equal(after.data.cart.items[0].available, false);
  assert.equal(after.data.cart.items[0].reason, "No longer sold");
  assert.equal(after.data.cart.summary.subtotal, 0);
  assert.equal((await call("PATCH", `/api/cart/items/${shoeId}`, { body: { quantity: 1 }, cookie: shopperCookie })).status, 400);
  const page = await call("GET", "/cart", { cookie: shopperCookie });
  assert.match(page.data, /Unavailable · No longer sold/);
  await Product.updateOne({ _id: shoeId }, { $set: { isListed: true } });
});

test("cart: blocked customers are signed out of the cart too", async () => {
  const meera = await User.findOne({ email: "meera@nexthlon.test" });
  await User.updateOne({ _id: meera._id }, { $set: { isBlocked: true } });
  assert.equal((await call("GET", "/api/cart", { cookie: shopperCookie })).status, 403);
  assert.equal((await call("GET", "/cart", { cookie: shopperCookie })).location, "/login?next=%2Fcart&reason=blocked");
  await User.updateOne({ _id: meera._id }, { $set: { isBlocked: false } });

  const cleared = await call("DELETE", "/api/cart", { cookie: shopperCookie });
  assert.equal(cleared.data.cart.items.length, 0);
  assert.equal((await Cart.findOne({ user: meera._id })).items.length, 0);
});

// ---------- Storefront redesign: lookup, home, policy pages, contact and newsletter ----------
const ContactMessage = require("../models/ContactMessage");
const NewsletterSubscriber = require("../models/NewsletterSubscriber");

test("product lookup returns listed products in the order asked, and skips the rest", async () => {
  const shoe = await Product.findOne({ slug: "nexthlon-trail-shoe" });
  const ball = await makeProduct({ name: "Match Ball Pro", slug: "match-ball-pro", category: "Football", brand: "Strike", price: 1299, mrp: 1599, stock: 9, image: "/img/favicon.svg" });
  const gone = await makeProduct({ name: "Retired Bat", slug: "retired-bat", category: "Cricket", price: 999, mrp: 999, stock: 3, image: "/img/favicon.svg", isListed: false });
  const res = await call("GET", `/api/products/lookup?ids=${ball._id},${gone._id},junk,${shoe._id},${ball._id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.products.map(p => p.slug), ["match-ball-pro", "nexthlon-trail-shoe"]);
  // Prices always come from the database.
  assert.equal(res.data.products[0].price, 129900);
  assert.deepEqual((await call("GET", "/api/products/lookup")).data.products, []);
  assert.deepEqual((await call("GET", "/api/products/lookup?ids[$ne]=x")).data.products, []);
});

test("home page: 3D hero, trust badges, flip deals and countdown, journey, rails and brands", async () => {
  // Best sellers are the in-stock items that are not already in the deals row.
  await makeProduct({ name: "Plain Training Tee", slug: "plain-training-tee", category: "Fitness", price: 499, mrp: 499, stock: 8, image: "/img/favicon.svg" });
  const res = await call("GET", "/");
  assert.equal(res.status, 200);
  // The 3D hero: a WebGL canvas, the CSS 3D fallback, and the headline split into letters for the 3D reveal.
  assert.match(res.data, /data-hero3d/);
  assert.match(res.data, /data-hero3d-canvas/);
  assert.match(res.data, /class="hero3d-fallback"/);
  assert.match(res.data, /<span class="char" style="--i: 0">B<\/span>/);
  assert.match(res.data, /type="module" src="\/js\/home3d\.js"/);
  assert.match(res.data, /data-flip-card/);
  assert.match(res.data, /data-journey/);
  assert.match(res.data, /Free delivery/);
  assert.match(res.data, /Deals of the day/);
  assert.match(res.data, /data-countdown data-left="\d+"/);
  assert.match(res.data, /Best sellers/);
  assert.match(res.data, /New arrivals/);
  assert.match(res.data, /data-recent hidden/);
  assert.match(res.data, /class="brand-chip"[^>]*>Strike</);
  assert.match(res.data, /data-wish-id="[a-f0-9]{24}"/);
  assert.doesNotMatch(res.data, /Retired Bat/);
});

test("policy pages, about, contact and wishlist pages render for everyone", async () => {
  const pages = {
    "/privacy": /Privacy policy/, "/terms": /Terms and conditions/, "/refund-policy": /Cancellation and refund policy/,
    "/shipping-policy": /Shipping and delivery policy/, "/about": /About Nexthlon/, "/contact": /data-contact-form/
  };
  for (const [path, pattern] of Object.entries(pages)) {
    const res = await call("GET", path);
    assert.equal(res.status, 200, path);
    assert.match(res.data, pattern, path);
    assert.match(res.data, /href="\/refund-policy"/, path);
  }
  const contact = await call("GET", "/contact");
  assert.match(contact.data, /aria-current="page"[^>]*>[\s\S]*?Contact us/);
  assert.doesNotMatch(contact.data, /<script>/);
});

test("contact form saves valid messages, checks every field, drops bots and blocks other sites", async () => {
  const bad = await call("POST", "/api/contact", { body: { name: "", email: "x", topic: "nope", message: "short" } });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.data.errors).sort(), ["email", "message", "name", "topic"]);

  const good = await call("POST", "/api/contact", { body: { name: "Asha Nair", email: "Asha@Example.com", topic: "Payments", message: "Can I pay with UPI on delivery?", status: "closed", user: "64b000000000000000000001" } });
  assert.equal(good.status, 201);
  const saved = await ContactMessage.findOne({ email: "asha@example.com" }).lean();
  assert.equal(saved.topic, "Payments");
  assert.equal(saved.status, "new");
  assert.equal(saved.user, null);

  const bot = await call("POST", "/api/contact", { body: { name: "Spam Bot", email: "bot@spam.io", topic: "Payments", message: "Cheap watches here!!!", website: "spam.io" } });
  assert.equal(bot.status, 201);
  assert.equal(await ContactMessage.countDocuments({ email: "bot@spam.io" }), 0);

  const foreign = await call("POST", "/api/contact", { origin: "https://evil.example", body: { name: "Asha Nair", email: "a@b.in", topic: "Payments", message: "Hello there team" } });
  assert.equal(foreign.status, 403);
});

test("newsletter: subscribing twice keeps one row and gives the same answer", async () => {
  const first = await call("POST", "/api/newsletter", { body: { email: "Fan@Example.com" } });
  const again = await call("POST", "/api/newsletter", { body: { email: "fan@example.com" } });
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(first.data.message, again.data.message);
  assert.equal(await NewsletterSubscriber.countDocuments({ email: "fan@example.com" }), 1);
  assert.equal((await call("POST", "/api/newsletter", { body: { email: "not-an-email" } })).status, 400);
});

// ---------- Phase 2: categories, offers, search, filters, reviews and delivery ----------
const Review = require("../models/Review");
const { runMigrations } = require("../services/migrationService");

test("category names are unique whatever the letter case", async () => {
  const first = await categoryService.ensureCategory("Badminton");
  const again = await categoryService.ensureCategory("  badminton ");
  assert.equal(String(first._id), String(again._id));
  await assert.rejects(Category.create({ name: "BADMINTON", slug: "badminton-2" }), /duplicate key/);
});

test("the category offer applies when it beats the product offer, and prices follow it", async () => {
  const racket = await makeProduct({ name: "Smash Racket", slug: "smash-racket", category: "Badminton", brand: "Volt", price: 2000, mrp: 2500, stock: 6, image: "/img/favicon.svg", offerPercent: 10 });
  assert.equal(racket.price, 180000);
  const category = await Category.findOneAndUpdate({ nameKey: "badminton" }, { $set: { offerPercent: 25 } }, { new: true });
  await Product.syncCategory(category);
  categoryService.invalidate();
  const res = await call("GET", "/api/products/smash-racket");
  assert.equal(res.data.product.price, 150000);
  assert.equal(res.data.product.discountPercent, 40);
  assert.equal(res.data.product.offer.source, "category");
  const page = await call("GET", "/products/smash-racket");
  assert.match(page.data, /25% Badminton offer applied/);
  assert.match(page.data, /<s>₹2,500<\/s>/);
});

test("hidden categories hide their products, and their direct links show the friendly 404 page", async () => {
  const category = await Category.findOneAndUpdate({ nameKey: "badminton" }, { $set: { isListed: false } }, { new: true });
  await Product.syncCategory(category);
  categoryService.invalidate();
  assert.equal((await call("GET", "/api/products/smash-racket")).status, 404);
  const page = await call("GET", "/products/smash-racket");
  assert.equal(page.status, 404);
  assert.match(page.data, /This trail ends here/);
  assert.equal((await call("GET", "/products?category=badminton")).status, 404);
  assert.equal((await call("GET", "/api/products?q=smash")).data.products.length, 0);
  assert.doesNotMatch((await call("GET", "/")).data, /category=badminton/);

  category.isListed = true;
  await category.save();
  await Product.syncCategory(category);
  categoryService.invalidate();
  assert.equal((await call("GET", "/api/products/smash-racket")).status, 200);
});

test("search uses the text index for whole words and still finds partial words", async () => {
  const indexes = await Product.collection.indexes();
  assert.ok(indexes.some(index => index.name === "product_text"));
  const words = await call("GET", "/api/products/search?q=smash racket");
  assert.equal(words.data.products[0].slug, "smash-racket");
  const brand = await call("GET", "/api/products?q=volt");
  assert.deepEqual(brand.data.products.map(p => p.slug), ["smash-racket"]);
  const partial = await call("GET", "/api/products/search?q=rack");
  assert.ok(partial.data.products.some(p => p.slug === "smash-racket"));
  assert.equal((await call("GET", "/api/products?q=zzzqqq")).data.products.length, 0);
});

test("filters: brand, discount, rating and price slider facets", async () => {
  const brand = await call("GET", "/api/products?brand=Volt&brand=Strike");
  assert.ok(brand.data.products.length >= 2);
  assert.ok(brand.data.products.every(p => ["Volt", "Strike"].includes(p.brand)));
  assert.ok(brand.data.facets.brands.some(b => b.name === "Nexthlon"));
  const deep = await call("GET", "/api/products?discount=40");
  assert.ok(deep.data.products.length > 0 && deep.data.products.every(p => p.discountPercent >= 40));
  assert.equal((await call("GET", "/api/products?rating=4")).data.products.length, 0);
  assert.ok(brand.data.facets.priceHigh >= brand.data.facets.priceLow);
  const page = await call("GET", "/products?brand=Volt&discount=40&view=list");
  assert.match(page.data, /class="product-grid product-grid-3 is-list"/);
  assert.match(page.data, /aria-label="Remove filter: Volt"/);
  assert.match(page.data, /40% off or more/);
});

test("reviews: only customers who received the product, once each, and the average is stored", async () => {
  const racket = await Product.findOne({ slug: "smash-racket" });
  const review = { rating: 4, title: "Light and quick", body: "Great control at the net, strings held up." };
  assert.equal((await call("POST", `/api/products/${racket._id}/reviews`, { body: review })).status, 401);

  const buyer = await call("POST", "/api/signup", { body: { name: "Kiran Rao", email: "kiran@nexthlon.test", password: "court2024", confirmPassword: "court2024" } });
  const before = await call("POST", `/api/products/${racket._id}/reviews`, { body: review, cookie: buyer.cookie });
  assert.equal(before.status, 403);
  let page = await call("GET", "/products/smash-racket", { cookie: buyer.cookie });
  assert.match(page.data, /Only customers who received this product can review it/);

  // A delivered order line for this product makes the customer eligible.
  const kiran = await User.findOne({ email: "kiran@nexthlon.test" });
  await mongoose.connection.collection("orders").insertOne({ user: kiran._id, items: [{ product: racket._id, status: "delivered", quantity: 1 }] });
  page = await call("GET", "/products/smash-racket", { cookie: buyer.cookie });
  assert.match(page.data, /data-review-open/);
  assert.equal((await call("POST", `/api/products/${racket._id}/reviews`, { body: { ...review, rating: 7 }, cookie: buyer.cookie })).status, 400);
  const posted = await call("POST", `/api/products/${racket._id}/reviews`, { body: { ...review, user: "someone-else", rating: 4 }, cookie: buyer.cookie });
  assert.equal(posted.status, 201);
  assert.equal(posted.data.review.author, "Kiran R.");
  assert.equal((await call("POST", `/api/products/${racket._id}/reviews`, { body: review, cookie: buyer.cookie })).status, 409);

  const stored = await Product.findById(racket._id).lean();
  assert.equal(stored.ratingAverage, 4);
  assert.equal(stored.ratingCount, 1);
  assert.equal(await Review.countDocuments({ product: racket._id }), 1);
  const listed = await call("GET", "/api/products/smash-racket/reviews");
  assert.equal(listed.data.reviews[0].title, "Light and quick");
  assert.deepEqual(listed.data.breakdown.map(row => row.count), [0, 1, 0, 0, 0]);
  assert.equal((await call("GET", "/api/products?rating=4")).data.products[0].slug, "smash-racket");
  const sorted = await call("GET", "/api/products?sort=rating");
  assert.equal(sorted.data.products[0].slug, "smash-racket");
});

test("product page: lightbox, share, delivery check, reviews and related products", async () => {
  await makeProduct({ name: "Trail Socks", slug: "trail-socks", category: "Running", brand: "Nexthlon", price: 399, mrp: 499, stock: 30, image: "/img/favicon.svg" });
  const res = await call("GET", "/products/nexthlon-trail-shoe");
  assert.match(res.data, /data-lightbox-open/);
  assert.match(res.data, /data-share/);
  assert.match(res.data, /data-delivery-check/);
  assert.match(res.data, /id="reviews"/);
  assert.match(res.data, /More Running gear/);
  assert.match(res.data, /href="\/products\/trail-socks"/);
});

test("delivery estimate API checks the PIN code", async () => {
  assert.equal((await call("GET", "/api/delivery/estimate?pincode=12ab56")).status, 400);
  const ok = await call("GET", "/api/delivery/estimate?pincode=110001");
  assert.equal(ok.status, 200);
  assert.equal(ok.data.estimate.zone, "metro");
  assert.match(ok.data.estimate.label, /–/);
});

test("old products in rupees with text categories are upgraded once at start-up", async () => {
  await Product.collection.insertOne({ name: "Old Skipping Rope", slug: "old-skipping-rope", category: "Fitness", brand: "Nexthlon", price: 349, mrp: 499, discountPercent: 30, stock: 3, image: "/img/favicon.svg", isActive: true });
  await runMigrations();
  await runMigrations();
  const rope = await Product.findOne({ slug: "old-skipping-rope" }).populate("category").lean();
  assert.equal(rope.basePrice, 34900);
  assert.equal(rope.price, 34900);
  assert.equal(rope.mrp, 49900);
  assert.equal(rope.isListed, true);
  assert.equal(rope.category.name, "Fitness");
  assert.equal(rope.discountPercent, 30);
});

// ---------- Phase 3: wishlist, save for later and the price summary ----------
const Wishlist = require("../models/Wishlist");

test("wishlist: customers only, guests are sent to sign in and come back", async () => {
  assert.equal((await call("GET", "/api/wishlist")).status, 401);
  assert.equal((await call("GET", "/wishlist")).location, "/login?next=%2Fwishlist");
  const admin = await call("POST", "/api/admin/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } });
  assert.equal((await call("GET", "/api/wishlist", { cookie: admin.cookie })).status, 403);
});

test("wishlist: add, no duplicates, newest first, hidden products refused, remove", async () => {
  const shopper = await call("POST", "/api/signup", { body: { name: "Wish Tester", email: "wish@nexthlon.test", password: "heart2024", confirmPassword: "heart2024" } });
  const cookie = shopper.cookie;
  const socks = await Product.findOne({ slug: "trail-socks" });
  const shoe = await Product.findOne({ slug: "nexthlon-trail-shoe" });
  const hidden = await Product.findOne({ slug: "old-racket" });
  assert.equal((await call("POST", "/api/wishlist", { body: { productId: String(socks._id) }, cookie })).status, 201);
  const second = await call("POST", "/api/wishlist", { body: { productId: String(shoe._id) }, cookie });
  assert.deepEqual(second.data.wishlist.items.map(i => i.slug), ["nexthlon-trail-shoe", "trail-socks"]);
  const again = await call("POST", "/api/wishlist", { body: { productId: String(socks._id) }, cookie });
  assert.deepEqual(again.data.wishlist.items.map(i => i.slug), ["trail-socks", "nexthlon-trail-shoe"]);
  assert.equal((await call("POST", "/api/wishlist", { body: { productId: String(hidden._id) }, cookie })).status, 404);
  assert.equal((await call("POST", "/api/wishlist", { body: { productId: { $ne: null } }, cookie })).status, 400);

  const page = await call("GET", "/products", { cookie });
  assert.match(page.data, /data-wish-count >2</);
  const list = await call("GET", "/wishlist", { cookie });
  assert.match(list.data, /2 saved items/);

  const removed = await call("DELETE", `/api/wishlist/${socks._id}`, { cookie });
  assert.equal(removed.data.wishlist.count, 1);
  assert.equal((await call("DELETE", `/api/wishlist/${socks._id}`, { cookie })).status, 404);
  wishCookie = cookie;
});

let wishCookie;

test("moving to the cart follows every cart rule, and removes the item from the wishlist", async () => {
  const shoe = await Product.findOne({ slug: "nexthlon-trail-shoe" });
  const moved = await call("POST", `/api/wishlist/${shoe._id}/move-to-cart`, { cookie: wishCookie });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.wishlist.count, 0);
  assert.equal(moved.data.cart.items[0].productId, String(shoe._id));
  assert.equal(moved.data.cart.items[0].price, shoe.price);
  assert.equal((await call("POST", `/api/wishlist/${shoe._id}/move-to-cart`, { cookie: wishCookie })).status, 404);

  // Out of stock: the cart says no, so the product stays on the wishlist.
  const soldOut = await Product.findOne({ slug: "sold-out-cap" });
  await Wishlist.updateOne({}, {}, {});
  const user = await User.findOne({ email: "wish@nexthlon.test" });
  await Wishlist.updateOne({ user: user._id }, { $push: { products: soldOut._id } });
  const refused = await call("POST", `/api/wishlist/${soldOut._id}/move-to-cart`, { cookie: wishCookie });
  assert.equal(refused.status, 400);
  assert.match(refused.data.message, /out of stock/);
  assert.equal((await call("GET", "/api/wishlist", { cookie: wishCookie })).data.wishlist.count, 1);
});

test("save for later moves a cart line to the wishlist", async () => {
  const shoe = await Product.findOne({ slug: "nexthlon-trail-shoe" });
  const saved = await call("POST", `/api/cart/items/${shoe._id}/save-for-later`, { cookie: wishCookie });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.cart.items.length, 0);
  assert.equal(saved.data.wishlist.items[0].slug, "nexthlon-trail-shoe");
  assert.equal((await call("POST", `/api/cart/items/${shoe._id}/save-for-later`, { cookie: wishCookie })).status, 404);
});

test("cart summary: M.R.P. total, discount, delivery fee below ₹499 and the grand total", async () => {
  const socks = await Product.findOne({ slug: "trail-socks" });
  const one = await call("POST", "/api/cart/items", { body: { productId: String(socks._id), quantity: 1 }, cookie: wishCookie });
  const summary = one.data.cart.summary;
  assert.equal(summary.subtotal, 39900);
  assert.equal(summary.mrpTotal, 49900);
  assert.equal(summary.savings, 10000);
  assert.equal(summary.deliveryFee, 4000);
  assert.equal(summary.freeDeliveryGap, 10000);
  assert.equal(summary.grandTotal, 43900);
  const two = await call("PATCH", `/api/cart/items/${socks._id}`, { body: { quantity: 2 }, cookie: wishCookie });
  assert.equal(two.data.cart.summary.deliveryFee, 0);
  assert.equal(two.data.cart.summary.grandTotal, 79800);
  const page = await call("GET", "/cart", { cookie: wishCookie });
  assert.match(page.data, /Save for later/);
  assert.match(page.data, /Delivery fee/);
});

// ---------- Phase 4: checkout and Cash on Delivery orders ----------
const Order = require("../models/Order");
const Address = require("../models/Address");
const orderService = require("../services/orderService");

async function newCustomer(name, email) {
  const res = await call("POST", "/api/signup", { body: { name, email, password: "order2024", confirmPassword: "order2024" } });
  const user = await User.findOne({ email });
  const address = await Address.create({ user: user._id, fullName: name, phone: "9876543210", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", isDefault: true });
  return { cookie: res.cookie, user, addressId: String(address._id) };
}

let buyer;
let placed;

test("checkout is for customers with something in the cart", async () => {
  assert.equal((await call("GET", "/checkout")).location, "/login?next=%2Fcheckout");
  buyer = await newCustomer("Order Tester", "orders@nexthlon.test");
  assert.equal((await call("GET", "/checkout", { cookie: buyer.cookie })).location, "/cart");
  assert.equal((await call("POST", "/api/orders", { body: { addressId: buyer.addressId, paymentMethod: "cod" }, cookie: buyer.cookie })).status, 400);
});

test("placing a COD order: server prices, atomic stock, snapshots, cart cleared", async () => {
  const pole = await makeProduct({ name: "Carbon Trek Pole", slug: "carbon-trek-pole", category: "Hiking", brand: "Nexthlon", price: 1200, mrp: 1500, stock: 3, image: "/img/favicon.svg" });
  await call("POST", "/api/cart/items", { body: { productId: String(pole._id), quantity: 2 }, cookie: buyer.cookie });
  const page = await call("GET", "/checkout", { cookie: buyer.cookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /Cash on Delivery/);

  const quote = await call("POST", "/api/checkout/quote", { body: {}, cookie: buyer.cookie });
  assert.equal(quote.data.quote.totals.total, 240000);
  assert.equal(quote.data.quote.codAllowed, true);

  // Someone else's address is refused.
  const other = await newCustomer("Other Person", "other-orders@nexthlon.test");
  assert.equal((await call("POST", "/api/orders", { body: { addressId: other.addressId, paymentMethod: "cod" }, cookie: buyer.cookie })).status, 400);
  assert.equal((await call("POST", "/api/orders", { body: { addressId: buyer.addressId, paymentMethod: "bitcoin" }, cookie: buyer.cookie })).status, 400);

  const res = await call("POST", "/api/orders", { body: { addressId: buyer.addressId, paymentMethod: "cod", total: 1, items: [{ price: 1 }] }, cookie: buyer.cookie });
  assert.equal(res.status, 201);
  placed = res.data.order;
  assert.match(placed.orderId, /^NX-\d{4}-\d{6}$/);
  assert.equal(res.data.redirect, `/orders/${placed.orderId}/success`);
  assert.equal(placed.total, 240000);
  assert.equal(placed.items[0].price, 120000);
  assert.equal(placed.items[0].name, "Carbon Trek Pole");
  assert.equal(placed.address.city, "Bengaluru");
  assert.equal(placed.paymentStatus, "pending");
  assert.equal((await Product.findById(pole._id)).stock, 1);
  assert.equal((await call("GET", "/api/cart", { cookie: buyer.cookie })).data.cart.items.length, 0);

  // The snapshot does not change when the product does.
  await Product.updateOne({ _id: pole._id }, { $set: { name: "Renamed Pole", price: 1, basePrice: 1 } });
  const again = await call("GET", `/api/orders/${placed.orderId}`, { cookie: buyer.cookie });
  assert.equal(again.data.order.items[0].name, "Carbon Trek Pole");
  assert.equal(again.data.order.items[0].price, 120000);
  await Product.updateOne({ _id: pole._id }, { $set: { name: "Carbon Trek Pole", basePrice: 120000, price: 120000 } });
  const success = await call("GET", res.data.redirect, { cookie: buyer.cookie });
  assert.match(success.data, /data-confetti/);
});

test("the last item cannot be sold twice, even when two orders arrive together", async () => {
  const lamp = await makeProduct({ name: "Head Lamp", slug: "head-lamp", category: "Camping", price: 900, mrp: 900, stock: 1, image: "/img/favicon.svg" });
  const a = await newCustomer("Racer One", "race1@nexthlon.test");
  const b = await newCustomer("Racer Two", "race2@nexthlon.test");
  for (const who of [a, b]) await call("POST", "/api/cart/items", { body: { productId: String(lamp._id), quantity: 1 }, cookie: who.cookie });
  const results = await Promise.all([a, b].map(who => call("POST", "/api/orders", { body: { addressId: who.addressId, paymentMethod: "cod" }, cookie: who.cookie })));
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.match(results.find(r => r.status === 409).data.message, /sold out/);
  assert.equal((await Product.findById(lamp._id)).stock, 0);
  assert.equal(await Order.countDocuments({ "items.product": lamp._id }), 1);
});

test("Cash on Delivery only up to ₹5,000, and unavailable items block checkout", async () => {
  const tent = await makeProduct({ name: "Expedition Tent", slug: "expedition-tent", category: "Camping", price: 5200, mrp: 6000, stock: 4, image: "/img/favicon.svg" });
  const big = await newCustomer("Big Spender", "big@nexthlon.test");
  await call("POST", "/api/cart/items", { body: { productId: String(tent._id), quantity: 1 }, cookie: big.cookie });
  const refused = await call("POST", "/api/orders", { body: { addressId: big.addressId, paymentMethod: "cod" }, cookie: big.cookie });
  assert.equal(refused.status, 400);
  assert.match(refused.data.message, /up to ₹5,000/);
  assert.equal((await Product.findById(tent._id)).stock, 4);

  await call("DELETE", "/api/cart", { cookie: big.cookie });
  const socks = await Product.findOne({ slug: "trail-socks" });
  await call("POST", "/api/cart/items", { body: { productId: String(socks._id), quantity: 1 }, cookie: big.cookie });
  await Product.updateOne({ _id: socks._id }, { $set: { isListed: false } });
  const blocked = await call("POST", "/api/orders", { body: { addressId: big.addressId, paymentMethod: "cod" }, cookie: big.cookie });
  assert.equal(blocked.status, 409);
  await Product.updateOne({ _id: socks._id }, { $set: { isListed: true } });
});

test("orders belong to their customer: lists, details, pages and invoices", async () => {
  const other = await call("POST", "/api/login", { body: { email: "other-orders@nexthlon.test", password: "order2024" } });
  assert.equal((await call("GET", `/api/orders/${placed.orderId}`, { cookie: other.cookie })).status, 404);
  assert.equal((await call("GET", `/orders/${placed.orderId}`, { cookie: other.cookie })).status, 404);
  assert.equal((await call("GET", `/orders/${placed.orderId}/invoice`, { cookie: other.cookie })).status, 404);
  assert.equal((await call("GET", "/api/orders", { cookie: other.cookie })).data.orders.length, 0);

  const mine = await call("GET", "/api/orders?status=active", { cookie: buyer.cookie });
  assert.equal(mine.data.orders.length, 1);
  assert.equal((await call("GET", "/api/orders?status=delivered", { cookie: buyer.cookie })).data.orders.length, 0);
  assert.equal((await call("GET", "/api/orders?q=trek", { cookie: buyer.cookie })).data.orders.length, 1);
  const list = await call("GET", "/orders", { cookie: buyer.cookie });
  assert.match(list.data, new RegExp(placed.orderId));
  const detail = await call("GET", `/orders/${placed.orderId}`, { cookie: buyer.cookie });
  assert.match(detail.data, /class="timeline"/);
  assert.match(detail.data, /Cancel order/);

  const pdf = await fetch(`${base}/orders/${placed.orderId}/invoice`, { headers: { Cookie: buyer.cookie } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /INV-\d{4}-\d{6}\.pdf/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
});

test("cancelling one item, then the rest, puts the stock back", async () => {
  const bottle = await makeProduct({ name: "Steel Bottle", slug: "steel-bottle", category: "Outdoor", price: 600, mrp: 800, stock: 10, image: "/img/favicon.svg" });
  const pole = await Product.findOne({ slug: "carbon-trek-pole" });
  await Product.updateOne({ _id: pole._id }, { $set: { stock: 5 } });
  await call("POST", "/api/cart/items", { body: { productId: String(bottle._id), quantity: 2 }, cookie: buyer.cookie });
  await call("POST", "/api/cart/items", { body: { productId: String(pole._id), quantity: 1 }, cookie: buyer.cookie });
  const res = await call("POST", "/api/orders", { body: { addressId: buyer.addressId, paymentMethod: "cod" }, cookie: buyer.cookie });
  const order = res.data.order;
  assert.equal((await Product.findById(bottle._id)).stock, 8);

  const bottleLine = order.items.find(i => i.name === "Steel Bottle");
  const one = await call("POST", `/api/orders/${order.orderId}/items/${bottleLine.id}/cancel`, { body: { reason: "Ordered by mistake" }, cookie: buyer.cookie });
  assert.equal(one.status, 200);
  assert.equal(one.data.order.status, "placed");
  assert.equal(one.data.order.items.find(i => i.id === bottleLine.id).status, "cancelled");
  assert.equal((await Product.findById(bottle._id)).stock, 10);
  assert.equal((await call("POST", `/api/orders/${order.orderId}/items/${bottleLine.id}/cancel`, { body: {}, cookie: buyer.cookie })).status, 400);

  const all = await call("POST", `/api/orders/${order.orderId}/cancel`, { body: {}, cookie: buyer.cookie });
  assert.equal(all.data.order.status, "cancelled");
  assert.equal((await Product.findById(pole._id)).stock, 5);
  assert.equal((await call("POST", `/api/orders/${order.orderId}/cancel`, { body: {}, cookie: buyer.cookie })).status, 400);
});

test("statuses move forward only; delivery marks COD paid and opens returns", async () => {
  const order = await Order.findOne({ orderId: placed.orderId });
  await orderService.advanceStatus(order, "shipped");
  assert.equal((await call("POST", `/api/orders/${placed.orderId}/cancel`, { body: {}, cookie: buyer.cookie })).status, 400);
  await assert.rejects(orderService.advanceStatus(order, "confirmed"), /cannot move/);
  assert.equal((await call("POST", `/api/orders/${placed.orderId}/return`, { body: { reason: "Wrong size or fit" }, cookie: buyer.cookie })).status, 400);

  await orderService.advanceStatus(order, "delivered");
  const delivered = await Order.findOne({ orderId: placed.orderId }).lean();
  assert.equal(delivered.paymentStatus, "paid");
  assert.ok(delivered.deliveredAt);
  assert.deepEqual(delivered.statusHistory.map(h => h.status), ["placed", "shipped", "delivered"]);

  assert.equal((await call("POST", `/api/orders/${placed.orderId}/return`, { body: { reason: "Because" }, cookie: buyer.cookie })).status, 400);
  const ret = await call("POST", `/api/orders/${placed.orderId}/return`, { body: { reason: "Wrong size or fit", note: "Too long" }, cookie: buyer.cookie });
  assert.equal(ret.status, 200);
  assert.equal(ret.data.order.status, "return_requested");
  assert.equal((await call("POST", `/api/orders/${placed.orderId}/return`, { body: { reason: "Wrong size or fit" }, cookie: buyer.cookie })).status, 400);
});

// ---------- Phase 5: Razorpay online payment (with a fake Razorpay client) ----------
const crypto = require("crypto");
const razorpayService = require("../services/razorpayService");

const razorpayCalls = { orders: [], refunds: [] };
razorpayService.setClient({
  orders: {
    create: async params => {
      razorpayCalls.orders.push(params);
      return { id: `order_TEST${String(razorpayCalls.orders.length).padStart(6, "0")}`, amount: params.amount, currency: params.currency };
    }
  },
  payments: {
    refund: async (paymentId, params) => {
      razorpayCalls.refunds.push({ paymentId, ...params });
      return { id: `rfnd_TEST${razorpayCalls.refunds.length}`, status: "pending", amount: params.amount };
    }
  }
});
const checkoutSignature = (orderId, paymentId) => crypto.createHmac("sha256", "test-key-secret").update(`${orderId}|${paymentId}`).digest("hex");
async function sendWebhook(event, { signature } = {}) {
  const raw = JSON.stringify(event);
  const sig = signature || crypto.createHmac("sha256", "test-webhook-secret").update(raw).digest("hex");
  const response = await fetch(`${base}/api/payments/razorpay/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Razorpay-Signature": sig }, body: raw });
  return response.status;
}

let payer;
let racket;

test("CSP allows only what Razorpay Checkout needs", async () => {
  const response = await fetch(`${base}/`);
  const csp = response.headers.get("content-security-policy");
  assert.match(csp, /script-src 'self' https:\/\/checkout\.razorpay\.com;/);
  assert.match(csp, /frame-src https:\/\/api\.razorpay\.com https:\/\/checkout\.razorpay\.com;/);
  assert.match(csp, /connect-src 'self' https:\/\/api\.razorpay\.com https:\/\/lumberjack\.razorpay\.com(;|$)/);
});

test("creating a payment: server prices, a pending order, and only four fields for the browser", async () => {
  payer = await newCustomer("Online Payer", "payer@nexthlon.test");
  racket = await makeProduct({ name: "Pro Racket", slug: "pro-racket", category: "Tennis", price: 4500, mrp: 6000, stock: 3, image: "/img/favicon.svg" });
  await call("POST", "/api/cart/items", { body: { productId: String(racket._id), quantity: 2 }, cookie: payer.cookie });
  assert.equal((await call("POST", "/api/payments/razorpay/order", { body: { addressId: payer.addressId } })).status, 401);

  const res = await call("POST", "/api/payments/razorpay/order", { body: { addressId: payer.addressId, amount: 100 }, cookie: payer.cookie });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(res.data).sort(), ["amount", "currency", "key_id", "razorpay_order_id"]);
  assert.equal(res.data.amount, 900000);
  assert.equal(res.data.currency, "INR");
  assert.equal(res.data.key_id, "rzp_test_dummykey");
  assert.doesNotMatch(JSON.stringify(res.data), /test-key-secret/);
  const sent = razorpayCalls.orders[razorpayCalls.orders.length - 1];
  assert.equal(sent.amount, 900000);
  assert.match(sent.receipt, /^NX-\d{4}-\d{6}$/);

  const order = await Order.findOne({ "razorpay.orderId": res.data.razorpay_order_id }).lean();
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.stockReserved, false);
  // Nothing is taken until the payment succeeds, and the cart is kept.
  assert.equal((await Product.findById(racket._id)).stock, 3);
  assert.equal((await call("GET", "/api/cart", { cookie: payer.cookie })).data.cart.items.length, 1);
  payer.razorpayOrderId = res.data.razorpay_order_id;
  payer.orderId = order.orderId;
});

test("verify: a wrong signature changes nothing; a good one pays, takes stock and clears the cart, once", async () => {
  const body = { razorpay_order_id: payer.razorpayOrderId, razorpay_payment_id: "pay_TESTGOOD01", razorpay_signature: "a".repeat(64) };
  const bad = await call("POST", "/api/payments/razorpay/verify", { body, cookie: payer.cookie });
  assert.equal(bad.status, 400);
  assert.equal((await Order.findOne({ orderId: payer.orderId })).paymentStatus, "pending");

  // Someone else cannot confirm this order, even with a valid signature.
  const other = await call("POST", "/api/login", { body: { email: "other-orders@nexthlon.test", password: "order2024" } });
  body.razorpay_signature = checkoutSignature(payer.razorpayOrderId, "pay_TESTGOOD01");
  assert.equal((await call("POST", "/api/payments/razorpay/verify", { body, cookie: other.cookie })).status, 404);

  const good = await call("POST", "/api/payments/razorpay/verify", { body, cookie: payer.cookie });
  assert.equal(good.status, 200);
  assert.equal(good.data.paid, true);
  assert.equal(good.data.redirect, `/orders/${payer.orderId}/success`);
  assert.equal((await Product.findById(racket._id)).stock, 1);
  assert.equal((await call("GET", "/api/cart", { cookie: payer.cookie })).data.cart.items.length, 0);

  // The same proof again, and the webhook for the same payment: no second stock change.
  assert.equal((await call("POST", "/api/payments/razorpay/verify", { body, cookie: payer.cookie })).status, 200);
  assert.equal(await sendWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_TESTGOOD01", order_id: payer.razorpayOrderId, amount: 900000 } } } }), 200);
  assert.equal((await Product.findById(racket._id)).stock, 1);
  const order = await Order.findOne({ orderId: payer.orderId }).lean();
  assert.equal(order.paymentStatus, "paid");
  assert.equal(order.razorpay.paymentId, "pay_TESTGOOD01");
  assert.equal(order.statusHistory.filter(h => h.status === "payment_received").length, 1);
});

test("webhook: the backup when the browser never comes back, with signature and amount checks", async () => {
  await Product.updateOne({ _id: racket._id }, { $set: { stock: 3 } });
  await call("POST", "/api/cart/items", { body: { productId: String(racket._id), quantity: 1 }, cookie: payer.cookie });
  const created = await call("POST", "/api/payments/razorpay/order", { body: { addressId: payer.addressId }, cookie: payer.cookie });
  const event = { event: "payment.captured", payload: { payment: { entity: { id: "pay_TESTHOOK01", order_id: created.data.razorpay_order_id, amount: 450000 } } } };

  assert.equal(await sendWebhook(event, { signature: "b".repeat(64) }), 400);
  assert.equal(await sendWebhook({ ...event, payload: { payment: { entity: { ...event.payload.payment.entity, amount: 1 } } } }), 200);
  assert.equal((await Order.findOne({ "razorpay.orderId": created.data.razorpay_order_id })).paymentStatus, "pending");

  assert.equal(await sendWebhook(event), 200);
  assert.equal(await sendWebhook(event), 200);
  assert.equal((await Order.findOne({ "razorpay.orderId": created.data.razorpay_order_id })).paymentStatus, "paid");
  assert.equal((await Product.findById(racket._id)).stock, 2);
  assert.equal(await sendWebhook({ event: "order.paid", payload: {} }), 200);
});

test("a closed or failed payment keeps the cart, and the order offers Retry payment", async () => {
  await call("POST", "/api/cart/items", { body: { productId: String(racket._id), quantity: 1 }, cookie: payer.cookie });
  const created = await call("POST", "/api/payments/razorpay/order", { body: { addressId: payer.addressId }, cookie: payer.cookie });
  const failed = await call("POST", "/api/payments/razorpay/failed", { body: { razorpay_order_id: created.data.razorpay_order_id, reason: "Closed the payment window" }, cookie: payer.cookie });
  assert.equal(failed.status, 200);
  const order = await Order.findOne({ "razorpay.orderId": created.data.razorpay_order_id }).lean();
  assert.equal(order.paymentStatus, "failed");
  assert.equal(failed.data.redirect, `/orders/${order.orderId}`);
  assert.equal((await call("GET", "/api/cart", { cookie: payer.cookie })).data.cart.items.length, 1);
  const page = await call("GET", `/orders/${order.orderId}`, { cookie: payer.cookie });
  assert.match(page.data, /data-retry-payment/);
  assert.match(page.data, /checkout\.razorpay\.com\/v1\/checkout\.js/);

  const retry = await call("POST", `/api/payments/razorpay/retry/${order.orderId}`, { body: {}, cookie: payer.cookie });
  assert.equal(retry.status, 200);
  assert.notEqual(retry.data.razorpay_order_id, created.data.razorpay_order_id);
  assert.equal(retry.data.amount, order.total);

  // A late webhook saying the first attempt failed does not touch a paid order.
  const pid = "pay_TESTRETRY1";
  await call("POST", "/api/payments/razorpay/verify", { body: { razorpay_order_id: retry.data.razorpay_order_id, razorpay_payment_id: pid, razorpay_signature: checkoutSignature(retry.data.razorpay_order_id, pid) }, cookie: payer.cookie });
  assert.equal(await sendWebhook({ event: "payment.failed", payload: { payment: { entity: { id: "pay_X", order_id: retry.data.razorpay_order_id, error_description: "Bank declined" } } } }), 200);
  assert.equal((await Order.findOne({ orderId: order.orderId })).paymentStatus, "paid");
  assert.equal((await call("POST", `/api/payments/razorpay/retry/${order.orderId}`, { body: {}, cookie: payer.cookie })).status, 400);
});

test("cancelling a paid order refunds to the original method through Razorpay, and puts stock back", async () => {
  const before = (await Product.findById(racket._id)).stock;
  const cancel = await call("POST", `/api/orders/${payer.orderId}/cancel`, { body: { reason: "Ordered by mistake", refundMethod: "original" }, cookie: payer.cookie });
  assert.equal(cancel.status, 200);
  const refund = razorpayCalls.refunds[razorpayCalls.refunds.length - 1];
  assert.equal(refund.paymentId, "pay_TESTGOOD01");
  assert.equal(refund.amount, 900000);
  const order = await Order.findOne({ orderId: payer.orderId }).lean();
  assert.equal(order.refundedAmount, 900000);
  assert.equal(order.paymentStatus, "refunded");
  assert.equal(order.refunds[0].method, "original");
  assert.equal(order.refunds[0].status, "pending");
  assert.equal((await Product.findById(racket._id)).stock, before + 2);

  assert.equal(await sendWebhook({ event: "refund.processed", payload: { refund: { entity: { id: refund.id || "rfnd_TEST1", payment_id: "pay_TESTGOOD01", amount: 900000 } } } }), 200);
  assert.equal((await Order.findOne({ orderId: payer.orderId }).lean()).refunds[0].status, "processed");
});

test("a payment gateway error gives a clear message and leaves no stray order", async () => {
  const fake = { orders: { create: async () => { const error = new Error("auth"); error.statusCode = 401; throw error; } }, payments: { refund: async () => ({}) } };
  razorpayService.setClient(fake);
  const before = await Order.countDocuments({ user: payer.user._id });
  await call("POST", "/api/cart/items", { body: { productId: String(racket._id), quantity: 1 }, cookie: payer.cookie });
  const res = await call("POST", "/api/payments/razorpay/order", { body: { addressId: payer.addressId }, cookie: payer.cookie });
  assert.equal(res.status, 502);
  assert.match(res.data.message, /Cash on Delivery/);
  assert.equal(await Order.countDocuments({ user: payer.user._id }), before);
});


// ---------- Phase 6: wallet, coupons and referrals ----------
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const walletService = require("../services/walletService");
const referralService = require("../services/referralService");

const balanceOf = async user => walletService.getBalance(user._id);
async function adminCookie() {
  return (await call("POST", "/api/admin/login", { body: { email: "admin@nexthlon.test", password: "AdminPass123" } })).cookie;
}
async function emptyCart(customer) {
  await Cart.updateOne({ user: customer.user._id }, { $set: { items: [], couponCode: "" } });
}

test("referrals: a code for everyone, both wallets credited once, bad codes refused, reward set by the admin", async () => {
  const inviter = await newCustomer("Riya Kapoor", "riya.ref@nexthlon.test");
  const wallet = await call("GET", "/api/wallet", { cookie: inviter.cookie });
  assert.equal(wallet.status, 200);
  const code = wallet.data.referral.code;
  assert.match(code, /^RIYA[A-Z2-9]{4}$/);
  assert.match(wallet.data.referral.link, new RegExp(`/signup\\?ref=${code}$`));
  assert.equal(wallet.data.balance, 0);

  const bad = await call("POST", "/api/signup", { body: { name: "Nope", email: "nope-ref@nexthlon.test", password: "order2024", referralCode: "ZZZZZZZZ" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.referralCode);
  assert.equal(await User.countDocuments({ email: "nope-ref@nexthlon.test" }), 0);

  // The sign-up page fills the code in from the invite link.
  assert.match((await call("GET", `/signup?ref=${code.toLowerCase()}`)).data, new RegExp(`value="${code}"`));

  const joined = await call("POST", "/api/signup", { body: { name: "Kabir Rao", email: "kabir.ref@nexthlon.test", password: "order2024", referralCode: code.toLowerCase() } });
  assert.equal(joined.status, 201);
  assert.match(joined.data.message, /₹100 has been added to your wallet/);
  const kabir = await User.findOne({ email: "kabir.ref@nexthlon.test" });
  assert.equal(String(kabir.referredBy), String(inviter.user._id));
  assert.equal(await balanceOf(kabir), 10000);
  assert.equal(await balanceOf(inviter.user), 10000);

  // Running the reward again (a retry, a double click) never pays twice.
  await referralService.rewardSignup(kabir, inviter.user);
  assert.equal(await balanceOf(kabir), 10000);
  assert.equal(await balanceOf(inviter.user), 10000);
  const history = await call("GET", "/api/wallet", { cookie: inviter.cookie });
  assert.equal(history.data.transactions.length, 1);
  assert.equal(history.data.transactions[0].kind, "referral");
  assert.equal(history.data.transactions[0].balanceAfter, 10000);
  assert.equal(history.data.referral.joined, 1);

  // Only admins change the reward.
  assert.equal((await call("PATCH", "/api/admin/settings/referral", { body: { referralReward: 50 }, cookie: inviter.cookie })).status, 403);
  const admin = await adminCookie();
  assert.equal((await call("PATCH", "/api/admin/settings/referral", { body: { referralReward: 5000 }, cookie: admin })).status, 400);
  const saved = await call("PATCH", "/api/admin/settings/referral", { body: { referralReward: "50" }, cookie: admin });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.referralReward, 5000);
  const meera = await call("POST", "/api/signup", { body: { name: "Meera Iyer", email: "meera.ref@nexthlon.test", password: "order2024", referralCode: code } });
  assert.equal(meera.status, 201, JSON.stringify(meera.data));
  assert.equal(await balanceOf(inviter.user), 15000);
  assert.equal(await balanceOf(await User.findOne({ email: "meera.ref@nexthlon.test" })), 5000);
  // 0 turns rewards off.
  await call("PATCH", "/api/admin/settings/referral", { body: { referralReward: 0 }, cookie: admin });
  await call("POST", "/api/signup", { body: { name: "Dev Shah", email: "dev.ref@nexthlon.test", password: "order2024", referralCode: code } });
  assert.equal(await balanceOf(inviter.user), 15000);
  await call("PATCH", "/api/admin/settings/referral", { body: { referralReward: 100 }, cookie: admin });

  // The wallet page renders the balance, the code and the history, with an empty state for filters.
  const page = await call("GET", "/wallet", { cookie: inviter.cookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /₹150/);
  assert.match(page.data, new RegExp(code));
  assert.match((await call("GET", "/wallet?type=debit", { cookie: inviter.cookie })).data, /Nothing here yet/);
  assert.equal((await call("GET", "/wallet")).location, "/login?next=%2Fwallet");
});

let shopper;
let ball;

test("coupons: server checks, listing, applying, and the discount in the order", async () => {
  shopper = await newCustomer("Coupon Shopper", "coupons@nexthlon.test");
  ball = await makeProduct({ name: "Match Ball", slug: "match-ball", category: "Football", price: 1500, mrp: 2000, stock: 10, image: "/img/favicon.svg" });
  const day = 24 * 60 * 60 * 1000;
  await Coupon.create([
    { code: "SAVE10", type: "percent", value: 10, maxDiscount: 10000, minOrder: 100000, perUserLimit: 1, endsAt: new Date(Date.now() + day) },
    { code: "BIGSPEND", type: "flat", value: 50000, minOrder: 1000000 },
    { code: "OLDONE", type: "flat", value: 10000, endsAt: new Date(Date.now() - day) },
    { code: "LATER", type: "flat", value: 10000, startsAt: new Date(Date.now() + day) },
    { code: "SLEEPY", type: "flat", value: 10000, isActive: false }
  ]);
  await call("POST", "/api/cart/items", { body: { productId: String(ball._id), quantity: 1 }, cookie: shopper.cookie });

  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "SAVE10" } })).status, 401);
  const bad = await call("POST", "/api/checkout/coupon", { body: { code: "no way!" }, cookie: shopper.cookie });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.code);
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "NOSUCH" }, cookie: shopper.cookie })).data.message, /not valid/);
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "OLDONE" }, cookie: shopper.cookie })).data.message, /expired/);
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "LATER" }, cookie: shopper.cookie })).data.message, /not active yet/);
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "SLEEPY" }, cookie: shopper.cookie })).data.message, /not valid/);
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "BIGSPEND" }, cookie: shopper.cookie })).data.message, /Add items worth ₹8,500 more/);

  const listed = await call("GET", "/api/coupons", { cookie: shopper.cookie });
  const codes = listed.data.coupons.map(coupon => coupon.code);
  assert.deepEqual(codes.filter(c => ["SAVE10", "BIGSPEND"].includes(c)), ["SAVE10", "BIGSPEND"]);
  assert.ok(!codes.includes("OLDONE") && !codes.includes("LATER") && !codes.includes("SLEEPY"));
  const save10 = listed.data.coupons.find(coupon => coupon.code === "SAVE10");
  assert.equal(save10.eligible, true);
  assert.equal(save10.saving, 10000);
  assert.equal(listed.data.coupons.find(coupon => coupon.code === "BIGSPEND").eligible, false);

  const applied = await call("POST", "/api/checkout/coupon", { body: { code: " save10 " }, cookie: shopper.cookie });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.coupon.code, "SAVE10");
  const quote = (await call("POST", "/api/checkout/quote", { body: {}, cookie: shopper.cookie })).data.quote;
  assert.equal(quote.totals.couponDiscount, 10000);
  assert.equal(quote.totals.couponCode, "SAVE10");
  assert.equal(quote.totals.total, 140000);
  assert.match((await call("GET", "/checkout", { cookie: shopper.cookie })).data, /SAVE10/);

  // Whatever the browser claims, the discount comes from the coupon in the database.
  const res = await call("POST", "/api/orders", { body: { addressId: shopper.addressId, paymentMethod: "cod", couponDiscount: 999999, total: 1 }, cookie: shopper.cookie });
  assert.equal(res.status, 201);
  assert.equal(res.data.order.couponCode, "SAVE10");
  assert.equal(res.data.order.couponDiscount, 10000);
  assert.equal(res.data.order.total, 140000);
  shopper.orderId = res.data.order.orderId;
  assert.equal((await Coupon.findOne({ code: "SAVE10" })).usedCount, 1);
  assert.equal(await CouponRedemption.countDocuments({ code: "SAVE10", user: shopper.user._id }), 1);
  assert.equal((await Cart.findOne({ user: shopper.user._id })).couponCode, "");
});

test("coupons: once per customer, a removed coupon stops counting, cancelling gives the use back", async () => {
  await call("POST", "/api/cart/items", { body: { productId: String(ball._id), quantity: 1 }, cookie: shopper.cookie });
  assert.match((await call("POST", "/api/checkout/coupon", { body: { code: "SAVE10" }, cookie: shopper.cookie })).data.message, /already used/);
  assert.ok(!(await call("GET", "/api/coupons", { cookie: shopper.cookie })).data.coupons.some(coupon => coupon.code === "SAVE10"));

  const cancel = await call("POST", `/api/orders/${shopper.orderId}/cancel`, { body: { reason: "Ordered by mistake" }, cookie: shopper.cookie });
  assert.equal(cancel.status, 200);
  assert.equal((await Coupon.findOne({ code: "SAVE10" })).usedCount, 0);
  assert.equal(await CouponRedemption.countDocuments({ code: "SAVE10" }), 0);

  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "SAVE10" }, cookie: shopper.cookie })).status, 200);
  assert.equal((await call("DELETE", "/api/checkout/coupon", { cookie: shopper.cookie })).status, 200);
  assert.equal((await call("POST", "/api/checkout/quote", { body: {}, cookie: shopper.cookie })).data.quote.totals.couponDiscount, 0);
  await emptyCart(shopper);
});

test("coupons: the total limit is claimed atomically, and an order that loses the race changes nothing", async () => {
  await Coupon.create({ code: "ONLYONE", type: "flat", value: 20000, usageLimit: 1, perUserLimit: 0 });
  const rival = await newCustomer("Coupon Rival", "rival@nexthlon.test");
  for (const customer of [shopper, rival]) {
    await call("POST", "/api/cart/items", { body: { productId: String(ball._id), quantity: 1 }, cookie: customer.cookie });
    assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "ONLYONE" }, cookie: customer.cookie })).status, 200);
  }
  const stockBefore = (await Product.findById(ball._id)).stock;
  const ordersBefore = await Order.countDocuments({ user: shopper.user._id });
  assert.equal((await call("POST", "/api/orders", { body: { addressId: rival.addressId, paymentMethod: "cod" }, cookie: rival.cookie })).status, 201);
  const lost = await call("POST", "/api/orders", { body: { addressId: shopper.addressId, paymentMethod: "cod" }, cookie: shopper.cookie });
  assert.equal(lost.status, 409);
  assert.match(lost.data.message, /ONLYONE/);
  assert.equal((await Product.findById(ball._id)).stock, stockBefore - 1);
  assert.equal(await Order.countDocuments({ user: shopper.user._id }), ordersBefore);
  assert.equal((await Coupon.findOne({ code: "ONLYONE" })).usedCount, 1);
  await emptyCart(shopper);
});

let saver;
let shoe;

test("wallet: pay for the whole order from the wallet", async () => {
  saver = await newCustomer("Wallet Saver", "wallet@nexthlon.test");
  shoe = await makeProduct({ name: "Court Shoe", slug: "court-shoe", category: "Tennis", price: 1200, mrp: 1500, stock: 6, image: "/img/favicon.svg" });
  await walletService.credit(saver.user._id, 200000, { kind: "admin", reason: "Test credit" });
  await call("POST", "/api/cart/items", { body: { productId: String(shoe._id), quantity: 1 }, cookie: saver.cookie });

  const without = (await call("POST", "/api/checkout/quote", { body: {}, cookie: saver.cookie })).data.quote;
  assert.equal(without.walletBalance, 200000);
  assert.equal(without.totals.walletUsed, 0);
  const withWallet = (await call("POST", "/api/checkout/quote", { body: { useWallet: true }, cookie: saver.cookie })).data.quote;
  assert.equal(withWallet.totals.walletUsed, 120000);
  assert.equal(withWallet.totals.total, 0);
  assert.equal(withWallet.coveredByWallet, true);
  assert.equal(withWallet.codAllowed, false);

  // "wallet" is refused when the wallet is not used; nothing changes.
  assert.equal((await call("POST", "/api/orders", { body: { addressId: saver.addressId, paymentMethod: "wallet" }, cookie: saver.cookie })).status, 400);
  assert.equal(await balanceOf(saver.user), 200000);

  const res = await call("POST", "/api/orders", { body: { addressId: saver.addressId, paymentMethod: "cod", useWallet: true }, cookie: saver.cookie });
  assert.equal(res.status, 201);
  assert.equal(res.data.order.paymentMethod, "wallet");
  assert.equal(res.data.order.paymentStatus, "paid");
  assert.equal(res.data.order.walletUsed, 120000);
  assert.equal(res.data.order.total, 0);
  saver.walletOrder = res.data.order.orderId;
  assert.equal(await balanceOf(saver.user), 80000);
  assert.equal((await Product.findById(shoe._id)).stock, 5);
  const debit = await WalletTransaction.findOne({ user: saver.user._id, type: "debit" }).lean();
  assert.equal(debit.amount, 120000);
  assert.equal(debit.orderId, saver.walletOrder);
  assert.equal(debit.balanceAfter, 80000);
});

test("wallet: part paid from the wallet, the rest on delivery; cancelling gives the wallet part back", async () => {
  await call("POST", "/api/cart/items", { body: { productId: String(shoe._id), quantity: 1 }, cookie: saver.cookie });
  const res = await call("POST", "/api/orders", { body: { addressId: saver.addressId, paymentMethod: "cod", useWallet: true }, cookie: saver.cookie });
  assert.equal(res.status, 201);
  assert.equal(res.data.order.paymentMethod, "cod");
  assert.equal(res.data.order.walletUsed, 80000);
  assert.equal(res.data.order.total, 40000);
  assert.equal(await balanceOf(saver.user), 0);

  const cancel = await call("POST", `/api/orders/${res.data.order.orderId}/cancel`, { body: { refundMethod: "original" }, cookie: saver.cookie });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.order.total, 0);
  assert.equal(cancel.data.order.refundedAmount, 80000);
  assert.equal(cancel.data.order.paymentStatus, "refunded");
  assert.equal(await balanceOf(saver.user), 80000);
  const refund = await WalletTransaction.findOne({ user: saver.user._id, kind: "refund" }).lean();
  assert.equal(refund.orderId, res.data.order.orderId);

  // Cancelling the fully wallet-paid order refunds it to the wallet too.
  await call("POST", `/api/orders/${saver.walletOrder}/cancel`, { body: {}, cookie: saver.cookie });
  assert.equal(await balanceOf(saver.user), 200000);
  const page = await call("GET", "/api/wallet?type=credit", { cookie: saver.cookie });
  assert.equal(page.data.transactions.length, 3);
  assert.equal(page.data.totals.debited, 200000);
});

test("wallet: the balance can never go below zero, even with two debits at once", async () => {
  const before = await balanceOf(saver.user);
  const results = await Promise.allSettled([
    walletService.debit(saver.user._id, 150000, { reason: "Test A" }),
    walletService.debit(saver.user._id, 150000, { reason: "Test B" })
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  assert.equal(await balanceOf(saver.user), before - 150000);
  assert.ok((await Wallet.findOne({ user: saver.user._id })).balance >= 0);
  await walletService.credit(saver.user._id, 150000, { kind: "admin", reason: "Test top-up" });
  await emptyCart(saver);
});

test("wallet with Razorpay: the wallet pays part, Razorpay the rest; refunds split by how it was paid", async () => {
  razorpayService.setClient({
    orders: { create: async params => ({ id: `order_MIX${String(Date.now()).slice(-8)}`, amount: params.amount, currency: "INR" }) },
    payments: { refund: async (paymentId, params) => ({ id: `rfnd_MIX${params.amount}`, status: "processed", amount: params.amount }) }
  });
  const mixer = await newCustomer("Mixed Payer", "mixed@nexthlon.test");
  const bat = await makeProduct({ name: "Willow Bat", slug: "willow-bat", category: "Cricket", price: 3000, mrp: 3500, stock: 4, image: "/img/favicon.svg" });
  await walletService.credit(mixer.user._id, 100000, { kind: "admin", reason: "Test credit" });
  await call("POST", "/api/cart/items", { body: { productId: String(bat._id), quantity: 1 }, cookie: mixer.cookie });

  const created = await call("POST", "/api/payments/razorpay/order", { body: { addressId: mixer.addressId, useWallet: true }, cookie: mixer.cookie });
  assert.equal(created.status, 201);
  assert.equal(created.data.amount, 200000);
  assert.equal(await balanceOf(mixer.user), 0);
  const order = await Order.findOne({ "razorpay.orderId": created.data.razorpay_order_id }).lean();
  assert.equal(order.walletUsed, 100000);
  assert.equal(order.total, 200000);

  const ids = { razorpay_order_id: created.data.razorpay_order_id, razorpay_payment_id: "pay_MIXPAID001" };
  const verified = await call("POST", "/api/payments/razorpay/verify", { body: { ...ids, razorpay_signature: checkoutSignature(ids.razorpay_order_id, ids.razorpay_payment_id) }, cookie: mixer.cookie });
  assert.equal(verified.status, 200);
  assert.equal((await Product.findById(bat._id)).stock, 3);

  // "Original method" sends back only the ₹2,000 paid online; the ₹1,000 from the wallet goes to the wallet.
  await call("POST", `/api/orders/${order.orderId}/cancel`, { body: { refundMethod: "original" }, cookie: mixer.cookie });
  const cancelled = await Order.findById(order._id).lean();
  assert.deepEqual(cancelled.refunds.map(refund => [refund.method, refund.amount]), [["original", 200000], ["wallet", 100000]]);
  assert.equal(cancelled.paymentStatus, "refunded");
  assert.equal(await balanceOf(mixer.user), 100000);
});

test("wallet with Razorpay: a gateway error puts the wallet amount and the coupon use back", async () => {
  const mixer = { user: await User.findOne({ email: "mixed@nexthlon.test" }) };
  mixer.cookie = (await call("POST", "/api/login", { body: { email: "mixed@nexthlon.test", password: "order2024" } })).cookie;
  mixer.addressId = String((await Address.findOne({ user: mixer.user._id }))._id);
  await Coupon.create({ code: "GATEWAY", type: "flat", value: 10000, perUserLimit: 1 });
  const bat = await Product.findOne({ slug: "willow-bat" });
  await call("POST", "/api/cart/items", { body: { productId: String(bat._id), quantity: 1 }, cookie: mixer.cookie });
  await call("POST", "/api/checkout/coupon", { body: { code: "GATEWAY" }, cookie: mixer.cookie });
  razorpayService.setClient({ orders: { create: async () => { throw Object.assign(new Error("down"), { statusCode: 500 }); } }, payments: { refund: async () => ({}) } });

  const ordersBefore = await Order.countDocuments({ user: mixer.user._id });
  const res = await call("POST", "/api/payments/razorpay/order", { body: { addressId: mixer.addressId, useWallet: true }, cookie: mixer.cookie });
  assert.equal(res.status, 502);
  assert.equal(await balanceOf(mixer.user), 100000);
  assert.equal(await Order.countDocuments({ user: mixer.user._id }), ordersBefore);
  assert.equal((await Coupon.findOne({ code: "GATEWAY" })).usedCount, 0);
  assert.equal(await CouponRedemption.countDocuments({ code: "GATEWAY" }), 0);
  // The coupon stays chosen on the cart for the next try.
  assert.equal((await Cart.findOne({ user: mixer.user._id })).couponCode, "GATEWAY");
});


// ---------- Embedded payment experience: status polling, late payments ----------
test("payment status: only the owner can poll it, and it follows the order", async () => {
  razorpayService.setClient({
    orders: { create: async params => ({ id: `order_POLL${String(Date.now()).slice(-8)}`, amount: params.amount, currency: "INR" }) },
    payments: { refund: async (paymentId, params) => ({ id: `rfnd_POLL${params.amount}`, status: "processed", amount: params.amount }) }
  });
  const poller = await newCustomer("Status Poller", "poller@nexthlon.test");
  const kit = await makeProduct({ name: "Goal Keeper Gloves", slug: "goal-keeper-gloves", category: "Football", price: 900, mrp: 1200, stock: 5, image: "/img/favicon.svg" });
  await call("POST", "/api/cart/items", { body: { productId: String(kit._id), quantity: 1 }, cookie: poller.cookie });
  const created = await call("POST", "/api/payments/razorpay/order", { body: { addressId: poller.addressId }, cookie: poller.cookie });
  const rzpId = created.data.razorpay_order_id;

  const pending = await call("GET", `/api/payments/razorpay/status/${rzpId}`, { cookie: poller.cookie });
  assert.equal(pending.status, 200);
  assert.equal(pending.data.paymentStatus, "pending");
  assert.equal(pending.data.paid, false);
  assert.match(pending.data.orderId, /^NX-\d{4}-\d{6}$/);
  assert.equal((await call("GET", `/api/payments/razorpay/status/${rzpId}`, { cookie: shopper.cookie })).status, 404);
  assert.equal((await call("GET", "/api/payments/razorpay/status/not-an-id", { cookie: poller.cookie })).status, 404);
  assert.equal((await call("GET", `/api/payments/razorpay/status/${rzpId}`)).status, 401);

  const ids = { razorpay_order_id: rzpId, razorpay_payment_id: "pay_POLLPAID01" };
  await call("POST", "/api/payments/razorpay/verify", { body: { ...ids, razorpay_signature: checkoutSignature(rzpId, ids.razorpay_payment_id) }, cookie: poller.cookie });
  const paid = await call("GET", `/api/payments/razorpay/status/${rzpId}`, { cookie: poller.cookie });
  assert.equal(paid.data.paid, true);
  assert.equal(paid.data.redirect, `/orders/${paid.data.orderId}/success`);
});

test("a payment that lands after the shopper cancelled the order is refunded at once", async () => {
  const late = await newCustomer("Late Payer", "late@nexthlon.test");
  const kit = await Product.findOne({ slug: "goal-keeper-gloves" });
  await call("POST", "/api/cart/items", { body: { productId: String(kit._id), quantity: 1 }, cookie: late.cookie });
  const created = await call("POST", "/api/payments/razorpay/order", { body: { addressId: late.addressId }, cookie: late.cookie });
  const rzpId = created.data.razorpay_order_id;
  const failed = await call("POST", "/api/payments/razorpay/failed", { body: { razorpay_order_id: rzpId, reason: "Closed the payment window" }, cookie: late.cookie });
  // "Choose another method" cancels the unpaid order.
  assert.equal((await call("POST", `/api/orders/${failed.data.orderId}/cancel`, { body: {}, cookie: late.cookie })).status, 200);
  const stockBefore = (await Product.findById(kit._id)).stock;

  // The bank was slow: the capture arrives afterwards through the webhook.
  assert.equal(await sendWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_LATE00001", order_id: rzpId, amount: created.data.amount } } } }), 200);
  const order = await Order.findOne({ orderId: failed.data.orderId }).lean();
  assert.equal(order.orderStatus, "cancelled");
  assert.equal(order.paymentStatus, "refunded");
  assert.deepEqual(order.refunds.map(refund => [refund.method, refund.amount]), [["original", created.data.amount]]);
  assert.equal((await Product.findById(kit._id)).stock, stockBefore);
  // The cart was never emptied.
  assert.equal((await call("GET", "/api/cart", { cookie: late.cookie })).data.cart.items.length, 1);
});

// ---------- Redesigned sign-in pages ----------
test("sign in and create account share one flipping card; admins get the control room", async () => {
  const login = await call("GET", "/login?next=%2Fcart");
  assert.equal(login.status, 200);
  assert.match(login.data, /data-mode="login"/);
  assert.match(login.data, /data-endpoint="\/api\/login"/);
  assert.match(login.data, /data-endpoint="\/api\/signup"/);
  assert.match(login.data, /data-face="signup"[^>]*inert/);
  assert.match(login.data, /href="\/signup\?next=%2Fcart"/);
  const signup = await call("GET", "/signup");
  assert.match(signup.data, /data-mode="signup"/);
  assert.match(signup.data, /data-face="login"[^>]*inert/);
  assert.match(signup.data, /type="module" src="\/js\/auth3d\.js"/);
  const admin = await call("GET", "/admin/login");
  assert.match(admin.data, /data-globe-scene/);
  assert.match(admin.data, /data-endpoint="\/api\/admin\/login"/);
  assert.doesNotMatch(admin.data, /\/api\/signup/);
});
