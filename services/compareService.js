// Compare 2 to 4 products side by side. Only listed products in listed categories are shown, the
// same rule as the shop. Reads only: nothing is stored on the server; the selection lives in the browser.
const Product = require('../models/Product');
const {LISTED_PRODUCT} = require('../utils/queryFilters');

const MAX_ITEMS = 4;
const SLUG = /^[a-z0-9][a-z0-9-]{0,120}$/;

// "a,b,,c" -> ['a','b','c']: unique, valid slugs only, at most four.
function parseSlugs(value) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const seen = new Set();
  for (const part of raw.split(',')) {
    const slug = part.trim().toLowerCase();
    if (SLUG.test(slug)) seen.add(slug);
    if (seen.size === MAX_ITEMS) break;
  }
  return [...seen];
}

// The rows the compare table shows, in the order the shopper asked for them.
async function forSlugs(slugs) {
  if (!slugs.length) return [];
  const found = await Product.find({...LISTED_PRODUCT, slug: {$in: slugs}})
    .select(
      'name brand slug image price mrp discountPercent ratingAverage ratingCount shipWeight highlights specs variants stock',
    )
    .lean();
  const bySlug = new Map(found.map((p) => [p.slug, p]));
  return slugs
    .filter((slug) => bySlug.has(slug))
    .map((slug) => {
      const p = bySlug.get(slug);
      const sizes = [
        ...new Set((p.variants || []).map((v) => v.size).filter(Boolean)),
      ];
      return {
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        image: p.image,
        price: p.price,
        mrp: p.mrp,
        discountPercent: p.discountPercent || 0,
        ratingAverage: p.ratingAverage || 0,
        ratingCount: p.ratingCount || 0,
        weightGrams: p.shipWeight || 0,
        highlights: (p.highlights || []).slice(0, 4),
        specs: p.specs ? Object.fromEntries(p.specs) : {},
        sizes,
        inStock: p.stock > 0,
      };
    });
}

module.exports = {MAX_ITEMS, parseSlugs, forSlugs};
