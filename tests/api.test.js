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

test("home page: carousel, trust badges, deals countdown, rails and brands", async () => {
  // Best sellers are the in-stock items that are not already in the deals row.
  await makeProduct({ name: "Plain Training Tee", slug: "plain-training-tee", category: "Fitness", price: 499, mrp: 499, stock: 8, image: "/img/favicon.svg" });
  const res = await call("GET", "/");
  assert.equal(res.status, 200);
  assert.match(res.data, /data-carousel/);
  assert.match(res.data, /aria-roledescription="slide"/);
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
