// GST invoices (B4): the tax split, rounding, coupon sharing, numbering, credit notes and the PDFs.
// The rules run without a database; the order flow needs TEST_MONGODB_URI (own database "_gst").
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const gst = require("../utils/gst");

const shoe = { hsn: "6404", rate: 5, rateAbove: 18, above: 250000 };
const ball = { hsn: "9506", rate: 5, rateAbove: null, above: null };

test("gst: Kerala to Kerala is CGST + SGST, Kerala to Delhi is IGST, and the money adds up exactly", () => {
  const lines = [{ lineTotal: 199900, price: 199900, quantity: 1, tax: shoe }, { lineTotal: 99800, price: 49900, quantity: 2, tax: ball }];
  const inside = gst.orderTax({ lines, sellerState: "Kerala", buyerState: "Kerala" });
  assert.equal(inside.interstate, false);
  assert.ok(inside.lines.every(line => line.igst === 0 && line.cgst > 0 && line.sgst > 0));
  // ₹1,999 shoe at 5%: 190381 + 9519 tax, split 4760 + 4759.
  assert.deepEqual(inside.lines[0], { hsn: "6404", rate: 5, discount: 0, value: 199900, taxable: 190381, cgst: 4760, sgst: 4759, igst: 0 });

  const across = gst.orderTax({ lines, sellerState: "Kerala", buyerState: "Delhi" });
  assert.equal(across.interstate, true);
  assert.equal(across.placeOfSupply, "Delhi");
  assert.ok(across.lines.every(line => line.cgst === 0 && line.sgst === 0 && line.igst > 0));
  assert.equal(across.totals.tax, inside.totals.tax, "the same tax, only split differently");
  for (const result of [inside, across]) {
    assert.equal(result.totals.taxable + result.totals.tax, result.totals.value);
    assert.equal(result.totals.value, 299700);
  }
});

test("gst: footwear above ₹2,500 a piece is 18%, and a coupon is shared out before tax", () => {
  assert.equal(gst.rateFor(shoe, 262500), 5, "₹2,625 with tax is ₹2,500 before tax: still 5%");
  assert.equal(gst.rateFor(shoe, 262600), 18);
  assert.equal(gst.rateFor(ball, 999900), 5, "one rate only");

  const result = gst.orderTax({
    lines: [{ lineTotal: 299900, price: 299900, quantity: 1, tax: shoe }, { lineTotal: 100100, price: 100100, quantity: 1, tax: ball }],
    couponDiscount: 40000,
    deliveryFee: 4000,
    sellerState: "Kerala",
    buyerState: "Kerala"
  });
  assert.equal(result.lines[0].rate, 18);
  assert.deepEqual(result.lines.map(line => line.discount), [29990, 10010], "shared by value, to the paisa");
  assert.equal(result.delivery.rate, 18, "delivery takes the highest rate in the order");
  assert.equal(result.totals.value, 299900 + 100100 - 40000 + 4000);
  assert.equal(result.totals.taxable + result.totals.tax, result.totals.value);
});

test("gst: shares, words, financial years and suggestions", () => {
  assert.deepEqual(gst.shareOut(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepEqual(gst.shareOut(0, [5, 5]), [0, 0]);
  assert.equal(gst.amountInWords(299700), "Two thousand nine hundred ninety-seven rupees only");
  assert.equal(gst.amountInWords(12345678950), "Twelve crore thirty-four lakh fifty-six thousand seven hundred eighty-nine rupees and fifty paise only");
  assert.equal(gst.financialYear(new Date("2027-03-31T12:00:00+05:30")), "26-27");
  assert.equal(gst.financialYear(new Date("2027-04-01T00:30:00+05:30")), "27-28", "India time decides");
  assert.equal(gst.suggestTax("TrailFlex 2 Trail Running Shoes").hsn, "6404");
  assert.equal(gst.suggestTax("Pro Match Football").hsn, "9506");
  assert.equal(gst.suggestTax("Dri-fit Training T-shirt").rateAbove, 18);
  assert.equal(gst.STATE_CODES.Kerala, "32");
  assert.equal(gst.STATE_CODES.Delhi, "07");
});

test("gst: product tax fields are checked", () => {
  const { validateProduct } = require("../utils/validators");
  const base = { name: "Trail shoe", category: "c".repeat(24), price: "1000", mrp: "1200", stock: "3" };
  assert.deepEqual(validateProduct({ ...base, hsn: "6404", gstRate: "5", gstRateAbove: "18", gstAbove: "2500" }).value.tax, { hsn: "6404", rate: 5, rateAbove: 18, above: 250000 });
  const bad = validateProduct({ ...base, hsn: "64", gstRate: "12" }).errors;
  assert.ok(bad.hsn && bad.gstRate, "12% is no longer a slab");
  assert.deepEqual(validateProduct({ ...base, hsn: "", gstRate: "" }).value.tax, { hsn: "", rate: null, rateAbove: null, above: null }, "empty: use the suggestion");
});

if (!process.env.TEST_MONGODB_URI) {
  test("gst database tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const Product = require("../models/Product");
const Order = require("../models/Order");
const categoryService = require("../services/categoryService");
const gstService = require("../services/gstService");
const { STORE } = require("../config/store");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_gst`;

let server;
let base;
let boot;
let football;
let socks;
let shopper;
const addresses = {};

function jar() {
  const cookies = new Map();
  return {
    header: () => [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    take(response) {
      const all = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
      all.filter(Boolean).forEach(line => {
        const [pair, ...attrs] = line.split(";");
        const at = pair.indexOf("=");
        const name = pair.slice(0, at).trim();
        const value = pair.slice(at + 1).trim();
        if (attrs.some(a => /expires=thu, 01 jan 1970/i.test(a)) || value === "") cookies.delete(name);
        else cookies.set(name, value);
      });
    }
  };
}

async function call(cookies, method, path, body) {
  const headers = { Accept: "application/json", Origin: base };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = cookies.header();
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, { method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body) });
  cookies.take(response);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : type.includes("pdf") ? Buffer.from(await response.arrayBuffer()) : await response.text();
  return { status: response.status, type, disposition: response.headers.get("content-disposition") || "", data };
}

async function order(state, items) {
  for (const [product, quantity] of items) {
    const added = await call(shopper, "POST", "/api/cart/items", { productId: String(product._id), quantity });
    assert.equal(added.status, 201, JSON.stringify(added.data));
  }
  const placed = await call(shopper, "POST", "/api/orders", { addressId: addresses[state], paymentMethod: "cod" });
  assert.equal(placed.status, 201, JSON.stringify(placed.data));
  // These tests place many orders for one shopper: count earlier ones as paid, so the cap on unpaid
  // Cash on Delivery orders on the way (checkoutService.MAX_OPEN_COD) stays out of the way.
  const saved = await Order.findOne({ orderId: placed.data.order.orderId }).lean();
  await Order.updateMany({ user: saved.user, _id: { $ne: saved._id }, paymentMethod: "cod" }, { $set: { paymentStatus: "paid" } });
  return saved;
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The GST test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  const running = await categoryService.ensureCategory("Running");
  categoryService.invalidate();
  boot = await Product.create({ name: "GST Trail Running Shoes", slug: "gst-trail-shoes", category: running._id, brand: "Nexthlon", basePrice: 199900, mrp: 249900, stock: 20, image: "/img/favicon.svg",
    tax: { hsn: "6404", rate: 5, rateAbove: 18, above: 250000 }, countryOfOrigin: "Vietnam", manufacturer: "Nexthlon Imports, Kochi", netQuantity: "1 pair" });
  socks = await Product.create({ name: "GST Running Socks", slug: "gst-running-socks", category: running._id, brand: "Nexthlon", basePrice: 19900, mrp: 24900, stock: 20, image: "/img/favicon.svg" });
  football = await Product.create({ name: "GST Match Football", slug: "gst-match-football", category: running._id, brand: "Nexthlon", basePrice: 49900, mrp: 59900, stock: 20, image: "/img/favicon.svg" });
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  shopper = jar();
  const signup = await call(shopper, "POST", "/api/signup", { name: "Tax Shopper", email: "tax.shopper@gst.test", password: "taxes2024run", confirmPassword: "taxes2024run" });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  for (const [state, city, pincode] of [["Kerala", "Kochi", "682001"], ["Delhi", "New Delhi", "110001"]]) {
    const made = await call(shopper, "POST", "/api/addresses", { fullName: "Tax Shopper", phone: "9876543210", line1: "12 Main Road", city, state, pincode });
    assert.equal(made.status, 201, JSON.stringify(made.data));
    const saved = made.data.address || made.data.addresses.find(a => a.state === state);
    addresses[state] = saved.id || saved._id;
  }
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("gst orders: a Kerala order is CGST + SGST with an invoice number; a Delhi order is IGST and the next number", async () => {
  assert.equal(STORE.state, "Kerala");
  const kerala = await order("Kerala", [[boot, 1], [football, 2]]);
  assert.equal(kerala.gst.interstate, false);
  assert.equal(kerala.gst.placeOfSupply, "Kerala");
  assert.match(kerala.gst.invoiceNo, /^NX\/\d{2}-\d{2}\/000001$/);
  assert.ok(kerala.items.every(item => item.tax && item.tax.cgst > 0 && item.tax.sgst > 0 && item.tax.igst === 0));
  assert.equal(kerala.items.find(item => item.name === "GST Trail Running Shoes").tax.hsn, "6404");
  assert.equal(kerala.items.find(item => item.name === "GST Match Football").tax.hsn, "9506", "no tax set: the suggestion");
  assert.equal(kerala.gst.taxable + kerala.gst.tax, kerala.gst.value);
  assert.equal(kerala.gst.value, kerala.subtotal - kerala.couponDiscount + kerala.deliveryFee);

  const delhi = await order("Delhi", [[socks, 1]]);
  assert.equal(delhi.gst.interstate, true);
  assert.equal(delhi.gst.placeOfSupply, "Delhi");
  assert.ok(delhi.items.every(item => item.tax.igst > 0 && item.tax.cgst === 0));
  assert.match(delhi.gst.invoiceNo, /\/000002$/, "one unbroken series");
  assert.ok(delhi.gst.delivery && delhi.gst.delivery.igst > 0, "a small order pays delivery, taxed too");

  // Issuing again changes nothing.
  const again = await gstService.issueInvoice(delhi._id);
  assert.equal(again.gst.invoiceNo, delhi.gst.invoiceNo);

  for (const placed of [kerala, delhi]) {
    const pdf = await call(shopper, "GET", `/orders/${placed.orderId}/invoice`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.type, /application\/pdf/);
    assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");
    assert.match(pdf.disposition, /filename="NX-\d{2}-\d{2}-00000\d\.pdf"/);
  }
});

test("gst orders: cancelling an invoiced item gives a credit note with the same tax, downloadable", async () => {
  const placed = await order("Kerala", [[boot, 1], [football, 1]]);
  const ballLine = placed.items.find(item => item.name === "GST Match Football");
  const cancel = await call(shopper, "POST", `/api/orders/${placed.orderId}/items/${ballLine._id}/cancel`, { reason: "Ordered by mistake" });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.data));
  const after = await Order.findById(placed._id).lean();
  assert.equal(after.creditNotes.length, 1);
  const note = after.creditNotes[0];
  assert.match(note.number, /^CN\/\d{2}-\d{2}\/000001$/);
  assert.equal(note.lines.length, 1);
  assert.equal(note.lines[0].cgst, ballLine.tax.cgst);
  assert.equal(note.value, ballLine.tax.value);
  assert.equal(note.delivery, null, "the order goes on, so delivery is not taken back");

  // A second call covers nothing new.
  assert.equal(await gstService.syncCreditNotes(placed._id), null);

  const pdf = await call(shopper, "GET", `/orders/${placed.orderId}/credit-notes/0`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 4).toString(), "%PDF");
  assert.equal((await call(shopper, "GET", `/orders/${placed.orderId}/credit-notes/5`)).status, 404);
  const page = await call(shopper, "GET", `/orders/${placed.orderId}`);
  assert.match(page.data, /Credit note CN\/\d{2}-\d{2}\/000001/);
});

test("gst orders: an unpaid online order has no invoice yet", async () => {
  const placed = await order("Kerala", [[football, 1]]);
  await Order.updateOne({ _id: placed._id }, { $set: { "gst.invoiceNo": "", paymentMethod: "razorpay", paymentStatus: "pending" } });
  const refused = await call(shopper, "GET", `/orders/${placed.orderId}/invoice`);
  assert.equal(refused.status, 409);
  const issued = await gstService.issueInvoice(placed._id);
  assert.match(issued.gst.invoiceNo, /^NX\//);
  assert.equal((await call(shopper, "GET", `/orders/${placed.orderId}/invoice`)).status, 200);
});

test("gst orders: the product page shows the legally required details", async () => {
  const page = await call(jar(), "GET", `/products/${boot.slug}`);
  assert.match(page.data, /<dt>Country of origin<\/dt><dd>Vietnam<\/dd>/);
  assert.match(page.data, /<dt>Net quantity<\/dt><dd>1 pair<\/dd>/);
  assert.match(page.data, /<dt>Manufacturer \/ importer<\/dt><dd>Nexthlon Imports, Kochi<\/dd>/);
  assert.match(page.data, /Inclusive of all taxes \(GST\)/);
});
