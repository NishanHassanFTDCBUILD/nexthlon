const productService = require("./productService");
const Product = require("../models/Product");
const { LISTED_PRODUCT } = require("../utils/queryFilters");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deals of the day end at midnight in India (IST has no daylight saving, so a fixed offset is exact).
function dealEndsAt(now = new Date()) {
  const istNow = now.getTime() + IST_OFFSET_MS;
  const nextIstMidnight = Math.floor(istNow / DAY_MS) * DAY_MS + DAY_MS;
  return new Date(nextIstMidnight - IST_OFFSET_MS);
}

// ---------- "Pick your sport": the 3D sport carousel ring ----------

const RING_SIZE = 6;

// The six headline sports come first, in this order. Other sports fill any gaps.
const RING_ORDER = ["Running", "Football", "Fitness", "Cricket", "Cycling", "Outdoor"];

// Each sport's glow colour behind the ring, the words that name its key gear (the card shows a
// listed product of that kind when there is one), and a matching photo for when there is not.
// The photos are Unsplash images (allowed by the CSP), cropped to the tall card.
const SPORT_LOOKS = {
  Running: { color: "#ff7a1a", gear: "shoe|trainer|sneaker", photo: "photo-1542291026-7eec264c27ff" },
  Football: { color: "#22c55e", gear: "football|ball", photo: "photo-1614632537190-23e4146777db" },
  Fitness: { color: "#ef4444", gear: "dumbbell|kettlebell|barbell", photo: "photo-1583454110551-21f2fa2afe61" },
  Cricket: { color: "#3b82f6", gear: "\\bbat\\b", photo: "photo-1531415074968-036ba1b575da" },
  Cycling: { color: "#facc15", gear: "bicycle|\\bbike", photo: "photo-1485965120184-e220f721d03e" },
  Outdoor: { color: "#14b8a6", gear: "backpack|rucksack|tent", photo: "photo-1553062407-98eeb64c6a62" },
  Swimming: { color: "#06b6d4", gear: "goggle", photo: "photo-1530549387789-4c1017266635" },
  Tennis: { color: "#a3e635", gear: "racket|racquet", photo: "photo-1595435934249-5df7ed86e1c0" },
  Hiking: { color: "#f59e0b", gear: "boot|shoe", photo: "photo-1551107696-a4b0c5a0d9a2" },
  Camping: { color: "#a855f7", gear: "tent", photo: "photo-1510312305653-8ed496efae75" }
};
// Clothing and small accessories never stand for a sport ("Football Training Jersey" is not a ball).
const NOT_GEAR = /jersey|shirt|tee\b|jacket|glove|sock|short|cap\b|bottle|bag\b/i;
const DEFAULT_COLOR = "#ff7a1a";

// Unsplash images are cropped to the tall card shape at twice the card's size; other images are kept.
function portraitImage(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "images.unsplash.com") return url;
    parsed.searchParams.set("auto", "format");
    parsed.searchParams.set("fit", "crop");
    parsed.searchParams.set("w", "640");
    parsed.searchParams.set("h", "900");
    parsed.searchParams.set("q", "75");
    return parsed.toString();
  } catch {
    return url; // a local path such as /uploads/...
  }
}

// Up to 6 sports for the ring, from the live category summaries (item count and lowest price
// come from the database). gearImages maps a category id to the photo of its key gear.
// The photo is: the sport's key gear from the catalogue, else a matching photo, else the category image.
function buildSportRing(categories = [], gearImages = {}) {
  const rank = name => {
    const at = RING_ORDER.indexOf(name);
    return at === -1 ? RING_ORDER.length : at;
  };
  return [...categories]
    .filter(category => category.count > 0)
    .sort((a, b) => rank(a.name) - rank(b.name) || b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, RING_SIZE)
    .map((category, i) => {
      const look = SPORT_LOOKS[category.name] || {};
      const photo = look.photo ? `https://images.unsplash.com/${look.photo}?auto=format&fit=crop&w=800&q=80` : "";
      return {
        number: String(i + 1).padStart(2, "0"),
        name: category.name,
        slug: category.slug,
        href: `/products?category=${encodeURIComponent(category.slug)}`,
        count: category.count,
        fromPrice: category.fromPrice || 0,
        color: look.color || DEFAULT_COLOR,
        image: portraitImage(gearImages[category.id] || photo || category.image)
      };
    });
}

// For each ring sport, the photo of one listed product that is its key gear (best rated first).
async function findGearImages(sports, categories) {
  const byName = new Map(categories.map(category => [category.name, category]));
  const pairs = await Promise.all(sports.map(async sport => {
    const look = SPORT_LOOKS[sport.name];
    const category = byName.get(sport.name);
    if (!look || !look.gear || !category) return null;
    const product = await Product.findOne({
      ...LISTED_PRODUCT,
      category: category.id,
      $and: [{ name: { $regex: look.gear, $options: "i" } }, { name: { $not: NOT_GEAR } }]
    }).sort({ ratingCount: -1, ratingAverage: -1, _id: 1 }).select("image").lean();
    return product && product.image ? [category.id, product.image] : null;
  }));
  return Object.fromEntries(pairs.filter(Boolean));
}

// ---------- "The zero-gravity showroom": up to 12 featured products ----------
// Best sellers first, then new arrivals, then deals, with no repeats. Only what the cards and the
// detail card show is passed to the page (money stays in paise).
const SHOWROOM_SIZE = 12;
function buildFeatured({ bestSellers = [], newest = [], deals = [] } = {}, size = SHOWROOM_SIZE) {
  const seen = new Set();
  return [...bestSellers, ...newest, ...deals]
    .filter(product => {
      const id = String(product._id);
      if (seen.has(id) || !product.image) return false;
      seen.add(id);
      return true;
    })
    .slice(0, size)
    .map(product => ({
      id: String(product._id),
      slug: product.slug,
      name: product.name,
      brand: product.brand || "",
      image: product.image,
      price: product.price,
      mrp: product.mrp,
      discountPercent: product.discountPercent || 0,
      rating: Math.round((product.ratingAverage || 0) * 10) / 10,
      ratingCount: product.ratingCount || 0,
      stock: product.stock || 0,
      highlights: (product.highlights || []).slice(0, 3)
    }));
}

async function getHomePage(now = new Date()) {
  const sections = await productService.getHomeSections();
  const gearImages = await findGearImages(buildSportRing(sections.categories), sections.categories);
  return {
    ...sections,
    sports: buildSportRing(sections.categories, gearImages),
    featured: buildFeatured(sections),
    dealEndsAt: dealEndsAt(now)
  };
}

module.exports = { dealEndsAt, buildSportRing, portraitImage, buildFeatured, getHomePage };
