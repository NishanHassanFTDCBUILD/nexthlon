// "npm run images:migrate": gives older photos their small copies and moves photos to Cloudinary, rewriting
// every address saved in the database. Needs the test database, like the API tests.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("image migration tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const mongoose = require("mongoose");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const storage = require("../providers/storage");
const { createLocalStorage } = require("../providers/storage/local");
const { migrateImages } = require("../services/imageMigrationService");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_images`;

const OLD_JPG = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_PNG = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const GONE = "cccccccccccccccccccccccccccccccc";
const NEW = "dddddddddddddddddddddddddddddddd";
const RETURNED = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// An in-memory Cloudinary-like provider.
function fakeCloudinary() {
  const files = new Map();
  return {
    driver: "cloudinary",
    files,
    put: async (key, body) => { files.set(key, Buffer.from(body)); },
    remove: async keys => { keys.forEach(key => files.delete(key)); },
    publicUrl: key => `https://res.cloudinary.com/demo/image/upload/${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith("https://res.cloudinary.com/demo/image/upload/") ? url.slice(46) : null)
  };
}

const image = (width, height, format) => sharp({ create: { width, height, channels: 3, background: "#d4ff3a" } })[format]().toBuffer();

let root;
let local;

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
});

test.after(async () => {
  storage.reset();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// Fresh files and database rows for every test, so they do not depend on each other.
async function setUp(current) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "nexthlon-migrate-"));
  local = createLocalStorage({ root });
  storage.useForTests({ local, current: current || local });
  await mongoose.connection.dropDatabase();
  await local.put(`products/${OLD_JPG}.jpg`, await image(2400, 1600, "jpeg"));
  await local.put(`products/${OLD_PNG}.png`, await image(900, 900, "png"));
  await local.put(`returns/${RETURNED}.jpg`, await image(800, 600, "jpeg"));
  // A photo already in the new format, with its copies.
  for (const [size, width] of [["full", 1200], ["200", 200], ["400", 400], ["800", 800], ["1600", 1200]]) {
    await local.put(`products/${NEW}-${size}.webp`, await image(width, Math.round(width * 0.75), "webp"));
  }
  const now = new Date();
  await Product.collection.insertMany([
    { name: "Tent", slug: "tent", image: `/uploads/products/${OLD_JPG}.jpg`, gallery: [`/uploads/products/${OLD_JPG}.jpg`, `/uploads/products/${OLD_PNG}.png`, "https://images.unsplash.com/photo-1?w=800"], createdAt: now, updatedAt: now },
    { name: "Pole", slug: "pole", image: `/uploads/products/${NEW}-full.webp`, gallery: [`/uploads/products/${NEW}-full.webp`], createdAt: now, updatedAt: now },
    { name: "Ball", slug: "ball", image: "https://images.unsplash.com/photo-2?w=800", gallery: [], createdAt: now, updatedAt: now },
    { name: "Lost", slug: "lost", image: `/uploads/products/${GONE}.jpg`, gallery: [`/uploads/products/${GONE}.jpg`], createdAt: now, updatedAt: now }
  ]);
  await Category.collection.insertMany([
    { name: "Camping", nameKey: "camping", slug: "camping", image: `/uploads/products/${OLD_JPG}.jpg` },
    { name: "Football", nameKey: "football", slug: "football", image: "https://images.unsplash.com/photo-3?w=800" }
  ]);
  await Order.collection.insertMany([{
    orderId: "NX-1",
    items: [{ name: "Tent", image: `/uploads/products/${OLD_JPG}.jpg` }, { name: "Mat", image: `/uploads/products/${OLD_PNG}.png` }, { name: "Ball", image: "https://images.unsplash.com/photo-2?w=800" }],
    returnPhotos: [`/uploads/returns/${RETURNED}.jpg`]
  }]);
}

const one = async (Model, filter) => Model.collection.findOne(filter);

test("older photos get small copies on the same disk, and every address that pointed at them follows", async () => {
  await setUp();
  const report = await migrateImages();
  assert.equal(report.driver, "local");
  assert.equal(report.migrated, 2, "the two older product photos (the missing one is only reported)");
  assert.deepEqual(report.missing, [`/uploads/products/${GONE}.jpg`]);
  assert.equal(report.filesWritten, 10, "five files for each photo");

  const moved = Object.fromEntries(report.moves.map(({ from, to }) => [from, to]));
  const tentNew = moved[`/uploads/products/${OLD_JPG}.jpg`];
  const matNew = moved[`/uploads/products/${OLD_PNG}.png`];
  assert.match(tentNew, /^\/uploads\/products\/[a-f0-9]{32}-full\.webp$/);

  // The new files are really there, at the right sizes.
  const id = tentNew.match(/([a-f0-9]{32})-full/)[1];
  for (const [size, width] of [["200", 200], ["400", 400], ["800", 800], ["1600", 1600]]) {
    assert.equal((await sharp(await local.read(`products/${id}-${size}.webp`)).metadata()).width, width, size);
  }
  assert.equal((await sharp(await local.read(`products/${id}-full.webp`)).metadata()).width, 2000, "2400px photo shrunk to the 2000px limit");

  // Products (image and gallery, in order), categories and order lines all follow.
  const tent = await one(Product, { slug: "tent" });
  assert.equal(tent.image, tentNew);
  assert.deepEqual(tent.gallery, [tentNew, matNew, "https://images.unsplash.com/photo-1?w=800"]);
  assert.equal((await one(Category, { name: "Camping" })).image, tentNew);
  assert.deepEqual((await one(Order, { orderId: "NX-1" })).items.map(line => line.image), [tentNew, matNew, "https://images.unsplash.com/photo-2?w=800"]);
  // Not touched: Unsplash photos, a photo already in the new format, and the one with no file.
  assert.equal((await one(Product, { slug: "ball" })).image, "https://images.unsplash.com/photo-2?w=800");
  assert.equal((await one(Product, { slug: "pole" })).image, `/uploads/products/${NEW}-full.webp`);
  assert.equal((await one(Product, { slug: "lost" })).image, `/uploads/products/${GONE}.jpg`);
  // Return photos stay where they are on the same disk.
  assert.deepEqual((await one(Order, { orderId: "NX-1" })).returnPhotos, [`/uploads/returns/${RETURNED}.jpg`]);
  // The old files are kept, so nothing else that points at them breaks.
  assert.ok(await local.read(`products/${OLD_JPG}.jpg`));
  // Orders and products keep their own "last changed" time.
  assert.equal((await one(Product, { slug: "tent" })).updatedAt.getTime(), (await one(Product, { slug: "ball" })).updatedAt.getTime());
});

test("running it again changes nothing", async () => {
  await setUp();
  await migrateImages();
  const before = await Product.collection.find({}).sort({ slug: 1 }).toArray();
  const again = await migrateImages();
  assert.equal(again.migrated, 0);
  assert.equal(again.filesWritten, 0);
  assert.deepEqual(await Product.collection.find({}).sort({ slug: 1 }).toArray(), before);
});

test("a dry run reports everything and writes nothing", async () => {
  await setUp();
  const before = await Product.collection.find({}).sort({ slug: 1 }).toArray();
  const filesBefore = (await fs.readdir(path.join(root, "products"))).sort();
  const report = await migrateImages({ dryRun: true });
  assert.equal(report.dryRun, true);
  assert.equal(report.migrated, 2);
  assert.equal(report.filesWritten, 10, "what it would write");
  assert.deepEqual(await Product.collection.find({}).sort({ slug: 1 }).toArray(), before);
  assert.deepEqual((await fs.readdir(path.join(root, "products"))).sort(), filesBefore);
});

test("switching to Cloudinary: every photo on disk is uploaded, and the addresses become Cloudinary URLs", async () => {
  const cloud = fakeCloudinary();
  await setUp(cloud);
  const report = await migrateImages();
  assert.equal(report.driver, "cloudinary");
  // Two older product photos, one already-new photo, and one return photo.
  assert.equal(report.migrated, 4);
  const moved = Object.fromEntries(report.moves.map(({ from, to }) => [from, to]));

  // The photo that already had its copies is copied as it is: same name, same bytes.
  assert.equal(moved[`/uploads/products/${NEW}-full.webp`], `https://res.cloudinary.com/demo/image/upload/products/${NEW}-full.webp`);
  for (const size of ["full", "200", "400", "800", "1600"]) {
    assert.deepEqual(cloud.files.get(`products/${NEW}-${size}.webp`), await local.read(`products/${NEW}-${size}.webp`), size);
  }
  // Older photos are converted on the way, and return photos go as one WebP.
  const tentNew = moved[`/uploads/products/${OLD_JPG}.jpg`];
  assert.match(tentNew, /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/products\/[a-f0-9]{32}-full\.webp$/);
  assert.ok(cloud.files.has(tentNew.slice(46).replace("-full", "-400")));
  const returnedNew = moved[`/uploads/returns/${RETURNED}.jpg`];
  assert.match(returnedNew, /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/returns\/[a-f0-9]{32}\.webp$/);
  assert.equal((await sharp(cloud.files.get(returnedNew.slice(46))).metadata()).format, "webp");

  assert.equal((await one(Product, { slug: "pole" })).image, `https://res.cloudinary.com/demo/image/upload/products/${NEW}-full.webp`);
  assert.equal((await one(Product, { slug: "tent" })).image, tentNew);
  assert.deepEqual((await one(Order, { orderId: "NX-1" })).returnPhotos, [returnedNew]);
  assert.equal((await one(Product, { slug: "ball" })).image, "https://images.unsplash.com/photo-2?w=800");

  // Run again: the addresses are Cloudinary URLs now, so there is nothing left to move.
  const again = await migrateImages();
  assert.equal(again.migrated, 0);
});

test("if Cloudinary fails, no address is changed and what was uploaded is cleaned up", async () => {
  const cloud = fakeCloudinary();
  let puts = 0;
  const realPut = cloud.put;
  cloud.put = async (key, body) => { puts += 1; if (puts === 7) throw new Error("Cloudinary down"); return realPut(key, body); };
  await setUp(cloud);
  const before = await Product.collection.find({}).sort({ slug: 1 }).toArray();
  await assert.rejects(() => migrateImages(), /Cloudinary down/);
  assert.deepEqual(await Product.collection.find({}).sort({ slug: 1 }).toArray(), before, "no address changed");
  // Photos that went up in full before the failure stay (they are harmless and the next run reuses the work).
  // The photo that failed part-way left nothing behind.
  const partial = [...cloud.files.keys()].filter(key => /-(full|200|400|800|1600)\.webp$/.test(key));
  assert.equal(partial.length % 5, 0, "only whole photos, never half of one");
});
