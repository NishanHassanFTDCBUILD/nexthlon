// What the search panel shows before anything is typed (the header search box, public/js/header.js),
// and the search log behind its "Trending searches".
//   record(q, results)  counts a search for today (from the results page, never from typing suggestions)
//   trending()          the most searched words of the last 7 days that found products
//   startPanel()        trending searches (once there are some), sports to jump to, popular products
// Trending only ever shows words the store itself uses (product names, brands, categories), so random or
// rude text typed by visitors can never appear there. Everything is the same for every visitor, so it is
// kept a few minutes (utils/memo.js).
const SearchLog = require("../models/SearchLog");
const productService = require("./productService");
const memo = require("../utils/memo");
const logger = require("../utils/logger");

const TRENDING_DAYS = 7;
const TRENDING_MIN_COUNT = 2;

// "  Running   SHOES!! " -> "running shoes". Letters, digits, spaces and hyphens only; 2 to 60 characters.
function normalizeTerm(q) {
  const term = String(q || "").toLowerCase().replace(/[^a-z0-9\s-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  return term.length >= 2 ? term : "";
}

const startOfDay = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

// Never slows the page down or breaks it: a failure is only logged.
async function record(q, results, now = new Date()) {
  const term = normalizeTerm(q);
  if (!term) return false;
  try {
    await SearchLog.updateOne(
      { term, day: startOfDay(now) },
      { $inc: { count: 1 }, $set: { results: Math.max(0, Number(results) || 0) } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    logger.warn("search_log.failed", { error: error.message });
    return false;
  }
}

// [{ term }], most searched first. Only searches that found products, searched at least twice, and made
// only of words the store uses.
function trending(limit = 8, now = new Date()) {
  return memo.remember(`search:trending:${limit}`, 10 * 60 * 1000, async () => {
    const since = new Date(startOfDay(now).getTime() - (TRENDING_DAYS - 1) * 24 * 60 * 60 * 1000);
    const [rows, vocabulary] = await Promise.all([
      SearchLog.aggregate([
        { $match: { day: { $gte: since }, results: { $gt: 0 } } },
        { $group: { _id: "$term", count: { $sum: "$count" } } },
        { $match: { count: { $gte: TRENDING_MIN_COUNT } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: limit * 4 }
      ]),
      productService.searchVocabulary()
    ]);
    const known = new Set(vocabulary);
    return rows
      .filter(row => row._id.split(" ").every(word => known.has(word)))
      .slice(0, limit)
      .map(row => ({ term: row._id }));
  });
}

// What the panel shows before typing. "Trending searches" appears once real searches exist; until then
// the sports and popular products carry the panel (sport names as searches would only repeat the sports).
function startPanel() {
  return memo.remember("catalog:search-start", 5 * 60 * 1000, async () => {
    const [popular, categories, home] = await Promise.all([
      trending(8),
      productService.getCategorySummaries(),
      productService.getHomeSections()
    ]);
    const sports = categories.filter(c => c.count > 0).slice(0, 8)
      .map(c => ({ name: c.name, slug: c.slug, count: c.count, image: c.image || "" }));
    const searches = popular.map(entry => ({ term: entry.term, trending: true }));
    const products = (home.bestSellers.length ? home.bestSellers : home.newest).slice(0, 4).map(productService.toPublicProduct);
    return { searches, sports, products };
  });
}

module.exports = { normalizeTerm, record, trending, startPanel, startOfDay };
