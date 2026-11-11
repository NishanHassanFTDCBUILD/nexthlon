const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Uploads live in public/uploads/<folder>: products (admin photos) and returns (customer photos).
const FOLDERS = new Set(["products", "returns"]);
const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads", "products");
const MAX_RETURN_PHOTOS = 3;

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

// Uploads are shrunk to web size before saving: at most 2000px (products) or 1200px (returns) on the longest side, re-compressed
// in the same format, turned the right way up, and with camera details (location, device) removed.
// A photo that cannot be processed, or would not get smaller, is kept exactly as uploaded.
// Product photos keep up to 2000px so the product page zoom shows real detail; customer return
// photos only need to be readable, so they stay at 1200px.
const MAX_SIDE = { products: 2000, returns: 1200 };
async function shrinkImage(buffer, type, maxSide = MAX_SIDE.products) {
  try {
    const sharp = require("sharp");
    const image = sharp(buffer, { failOn: "none" }).rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true });
    const out = await (type === "png" ? image.png({ compressionLevel: 9, palette: true, quality: 85 })
      : type === "webp" ? image.webp({ quality: 80 })
        : image.jpeg({ quality: 82, mozjpeg: true })).toBuffer();
    return out.length < buffer.length ? out : buffer;
  } catch {
    return buffer;
  }
}

// Saves checked uploads with random names and returns their public URLs, in the same order.
async function saveImages(files = [], folder = "products") {
  if (!files.length) return [];
  if (!FOLDERS.has(folder)) throw new Error(`Unknown upload folder: ${folder}`);
  const dir = path.join(__dirname, "..", "public", "uploads", folder);
  await fs.mkdir(dir, { recursive: true });
  const urls = [];
  for (const file of files) {
    const type = detectImageType(file.buffer);
    const name = `${crypto.randomBytes(16).toString("hex")}.${type}`;
    await fs.writeFile(path.join(dir, name), await shrinkImage(file.buffer, type, MAX_SIDE[folder]), { flag: "wx" });
    urls.push(`/uploads/${folder}/${name}`);
  }
  return urls;
}

function isUploadedImage(url) {
  return typeof url === "string" && /^\/uploads\/products\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(url);
}

// Deletes our own uploaded files only. Outside photo links (like Unsplash) are simply forgotten.
async function deleteImages(urls = []) {
  await Promise.all(urls.filter(isUploadedImage).map(url =>
    fs.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {})
  ));
}

module.exports = {
  shrinkImage,
  MAX_IMAGES,
  MAX_RETURN_PHOTOS,
  MAX_IMAGE_BYTES,
  ALLOWED_TYPES,
  detectImageType,
  findFakeImages,
  saveImages,
  deleteImages,
  isUploadedImage
};
