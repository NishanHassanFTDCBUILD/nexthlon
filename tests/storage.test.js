// Photo storage: the local and S3-compatible providers, the image pipeline that makes the small copies,
// and the rules that turn a stored address into a srcset. No database needed.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");

const storage = require("../providers/storage");
const { createLocalStorage } = require("../providers/storage/local");
const { createS3Storage } = require("../providers/storage/s3");
const images = require("../utils/images");
const imageService = require("../services/imageService");
const { checkEnv } = require("../config/schema");

const ID = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "nexthlon-storage-"));
}
const exists = file => fs.access(file).then(() => true, () => false);
const photo = (width, height, extra = {}) => sharp({ create: { width, height, channels: 3, background: "#d4ff3a" } }).jpeg({ quality: 90 }).toBuffer().then(buffer => ({ buffer, originalname: "p.jpg", ...extra }));

// A small fake S3 server that records what it is sent, and answers with what the test says.
async function fakeBucket(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const call = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
      calls.push(call);
      const reply = handler ? handler(call, calls.length) : { status: 200 };
      res.statusCode = reply.status;
      res.end(reply.body || "");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { calls, endpoint: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

const settings = endpoint => ({ endpoint, region: "auto", bucket: "nexthlon", accessKeyId: "AKIATESTKEY", secretAccessKey: "super-secret-value", publicUrl: "https://cdn.nexthlon.in" });

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

// ---------- S3-compatible provider ----------

test("s3 storage signs a PUT with the cache headers, to <endpoint>/<bucket>/<key>", async () => {
  const bucket = await fakeBucket();
  try {
    const s3 = createS3Storage(settings(bucket.endpoint));
    const body = Buffer.from("not really a photo");
    await s3.put("products/abc-400.webp", body, { contentType: "image/webp" });
    const [call] = bucket.calls;
    assert.equal(call.method, "PUT");
    assert.equal(call.url, "/nexthlon/products/abc-400.webp");
    assert.deepEqual(call.body, body);
    assert.equal(call.headers["content-type"], "image/webp");
    // Random names never change, so the photo is kept for a year and never re-checked.
    assert.equal(call.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIATESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/);
    assert.match(call.headers["x-amz-date"], /^\d{8}T\d{6}Z$/);
    assert.ok(call.headers["x-amz-content-sha256"]);
    // The secret itself never travels.
    assert.ok(!JSON.stringify(call.headers).includes("super-secret-value"));
  } finally {
    await bucket.close();
  }
});

test("s3 storage on Amazon S3 uses the bucket's own address", async () => {
  let seen;
  const s3 = createS3Storage({ ...settings(""), endpoint: "", region: "ap-south-1" }, {
    fetchImpl: async request => { seen = request; return new Response("", { status: 200 }); }
  });
  await s3.put("products/abc-full.webp", Buffer.from("x"), { contentType: "image/webp" });
  assert.equal(seen.url, "https://nexthlon.s3.ap-south-1.amazonaws.com/products/abc-full.webp");
  assert.match(seen.headers.get("authorization"), /Credential=AKIATESTKEY\/\d{8}\/ap-south-1\/s3\/aws4_request/);
});

test("s3 storage turns an address into a key and back", () => {
  const s3 = createS3Storage(settings("http://127.0.0.1:1"));
  assert.equal(s3.publicUrl("products/a-full.webp"), "https://cdn.nexthlon.in/products/a-full.webp");
  assert.equal(s3.keyFromUrl("https://cdn.nexthlon.in/products/a-full.webp"), "products/a-full.webp");
  assert.equal(s3.keyFromUrl("/uploads/products/a-full.webp"), null);
  assert.equal(s3.keyFromUrl("https://cdn.nexthlon.in.evil.example/products/a.webp"), null);
  assert.equal(s3.keyFromUrl("https://evil.example/products/a.webp"), null);
});

test("s3 storage tries a failing server again, but not a refusal", async () => {
  // A 503 twice, then success: the upload still works.
  const flaky = await fakeBucket((call, n) => ({ status: n < 3 ? 503 : 200 }));
  try {
    await createS3Storage(settings(flaky.endpoint)).put("products/x.webp", Buffer.from("x"));
    assert.equal(flaky.calls.length, 3);
  } finally {
    await flaky.close();
  }
  // A 403 (wrong keys, no permission) will not get better by asking again, and the message names no secret.
  const refusing = await fakeBucket(() => ({ status: 403, body: "<Error>SignatureDoesNotMatch</Error>" }));
  try {
    await assert.rejects(() => createS3Storage(settings(refusing.endpoint)).put("products/x.webp", Buffer.from("x")), error => {
      assert.match(error.message, /PUT products\/x\.webp failed with status 403/);
      assert.ok(!error.message.includes("super-secret-value") && !error.message.includes("AKIATESTKEY"));
      return true;
    });
    assert.equal(refusing.calls.length, 1);
  } finally {
    await refusing.close();
  }
});

test("s3 storage deletes in turn, treats a missing file as done, and never throws", async () => {
  const bucket = await fakeBucket(call => ({ status: call.url.endsWith("gone.webp") ? 404 : call.url.endsWith("broken.webp") ? 403 : 204 }));
  try {
    const s3 = createS3Storage(settings(bucket.endpoint));
    await s3.remove(["products/a.webp", "products/gone.webp", "products/broken.webp", "products/b.webp"]);
    // The refused one did not stop the one after it.
    assert.deepEqual(bucket.calls.map(call => `${call.method} ${call.url}`), [
      "DELETE /nexthlon/products/a.webp", "DELETE /nexthlon/products/gone.webp",
      "DELETE /nexthlon/products/broken.webp", "DELETE /nexthlon/products/b.webp"
    ]);
  } finally {
    await bucket.close();
  }
});

test("s3 storage fails cleanly when the server is unreachable", async () => {
  const s3 = createS3Storage(settings("http://127.0.0.1:1"));
  await assert.rejects(() => s3.put("products/x.webp", Buffer.from("x")), /Storage PUT products\/x\.webp failed/);
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

test("if the bucket fails part-way, the files already uploaded are removed again", async () => {
  const written = new Map();
  const removed = [];
  let puts = 0;
  const flaky = {
    driver: "s3",
    put: async key => { puts += 1; if (puts === 3) throw new Error("bucket down"); written.set(key, true); },
    remove: async keys => { removed.push(...keys); },
    publicUrl: key => `https://cdn.nexthlon.in/${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith("https://cdn.nexthlon.in/") ? url.slice(24) : null)
  };
  storage.useForTests({ local: createLocalStorage({ root: await tempDir() }), current: flaky });
  try {
    await assert.rejects(async () => imageService.saveImages([await photo(500, 500)], "products"), /bucket down/);
    assert.equal(removed.length, 5, "all five keys of the photo are cleaned up, whether or not they were written");
    assert.ok([...written.keys()].every(key => removed.includes(key)));
  } finally {
    storage.reset();
  }
});

// ---------- Which addresses are ours, and deleting ----------

test("isUploadedImage: our new and older photos on disk or in the bucket, nothing else", () => {
  const cloud = {
    driver: "s3", publicUrl: key => `https://cdn.nexthlon.in/${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith("https://cdn.nexthlon.in/") ? url.slice(24) : null)
  };
  storage.useForTests({ local: createLocalStorage({ root: os.tmpdir() }), current: cloud });
  try {
    for (const ok of [
      `/uploads/products/${ID}-full.webp`, `/uploads/products/${ID}.jpg`, `/uploads/products/${ID}.png`, `/uploads/products/${ID}.webp`,
      `https://cdn.nexthlon.in/products/${ID}-full.webp`, `https://cdn.nexthlon.in/products/${ID}.jpg`
    ]) assert.equal(imageService.isUploadedImage(ok), true, ok);
    for (const bad of [
      "/uploads/products/../../app.js", `/uploads/products/${ID}-400.webp`, `/uploads/products/${ID}-full.jpg`, "/uploads/products/short-full.webp",
      `/uploads/returns/${ID}.webp`, `https://evil.example/products/${ID}-full.webp`, `https://cdn.nexthlon.in.evil.example/products/${ID}-full.webp`,
      `https://images.unsplash.com/photo-1?w=800`, "", null, undefined, 42
    ]) assert.equal(imageService.isUploadedImage(bad), false, String(bad));
  } finally {
    storage.reset();
  }
});

test("deleting a photo removes it and its small copies, from the right place", async () => {
  const root = await tempDir();
  const local = createLocalStorage({ root });
  const removedFromBucket = [];
  const cloud = {
    driver: "s3", publicUrl: key => `https://cdn.nexthlon.in/${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith("https://cdn.nexthlon.in/") ? url.slice(24) : null),
    remove: async keys => { removedFromBucket.push(...keys); }
  };
  storage.useForTests({ local, current: cloud });
  try {
    // On disk: a new photo with its copies, and one from before small copies existed.
    for (const name of [`${ID}-full.webp`, `${ID}-200.webp`, `${ID}-400.webp`, `${ID}-800.webp`, `${ID}-1600.webp`, `${OTHER}.jpg`]) {
      await local.put(`products/${name}`, Buffer.from("x"));
    }
    await imageService.deleteImages([
      `/uploads/products/${ID}-full.webp`, `/uploads/products/${OTHER}.jpg`,
      `https://cdn.nexthlon.in/products/${OTHER}-full.webp`,
      "https://images.unsplash.com/photo-1?w=800", "/uploads/products/../../app.js", undefined
    ]);
    assert.deepEqual(await fs.readdir(path.join(root, "products")), [], "every file on disk is gone");
    assert.deepEqual(removedFromBucket.sort(), ["-1600", "-200", "-400", "-800", "-full"].map(size => `products/${OTHER}${size}.webp`).sort());
    // Nothing to delete is fine.
    await imageService.deleteImages([]);
    await imageService.deleteImages(["https://images.unsplash.com/photo-1?w=800"]);
  } finally {
    storage.reset();
  }
});

test("deleting never fails a product save, even when the bucket is down", async () => {
  const cloud = {
    driver: "s3", publicUrl: key => `https://cdn.nexthlon.in/${key}`,
    keyFromUrl: url => (typeof url === "string" && url.startsWith("https://cdn.nexthlon.in/") ? url.slice(24) : null),
    remove: async () => { throw new Error("bucket down"); }
  };
  storage.useForTests({ local: createLocalStorage({ root: await tempDir() }), current: cloud });
  try {
    await imageService.deleteImages([`https://cdn.nexthlon.in/products/${ID}-full.webp`]);
  } finally {
    storage.reset();
  }
});

// ---------- Settings ----------

const base = { MONGODB_URI: "mongodb://127.0.0.1:27017/nexthlon", JWT_SECRET: "k3Jx9pQ2vLm8Zr5TnB7wYc1HdF4sGa6UeRo0XiNb" };
const bucket = { STORAGE_DRIVER: "s3", S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com", S3_BUCKET: "nexthlon", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", STORAGE_PUBLIC_URL: "https://cdn.nexthlon.in" };

test("storage settings: a bucket needs everything, and a typo in the driver is caught", () => {
  assert.deepEqual(checkEnv({ ...base, ...bucket }), { errors: [], warnings: [] });
  assert.match(checkEnv({ ...base, STORAGE_DRIVER: "gcs" }).errors[0], /STORAGE_DRIVER: "gcs" must be local or s3/);
  const missing = checkEnv({ ...base, STORAGE_DRIVER: "s3" }).errors.map(line => line.split(":")[0]);
  for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_REGION", "STORAGE_PUBLIC_URL"]) assert.ok(missing.includes(name), name);
  // Amazon S3 (no endpoint) needs a region; R2 does not.
  assert.deepEqual(checkEnv({ ...base, ...bucket, S3_ENDPOINT: "", S3_REGION: "ap-south-1" }).errors, []);
  assert.match(checkEnv({ ...base, ...bucket, S3_ENDPOINT: "http://insecure.example" }).errors[0], /S3_ENDPOINT/);
  assert.match(checkEnv({ ...base, ...bucket, S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com/bucket" }).errors[0], /no path/);
  for (const bad of ["http://cdn.nexthlon.in", "cdn.nexthlon.in", "https://cdn.nexthlon.in?x=1"]) {
    assert.match(checkEnv({ ...base, ...bucket, STORAGE_PUBLIC_URL: bad }).errors[0], /STORAGE_PUBLIC_URL/, bad);
  }
  // A trailing slash is tolerated.
  assert.deepEqual(checkEnv({ ...base, ...bucket, STORAGE_PUBLIC_URL: "https://cdn.nexthlon.in/" }).errors, []);
});

test("local storage in production is called out, because a host's disk is wiped on every deploy", () => {
  const warnings = checkEnv({ ...base, NODE_ENV: "production", SITE_URL: "https://x.in" }).warnings;
  assert.ok(warnings.some(line => line.startsWith("STORAGE_DRIVER") && /wipe/.test(line)));
  assert.ok(!checkEnv({ ...base, ...bucket, NODE_ENV: "production", SITE_URL: "https://x.in" }).warnings.some(line => line.startsWith("STORAGE_DRIVER")));
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
