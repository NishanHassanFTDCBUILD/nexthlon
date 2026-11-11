// Photos in Cloudinary (https://cloudinary.com): no card needed for the free plan, files are served from its CDN.
// Settings: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (STORAGE_DRIVER=cloudinary).
//
// Same rules as the other providers: the app uploads each photo copy under the key it already uses
// ("products/<id>-full.webp", "-400.webp"...), and the stored address is
//   https://res.cloudinary.com/<cloud>/image/upload/products/<id>-full.webp
// so utils/images.js works out the other sizes by changing the ending, exactly as on local disk or a bucket.
// Uploads are signed with the API secret (SHA-1 of the sorted parameters plus the secret); the secret is never
// sent and never appears in an error message.
const crypto = require("crypto");
const logger = require("../../utils/logger");

const API = "https://api.cloudinary.com/v1_1";
const RETRIES = 2;
const TIMEOUT_MS = 30_000;

// "products/abc-400.webp" -> "products/abc-400" (Cloudinary's public id has no extension).
const publicIdOf = key => key.replace(/\.[a-z0-9]+$/i, "");

function createCloudinaryStorage({ cloudName, apiKey, apiSecret }, { fetchImpl = fetch, now = () => Math.floor(Date.now() / 1000) } = {}) {
  const base = `https://res.cloudinary.com/${cloudName}/image/upload`;

  const sign = params => crypto
    .createHash("sha1")
    .update(`${Object.keys(params).sort().map(name => `${name}=${params[name]}`).join("&")}${apiSecret}`)
    .digest("hex");

  async function call(action, fields, file) {
    const timestamp = now();
    const signed = { ...fields, timestamp };
    let last;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const form = new FormData();
        for (const [name, value] of Object.entries(signed)) form.append(name, String(value));
        form.append("api_key", apiKey);
        form.append("signature", sign(signed));
        if (file) form.append("file", file.blob, file.name);
        const response = await fetchImpl(`${API}/${cloudName}/image/${action}`, { method: "POST", body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const body = await response.json().catch(() => ({}));
        if (response.ok) return body;
        last = new Error(`Cloudinary ${action} failed with status ${response.status}${body.error && body.error.message ? `: ${body.error.message}` : ""}`);
        last.status = response.status;
        if (response.status < 500) break;
      } catch (error) {
        last = new Error(`Cloudinary ${action} failed: ${error.name === "TimeoutError" ? "timed out" : error.message}`);
      }
      if (attempt < RETRIES) await new Promise(resolve => setTimeout(resolve, 150 * 2 ** attempt));
    }
    throw last;
  }

  return {
    driver: "cloudinary",

    async put(key, buffer, { contentType = "application/octet-stream" } = {}) {
      const blob = new Blob([buffer], { type: contentType });
      // overwrite=false: random names never collide, so refusing to replace catches a bug instead of hiding it.
      await call("upload", { public_id: publicIdOf(key), overwrite: "false" }, { blob, name: key.split("/").pop() });
    },

    // Best effort and in turn, like the other providers: removing a photo must never fail a product save.
    async remove(keys) {
      for (const key of keys) {
        try {
          await call("destroy", { public_id: publicIdOf(key), invalidate: "true" });
        } catch (error) {
          logger.warn("storage.delete_failed", { key, error });
        }
      }
    },

    publicUrl: key => `${base}/${key}`,

    keyFromUrl(url) {
      return typeof url === "string" && url.startsWith(`${base}/`) ? url.slice(base.length + 1) : null;
    },

    // Cheap credential check for `npm run setup:check`: uploads nothing, asks for the account's usage.
    async ping() {
      const timestamp = now();
      const signed = { timestamp };
      const response = await fetchImpl(`https://api.cloudinary.com/v1_1/${cloudName}/usage?${new URLSearchParams({ api_key: apiKey, timestamp, signature: sign(signed) })}`, { signal: AbortSignal.timeout(15_000) });
      return response.ok;
    }
  };
}

module.exports = { createCloudinaryStorage, publicIdOf };
