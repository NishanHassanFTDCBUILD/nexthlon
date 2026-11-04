// Rules behind the redesigned storefront: deal timer, hero slides, id lists, contact and newsletter checks.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { dealEndsAt, buildHeroSlides } = require("../services/homeService");
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

test("hero slides: the top deal first, then the biggest sports, never more than 4", () => {
  const categories = [
    { name: "Tennis", slug: "tennis", count: 2, fromPrice: 149900, image: "/t.jpg" },
    { name: "Running", slug: "running", count: 9, fromPrice: 79900, image: "/r.jpg" },
    { name: "Hiking", slug: "hiking", count: 5, fromPrice: 299900, image: "/h.jpg" },
    { name: "Cricket", slug: "cricket", count: 5, fromPrice: 119900, image: "/c.jpg" },
    { name: "Football", slug: "football", count: 1, fromPrice: 59900, image: "/f.jpg" }
  ];
  const slides = buildHeroSlides({ deals: [{ discountPercent: 40, image: "/deal.jpg" }], categories });
  assert.equal(slides.length, 4);
  assert.equal(slides[0].title, "Up to 40% off top gear");
  assert.equal(slides[0].href, "/products?sort=discount");
  assert.deepEqual(slides.slice(1).map(s => s.href), [
    "/products?category=running", "/products?category=cricket", "/products?category=hiking"
  ]);
  assert.match(slides[1].kicker, /from ₹799/);
  assert.equal(buildHeroSlides({ categories: [{ name: "Running", slug: "running", count: 1, fromPrice: 123400, image: "" }] })[0].kicker, "Running · from ₹1,234");
});

test("hero slides: an empty store still gets one slide", () => {
  const slides = buildHeroSlides({});
  assert.equal(slides.length, 1);
  assert.equal(slides[0].href, "/products");
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
