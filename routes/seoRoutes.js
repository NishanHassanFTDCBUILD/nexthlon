// /robots.txt and /sitemap.xml (D1). The sitemap lists every page worth finding: home, the catalogue,
// each listed category and product (with its photo), and the policy pages. It is the same for everyone,
// so it is built at most every 30 minutes and may be kept by a CDN for an hour.
const router = require("express").Router();
const Product = require("../models/Product");
const categoryService = require("../services/categoryService");
const memo = require("../utils/memo");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { siteOrigin, absoluteUrl } = require("../utils/seo");
const { asyncHandler } = require("../utils/http");
const { sizedUrl } = require("../utils/images");

const STATIC_PAGES = ["/about", "/contact", "/privacy", "/terms", "/refund-policy", "/shipping-policy"];

const escapeXml = value => String(value).replace(/[<>&'"]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]));
const day = date => (date ? new Date(date).toISOString().slice(0, 10) : "");

async function sitemapEntries() {
  return memo.remember("seo:sitemap", 30 * 60 * 1000, async () => {
    const [products, categories] = await Promise.all([
      Product.find({ ...LISTED_PRODUCT }).select("slug name image updatedAt").sort({ updatedAt: -1 }).limit(45000).lean(),
      categoryService.listedCategories()
    ]);
    const newest = products.length ? products[0].updatedAt : null;
    return [
      { loc: "/", lastmod: newest, priority: "1.0" },
      { loc: "/products", lastmod: newest, priority: "0.9" },
      ...categories.map(category => ({ loc: `/products?category=${encodeURIComponent(category.slug)}`, lastmod: category.updatedAt || newest, priority: "0.8" })),
      ...products.map(product => ({ loc: `/products/${encodeURIComponent(product.slug)}`, lastmod: product.updatedAt, priority: "0.7", image: product.image, title: product.name })),
      ...STATIC_PAGES.map(loc => ({ loc, priority: "0.3" }))
    ];
  });
}

router.get("/sitemap.xml", asyncHandler(async (req, res) => {
  const origin = siteOrigin(req);
  const entries = await sitemapEntries();
  const body = entries.map(entry => [
    "  <url>",
    `    <loc>${escapeXml(absoluteUrl(origin, entry.loc))}</loc>`,
    entry.lastmod ? `    <lastmod>${day(entry.lastmod)}</lastmod>` : "",
    `    <priority>${entry.priority}</priority>`,
    entry.image ? `    <image:image><image:loc>${escapeXml(absoluteUrl(origin, sizedUrl(entry.image, 1200)))}</image:loc></image:image>` : "",
    "  </url>"
  ].filter(Boolean).join("\n")).join("\n");
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=0, s-maxage=3600");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>\n`);
}));

// The admin console's address is secret (ADMIN_PATH), so it is never named here; it sends noindex itself.
router.get("/robots.txt", (req, res) => {
  const origin = siteOrigin(req);
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=0, s-maxage=3600");
  res.send([
    "User-agent: *",
    "Disallow: /api/",
    "Disallow: /account",
    "Disallow: /cart",
    "Disallow: /checkout",
    "Disallow: /orders",
    "Disallow: /wallet",
    "Disallow: /wishlist",
    "Disallow: /lists/",
    // Filtered and sorted copies of the catalogue are the same products again.
    "Disallow: /products?*sort=",
    "Disallow: /products?*view=",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    ""
  ].join("\n"));
});

module.exports = router;
