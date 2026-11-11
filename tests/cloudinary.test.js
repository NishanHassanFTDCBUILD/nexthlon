require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { createCloudinaryStorage, publicIdOf } = require("../providers/storage/cloudinary");
const { checkEnv } = require("../config/schema");
const images = require("../utils/images");

const settings = { cloudName: "democloud", apiKey: "key-1", apiSecret: "very-secret" };

function fake(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const next = responses.shift() || { ok: true, status: 200, body: {} };
    calls.push({ url: String(url), form: init && init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : null, init });
    return { ok: next.ok !== false, status: next.status || 200, json: async () => next.body || {} };
  };
  return { calls, provider: createCloudinaryStorage(settings, { fetchImpl, now: () => 1700000000 }) };
}

test("public id drops the extension; urls round-trip with keyFromUrl", () => {
  assert.equal(publicIdOf("products/abc-400.webp"), "products/abc-400");
  const { provider } = fake([]);
  const url = provider.publicUrl("products/abc-full.webp");
  assert.equal(url, "https://res.cloudinary.com/democloud/image/upload/products/abc-full.webp");
  assert.equal(provider.keyFromUrl(url), "products/abc-full.webp");
  assert.equal(provider.keyFromUrl("/uploads/products/x.jpg"), null);
});

test("upload is signed with the secret, which is never sent", async () => {
  const { provider, calls } = fake([{ body: { public_id: "x" } }]);
  await provider.put("products/abc-400.webp", Buffer.from("img"), { contentType: "image/webp" });
  const { url, form } = calls[0];
  assert.equal(url, "https://api.cloudinary.com/v1_1/democloud/image/upload");
  assert.equal(form.public_id, "products/abc-400");
  assert.equal(form.api_key, "key-1");
  const expected = crypto.createHash("sha1").update("overwrite=false&public_id=products/abc-400&timestamp=1700000000very-secret").digest("hex");
  assert.equal(form.signature, expected);
  assert.ok(!JSON.stringify(form).includes("very-secret"));
});

test("a 4xx is not retried and its message never contains the secret; 5xx is retried", async () => {
  const bad = fake([{ ok: false, status: 401, body: { error: { message: "Invalid Signature" } } }]);
  await assert.rejects(bad.provider.put("products/a.webp", Buffer.from("x")), error => /401/.test(error.message) && !/very-secret/.test(error.message));
  assert.equal(bad.calls.length, 1);
  const flaky = fake([{ ok: false, status: 503 }, { body: {} }]);
  await flaky.provider.put("products/a.webp", Buffer.from("x"));
  assert.equal(flaky.calls.length, 2);
});

test("remove deletes each public id and never throws", async () => {
  const { provider, calls } = fake([{}, { ok: false, status: 400, body: {} }]);
  await provider.remove(["products/a-full.webp", "products/b-full.webp"]);
  assert.match(calls[0].url, /image\/destroy$/);
  assert.equal(calls[0].form.public_id, "products/a-full");
});

test("size helpers work on Cloudinary addresses (same naming as every other provider)", () => {
  const full = `https://res.cloudinary.com/democloud/image/upload/products/${"a".repeat(32)}-full.webp`;
  assert.match(images.sizedUrl(full, 300), /-400\.webp$/);
  assert.match(images.srcsetFor(full), /-800\.webp 800w/);
});

test("settings: cloudinary needs its three values", () => {
  const base = { NODE_ENV: "development", MONGODB_URI: "mongodb://x/nexthlon", JWT_SECRET: "x".repeat(40), STORAGE_DRIVER: "cloudinary" };
  const missing = checkEnv(base).errors.map(line => line.split(":")[0]);
  for (const name of ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]) assert.ok(missing.includes(name));
  assert.deepEqual(checkEnv({ ...base, CLOUDINARY_CLOUD_NAME: "demo", CLOUDINARY_API_KEY: "1", CLOUDINARY_API_SECRET: "s" }).errors, []);
});
