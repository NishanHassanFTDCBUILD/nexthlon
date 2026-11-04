const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads", "products");
const PUBLIC_PREFIX = "/uploads/products/";

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

// Saves checked uploads with random names and returns their public URLs, in the same order.
async function saveImages(files = []) {
  if (!files.length) return [];
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const urls = [];
  for (const file of files) {
    const type = detectImageType(file.buffer);
    const name = `${crypto.randomBytes(16).toString("hex")}.${type}`;
    await fs.writeFile(path.join(UPLOAD_DIR, name), file.buffer, { flag: "wx" });
    urls.push(PUBLIC_PREFIX + name);
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
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_TYPES,
  detectImageType,
  findFakeImages,
  saveImages,
  deleteImages,
  isUploadedImage
};
