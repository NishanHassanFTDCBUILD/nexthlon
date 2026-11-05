// The trimmed admin console: Analytics, Inventory, Reviews, Q&A (store side and admin side),
// Coupons (admin side and the rules the store applies), and System status.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("admin section tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Review = require("../models/Review");
const Question = require("../models/Question");
const Coupon = require("../models/Coupon");
const CouponRedemption = require("../models/CouponRedemption");
const AuditLog = require("../models/AuditLog");
const categoryService = require("../services/categoryService");
const { hashPassword } = require("../services/authService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_sections`;
const ADMIN = "/admin";

let server;
let base;
let adminCookie;
let asha;
let ashaCookie;
let ravi;
let raviCookie;
let shoe;
let socks;

async function call(method, path, { body, cookie } = {}) {
  const headers = { Accept: "application/json,text/html", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data, headers: response.headers, location: response.headers.get("location"), cookie: match && match[2] ? `${match[1]}=${match[2]}` : null };
}

let seq = 0;
// A delivered order, which is what makes a customer able to review the product.
async function makeOrder(user, product, fields = {}) {
  seq += 1;
  const quantity = fields.quantity || 1;
  const lineTotal = product.price * quantity;
  return Order.create({
    orderId: `NX-2026-${String(500000 + seq)}`,
    user: user._id,
    items: [{ product: product._id, name: product.name, slug: product.slug, price: product.price, mrp: product.mrp, quantity, lineTotal, status: fields.itemStatus || fields.orderStatus || "delivered" }],
    address: { fullName: "Asha Nair", phone: "9876543210", line1: "1 Beach Road", city: fields.city || "Kochi", state: "Kerala", pincode: "682001" },
    mrpTotal: product.mrp * quantity,
    subtotal: lineTotal,
    total: fields.total ?? lineTotal,
    couponCode: fields.couponCode || "",
    couponDiscount: fields.couponDiscount || 0,
    paymentMethod: fields.paymentMethod || "cod",
    paymentStatus: fields.paymentStatus || "paid",
    orderStatus: fields.orderStatus || "delivered",
    deliveredAt: fields.deliveredAt || new Date(),
    stockReserved: true,
    statusHistory: []
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  await User.create({ name: "Section Admin", email: "admin@sections.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" });
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  shoe = await Product.create({ name: "Section Trail Shoe", slug: "section-trail-shoe", category: running._id, brand: "Nexthlon", basePrice: 300000, mrp: 400000, stock: 10, image: "/img/favicon.svg" });
  socks = await Product.create({ name: "Section Socks", slug: "section-socks", category: running._id, brand: "Nexthlon", basePrice: 50000, mrp: 60000, stock: 3, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  ashaCookie = (await call("POST", "/api/signup", { body: { name: "Asha Nair", email: "asha@sections.test", password: "trail2024", confirmPassword: "trail2024" } })).cookie;
  raviCookie = (await call("POST", "/api/signup", { body: { name: "Ravi Menon", email: "ravi@sections.test", password: "trail2024", confirmPassword: "trail2024" } })).cookie;
  asha = await User.findOne({ email: "asha@sections.test" });
  ravi = await User.findOne({ email: "ravi@sections.test" });
  adminCookie = (await call("POST", "/api/admin/login", { body: { email: "admin@sections.test", password: "AdminPass123" } })).cookie;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

// ======================= Analytics =======================

test("analytics: totals, the series behind each chart, and the carts-to-orders funnel", async () => {
  await makeOrder(asha, shoe, { paymentMethod: "razorpay", quantity: 2 });
  await makeOrder(ravi, socks, { paymentMethod: "cod", paymentStatus: "pending", orderStatus: "placed", itemStatus: "placed" });

  assert.equal((await call("GET", "/api/admin/analytics")).status, 401);
  assert.equal((await call("GET", "/api/admin/analytics", { cookie: ashaCookie })).status, 401);

  const res = await call("GET", "/api/admin/analytics?range=30d", { cookie: adminCookie });
  assert.equal(res.status, 200);
  const data = res.data;

  // Everything the section promises is in the answer.
  const cards = Object.fromEntries(data.cards.map(c => [c.key, c.value]));
  assert.deepEqual(Object.keys(cards).sort(), ["aov", "buyers", "cartToOrder", "customers", "newCustomers", "orders", "revenue", "units"].filter(k => k !== "customers").sort());
  assert.equal(cards.orders, 2);
  // Only the paid order counts as revenue: 2 shoes at the selling price.
  assert.equal(cards.revenue, shoe.price * 2);
  assert.equal(cards.aov, shoe.price * 2);
  assert.equal(cards.units, 3);
  assert.equal(cards.buyers, 2);

  assert.ok(data.timeline.length > 0);
  assert.equal(data.timeline.reduce((sum, p) => sum + p.orders, 0), 2);
  assert.ok(data.newReturning.length > 0);
  assert.equal(data.newReturning.reduce((sum, p) => sum + p.newCustomers, 0), 2);

  assert.deepEqual(data.topProducts.byRevenue.map(p => p.name), ["Section Trail Shoe", "Section Socks"]);
  assert.deepEqual(data.topProducts.byUnits.map(p => p.units), [2, 1]);
  assert.deepEqual(data.topCategories.map(c => c.name), ["Running"]);

  // The payment split covers Razorpay, wallet and COD.
  const methods = Object.fromEntries(data.payments.map(p => [p.key, p.count]));
  assert.equal(methods.razorpay, 1);
  assert.equal(methods.cod, 1);
  assert.equal(data.payments.reduce((sum, p) => sum + p.share, 0), 100);

  // Conversion: orders against shoppers who filled a basket.
  assert.equal(data.funnel.orders, 2);
  assert.equal(data.funnel.paid, 1);
  assert.equal(typeof data.funnel.cartToOrder, "number");
});

test("analytics: the grouping can be day, week or month, and silly values fall back", async () => {
  const group = async query => (await call("GET", `/api/admin/analytics?${query}`, { cookie: adminCookie })).data.group;
  assert.equal((await group("range=30d&by=day")).unit, "day");
  assert.equal((await group("range=30d&by=week")).unit, "week");
  assert.equal((await group("range=year&by=month")).unit, "month");
  // A week needs at least a week of range, so "today" ignores it.
  assert.equal((await group("range=today&by=week")).key, "auto");
  // Junk is ignored rather than trusted.
  assert.equal((await group("range=30d&by=%24ne")).key, "auto");

  const weekly = await call("GET", "/api/admin/analytics?range=30d&by=week", { cookie: adminCookie });
  // A week bucket is labelled with the range it covers.
  assert.match(weekly.data.timeline[0].label, / – /);
});

test("analytics: the page renders and the CSV holds every block", async () => {
  const page = await call("GET", `${ADMIN}/analytics?range=30d&by=week`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-analytics=/);
  assert.match(page.data, /data-chart="timeline"/);
  assert.match(page.data, /data-chart="payments"/);
  assert.match(page.data, /data-chart="newReturning"/);
  assert.match(page.data, /data-chart="categories"/);
  assert.match(page.data, /Carts → orders|Carts &#8594; orders/);
  // No chart library, and no inline script (the CSP forbids one).
  assert.doesNotMatch(page.data, /chart\.js|cdn\./i);
  assert.doesNotMatch(page.data, /<script>[^<]/);

  assert.equal((await call("GET", "/api/admin/reports/analytics.csv")).status, 401);
  const csv = await call("GET", "/api/admin/reports/analytics.csv?range=30d", { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.match(csv.headers.get("content-disposition"), /attachment; filename="nexthlon-analytics-/);
  for (const heading of ["Totals", "Revenue and orders over time", "New vs returning customers",
    "Top products by revenue", "Top products by units", "Top categories", "Payment methods", "Conversion (carts to orders)"]) {
    assert.ok(csv.data.includes(heading), `the CSV should have a "${heading}" block`);
  }
  assert.ok(csv.data.includes("Section Trail Shoe"));
});

// ======================= Inventory =======================

test("inventory: bands, filters, stock value and the CSV export", async () => {
  assert.equal((await call("GET", "/api/admin/inventory")).status, 401);
  const all = await call("GET", "/api/admin/inventory", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.pagination.total, 2);
  // Lowest stock first by default, so what needs attention is at the top.
  assert.deepEqual(all.data.products.map(p => p.name), ["Section Socks", "Section Trail Shoe"]);
  assert.equal(all.data.products[0].state, "low");
  assert.equal(all.data.products[0].stockValue, socks.price * 3);
  assert.equal(all.data.totals.units, 13);
  assert.equal(all.data.totals.value, shoe.price * 10 + socks.price * 3);
  assert.equal(all.data.totals.low, 1);
  assert.equal(all.data.totals.out, 0);

  const by = async query => (await call("GET", `/api/admin/inventory?${query}`, { cookie: adminCookie })).data.products.map(p => p.name);
  assert.deepEqual(await by("status=low"), ["Section Socks"]);
  assert.deepEqual(await by("status=healthy"), ["Section Trail Shoe"]);
  assert.deepEqual(await by("q=socks"), ["Section Socks"]);
  assert.deepEqual(await by("sort=stock_desc"), ["Section Trail Shoe", "Section Socks"]);
  assert.deepEqual(await by("sort=value_desc"), ["Section Trail Shoe", "Section Socks"]);
  assert.equal((await by("status=%24ne&sort=%7B%7D")).length, 2); // junk filters are ignored

  const page = await call("GET", `${ADMIN}/inventory?status=low`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-inv-form="/);
  assert.match(page.data, /Section Socks/);

  const csv = await call("GET", "/api/admin/inventory/export.csv", { cookie: adminCookie });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type"), /text\/csv/);
  assert.ok(csv.data.includes("Stock value (Rs)"));
  assert.ok(csv.data.includes("Section Socks"));
});

test("inventory: add, remove and set the exact count, and stock can never go negative", async () => {
  const change = (id, body) => call("PATCH", `/api/admin/inventory/${id}`, { body, cookie: adminCookie });

  const added = await change(socks._id, { action: "add", units: 7 });
  assert.equal(added.status, 200);
  assert.equal(added.data.product.stock, 10);
  assert.match(added.data.message, /up 7/);

  const removed = await change(socks._id, { action: "remove", units: 4 });
  assert.equal(removed.data.product.stock, 6);

  // Taking more than there is would make the shelf negative, so it is refused.
  const tooMany = await change(socks._id, { action: "remove", units: 99 });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.data.message, /only has 6 in stock/);
  assert.equal((await Product.findById(socks._id).lean()).stock, 6);

  // Setting the count replaces the number (after counting the shelf).
  const counted = await change(socks._id, { action: "count", units: 3, note: "Shelf count" });
  assert.equal(counted.data.product.stock, 3);
  assert.equal(counted.data.product.state, "low");

  // Validation and the audit trail.
  assert.equal((await change(socks._id, { action: "zap", units: 1 })).status, 400);
  assert.equal((await change(socks._id, { action: "add", units: 0 })).status, 400);
  assert.equal((await change(socks._id, { action: "add", units: "x" })).status, 400);
  assert.equal((await change("not-an-id", { action: "add", units: 1 })).status, 404);
  assert.equal((await call("PATCH", `/api/admin/inventory/${socks._id}`, { body: { action: "add", units: 1 }, cookie: ashaCookie })).status, 401);

  const logged = await AuditLog.findOne({ action: "inventory.stock_changed", target: `product:${socks._id}` }).sort({ at: -1 }).lean();
  assert.ok(logged, "a stock change should be written to the audit log");
  assert.equal(logged.after.action, "count");
  assert.equal(logged.after.note, "Shelf count");
  // Undo the one extra unit so later tests see the stock they expect.
  await change(socks._id, { action: "add", units: 0 }).catch(() => {});
});

// ======================= Reviews =======================

let ashaReview;

test("reviews: list, filter and search, for admins only", async () => {
  // Both customers had the product delivered, so both may review it.
  await makeOrder(asha, shoe);
  await makeOrder(ravi, shoe);
  const first = await call("POST", `/api/products/${shoe._id}/reviews`, { body: { rating: 5, title: "Superb grip", body: "Brilliant on wet trails, very grippy." }, cookie: ashaCookie });
  assert.equal(first.status, 201);
  ashaReview = first.data.review.id;
  const second = await call("POST", `/api/products/${shoe._id}/reviews`, { body: { rating: 2, title: "Runs small", body: "Had to send them back, far too narrow for me." }, cookie: raviCookie });
  assert.equal(second.status, 201);

  assert.equal((await call("GET", "/api/admin/reviews")).status, 401);
  const all = await call("GET", "/api/admin/reviews", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.totals.all, 2);
  assert.equal(all.data.totals.hidden, 0);
  assert.equal(all.data.totals.average, 3.5);

  const by = async query => (await call("GET", `/api/admin/reviews?${query}`, { cookie: adminCookie })).data.reviews.map(r => r.rating);
  assert.deepEqual(await by("rating=2"), [2]);
  assert.deepEqual(await by("sort=rating_asc"), [2, 5]);
  assert.deepEqual(await by("q=grippy"), [5]);
  assert.deepEqual(await by("q=narrow"), [2]);
  // Both were written in the same instant, so the newer _id decides: Ravi's 2-star first.
  assert.deepEqual(await by(`product=${shoe._id}`), [2, 5]);
  assert.equal((await by("rating=99&visibility=%24ne")).length, 2); // junk filters are ignored

  const page = await call("GET", `${ADMIN}/reviews`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-review-toggle/);
  assert.match(page.data, /Superb grip/);
});

test("reviews: hiding one takes it off the store and out of the stars; showing it puts it back", async () => {
  const before = await Product.findById(shoe._id).lean();
  assert.equal(before.ratingAverage, 3.5);
  assert.equal(before.ratingCount, 2);

  // A reason is required, so the audit log always says why.
  assert.equal((await call("PATCH", `/api/admin/reviews/${ashaReview}/hidden`, { body: { isHidden: true }, cookie: adminCookie })).status, 400);

  const hidden = await call("PATCH", `/api/admin/reviews/${ashaReview}/hidden`, { body: { isHidden: true, reason: "Mentions a competitor" }, cookie: adminCookie });
  assert.equal(hidden.status, 200);
  assert.equal(hidden.data.review.isHidden, true);
  // The stars are worked out again from the visible reviews only.
  assert.equal(hidden.data.rating.average, 2);
  assert.equal(hidden.data.rating.count, 1);

  // The store no longer shows it, in the API or on the page.
  const storeList = await call("GET", `/api/products/${shoe._id}/reviews`);
  assert.equal(storeList.data.reviews.length, 1);
  assert.equal(storeList.data.pagination.total, 1);
  assert.ok(!storeList.data.reviews.some(r => r.id === ashaReview));
  assert.doesNotMatch((await call("GET", `/products/${shoe.slug}`)).data, /Superb grip/);
  // The star breakdown drops it too.
  assert.equal(storeList.data.breakdown.find(row => row.stars === 5).count, 0);

  assert.ok(await AuditLog.exists({ action: "review.hidden", target: `review:${ashaReview}` }));

  const shown = await call("PATCH", `/api/admin/reviews/${ashaReview}/hidden`, { body: { isHidden: false }, cookie: adminCookie });
  assert.equal(shown.data.rating.average, 3.5);
  assert.equal((await call("GET", `/api/products/${shoe._id}/reviews`)).data.reviews.length, 2);
  assert.ok(await AuditLog.exists({ action: "review.shown", target: `review:${ashaReview}` }));
});

test("reviews: deleting one is final and the stars follow", async () => {
  assert.equal((await call("DELETE", `/api/admin/reviews/${ashaReview}`, { cookie: ashaCookie })).status, 401);
  const gone = await call("DELETE", `/api/admin/reviews/${ashaReview}`, { cookie: adminCookie });
  assert.equal(gone.status, 200);
  assert.equal(gone.data.rating.count, 1);
  assert.equal(gone.data.rating.average, 2);
  assert.equal(await Review.countDocuments({ _id: ashaReview }), 0);
  assert.ok(await AuditLog.exists({ action: "review.deleted", target: `review:${ashaReview}` }));
  assert.equal((await call("DELETE", `/api/admin/reviews/${ashaReview}`, { cookie: adminCookie })).status, 404);
});

// ======================= Questions & answers =======================

let questionId;

test("Q&A store side: anyone reads, customers ask, and the text is never treated as markup", async () => {
  // Guests may read but not ask.
  assert.equal((await call("GET", `/api/products/${shoe._id}/questions`)).status, 200);
  assert.equal((await call("POST", `/api/products/${shoe._id}/questions`, { body: { body: "Is this waterproof at all?" } })).status, 401);

  // Validation: too short, and too long.
  assert.equal((await call("POST", `/api/products/${shoe._id}/questions`, { body: { body: "short" }, cookie: ashaCookie })).status, 400);
  assert.equal((await call("POST", `/api/products/${shoe._id}/questions`, { body: { body: "x".repeat(301) }, cookie: ashaCookie })).status, 400);

  const asked = await call("POST", `/api/products/${shoe._id}/questions`, { body: { body: "Does this shoe suit a wide foot? <script>alert(1)</script>" }, cookie: ashaCookie });
  assert.equal(asked.status, 201);
  questionId = asked.data.question.id;
  assert.equal(asked.data.question.author, "Asha N.");
  assert.equal(asked.data.question.answerCount, 0);

  // The product page shows the question as text: the tag is escaped, never a real script.
  const page = await call("GET", `/products/${shoe.slug}`);
  assert.match(page.data, /Questions &amp; answers|Questions &amp;amp; answers/);
  assert.match(page.data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page.data, /<script>alert\(1\)<\/script>/);

  // A missing or unlisted product is a 404, not a way to create stray questions.
  assert.equal((await call("POST", "/api/products/64b000000000000000000001/questions", { body: { body: "Anyone there at all?" }, cookie: ashaCookie })).status, 404);
});

test("Q&A store side: another customer answers, once, and Helpful is one vote each", async () => {
  const answered = await call("POST", `/api/questions/${questionId}/answers`, { body: { body: "Yes, I have wide feet and they fit well." }, cookie: raviCookie });
  assert.equal(answered.status, 201);
  assert.equal(answered.data.question.answerCount, 1);
  assert.equal(answered.data.question.answers[0].author, "Ravi M.");
  assert.equal(answered.data.question.answers[0].byTeam, false);
  const answerId = answered.data.question.answers[0].id;

  // One answer per customer per question.
  assert.equal((await call("POST", `/api/questions/${questionId}/answers`, { body: { body: "Saying it twice for effect." }, cookie: raviCookie })).status, 409);
  assert.equal((await call("POST", `/api/questions/${questionId}/answers`, { body: { body: "x" }, cookie: ashaCookie })).status, 400);
  assert.equal((await call("POST", `/api/questions/${questionId}/answers`, { body: { body: "Guests cannot answer." } })).status, 401);

  // Helpful on the answer: a vote, then the same press takes it back.
  const voted = await call("POST", `/api/questions/${questionId}/helpful`, { body: { answerId }, cookie: ashaCookie });
  assert.equal(voted.status, 200);
  assert.equal(voted.data.voted, true);
  assert.equal(voted.data.question.answers[0].helpful, 1);
  assert.equal(voted.data.question.answers[0].votedByMe, true);

  const again = await call("POST", `/api/questions/${questionId}/helpful`, { body: { answerId }, cookie: ashaCookie });
  assert.equal(again.data.voted, false);
  assert.equal(again.data.question.answers[0].helpful, 0);

  // Two different customers make two votes, not one.
  await call("POST", `/api/questions/${questionId}/helpful`, { body: { answerId }, cookie: ashaCookie });
  await call("POST", `/api/questions/${questionId}/helpful`, { body: { answerId }, cookie: raviCookie });
  const list = await call("GET", `/api/products/${shoe._id}/questions`, { cookie: ashaCookie });
  assert.equal(list.data.questions[0].answers[0].helpful, 2);

  // Helpful on the question itself works too, and guests cannot vote.
  assert.equal((await call("POST", `/api/questions/${questionId}/helpful`, { body: {}, cookie: ashaCookie })).data.question.helpful, 1);
  assert.equal((await call("POST", `/api/questions/${questionId}/helpful`, { body: {} })).status, 401);
  assert.equal((await call("POST", `/api/questions/${questionId}/helpful`, { body: { answerId: "64b000000000000000000009" }, cookie: ashaCookie })).status, 404);
});

test("Q&A store side: search, paging and the answered-first order", async () => {
  await call("POST", `/api/products/${shoe._id}/questions`, { body: { body: "How long does delivery usually take?" }, cookie: raviCookie });
  const found = await call("GET", `/api/products/${shoe._id}/questions?q=delivery`);
  assert.equal(found.data.questions.length, 1);
  assert.match(found.data.questions[0].body, /delivery/);
  assert.equal(found.data.search, "delivery");
  assert.equal((await call("GET", `/api/products/${shoe._id}/questions?q=nothinglikethis`)).data.total, 0);

  // Answered questions come first, because they help the next shopper most.
  const all = await call("GET", `/api/products/${shoe._id}/questions`);
  assert.equal(all.data.total, 2);
  assert.equal(all.data.answeredCount, 1);
  assert.equal(all.data.questions[0].id, questionId);
  // A silly page number falls back to the first page.
  assert.equal((await call("GET", `/api/products/${shoe._id}/questions?page=abc`)).data.pagination.page, 1);
});

test("Q&A admin side: unanswered first, answer as the team, edit, hide and delete", async () => {
  assert.equal((await call("GET", "/api/admin/questions")).status, 401);
  const waiting = await call("GET", "/api/admin/questions", { cookie: adminCookie });
  assert.equal(waiting.status, 200);
  assert.equal(waiting.data.totals.all, 2);
  assert.equal(waiting.data.totals.waiting, 1);
  // The default sort puts the question nobody has answered at the top.
  assert.equal(waiting.data.questions[0].answered, false);

  const by = async query => (await call("GET", `/api/admin/questions?${query}`, { cookie: adminCookie })).data.questions.map(q => q.answered);
  assert.deepEqual(await by("answered=no"), [false]);
  assert.deepEqual(await by("answered=yes"), [true]);
  assert.equal((await by(`product=${shoe._id}`)).length, 2);
  assert.equal((await by("q=delivery")).length, 1);

  // Answering posts as the team and is shown with the official badge.
  const unanswered = waiting.data.questions[0].id;
  const answered = await call("POST", `/api/admin/questions/${unanswered}/answer`, { body: { body: "Orders reach most PIN codes in 3 to 7 working days." }, cookie: adminCookie });
  assert.equal(answered.status, 200);
  const teamAnswer = answered.data.question.answers.find(a => a.byTeam);
  assert.ok(teamAnswer);
  assert.equal(teamAnswer.author, "Nexthlon Team");
  assert.equal(answered.data.question.answered, true);
  assert.ok(await AuditLog.exists({ action: "question.answered" }));

  // The store shows it, with the badge, above the customer answers.
  const storeView = await call("GET", `/api/products/${shoe._id}/questions`);
  const shown = storeView.data.questions.find(q => q.id === unanswered);
  assert.equal(shown.answers[0].byTeam, true);
  assert.equal(shown.answers[0].author, "Nexthlon Team");

  // Answering again edits that one answer, so the team never appears twice.
  const edited = await call("POST", `/api/admin/questions/${unanswered}/answer`, { body: { body: "Usually 3 to 5 working days." }, cookie: adminCookie });
  assert.equal(edited.data.question.answers.filter(a => a.byTeam).length, 1);
  assert.match(edited.data.question.answers.find(a => a.byTeam).body, /3 to 5/);

  // Editing the question's own wording.
  const reworded = await call("PATCH", `/api/admin/questions/${unanswered}`, { body: { body: "How long does delivery take to Kerala?" }, cookie: adminCookie });
  assert.equal(reworded.status, 200);
  assert.match(reworded.data.question.body, /Kerala/);
  assert.equal((await call("PATCH", `/api/admin/questions/${unanswered}`, { body: { body: "tiny" }, cookie: adminCookie })).status, 400);

  // Hiding the team answer puts the question back in the queue.
  const answerId = edited.data.question.answers.find(a => a.byTeam).id;
  const hiddenAnswer = await call("PATCH", `/api/admin/questions/${unanswered}/hidden`, { body: { isHidden: true, answerId }, cookie: adminCookie });
  assert.equal(hiddenAnswer.status, 200);
  assert.equal(hiddenAnswer.data.question.answered, false);
  const afterHide = await call("GET", `/api/products/${shoe._id}/questions`);
  assert.equal(afterHide.data.questions.find(q => q.id === unanswered).answers.length, 0);
  await call("PATCH", `/api/admin/questions/${unanswered}/hidden`, { body: { isHidden: false, answerId }, cookie: adminCookie });

  // Hiding a whole question takes it off the store but keeps it for the admin.
  const hiddenQuestion = await call("PATCH", `/api/admin/questions/${unanswered}/hidden`, { body: { isHidden: true }, cookie: adminCookie });
  assert.equal(hiddenQuestion.data.question.isHidden, true);
  assert.equal((await call("GET", `/api/products/${shoe._id}/questions`)).data.total, 1);
  assert.equal((await call("GET", "/api/admin/questions?hidden=yes", { cookie: adminCookie })).data.totals.hidden, 1);
  // A hidden question cannot be answered or voted on from the store.
  assert.equal((await call("POST", `/api/questions/${unanswered}/answers`, { body: { body: "Trying to sneak in." }, cookie: raviCookie })).status, 404);
  assert.equal((await call("POST", `/api/questions/${unanswered}/helpful`, { body: {}, cookie: ashaCookie })).status, 404);

  // Deleting one answer, then the whole question.
  const customerAnswer = (await call("GET", "/api/admin/questions?answered=yes", { cookie: adminCookie })).data.questions[0];
  const toDelete = customerAnswer.answers[0].id;
  const answerGone = await call("DELETE", `/api/admin/questions/${customerAnswer.id}?answerId=${toDelete}`, { cookie: adminCookie });
  assert.equal(answerGone.status, 200);
  assert.equal(answerGone.data.deleted, "answer");
  assert.ok(await AuditLog.exists({ action: "question.answer_deleted" }));

  const questionGone = await call("DELETE", `/api/admin/questions/${unanswered}`, { cookie: adminCookie });
  assert.equal(questionGone.data.deleted, "question");
  assert.equal(await Question.countDocuments({ _id: unanswered }), 0);
  assert.ok(await AuditLog.exists({ action: "question.deleted" }));

  // Admin-only throughout.
  assert.equal((await call("POST", `/api/admin/questions/${questionId}/answer`, { body: { body: "Not an admin." }, cookie: ashaCookie })).status, 401);
  assert.equal((await call("DELETE", `/api/admin/questions/${questionId}`, { cookie: ashaCookie })).status, 401);

  const page = await call("GET", `${ADMIN}/questions`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-qa-answer="/);
  assert.match(page.data, /Nexthlon Team/);
});

test("Q&A: a customer cannot pile up unanswered questions on one product", async () => {
  // Three waiting questions is the limit; the fourth is refused.
  for (let n = 0; n < 3; n += 1) {
    const res = await call("POST", `/api/products/${socks._id}/questions`, { body: { body: `Waiting question number ${n} about these socks?` }, cookie: ashaCookie });
    assert.equal(res.status, 201);
  }
  const blocked = await call("POST", `/api/products/${socks._id}/questions`, { body: { body: "One question too many about these socks?" }, cookie: ashaCookie });
  assert.equal(blocked.status, 429);
  assert.match(blocked.data.message, /already have 3 questions waiting/);
  // Another customer is unaffected, and so is another product.
  assert.equal((await call("POST", `/api/products/${socks._id}/questions`, { body: { body: "Ravi still has a question to ask here?" }, cookie: raviCookie })).status, 201);
});

// ======================= Coupons =======================

let couponId;

test("coupons: create with full validation, and the code must be unique", async () => {
  assert.equal((await call("POST", "/api/admin/coupons", { body: {}, cookie: ashaCookie })).status, 401);

  const bad = await call("POST", "/api/admin/coupons", {
    body: { code: "ab", type: "percent", value: 95, startsAt: "2026-05-01", endsAt: "2026-04-01", perUserLimit: 500 },
    cookie: adminCookie
  });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.errors.code, "a short code is refused");
  assert.ok(bad.data.errors.value, "more than 90% is refused");
  assert.ok(bad.data.errors.endsAt, "an expiry before the start is refused");
  assert.ok(bad.data.errors.perUserLimit);

  const made = await call("POST", "/api/admin/coupons", {
    body: { code: " run10 ", type: "percent", value: 10, maxDiscount: 500, minOrder: 1000, endsAt: "2030-12-31", usageLimit: 3, perUserLimit: 1, isActive: true },
    cookie: adminCookie
  });
  assert.equal(made.status, 201);
  couponId = made.data.coupon.id;
  // The code is cleaned and stored in capitals, and money is kept in paise.
  assert.equal(made.data.coupon.code, "RUN10");
  assert.equal(made.data.coupon.value, 10);
  assert.equal(made.data.coupon.maxDiscount, 50000);
  assert.equal(made.data.coupon.minOrder, 100000);
  assert.equal(made.data.coupon.status, "active");
  assert.ok(await AuditLog.exists({ action: "coupon.created", target: `coupon:${couponId}` }));

  // The same code twice is refused with a field error, not a server error.
  const duplicate = await call("POST", "/api/admin/coupons", { body: { code: "RUN10", type: "flat", value: 50 }, cookie: adminCookie });
  assert.equal(duplicate.status, 409);
  assert.ok(duplicate.data.errors.code);

  // A flat coupon bigger than its own minimum order would pay people to shop.
  const silly = await call("POST", "/api/admin/coupons", { body: { code: "SILLY", type: "flat", value: 500, minOrder: 100 }, cookie: adminCookie });
  assert.equal(silly.status, 400);
  // A cap only makes sense on a percent coupon.
  const capOnFlat = await call("POST", "/api/admin/coupons", { body: { code: "FLATCAP", type: "flat", value: 50, maxDiscount: 10 }, cookie: adminCookie });
  assert.equal(capOnFlat.status, 400);
  assert.ok(capOnFlat.data.errors.maxDiscount);

  const form = await call("GET", `${ADMIN}/coupons/new`, { cookie: adminCookie });
  assert.equal(form.status, 200);
  assert.match(form.data, /data-coupon-form/);
});

test("coupons: list with status, search, filters and sorting", async () => {
  await Coupon.create({ code: "OLD20", type: "percent", value: 20, endsAt: new Date("2020-01-01"), description: "Last winter" });
  await Coupon.create({ code: "SOON15", type: "percent", value: 15, startsAt: new Date("2099-01-01") });
  await Coupon.create({ code: "OFFNOW", type: "flat", value: 10000, isActive: false });

  const all = await call("GET", "/api/admin/coupons", { cookie: adminCookie });
  assert.equal(all.status, 200);
  assert.equal(all.data.totals.all, 4);
  assert.equal(all.data.totals.active, 1);
  assert.equal(all.data.totals.expired, 1);
  assert.equal(all.data.totals.scheduled, 1);
  assert.equal(all.data.totals.disabled, 1);

  const by = async query => (await call("GET", `/api/admin/coupons?${query}`, { cookie: adminCookie })).data.coupons.map(c => c.code);
  assert.deepEqual(await by("status=active"), ["RUN10"]);
  assert.deepEqual(await by("status=expired"), ["OLD20"]);
  assert.deepEqual(await by("status=scheduled"), ["SOON15"]);
  assert.deepEqual(await by("status=disabled"), ["OFFNOW"]);
  assert.deepEqual(await by("q=run"), ["RUN10"]);
  assert.deepEqual(await by("q=winter"), ["OLD20"]);
  assert.deepEqual(await by("sort=code_asc"), ["OFFNOW", "OLD20", "RUN10", "SOON15"]);
  assert.equal((await by("status=%24ne&sort=%7B%7D")).length, 4); // junk filters are ignored

  const page = await call("GET", `${ADMIN}/coupons?status=active`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /RUN10/);
  assert.match(page.data, /data-coupon-toggle/);
});

test("coupons: editing keeps the use count, and the enable/disable toggle works", async () => {
  const edited = await call("PATCH", `/api/admin/coupons/${couponId}`, {
    body: { code: "RUN10", type: "percent", value: 15, maxDiscount: 600, minOrder: 1000, endsAt: "2030-12-31", usageLimit: 3, perUserLimit: 1, isActive: true },
    cookie: adminCookie
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.coupon.value, 15);
  assert.equal(edited.data.coupon.usedCount, 0);
  assert.ok(await AuditLog.exists({ action: "coupon.updated", target: `coupon:${couponId}` }));
  assert.equal((await call("PATCH", `/api/admin/coupons/${couponId}`, { body: { code: "RUN10", type: "percent", value: 999 }, cookie: adminCookie })).status, 400);

  const off = await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: false }, cookie: adminCookie });
  assert.equal(off.data.coupon.status, "disabled");
  assert.ok(await AuditLog.exists({ action: "coupon.disabled" }));
  assert.equal((await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: "nope" }, cookie: adminCookie })).status, 400);

  const on = await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: true }, cookie: adminCookie });
  assert.equal(on.data.coupon.status, "active");
  assert.ok(await AuditLog.exists({ action: "coupon.enabled" }));

  const edit = await call("GET", `${ADMIN}/coupons/${couponId}/edit`, { cookie: adminCookie });
  assert.equal(edit.status, 200);
  assert.match(edit.data, /value="RUN10"/);
});

test("coupons store side: the server decides, and a disabled coupon stops working at once", async () => {
  // Something in the basket, above the coupon's minimum order.
  await call("DELETE", "/api/cart", { cookie: ashaCookie });
  assert.equal((await call("POST", "/api/cart/items", { body: { productId: String(shoe._id), quantity: 1 } , cookie: ashaCookie })).status, 201);

  // The customer sees the coupons they could use.
  const offered = await call("GET", "/api/coupons", { cookie: ashaCookie });
  assert.equal(offered.status, 200);
  const codes = offered.data.coupons.map(c => c.code);
  assert.ok(codes.includes("RUN10"), "a running coupon is offered at checkout");
  assert.ok(!codes.includes("OLD20"), "an expired coupon is never offered");
  assert.ok(!codes.includes("SOON15"), "a coupon that has not started is never offered");
  assert.ok(!codes.includes("OFFNOW"), "a disabled coupon is never offered");

  // Applying it is judged on the server, against the live cart.
  const applied = await call("POST", "/api/checkout/coupon", { body: { code: "run10" }, cookie: ashaCookie });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.coupon.code, "RUN10");
  // 15% of ₹3,000 is ₹450, under the ₹600 cap.
  assert.equal(applied.data.coupon.saving, Math.round(shoe.price * 0.15));
  // The quote works the discount out again rather than trusting the browser.
  const quote = await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie });
  assert.equal(quote.data.quote.totals.couponDiscount, Math.round(shoe.price * 0.15));

  // Expired, not-yet-started, disabled and unknown codes are all refused by the server.
  for (const code of ["OLD20", "SOON15", "OFFNOW", "NOSUCH"]) {
    const res = await call("POST", "/api/checkout/coupon", { body: { code }, cookie: ashaCookie });
    assert.equal(res.status, 400, `${code} should be refused`);
  }

  // Disabling it while a customer holds it takes effect on the very next check.
  await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" }, cookie: ashaCookie });
  await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: false }, cookie: adminCookie });
  const afterOff = await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie });
  assert.equal(afterOff.data.quote.totals.couponDiscount, 0);
  assert.match(afterOff.data.quote.couponNotice, /not valid|expired/i);
  await call("PATCH", `/api/admin/coupons/${couponId}/active`, { body: { isActive: true }, cookie: adminCookie });

  // Removing it is a server action too.
  assert.equal((await call("DELETE", "/api/checkout/coupon", { cookie: ashaCookie })).status, 200);
  assert.equal((await call("POST", "/api/checkout/quote", { body: {}, cookie: ashaCookie })).data.quote.totals.couponDiscount, 0);
  // Guests have no cart, so they cannot apply anything.
  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" } })).status, 401);
});

test("coupons: the detail page shows who used it and the total discount given", async () => {
  // Two orders that used the coupon, recorded the way checkout records them.
  const order = await makeOrder(asha, shoe, { couponCode: "RUN10", couponDiscount: 45000 });
  const second = await makeOrder(ravi, shoe, { couponCode: "RUN10", couponDiscount: 45000 });
  await CouponRedemption.create([
    { coupon: couponId, user: asha._id, order: order._id, code: "RUN10", discount: 45000 },
    { coupon: couponId, user: ravi._id, order: second._id, code: "RUN10", discount: 45000 }
  ]);
  await Coupon.updateOne({ _id: couponId }, { $set: { usedCount: 2 } });

  const detail = await call("GET", `/api/admin/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.totals.uses, 2);
  assert.equal(detail.data.totals.customers, 2);
  assert.equal(detail.data.totals.discountGiven, 90000);
  assert.equal(detail.data.coupon.usesLeft, 1);
  const emails = detail.data.uses.map(u => u.customer && u.customer.email).sort();
  assert.deepEqual(emails, ["asha@sections.test", "ravi@sections.test"]);
  assert.ok(detail.data.uses.every(u => u.orderId.startsWith("NX-2026-")));

  const page = await call("GET", `${ADMIN}/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /asha@sections\.test/);
  assert.match(page.data, /RUN10/);
  assert.equal((await call("GET", `${ADMIN}/coupons/${couponId}`)).status, 404);
  assert.equal((await call("GET", "/api/admin/coupons/not-an-id", { cookie: adminCookie })).status, 404);
});

test("coupons: a soft delete keeps the history but the code can never be used again", async () => {
  const deleted = await call("DELETE", `/api/admin/coupons/${couponId}`, { cookie: adminCookie });
  assert.equal(deleted.status, 200);
  assert.ok(await AuditLog.exists({ action: "coupon.deleted", target: `coupon:${couponId}` }));

  // Gone from the admin list, and from the API.
  assert.ok(!(await call("GET", "/api/admin/coupons", { cookie: adminCookie })).data.coupons.some(c => c.code === "RUN10"));
  assert.equal((await call("GET", `/api/admin/coupons/${couponId}`, { cookie: adminCookie })).status, 404);

  // The row and its redemptions are still there, so reports and past orders stay correct.
  const row = await Coupon.findById(couponId).lean();
  assert.equal(row.isDeleted, true);
  assert.equal(row.usedCount, 2);
  assert.equal(await CouponRedemption.countDocuments({ coupon: couponId }), 2);

  // The store behaves as though the code never existed.
  assert.equal((await call("POST", "/api/checkout/coupon", { body: { code: "RUN10" }, cookie: ashaCookie })).status, 400);
  assert.ok(!(await call("GET", "/api/coupons", { cookie: ashaCookie })).data.coupons.some(c => c.code === "RUN10"));
});

// ======================= Customers and System =======================

test("customers: the list, blocking, and the search that feeds Ctrl+K", async () => {
  const list = await call("GET", "/api/admin/customers?q=asha", { cookie: adminCookie });
  assert.equal(list.status, 200);
  assert.equal(list.data.customers.length, 1);
  assert.equal(list.data.customers[0].passwordHash, undefined);

  const page = await call("GET", `${ADMIN}/customers`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /data-block-user/);

  // The console's search still offers customers, because the page exists again.
  const search = await call("GET", "/api/admin/search?q=asha", { cookie: adminCookie });
  assert.equal(search.data.results.customers[0].email, "asha@sections.test");
  assert.ok(Array.isArray(search.data.results.orders));
  assert.ok(Array.isArray(search.data.results.products));
});

test("system status: health, counts and what is switched on, with no secrets", async () => {
  assert.equal((await call("GET", "/api/admin/system")).status, 401);
  const res = await call("GET", "/api/admin/system", { cookie: adminCookie });
  assert.equal(res.status, 200);
  assert.equal(res.data.healthy, true);
  assert.equal(res.data.database.ok, true);
  assert.equal(typeof res.data.database.pingMs, "number");
  assert.ok(res.data.app.version);
  assert.ok(res.data.app.node.startsWith("v"));

  const counts = Object.fromEntries(res.data.counts.map(c => [c.label, c.value]));
  assert.ok(counts.Orders > 0);
  assert.ok(counts.Products >= 2);
  assert.equal(typeof counts["Signed-in devices"], "number");

  const features = Object.fromEntries(res.data.features.map(f => [f.key, f.on]));
  assert.equal(typeof features.razorpay, "boolean");
  assert.equal(typeof features.mail, "boolean");
  // The session rules are shown, but never a key or a secret.
  assert.equal(res.data.session[0].value, "15m");
  const text = JSON.stringify(res.data);
  assert.doesNotMatch(text, /rzp_test_dummykey|test-key-secret|test-webhook-secret|hs256-signing/);

  const page = await call("GET", `${ADMIN}/system`, { cookie: adminCookie });
  assert.equal(page.status, 200);
  assert.match(page.data, /System status/);
  assert.match(page.data, /data-system-refresh/);
  assert.doesNotMatch(page.data, /rzp_test_dummykey|test-key-secret/);
});
