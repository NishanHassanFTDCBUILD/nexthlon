// Photo storage: the local provider and the image pipeline that makes the small copies,
// and the rules that turn a stored address into a srcset. No database needed.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const storage = require("../providers/storage");
const { createLocalStorage } = require("../providers/storage/local");
const images = require("../utils/images");
const imageService = require("../services/imageService");
const { checkEnv } = require("../config/schema");

const ID = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const CLOUD_URL = "https://res.cloudinary.com/demo/image/upload/";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "nexthlon-storage-"));
}
const exists = file => fs.access(file).then(() => true, () => false);
const photo = (width, height, extra = {}) => sharp({ create: { width, height, channels: 3, background: "#d4ff3a" } }).jpeg({ quality: 90 }).toBuffer().then(buffer => ({ buffer, originalname: "p.jpg", ...extra }));

// ---------- Local provider ----------

test("local storage writes, reads and removes files under its folder, and refuses to leave it", async () => {
  const root = await tempDir();
  const local = createLocalStorage({ root });
  await local.put("products/a-full.webp", Buffer.from("hello"));
  assert.equal((await local.read("products/a-full.webp")).toString(), "hello");
  assert.equal(local.publicUrl("products/a-full.webp"), "/uploads/products/a-full.webp");
  assert.equal(local.keyFromUrl("/uploads/products/a-full.webp"), "products/a-full.webp");
  assert.equal(local.keyFromUrl("https://cdn.nexthlon.in/products/a.webp"), null);
  // Random names never repeat, so overwriting would be a bug: it is refused.
  await assert.rejects(() => local.put("products/a-full.webp", Buffer.from("again")));
  await assert.rejects(() => local.put("../escape.txt", Buffer.from("x")), /Unsafe storage key/);
  await assert.rejects(() => local.remove(["../../etc/passwd"]), /Unsafe storage key/);
  // Removing is safe to repeat, and for files that never existed.
  await local.remove(["products/a-full.webp", "products/never-existed.webp"]);
  await local.remove(["products/a-full.webp"]);
  assert.equal(await exists(path.join(root, "products", "a-full.webp")), false);
});

// ---------- Which photo sizes are offered ----------

test("our own photos get card sizes from their stored address; older and outside photos do not", () => {
  const own = `/uploads/products/${ID}-full.webp`;
  assert.equal(images.srcsetFor(own), `/uploads/products/${ID}-400.webp 400w, /uploads/products/${ID}-800.webp 800w, /uploads/products/${ID}-1600.webp 1600w`);
  // The same rule on a CDN address.
  assert.equal(images.srcsetFor(`https://cdn.nexthlon.in/products/${ID}-full.webp`).split(", ")[0], `https://cdn.nexthlon.in/products/${ID}-400.webp 400w`);
  // Before small copies existed: nothing to offer, so the photo is used as it is.
  assert.equal(images.srcsetFor(`/uploads/products/${ID}.jpg`), "");
  assert.equal(images.srcsetFor(`/uploads/products/${ID}.webp`), "");
  assert.equal(images.srcsetFor("https://example.com/products/x-full.webp"), "");
  assert.equal(images.srcsetFor(undefined), "");
});

test("sizedUrl picks the smallest copy that is still sharp", () => {
  const own = `/uploads/products/${ID}-full.webp`;
  const at = width => images.sizedUrl(own, width);
  assert.equal(at(64), `/uploads/products/${ID}-200.webp`);
  assert.equal(at(200), `/uploads/products/${ID}-200.webp`);
  assert.equal(at(201), `/uploads/products/${ID}-400.webp`);
  assert.equal(at(700), `/uploads/products/${ID}-800.webp`);
  assert.equal(at(1600), `/uploads/products/${ID}-1600.webp`);
  assert.equal(at(2400), own, "bigger than any copy: the full photo");
  // Everything else is left alone, apart from Unsplash, which takes a width.
  assert.equal(images.sizedUrl(`/uploads/products/${ID}.jpg`, 200), `/uploads/products/${ID}.jpg`);
  assert.equal(images.sizedUrl("https://images.unsplash.com/photo-1?auto=format&w=800&q=80", 200), "https://images.unsplash.com/photo-1?auto=format&w=200&q=80");
  assert.equal(images.sizedUrl(undefined, 200), undefined);
});

test("the product page's big photo is offered at 800 and 1600, with 1600 as the fallback", () => {
  const own = `https://cdn.nexthlon.in/products/${ID}-full.webp`;
  assert.deepEqual(images.gallerySource(own), {
    src: `https://cdn.nexthlon.in/products/${ID}-1600.webp`,
    srcset: `https://cdn.nexthlon.in/products/${ID}-800.webp 800w, https://cdn.nexthlon.in/products/${ID}-1600.webp 1600w`
  });
  assert.deepEqual(images.gallerySource("https://images.unsplash.com/photo-1?w=800"), { src: "https://images.unsplash.com/photo-1?w=800", srcset: "" });
});

// ---------- The image pipeline ----------

test("an upload becomes a full WebP and four smaller copies, at most 2000px, never enlarged", async () => {
  // Noise, like a real photo: a flat colour compresses to almost nothing at every size.
  const noisy = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 40 } } }).jpeg({ quality: 90 }).toBuffer();
  const big = noisy;
  const { full, variants } = await imageService.renderImage(big, "products");
  const meta = await sharp(full).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 2000, 1000]);
  assert.deepEqual(variants.map(v => v.width), [200, 400, 800, 1600]);
  for (const variant of variants) {
    const m = await sharp(variant.buffer).metadata();
    assert.equal(m.format, "webp");
    assert.equal(m.width, variant.width, `${variant.width}px copy`);
  }
  const sizes = [...variants.map(v => v.buffer.length), full.length];
  assert.deepEqual(sizes, [...sizes].sort((x, y) => x - y), `each copy is a smaller file than the next: ${sizes.join(" < ")}`);

  // A small photo is not blown up: its copies are as wide as it is, and still exist.
  const small = await imageService.renderImage((await photo(300, 200)).buffer, "products");
  assert.equal((await sharp(small.full).metadata()).width, 300);
  const widths = (await Promise.all(small.variants.map(v => sharp(v.buffer).metadata()))).map(m => m.width);
  assert.deepEqual(widths, [200, 300, 300, 300], "copies wider than the photo are the photo's own width");
});

test("the saved photo is turned the right way up and carries no camera details", async () => {
  // A 100x50 photo that a phone marked "rotate 90 degrees", with location-style metadata.
  const raw = await sharp({ create: { width: 100, height: 50, channels: 3, background: "#123456" } })
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "private camera note" } } }).toBuffer();
  const { full } = await imageService.renderImage(raw, "products");
  const meta = await sharp(full).metadata();
  assert.deepEqual([meta.width, meta.height], [50, 100], "rotated upright");
  assert.equal(meta.exif, undefined);
  assert.ok(!full.toString("latin1").includes("private camera note"));
});

test("saveImages writes the five files under random names, and returns the full one's address", async () => {
  const root = await tempDir();
  storage.useForTests({ local: createLocalStorage({ root }) });
  try {
    const [url, second] = await imageService.saveImages([await photo(1200, 900), await photo(600, 600)], "products");
    assert.match(url, /^\/uploads\/products\/[a-f0-9]{32}-full\.webp$/);
    assert.notEqual(url, second);
    const id = url.match(/([a-f0-9]{32})-full/)[1];
    for (const size of ["full", "200", "400", "800", "1600"]) {
      assert.ok(await exists(path.join(root, "products", `${id}-${size}.webp`)), `${size} copy`);
    }
    assert.equal((await fs.readdir(path.join(root, "products"))).length, 10);
    // Return photos: one file, no small copies.
    const [returned] = await imageService.saveImages([await photo(1500, 1000)], "returns");
    assert.match(returned, /^\/uploads\/returns\/[a-f0-9]{32}\.webp$/);
    assert.equal((await fs.readdir(path.join(root, "returns"))).length, 1);
    assert.deepEqual(await imageService.saveImages([], "products"), []);
    await assert.rejects(async () => imageService.saveImages([await photo(10, 10)], "secrets"), /Unknown upload folder/);
  } finally {
    storage.reset();
  }
});

test("a photo that cannot be decoded is refused with a clear message and nothing is left behind", async () => {
  const root = await tempDir();
  storage.useForTests({ local: createLocalStorage({ root }) });
  try {
    // Starts like a PNG (so it passes the type check) but is not an image.
    const fake = { buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]), originalname: "x.png" };
    await assert.rejects(async () => imageService.saveImages([await photo(300, 300), fake], "products"), error => {
      assert.equal(error.status, 400);
      assert.match(error.message, /could not be processed/);
      assert.ok(error.fieldErrors.images);
      return true;
    });
    // The good first photo was rolled back too.
    assert.deepEqual(await fs.readdir(path.join(root, "products")).catch(() => []), []);
    await assert.rejects(() => imageService.saveImages([fake], "returns"), error => Boolean(error.fieldErrors.photos));
  } finally {
    storage.reset();
  }
});

test("if Cloudinary fails part-way, the files already uploaded are removed again", async () => {
  const written = new Map();
  const removed = [];
  let puts = 0;
  const flaky = {
    driver: "cloudinary",
    put: async key => { puts += 1; if (puts === 3) throw new Error("Cloudinary down"); written.set(key, true); },
    remove: async keys => { removed.push(...keys); },
    publicUrl: key => `${CLOUD_URL}${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith(CLOUD_URL) ? url.slice(CLOUD_URL.length) : null)
  };
  storage.useForTests({ local: createLocalStorage({ root: await tempDir() }), current: flaky });
  try {
    await assert.rejects(async () => imageService.saveImages([await photo(500, 500)], "products"), /Cloudinary down/);
    assert.equal(removed.length, 5, "all five keys of the photo are cleaned up, whether or not they were written");
    assert.ok([...written.keys()].every(key => removed.includes(key)));
  } finally {
    storage.reset();
  }
});

// ---------- Which addresses are ours, and deleting ----------

test("isUploadedImage: our new and older photos on disk or in Cloudinary, nothing else", () => {
  const cloud = {
    driver: "cloudinary", publicUrl: key => `${CLOUD_URL}${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith(CLOUD_URL) ? url.slice(CLOUD_URL.length) : null)
  };
  storage.useForTests({ local: createLocalStorage({ root: os.tmpdir() }), current: cloud });
  try {
    for (const ok of [
      `/uploads/products/${ID}-full.webp`, `/uploads/products/${ID}.jpg`, `/uploads/products/${ID}.png`, `/uploads/products/${ID}.webp`,
      `${CLOUD_URL}products/${ID}-full.webp`, `${CLOUD_URL}products/${ID}.jpg`
    ]) assert.equal(imageService.isUploadedImage(ok), true, ok);
    for (const bad of [
      "/uploads/products/../../app.js", `/uploads/products/${ID}-400.webp`, `/uploads/products/${ID}-full.jpg`, "/uploads/products/short-full.webp",
      `/uploads/returns/${ID}.webp`, `https://evil.example/products/${ID}-full.webp`, `https://res.cloudinary.com.evil.example/products/${ID}-full.webp`,
      `https://images.unsplash.com/photo-1?w=800`, "", null, undefined, 42
    ]) assert.equal(imageService.isUploadedImage(bad), false, String(bad));
  } finally {
    storage.reset();
  }
});

test("deleting a photo removes it and its small copies, from the right place", async () => {
  const root = await tempDir();
  const local = createLocalStorage({ root });
  const removedFromCloudinary = [];
  const cloud = {
    driver: "cloudinary", publicUrl: key => `${CLOUD_URL}${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith(CLOUD_URL) ? url.slice(CLOUD_URL.length) : null),
    remove: async keys => { removedFromCloudinary.push(...keys); }
  };
  storage.useForTests({ local, current: cloud });
  try {
    // On disk: a new photo with its copies, and one from before small copies existed.
    for (const name of [`${ID}-full.webp`, `${ID}-200.webp`, `${ID}-400.webp`, `${ID}-800.webp`, `${ID}-1600.webp`, `${OTHER}.jpg`]) {
      await local.put(`products/${name}`, Buffer.from("x"));
    }
    await imageService.deleteImages([
      `/uploads/products/${ID}-full.webp`, `/uploads/products/${OTHER}.jpg`,
      `${CLOUD_URL}products/${OTHER}-full.webp`,
      "https://images.unsplash.com/photo-1?w=800", "/uploads/products/../../app.js", undefined
    ]);
    assert.deepEqual(await fs.readdir(path.join(root, "products")), [], "every file on disk is gone");
    assert.deepEqual(removedFromCloudinary.sort(), ["-1600", "-200", "-400", "-800", "-full"].map(size => `products/${OTHER}${size}.webp`).sort());
    // Nothing to delete is fine.
    await imageService.deleteImages([]);
    await imageService.deleteImages(["https://images.unsplash.com/photo-1?w=800"]);
  } finally {
    storage.reset();
  }
});

test("deleting never fails a product save, even when Cloudinary is down", async () => {
  const cloud = {
    driver: "cloudinary", publicUrl: key => `${CLOUD_URL}${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith(CLOUD_URL) ? url.slice(CLOUD_URL.length) : null),
    remove: async () => { throw new Error("Cloudinary down"); }
  };
  storage.useForTests({ local: createLocalStorage({ root: await tempDir() }), current: cloud });
  try {
    await imageService.deleteImages([`${CLOUD_URL}products/${ID}-full.webp`]);
  } finally {
    storage.reset();
  }
});

// ---------- Settings ----------

const base = { MONGODB_URI: "mongodb://127.0.0.1:27017/nexthlon", JWT_SECRET: "k3Jx9pQ2vLm8Zr5TnB7wYc1HdF4sGa6UeRo0XiNb" };
const cloudinary = { STORAGE_DRIVER: "cloudinary", CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };

test("storage settings: Cloudinary needs its three values, and a typo in the driver is caught", () => {
  assert.deepEqual(checkEnv({ ...base, ...cloudinary }), { errors: [], warnings: [] });
  assert.match(checkEnv({ ...base, STORAGE_DRIVER: "gcs" }).errors[0], /STORAGE_DRIVER: "gcs" must be local or cloudinary/);
  const missing = checkEnv({ ...base, STORAGE_DRIVER: "cloudinary" }).errors.map(line => line.split(":")[0]);
  for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) assert.ok(missing.includes(name), name);
});

test("local storage in production is called out, because a host's disk is wiped on every deploy", () => {
  const warnings = checkEnv({ ...base, NODE_ENV: "production", SITE_URL: "https://x.in" }).warnings;
  assert.ok(warnings.some(line => line.startsWith("STORAGE_DRIVER") && /wipe/.test(line)));
  assert.ok(!checkEnv({ ...base, ...cloudinary, NODE_ENV: "production", SITE_URL: "https://x.in" }).warnings.some(line => line.startsWith("STORAGE_DRIVER")));
});

test("the database address: the Atlas placeholder, a missing database name and the pool size", () => {
  const atlas = "mongodb+srv://nexthlon-app:pw@cluster0.ab12c.mongodb.net";
  assert.deepEqual(checkEnv({ ...base, MONGODB_URI: `${atlas}/nexthlon?retryWrites=true&w=majority` }), { errors: [], warnings: [] });
  assert.match(checkEnv({ ...base, MONGODB_URI: "mongodb+srv://nexthlon-app:<db_password>@cluster0.ab12c.mongodb.net/nexthlon" }).errors[0], /placeholder/);
  for (const noName of [atlas, `${atlas}/`, `${atlas}/?retryWrites=true`]) {
    assert.match(checkEnv({ ...base, MONGODB_URI: noName }).warnings[0], /no database name/, noName);
  }
  assert.match(checkEnv({ ...base, NODE_ENV: "production", SITE_URL: "https://x.in", MONGODB_URI: `${atlas}/nexthlon_test` }).warnings[0], /looks like a test database/);
  for (const bad of ["0", "101", "many", "-5"]) assert.match(checkEnv({ ...base, MONGODB_MAX_POOL: bad }).errors[0], /MONGODB_MAX_POOL/, bad);
  assert.deepEqual(checkEnv({ ...base, MONGODB_MAX_POOL: "20" }).errors, []);
});
