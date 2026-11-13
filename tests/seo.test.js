// Search engines and link previews (D1): sitemap, robots.txt, canonical addresses, noindex on private
// pages, link-preview tags and Google's product data. Rules first; pages need TEST_MONGODB_URI ("_seo").
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const seo = require("../utils/seo");

test("seo: private pages, absolute addresses and safe JSON", () => {
  for (const path of ["/account", "/account/orders", "/cart", "/checkout", "/orders/NX-1", "/login", "/wishlist", "/lists/abc"]) {
    assert.ok(seo.isPrivatePage(path), path);
  }
  for (const path of ["/", "/products", "/products/trail-shoe", "/about", "/accounting-tips"]) {
    assert.ok(!seo.isPrivatePage(path), path);
  }
  assert.equal(seo.absoluteUrl("https://nexthlon.in", "/img/a.webp"), "https://nexthlon.in/img/a.webp");
  assert.equal(seo.absoluteUrl("https://nexthlon.in", "https://images.unsplash.com/x"), "https://images.unsplash.com/x");
  assert.equal(seo.jsonLdText({ name: "</script><script>alert(1)</script>" }).includes("</script>"), false);
});

test("seo: product data has price in rupees, stock, rating, sizes and the return policy", () => {
  const data = seo.productData(
    { _id: "a".repeat(24), name: "Trail Shoe", description: "Grippy.", brand: "Nexthlon", price: 299900, stock: 0, ratingAverage: 4.25, ratingCount: 12, countryOfOrigin: "India",
      variants: [{ size: "8", colour: "Black" }, { size: "9", colour: "Black" }] },
    { origin: "https://nexthlon.in", url: "https://nexthlon.in/products/trail-shoe", image: "https://nexthlon.in/a.webp", images: ["https://nexthlon.in/a.webp", "https://nexthlon.in/b.webp"] }
  );
  assert.equal(data["@type"], "Product");
  assert.equal(data.offers.price, "2999.00");
  assert.equal(data.offers.priceCurrency, "INR");
  assert.equal(data.offers.availability, "https://schema.org/OutOfStock");
  assert.equal(data.offers.shippingDetails.shippingRate.value, "0", "free delivery above the limit");
  assert.equal(data.offers.hasMerchantReturnPolicy.merchantReturnDays, 7);
  assert.deepEqual(data.image, ["https://nexthlon.in/a.webp", "https://nexthlon.in/b.webp"], "no repeated photo");
  assert.equal(data.aggregateRating.ratingValue, "4.3");
  assert.equal(data.size, "8, 9");
  assert.equal(data.color, "Black");
  assert.equal(seo.productData({ _id: "b", name: "x", price: 100, stock: 1, ratingCount: 0 }, { origin: "", url: "", image: "" }).aggregateRating, undefined, "no stars without reviews");
});

if (!process.env.TEST_MONGODB_URI) {
  test("seo page tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const categoryService = require("../services/categoryService");
const memo = require("../utils/memo");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_seo`;

let server;
let base;
let shoe;

async function get(path) {
  const response = await fetch(base + path, { redirect: "manual" });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
const meta = (html, property) => {
  const match = new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html);
  return match ? match[1] : null;
};
const canonicalOf = html => {
  const match = /<link rel="canonical" href="([^"]+)"/.exec(html);
  return match ? match[1].replace(/&amp;/g, "&") : null;
};

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The SEO test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  memo.forget("seo:sitemap");
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({ name: "SEO Trail Shoe", slug: "seo-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 299900, mrp: 399900, stock: 5, image: "/img/favicon.svg",
    description: "A grippy trail shoe for wet hills.", ratingAverage: 4.5, ratingCount: 2 });
  await Product.create({ name: "SEO Hidden Shoe", slug: "seo-hidden-shoe", category: running._id, brand: "Nexthlon", basePrice: 99900, mrp: 99900, stock: 5, image: "/img/favicon.svg", isListed: false });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("seo: sitemap.xml lists listed products and categories, never hidden ones; robots.txt points to it", async () => {
  const map = await get("/sitemap.xml");
  assert.equal(map.status, 200);
  assert.match(map.headers.get("content-type"), /application\/xml/);
  assert.match(map.text, /^<\?xml version="1.0"/);
  assert.match(map.text, /<loc>http:\/\/127\.0\.0\.1:\d+\/products\/seo-trail-shoe<\/loc>/);
  assert.match(map.text, /<loc>[^<]+\/products\?category=running<\/loc>/);
  assert.match(map.text, /<image:loc>/);
  assert.doesNotMatch(map.text, /seo-hidden-shoe/, "an unlisted product is not offered to Google");
  assert.match(map.text, /\/refund-policy<\/loc>/);

  const robots = await get("/robots.txt");
  assert.equal(robots.status, 200);
  assert.match(robots.text, /Disallow: \/checkout/);
  assert.match(robots.text, /Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  assert.doesNotMatch(robots.text, /admin/i, "the admin address stays secret");
});

test("seo: a product page has its canonical address, link preview and Google product data", async () => {
  const page = await get(`/products/${shoe.slug}`);
  assert.equal(page.status, 200);
  assert.match(canonicalOf(page.text), /\/products\/seo-trail-shoe$/);
  assert.equal(meta(page.text, "og:type"), "product");
  assert.match(meta(page.text, "og:title"), /SEO Trail Shoe · ₹2,999/);
  assert.equal(meta(page.text, "product:price:amount"), "2999.00");
  assert.match(meta(page.text, "og:image"), /^http/);
  assert.match(meta(page.text, "description"), /^₹2,999 \(25% off\) · A grippy trail shoe/);
  const blocks = ldBlocks(page.text);
  const product = blocks.find(block => block["@type"] === "Product");
  assert.equal(product.offers.price, "2999.00");
  assert.equal(product.offers.availability, "https://schema.org/InStock");
  assert.equal(product.aggregateRating.reviewCount, 2);
  const crumbs = blocks.find(block => block["@type"] === "BreadcrumbList");
  assert.deepEqual(crumbs.itemListElement.map(item => item.name), ["Home", "Running", "SEO Trail Shoe"]);
  assert.doesNotMatch(page.text, /name="robots" content="noindex/);
});

test("seo: the home page names the store and its search box", async () => {
  const page = await get("/");
  const blocks = ldBlocks(page.text);
  assert.ok(blocks.some(block => block["@type"] === "OnlineStore"));
  const site = blocks.find(block => block["@type"] === "WebSite");
  assert.match(site.potentialAction.target, /\/products\?q=\{search_term_string\}$/);
  assert.match(meta(page.text, "og:image"), /\/img\/og-default\.png$/);
});

test("seo: categories get their own title and address; filters point back to it; searches are hidden", async () => {
  const category = await get("/products?category=running");
  assert.match(category.text, /<title>Running gear: shoes, equipment and accessories \| Nexthlon<\/title>/);
  assert.match(meta(category.text, "description"), /^Shop 1 running products at Nexthlon from ₹2,999/);
  assert.match(canonicalOf(category.text), /\/products\?category=running$/);

  const filtered = await get("/products?category=running&sort=price_asc&brand=Nexthlon");
  assert.match(canonicalOf(filtered.text), /\/products\?category=running$/, "the same products again");

  const search = await get("/products?q=trail");
  assert.match(search.text, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(canonicalOf(search.text), null);
});

test("seo: private and error pages stay out of search results", async () => {
  const login = await get("/login");
  assert.match(login.text, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");
  const missing = await get("/products/no-such-thing");
  assert.equal(missing.status, 404);
  assert.match(missing.text, /<meta name="robots" content="noindex, nofollow">/);
});
