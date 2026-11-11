const crypto = require("crypto");
const storage = require("../providers/storage");
const { VARIANT_WIDTHS } = require("../utils/images");
const { HttpError } = require("../utils/http");
const logger = require("../utils/logger");

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Uploads live in a storage provider (providers/storage): local disk in development, an S3-compatible
// bucket (Cloudflare R2, Amazon S3) in production. Folders: products (admin photos) and returns (customer photos).
const FOLDERS = new Set(["products", "returns"]);
const MAX_RETURN_PHOTOS = 3;
// Largest side of the saved photo. Product photos keep up to 2000px so the product page zoom shows real
// detail; customer return photos only need to be readable.
const FULL_SIDE = { products: 2000, returns: 1200 };
// A photo that decodes to more pixels than this is refused (a small file can hide a huge image).
const MAX_PIXELS = 64_000_000;
const WEBP_FULL = { quality: 82, effort: 4 };
const WEBP_SMALL = { quality: 78, effort: 4 };

// Works out the real image type from the first bytes of the file, not from its name.
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

// Returns the names of uploaded files that are not real JPG, PNG or WEBP images.
function findFakeImages(files = []) {
  return files.filter(file => !detectImageType(file.buffer)).map(file => file.originalname);
}

// Turns an upload into what gets saved: one WebP "full" copy (turned the right way up, camera details such
// as location and device removed, at most 2000px or 1200px on the longest side) and, for product photos,
// smaller WebP copies at each width in VARIANT_WIDTHS. A photo narrower than a width is not enlarged, so
// that copy is simply the same size: the file always exists, and a srcset never points at nothing.
async function renderImage(buffer, folder = "products") {
  const sharp = require("sharp");
  const side = FULL_SIDE[folder];
  const full = await sharp(buffer, { failOn: "none", limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
    .webp(WEBP_FULL)
    .toBuffer();
  if (folder !== "products") return { full, variants: [] };
  const variants = await Promise.all(VARIANT_WIDTHS.map(async width => ({
    width,
    buffer: await sharp(full).resize({ width, withoutEnlargement: true }).webp(WEBP_SMALL).toBuffer()
  })));
  return { full, variants };
}

// Saves checked uploads under random names and returns their public URLs, in the same order.
//   products: products/<id>-full.webp plus -200, -400, -800 and -1600 copies. The URL is the -full one.
//   returns:  returns/<id>.webp
// If anything fails part-way, what was already written is removed again.
async function saveImages(files = [], folder = "products") {
  if (!files.length) return [];
  if (!FOLDERS.has(folder)) throw new Error(`Unknown upload folder: ${folder}`);
  const store = storage.current();
  const written = [];
  const urls = [];
  try {
    for (const file of files) {
      const id = crypto.randomBytes(16).toString("hex");
      let rendered;
      try {
        rendered = await renderImage(file.buffer, folder);
      } catch (error) {
        logger.warn("image.render_failed", { error });
        const message = "That photo could not be processed. Try a different file.";
        throw new HttpError(400, message, { [folder === "products" ? "images" : "photos"]: message });
      }
      const parts = folder === "products"
        ? [[`products/${id}-full.webp`, rendered.full], ...rendered.variants.map(v => [`products/${id}-${v.width}.webp`, v.buffer])]
        : [[`returns/${id}.webp`, rendered.full]];
      written.push(...parts.map(([key]) => key));
      await Promise.all(parts.map(([key, body]) => store.put(key, body, { contentType: "image/webp" })));
      urls.push(store.publicUrl(parts[0][0]));
    }
    return urls;
  } catch (error) {
    await store.remove(written).catch(() => {});
    throw error;
  }
}

// One of our own product photos: new ("<id>-full.webp") or from before small copies existed ("<id>.jpg").
// It must be in local storage ("/uploads/...") or in the configured bucket (STORAGE_PUBLIC_URL/...).
const PRODUCT_KEY = /^products\/[a-f0-9]{32}(-full\.webp|\.(jpg|png|webp))$/;
function isUploadedImage(url) {
  const backend = storage.backendFor(url);
  const key = backend ? backend.keyFromUrl(url) : null;
  return key !== null && PRODUCT_KEY.test(key);
}

// Every file behind one stored photo address: the photo itself, and its smaller copies when it has them.
function keysFor(key) {
  if (!key.endsWith("-full.webp")) return [key];
  return [key, ...VARIANT_WIDTHS.map(width => key.replace(/-full\.webp$/, `-${width}.webp`))];
}

// Deletes our own uploaded files only, wherever they are (disk or bucket), with their small copies.
// Outside photo links (like Unsplash) are simply forgotten. Never throws: a photo that can't be removed
// costs a little storage, and must not stop a product from saving.
async function deleteImages(urls = []) {
  const byBackend = new Map();
  for (const url of urls.filter(isUploadedImage)) {
    const backend = storage.backendFor(url);
    byBackend.set(backend, [...(byBackend.get(backend) || []), ...keysFor(backend.keyFromUrl(url))]);
  }
  await Promise.all([...byBackend].map(([backend, keys]) =>
    backend.remove(keys).catch(error => logger.warn("storage.delete_failed", { error }))
  ));
}

module.exports = {
  renderImage,
  MAX_IMAGES,
  MAX_RETURN_PHOTOS,
  MAX_IMAGE_BYTES,
  ALLOWED_TYPES,
  FOLDERS,
  FULL_SIDE,
  detectImageType,
  findFakeImages,
  saveImages,
  deleteImages,
  isUploadedImage,
  keysFor
};
