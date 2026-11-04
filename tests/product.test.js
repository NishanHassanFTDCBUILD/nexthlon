require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProduct, hasErrors } = require("../utils/validators");
const { slugify } = require("../utils/slug");
const { detectImageType, isUploadedImage } = require("../services/imageService");
const { planImages, orderImages, readAdminFilters } = require("../services/adminProductService");
const Product = require("../models/Product");

const CATEGORY_ID = "64b0000000000000000000c1";
const good = { name: "TrailFlex 2 Shoes", category: CATEGORY_ID, brand: "", price: "2999", mrp: "3999", stock: "4", description: " Light and fast. " };

test("product validation accepts good input and cleans it", () => {
  const { errors, value } = validateProduct(good);
  assert.equal(hasErrors(errors), false);
  assert.deepEqual(value, {
    name: "TrailFlex 2 Shoes", description: "Light and fast.", category: CATEGORY_ID,
    brand: "Nexthlon", basePrice: 299900, mrp: 399900, offerPercent: 0, stock: 4
  });
});

test("product price must be above 0 and M.R.P. at least the price", () => {
  assert.ok(validateProduct({ ...good, price: "0" }).errors.price);
  assert.ok(validateProduct({ ...good, price: "-10" }).errors.price);
  assert.ok(validateProduct({ ...good, price: "abc" }).errors.price);
  assert.ok(validateProduct({ ...good, price: "10.555" }).errors.price);
  assert.ok(validateProduct({ ...good, mrp: "2998" }).errors.mrp);
  assert.equal(validateProduct({ ...good, mrp: "2999" }).errors.mrp, undefined);
});

test("product stock must be a whole number of 0 or more", () => {
  assert.ok(validateProduct({ ...good, stock: "1.5" }).errors.stock);
  assert.ok(validateProduct({ ...good, stock: "-1" }).errors.stock);
  assert.ok(validateProduct({ ...good, stock: "" }).errors.stock);
  assert.equal(validateProduct({ ...good, stock: "0" }).errors.stock, undefined);
});

test("product name is 3 to 120 characters and the category must be a real id", () => {
  assert.ok(validateProduct({ ...good, name: "Ab" }).errors.name);
  assert.ok(validateProduct({ ...good, name: "x".repeat(121) }).errors.name);
  assert.equal(validateProduct({ ...good, name: "x".repeat(120) }).errors.name, undefined);
  assert.ok(validateProduct({ ...good, category: "Hacking" }).errors.category);
  assert.ok(validateProduct({ ...good, category: { $ne: "" } }).errors.category);
});

test("the discount is worked out from price and M.R.P., never from the form", () => {
  assert.equal(validateProduct({ ...good, discountPercent: "99" }).value.discountPercent, undefined);
  assert.equal(validateProduct({ ...good, price: "1" }).value.price, undefined);
  assert.equal(Product.discountFor(2999, 3999), 25);
  assert.equal(Product.discountFor(500, 500), 0);
});

test("slugs are lowercase words joined by hyphens", () => {
  assert.equal(slugify("TrailFlex 2 — Running Shoés!"), "trailflex-2-running-shoes");
  assert.equal(slugify("   "), "product");
  assert.ok(slugify("a ".repeat(100)).length <= 80);
});

test("image type comes from the file's bytes, not its name", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const jpg = Buffer.from("ffd8ffe000104a464946000101", "hex");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
  assert.equal(detectImageType(png), "png");
  assert.equal(detectImageType(jpg), "jpg");
  assert.equal(detectImageType(webp), "webp");
  assert.equal(detectImageType(Buffer.from("<script>alert(1)</script>")), null);
  assert.equal(isUploadedImage("/uploads/products/0123456789abcdef0123456789abcdef.png"), true);
  assert.equal(isUploadedImage("/uploads/products/../../app.js"), false);
});

test("photo plan keeps only the product's own photos and allows at most 4", () => {
  const current = ["/a.jpg", "/b.jpg", "/c.jpg"];
  const plan = planImages({ current, keepRaw: JSON.stringify(["/b.jpg", "/a.jpg"]), mainRaw: "new:0", newCount: 1 });
  assert.deepEqual(plan.keep, ["/b.jpg", "/a.jpg"]);
  assert.deepEqual(plan.removed, ["/c.jpg"]);
  assert.deepEqual(orderImages(plan, ["/new.png"]), ["/new.png", "/b.jpg", "/a.jpg"]);

  assert.ok(planImages({ current, keepRaw: JSON.stringify(["https://evil.example/x.jpg"]), newCount: 0 }).error);
  assert.ok(planImages({ current, keepRaw: "not json", newCount: 1 }).error);
  assert.ok(planImages({ current, keepRaw: "[]", newCount: 0 }).error);
  assert.ok(planImages({ current, keepRaw: JSON.stringify(current), newCount: 2 }).error);
  // An unknown main choice falls back to the first photo.
  assert.deepEqual(planImages({ current, keepRaw: JSON.stringify(current), mainRaw: "new:3", newCount: 0 }).main, { kind: "kept", value: "/a.jpg" });
});

test("admin product filters ignore bad values", () => {
  assert.deepEqual(readAdminFilters({ q: ["x"], category: "Nope", status: "deleted", sort: "$where", page: "-1" }),
    { q: "", category: "", status: "all", sort: "newest", page: 1 });
});
