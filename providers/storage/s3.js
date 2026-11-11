// Photos in an S3-compatible bucket: Cloudflare R2 (recommended: no charge for downloads), Amazon S3,
// Backblaze B2, MinIO... The bucket serves the files itself (or through a CDN / custom domain) at
// publicUrl, so the app never streams a photo.
//
// Requests are signed with aws4fetch (a tiny library, no AWS SDK). Settings, from config/env.js:
//   endpoint   set for R2 and other services: https://<account>.r2.cloudflarestorage.com
//              (path-style: <endpoint>/<bucket>/<key>). Leave empty for Amazon S3.
//   region     "auto" for R2; for Amazon S3 the bucket's region, e.g. ap-south-1.
//   publicUrl  where visitors fetch photos, e.g. https://cdn.nexthlon.in (no trailing slash).
//
// Every photo has a random name and never changes, so it is uploaded with a one-year "immutable"
// Cache-Control: browsers and the CDN keep it and never ask again.
const { AwsClient } = require("aws4fetch");
const logger = require("../../utils/logger");

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const RETRIES = 2;
const TIMEOUT_MS = 20_000;

function createS3Storage(settings, { fetchImpl } = {}) {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey, publicUrl } = settings;
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: region || "auto" });
  const send = fetchImpl ? (url, init) => client.sign(url, init).then(request => fetchImpl(request)) : (url, init) => client.fetch(url, init);

  // Amazon S3: https://<bucket>.s3.<region>.amazonaws.com/<key>. Everything else: <endpoint>/<bucket>/<key>.
  const objectUrl = key => {
    const encoded = key.split("/").map(encodeURIComponent).join("/");
    return endpoint ? `${endpoint}/${bucket}/${encoded}` : `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
  };

  // Network trouble and 5xx answers are tried again; a 4xx (wrong key, no permission) is not.
  // The error never contains the request, so no secret can end up in a log.
  async function request(method, key, init = {}) {
    let last;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const response = await send(objectUrl(key), { method, signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
        if (response.ok || (method === "DELETE" && response.status === 404)) return response;
        last = new Error(`Storage ${method} ${key} failed with status ${response.status}`);
        last.status = response.status;
        if (response.status < 500) break;
      } catch (error) {
        last = new Error(`Storage ${method} ${key} failed: ${error.name === "TimeoutError" ? "timed out" : error.message}`);
      }
      if (attempt < RETRIES) await new Promise(resolve => setTimeout(resolve, 150 * 2 ** attempt));
    }
    throw last;
  }

  return {
    driver: "s3",

    async put(key, buffer, { contentType = "application/octet-stream" } = {}) {
      await request("PUT", key, { body: buffer, headers: { "Content-Type": contentType, "Cache-Control": CACHE_CONTROL } });
    },

    // Best effort and in turn: deleting must never fail a product save. A photo that could not be
    // removed is only logged (it costs a few KB of storage, nothing else).
    async remove(keys) {
      for (const key of keys) {
        try {
          await request("DELETE", key);
        } catch (error) {
          logger.warn("storage.delete_failed", { key, error });
        }
      }
    },

    publicUrl: key => `${publicUrl}/${key}`,

    keyFromUrl(url) {
      return typeof url === "string" && url.startsWith(`${publicUrl}/`) ? url.slice(publicUrl.length + 1) : null;
    }
  };
}

module.exports = { createS3Storage, CACHE_CONTROL };
