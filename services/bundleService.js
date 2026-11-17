// Complete-the-kit bundles (E6).
//   forProduct(productId)   active bundles that include this product, with their listed products
//   addAll(user, slug)      adds every item of the bundle to the signed-in customer's cart
//   create(value)           admin: a new bundle (2 to 6 listed products, up to 30% off the set)
// The discount shown is the bundle's own; the cart and checkout still price every line on the server.
const mongoose = require("mongoose");
const Bundle = require("../models/Bundle");
const Product = require("../models/Product");
const cartService = require("./cartService");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { HttpError } = require("../utils/http");

const slugify = text => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

async function listedProducts(bundle) {
  const products = await Product.find({ _id: { $in: bundle.products }, ...LISTED_PRODUCT }).select("name slug image price stock variants").lean();
  return products;
}

function shape(bundle, products) {
  const price = products.reduce((sum, p) => sum + p.price, 0);
  const saving = Math.round((price * bundle.percentOff) / 100);
  return {
    id: String(bundle._id),
    name: bundle.name,
    slug: bundle.slug,
    summary: bundle.summary,
    percentOff: bundle.percentOff,
    price,
    saving,
    total: price - saving,
    // Only a bundle whose products are all listed and in stock can be bought in one click.
    buyable: products.length === bundle.products.length && products.every(p => p.stock > 0 || (p.variants && p.variants.length)),
    products: products.map(p => ({ id: String(p._id), name: p.name, slug: p.slug, image: p.image, price: p.price }))
  };
}

async function forProduct(productId) {
  if (!mongoose.isValidObjectId(productId)) return [];
  const bundles = await Bundle.find({ products: productId, isActive: true }).limit(3).lean();
  const out = [];
  for (const bundle of bundles) {
    const products = await listedProducts(bundle);
    if (products.length >= 2) out.push(shape(bundle, products));
  }
  return out;
}

async function addAll(user, slug) {
  if (!user || user.role !== "customer") throw new HttpError(403, "Sign in to add a bundle to your cart.");
  const bundle = await Bundle.findOne({ slug: String(slug || "").toLowerCase(), isActive: true }).lean();
  if (!bundle) throw new HttpError(404, "That bundle is not available.");
  const products = await listedProducts(bundle);
  if (products.length !== bundle.products.length) throw new HttpError(409, "Part of this bundle is no longer available.", null, "items_unavailable");
  let cart = null;
  for (const product of products) {
    // Products with sizes need the shopper to choose one: send them to the product page instead.
    if (product.variants && product.variants.length) throw new HttpError(409, `Choose a size for ${product.name} first.`, null, "option_required");
    cart = await cartService.addItem(user._id, String(product._id), 1);
  }
  return { message: `${bundle.name} added to your cart.`, cart };
}

module.exports = { forProduct, addAll, shape, slugify };
