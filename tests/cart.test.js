require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const { quantityProblem, buildCartView, limitFor, MAX_PER_PRODUCT } = require("../services/cartService");
const { validateCartItem, validateCartQuantity } = require("../utils/validators");

const shoe = { _id: "64b000000000000000000001", slug: "shoe", name: "Trail Shoe", brand: "Nexthlon", image: "/s.jpg", price: 2999, mrp: 3999, discountPercent: 25, stock: 3, isListed: true };

test("cart quantity can never go above the stock", () => {
  assert.equal(quantityProblem(shoe, 3), null);
  assert.match(quantityProblem(shoe, 4), /Only 3 left/);
  assert.equal(limitFor(shoe), 3);
});

test("cart quantity is at most 5 per product, and at least 1", () => {
  const plenty = { ...shoe, stock: 50 };
  assert.equal(MAX_PER_PRODUCT, 5);
  assert.equal(quantityProblem(plenty, 5), null);
  assert.match(quantityProblem(plenty, 6), /up to 5/);
  assert.equal(limitFor(plenty), 5);
  assert.ok(quantityProblem(plenty, 0));
  assert.ok(quantityProblem(plenty, 1.5));
});

test("unlisted, out-of-stock and missing products cannot be added", () => {
  assert.match(quantityProblem({ ...shoe, isListed: false }, 1), /no longer available/);
  assert.match(quantityProblem({ ...shoe, stock: 0 }, 1), /out of stock/);
  assert.match(quantityProblem(null, 1), /no longer available/);
});

test("cart totals use the price from the database, not the price when added", () => {
  const { items, summary } = buildCartView([{ product: shoe, quantity: 2, priceAtAdd: 1 }]);
  assert.equal(items[0].price, 2999);
  assert.equal(items[0].priceChanged, true);
  assert.equal(summary.subtotal, 5998);
  assert.equal(summary.mrpTotal, 7998);
  assert.equal(summary.savings, 2000);
  assert.equal(summary.grandTotal, 5998);
});

test("unavailable items stay in the cart but are left out of the total", () => {
  const tent = { ...shoe, _id: "64b000000000000000000002", name: "Tent", price: 5000, mrp: 5000, isListed: false };
  const bottle = { ...shoe, _id: "64b000000000000000000003", name: "Bottle", price: 500, mrp: 800, stock: 0 };
  const { items, summary } = buildCartView([
    { product: shoe, quantity: 1, priceAtAdd: 2999 },
    { product: tent, quantity: 2, priceAtAdd: 5000 },
    { product: bottle, quantity: 1, priceAtAdd: 500 },
    { product: null, quantity: 1, priceAtAdd: 10 }
  ]);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map(i => i.available), [true, false, false]);
  assert.deepEqual(items.map(i => i.reason), [null, "No longer sold", "Out of stock"]);
  assert.equal(summary.subtotal, 2999);
  assert.equal(summary.itemCount, 1);
  assert.equal(summary.unavailableCount, 2);
  assert.equal(summary.count, 4);
});

test("a cart line above the current stock is shown at the stock level", () => {
  const { items, summary } = buildCartView([{ product: { ...shoe, stock: 2 }, quantity: 5, priceAtAdd: 2999 }]);
  assert.equal(items[0].quantity, 2);
  assert.equal(items[0].maxQuantity, 2);
  assert.equal(summary.subtotal, 5998);
});

test("cart input validation reads only product id and a whole quantity", () => {
  const { errors, value } = validateCartItem({ productId: shoe._id, quantity: "2", price: 1 });
  assert.deepEqual(errors, {});
  assert.deepEqual(value, { productId: shoe._id, quantity: 2 });
  assert.equal(validateCartItem({ productId: shoe._id }).value.quantity, 1);
  assert.ok(validateCartItem({ productId: "../etc", quantity: 1 }).errors.productId);
  assert.ok(validateCartItem({ productId: shoe._id, quantity: "1.5" }).errors.quantity);
  assert.ok(validateCartQuantity({ quantity: 0 }).errors.quantity);
  assert.ok(validateCartQuantity({ quantity: "abc" }).errors.quantity);
  assert.equal(validateCartQuantity({ quantity: 3 }).value.quantity, 3);
});
