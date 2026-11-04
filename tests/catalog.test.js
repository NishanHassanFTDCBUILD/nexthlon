// Catalogue rules: money in paise, the best offer, delivery estimates, filters and reviews.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { rupeesToPaise, formatPaise, percentOf } = require("../utils/money");
const { priceFor, bestOfferFor } = require("../utils/pricing");
const { estimateDelivery, zoneFor } = require("../services/deliveryService");
const { readFilters } = require("../services/productService");
const { shortName } = require("../services/reviewService");
const { validateReview, readPercent } = require("../utils/validators");
const { linkBuilder } = require("../utils/queryString");

test("money: rupees typed in forms become whole paise, and show with Indian grouping", () => {
  assert.equal(rupeesToPaise("2999"), 299900);
  assert.equal(rupeesToPaise("2999.5"), 299950);
  assert.equal(rupeesToPaise("0.07"), 7);
  assert.equal(rupeesToPaise("1.005"), null);
  assert.equal(rupeesToPaise("-1"), null);
  assert.equal(rupeesToPaise("1e3"), null);
  assert.equal(formatPaise(12345600), "₹1,23,456");
  assert.equal(formatPaise(12345650), "₹1,23,456.50");
  assert.equal(formatPaise(0), "₹0");
  assert.equal(percentOf(99900, 10), 9990);
  assert.equal(percentOf(5, 50), 3);
});

test("offers: the higher of the product and category offer applies, never both", () => {
  assert.deepEqual(bestOfferFor({ offerPercent: 10, categoryOffer: 25 }), { percent: 25, source: "category" });
  assert.deepEqual(bestOfferFor({ offerPercent: 30, categoryOffer: 25 }), { percent: 30, source: "product" });
  assert.deepEqual(bestOfferFor({}), { percent: 0, source: null });
  // ₹3,999 base, ₹5,999 M.R.P., 25% category offer: pays ₹2,999.25 -> 299925 paise.
  const priced = priceFor({ basePrice: 399900, mrp: 599900, offerPercent: 10, categoryOffer: 25 });
  assert.equal(priced.price, 299925);
  assert.equal(priced.bestOffer, 25);
  assert.equal(priced.discountPercent, 50);
  assert.equal(priceFor({ basePrice: 50000, mrp: 50000 }).discountPercent, 0);
});

test("delivery estimates: metro, standard and remote PIN codes, no Sundays, and a 2 pm cut-off", () => {
  assert.equal(zoneFor("560001"), "metro");
  assert.equal(zoneFor("682001"), "standard");
  assert.equal(zoneFor("795001"), "remote");
  assert.equal(zoneFor("744101"), "remote");
  assert.equal(estimateDelivery("060001"), null);
  assert.equal(estimateDelivery("56001"), null);
  // Wednesday 4 Nov 2026, 10:00 IST: a metro order arrives Fri 6 – Sat 7 Nov.
  const morning = estimateDelivery("560001", new Date("2026-11-04T04:30:00Z"));
  assert.equal(morning.from, "2026-11-06");
  assert.equal(morning.to, "2026-11-07");
  assert.equal(morning.orderBy, "2 pm today");
  // After the cut-off it ships Thursday, and Sunday 8 Nov is skipped: Sat 7 – Mon 9 Nov.
  const evening = estimateDelivery("560001", new Date("2026-11-04T10:00:00Z"));
  assert.equal(evening.from, "2026-11-07");
  assert.equal(evening.to, "2026-11-09");
  assert.equal(evening.orderBy, null);
});

test("filters: several brands, steps for discount and rating, and the grid or list view", () => {
  const filters = readFilters({ brand: ["Strike", "Volt", "Strike", ""], discount: "30", rating: "4", view: "list", sort: "rating" });
  assert.deepEqual(filters.brands, ["Strike", "Volt"]);
  assert.equal(filters.discount, 30);
  assert.equal(filters.rating, 4);
  assert.equal(filters.view, "list");
  assert.equal(filters.sort, "rating");
  assert.equal(readFilters({ discount: "35", rating: "5" }).discount, 0);
  const link = linkBuilder("/products", { category: "running", brand: ["Strike", "Volt"], min: null });
  assert.equal(link({ page: 2 }), "/products?category=running&brand=Strike&brand=Volt&page=2");
  assert.equal(link({ brand: ["Volt"] }), "/products?category=running&brand=Volt");
});

test("reviews: 1 to 5 whole stars, a real message, and a short public name", () => {
  assert.deepEqual(validateReview({ rating: 5, title: " Superb ", body: "  Fits well and grips wet rock.  " }).value,
    { rating: 5, title: "Superb", body: "Fits well and grips wet rock." });
  assert.ok(validateReview({ rating: 0, body: "Fits well and grips." }).errors.rating);
  assert.ok(validateReview({ rating: 4.5, body: "Fits well and grips." }).errors.rating);
  assert.ok(validateReview({ rating: "6", body: "Fits well and grips." }).errors.rating);
  assert.ok(validateReview({ rating: 4, body: "ok" }).errors.body);
  assert.equal(shortName("Asha Nair"), "Asha N.");
  assert.equal(shortName("Ravi"), "Ravi");
  assert.equal(readPercent("15"), 15);
  assert.equal(readPercent(""), 0);
  assert.equal(readPercent("95"), null);
  assert.equal(readPercent("1.5"), null);
});
