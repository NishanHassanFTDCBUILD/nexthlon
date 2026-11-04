// Rules behind the redesigned storefront: deal timer, hero slides, id lists, contact and newsletter checks.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { dealEndsAt, buildSportRing, portraitImage, buildFeatured } = require("../services/homeService");
const { validateContact, validateNewsletter, readIdList, hasErrors } = require("../utils/validators");
const { CONTACT_TOPICS } = require("../config/store");

test("deals end at the next midnight in India, whatever the server's time zone", () => {
  // 10:00 IST on 4 Nov 2026 is 04:30 UTC; deals end at 00:00 IST on 5 Nov, which is 18:30 UTC on 4 Nov.
  assert.equal(dealEndsAt(new Date("2026-11-04T04:30:00Z")).toISOString(), "2026-11-04T18:30:00.000Z");
  // 23:59 IST still ends the same night.
  assert.equal(dealEndsAt(new Date("2026-11-04T18:29:00Z")).toISOString(), "2026-11-04T18:30:00.000Z");
  // Exactly midnight IST starts a new day of deals.
  assert.equal(dealEndsAt(new Date("2026-11-04T18:30:00Z")).toISOString(), "2026-11-05T18:30:00.000Z");
});

test("sport ring: the six headline sports first, in order, with DB counts, prices and colours", () => {
  const categories = [
    { name: "Tennis", slug: "tennis", count: 9, fromPrice: 149900, image: "/t.jpg" },
    { name: "Outdoor", slug: "outdoor", count: 2, fromPrice: 299900, image: "" },
    { name: "Running", slug: "running", count: 3, fromPrice: 199900, image: "https://images.unsplash.com/photo-1?auto=format&fit=crop&w=800&q=80" },
    { name: "Cricket", slug: "cricket", count: 1, fromPrice: 119900, image: "/c.jpg" },
    { name: "Empty", slug: "empty", count: 0, fromPrice: 0, image: "" },
    { name: "Football", slug: "football", count: 4, fromPrice: 59900, image: "/f.jpg" },
    { name: "Swimming", slug: "swimming", count: 2, fromPrice: 49900, image: "/s.jpg" },
    { name: "Fitness", slug: "fitness", count: 5, fromPrice: 89900, image: "/fit.jpg" }
  ];
  const ring = buildSportRing(categories);
  assert.equal(ring.length, 6);
  // Headline sports in their fixed order, then the biggest other sport fills the last place.
  assert.deepEqual(ring.map(s => s.name), ["Running", "Football", "Fitness", "Cricket", "Outdoor", "Tennis"]);
  assert.deepEqual(ring.map(s => s.number), ["01", "02", "03", "04", "05", "06"]);
  assert.equal(ring[0].href, "/products?category=running");
  assert.equal(ring[0].count, 3);
  assert.equal(ring[0].fromPrice, 199900);
  assert.equal(ring[0].color, "#ff7a1a");
  assert.equal(ring[1].color, "#22c55e");
  // Unsplash photos are cropped to the tall card. A known sport without key gear in the catalogue
  // gets its matching photo rather than the category's cover image.
  assert.match(ring[1].image, /photo-1614632537190.*w=640/);
  assert.match(ring[1].image, /h=900/);
  assert.match(ring[5].image, /photo-1595435934249/);
  // A sport without an image gets a matching photo.
  assert.match(ring[4].image, /^https:\/\/images\.unsplash\.com\/photo-1553062407/);
});

test("sport ring photo: the sport's key gear first, then a matching photo, then the category image", () => {
  const categories = [
    { id: "c1", name: "Football", slug: "football", count: 2, fromPrice: 100, image: "/jersey.jpg" },
    { id: "c2", name: "Cycling", slug: "cycling", count: 1, fromPrice: 100, image: "/helmet.jpg" },
    { id: "c3", name: "Kabaddi", slug: "kabaddi", count: 1, fromPrice: 100, image: "/mat.jpg" }
  ];
  const [football, cycling, kabaddi] = buildSportRing(categories, { c1: "/uploads/ball.webp" });
  assert.equal(football.image, "/uploads/ball.webp");
  assert.match(cycling.image, /^https:\/\/images\.unsplash\.com\/photo-1485965120184/);
  assert.equal(kabaddi.image, "/mat.jpg");
});

test("sport ring: an empty store has no ring, and odd image paths are kept", () => {
  assert.deepEqual(buildSportRing([]), []);
  assert.deepEqual(buildSportRing(), []);
  assert.equal(portraitImage("/uploads/products/a.webp"), "/uploads/products/a.webp");
  assert.equal(portraitImage(""), "");
  assert.equal(buildSportRing([{ name: "Kabaddi", slug: "kabaddi", count: 1, fromPrice: 100, image: "" }])[0].image, "");
});

test("id lists from the browser keep only real ids, without repeats, up to the limit", () => {
  const a = "64b0000000000000000000a1";
  const b = "64B0000000000000000000B2";
  assert.deepEqual(readIdList(`${a}, ${b},${a},nope,{"$gt":""},123`), [a, b.toLowerCase()]);
  assert.deepEqual(readIdList(undefined), []);
  assert.deepEqual(readIdList(["64b0000000000000000000a1"]), []);
  const many = Array.from({ length: 80 }, (_, n) => n.toString(16).padStart(24, "0")).join(",");
  assert.equal(readIdList(many, 50).length, 50);
});

test("contact form: good input is cleaned, bad input gets a message per field", () => {
  const { errors, value } = validateContact({
    name: "  Asha   Nair ", email: "ASHA@Example.com", phone: "+91 98765-43210",
    topic: CONTACT_TOPICS[0], message: "  My parcel has not arrived yet.\r\nCan you check?  "
  });
  assert.equal(hasErrors(errors), false);
  assert.equal(value.name, "Asha Nair");
  assert.equal(value.email, "asha@example.com");
  assert.equal(value.phone, "9876543210");
  assert.equal(value.message, "My parcel has not arrived yet.\nCan you check?");
  assert.equal(value.isBot, false);

  const bad = validateContact({ name: "A", email: "nope", phone: "12345", topic: "Free stuff", message: "hi" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["email", "message", "name", "phone", "topic"]);
  assert.equal(hasErrors(validateContact({ name: "Asha", email: "a@b.in", topic: CONTACT_TOPICS[1], message: "x".repeat(2001) }).errors), true);
  // The phone number is optional.
  assert.equal(validateContact({ name: "Asha", email: "a@b.in", topic: CONTACT_TOPICS[1], message: "Where is my refund?" }).errors.phone, undefined);
});

test("contact form: the hidden trap field marks bots", () => {
  const { value } = validateContact({ name: "Bot", email: "bot@spam.io", topic: CONTACT_TOPICS[0], message: "Buy cheap watches now", website: "http://spam.io" });
  assert.equal(value.isBot, true);
});

test("newsletter: only a valid email is accepted, in lower case", () => {
  assert.deepEqual(validateNewsletter({ email: " Ravi@Example.IN " }), { errors: {}, value: { email: "ravi@example.in" } });
  assert.equal(validateNewsletter({ email: "ravi@" }).errors.email, "Enter a valid email address.");
  assert.equal(validateNewsletter({ email: { $ne: "" } }).errors.email, "Enter a valid email address.");
});

test("showroom: up to 12 featured products, best sellers first, no repeats, only card fields", () => {
  const make = (id, extra = {}) => ({ _id: id, slug: `p-${id}`, name: `Product ${id}`, image: `/i/${id}.jpg`, price: 100000, mrp: 150000, discountPercent: 33, ratingAverage: 4.26, ratingCount: 3, stock: 4, highlights: ["a", "b", "c", "d"], passwordHash: "never", ...extra });
  const bestSellers = [make("a1"), make("a2")];
  const newest = [make("a2"), make("a3"), make("x0", { image: "" })];
  const deals = Array.from({ length: 15 }, (_, i) => make(`d${i}`));
  const featured = buildFeatured({ bestSellers, newest, deals });
  assert.equal(featured.length, 12);
  assert.deepEqual(featured.slice(0, 4).map(p => p.id), ["a1", "a2", "a3", "d0"]);
  // Products without a photo are skipped; only what the cards show is kept.
  assert.ok(!featured.some(p => p.id === "x0"));
  assert.deepEqual(Object.keys(featured[0]).sort(), ["brand", "discountPercent", "highlights", "id", "image", "mrp", "name", "price", "rating", "ratingCount", "slug", "stock"]);
  assert.equal(featured[0].rating, 4.3);
  assert.deepEqual(featured[0].highlights, ["a", "b", "c"]);
  assert.deepEqual(buildFeatured({}), []);
  assert.equal(buildFeatured({ deals }, 8).length, 8);
});
