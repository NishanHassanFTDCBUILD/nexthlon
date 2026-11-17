// Moves photos uploaded earlier to the current storage, in the current format ("npm run images:migrate").
//
// Two situations need it:
//   1. Photos uploaded before small copies existed ("/uploads/products/<id>.jpg"): they get a full WebP
//      and 200/400/800/1600 copies, so product cards stop downloading the big file.
//   2. Switching STORAGE_DRIVER from local to cloudinary: every photo still on this server's disk is
//      uploaded to Cloudinary, so the site no longer depends on the server's disk.
//
// Every place that stores a photo address is updated: products (image, gallery), categories, order lines
// (the photo at the time of the order) and return photos. Old files on disk are never deleted, so the
// previous addresses keep working until you decide to clean up. It is safe to run again: addresses that are
// already current are left alone, and a photo whose file is missing is reported and skipped.
const crypto = require("crypto");
const Product = require("../models/Product");
const Category = require("../models/Category");
const Order = require("../models/Order");
const storage = require("../providers/storage");
const { renderImage, keysFor } = require("./imageService");

// The two shapes of a local photo address.
const OLD_PRODUCT = /^\/uploads\/products\/([a-f0-9]{32})\.(jpg|png|webp)$/;
const NEW_PRODUCT = /^\/uploads\/products\/([a-f0-9]{32})-full\.webp$/;
const RETURN_PHOTO = /^\/uploads\/returns\/([a-f0-9]{32})\.(jpg|png|webp)$/;

const flat = lists => [...new Set(lists.flat().filter(url => typeof url === "string" && url))];

// Every photo address saved anywhere in the database.
async function savedAddresses() {
  const [image, gallery, category, orderLine, returned] = await Promise.all([
    Product.collection.distinct("image"),
    Product.collection.distinct("gallery"),
    Category.collection.distinct("image"),
    Order.collection.distinct("items.image"),
    Order.collection.distinct("returnPhotos")
  ]);
  return { products: flat([image, gallery, category, orderLine]), returns: flat([returned]) };
}

// Where each saved address changes to. Writes the files unless dryRun.
async function planMoves({ dryRun, report }) {
  const target = storage.current();
  const local = storage.local();
  const toCloudinary = target.driver === "cloudinary";
  const { products, returns } = await savedAddresses();
  const moves = new Map();

  // Photos with small copies already, still on this disk, going to Cloudinary: copy the five files as
  // they are (same name, no second round of compression), then only the address changes.
  async function copyAsIs(url, key) {
    const keys = keysFor(key);
    const files = [];
    for (const k of keys) files.push([k, await local.read(k)]);
    if (!dryRun) {
      try {
        await Promise.all(files.map(([k, body]) => target.put(k, body, { contentType: "image/webp" })));
      } catch (error) {
        // Never leave half a photo in Cloudinary.
        await target.remove(keys).catch(() => {});
        throw error;
      }
    }
    report.filesWritten += files.length;
    return target.publicUrl(key);
  }

  async function renderAndSave(url, key, folder) {
    const source = await local.read(key);
    const id = crypto.randomBytes(16).toString("hex");
    const { full, variants } = await renderImage(source, folder);
    const parts = folder === "products"
      ? [[`products/${id}-full.webp`, full], ...variants.map(v => [`products/${id}-${v.width}.webp`, v.buffer])]
      : [[`returns/${id}.webp`, full]];
    if (!dryRun) {
      try {
        await Promise.all(parts.map(([k, body]) => target.put(k, body, { contentType: "image/webp" })));
      } catch (error) {
        await target.remove(parts.map(([k]) => k)).catch(() => {});
        throw error;
      }
    }
    report.filesWritten += parts.length;
    return target.publicUrl(parts[0][0]);
  }

  for (const url of products) {
    const old = OLD_PRODUCT.exec(url);
    const current = NEW_PRODUCT.exec(url);
    if (!old && !(current && toCloudinary)) continue;
    report.found += 1;
    try {
      const key = url.slice("/uploads/".length);
      moves.set(url, current ? await copyAsIs(url, key) : await renderAndSave(url, key, "products"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.missing.push(url);
    }
  }
  // Customers' return photos only need to move when they are going to Cloudinary.
  for (const url of returns) {
    if (!toCloudinary || !RETURN_PHOTO.test(url)) continue;
    report.found += 1;
    try {
      moves.set(url, await renderAndSave(url, url.slice("/uploads/".length), "returns"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.missing.push(url);
    }
  }
  return moves;
}

// Writes the new addresses over the old ones, everywhere they are saved. Raw updates, so that
// orders and products keep their own "last changed" times.
async function rewriteAddresses(moves) {
  for (const [from, to] of moves) {
    await Product.collection.updateMany({ image: from }, { $set: { image: to } });
    await Product.collection.updateMany({ gallery: from }, { $set: { "gallery.$[p]": to } }, { arrayFilters: [{ p: from }] });
    await Category.collection.updateMany({ image: from }, { $set: { image: to } });
    await Order.collection.updateMany({ "items.image": from }, { $set: { "items.$[i].image": to } }, { arrayFilters: [{ "i.image": from }] });
    await Order.collection.updateMany({ returnPhotos: from }, { $set: { "returnPhotos.$[p]": to } }, { arrayFilters: [{ p: from }] });
  }
}

// dryRun: works out and reports everything, but writes no file and changes no address.
async function migrateImages({ dryRun = false } = {}) {
  const report = { dryRun, driver: storage.current().driver, found: 0, migrated: 0, filesWritten: 0, missing: [], moves: [] };
  const moves = await planMoves({ dryRun, report });
  if (!dryRun) await rewriteAddresses(moves);
  report.migrated = moves.size;
  report.moves = [...moves].map(([from, to]) => ({ from, to }));
  return report;
}

module.exports = { migrateImages, savedAddresses };
