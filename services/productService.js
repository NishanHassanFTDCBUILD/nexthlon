const mongoose = require('mongoose');
const Product = require('../models/Product');
const categoryService = require('./categoryService');
const {HttpError} = require('../utils/http');
const {bestOfferFor} = require('../utils/pricing');
const dealService = require('./dealService');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const memo = require('../utils/memo');
const {correctQuery, vocabularyFrom} = require('../utils/fuzzy');

const PAGE_SIZE = 12;
// "relevance" ranks by text-search score when there is a search, and by best deals otherwise.
const SORTS = {
  relevance: {
    label: 'Relevance',
    order: {discountPercent: -1, ratingAverage: -1, name: 1, _id: 1},
  },
  price_asc: {label: 'Price: low to high', order: {price: 1, _id: 1}},
  price_desc: {label: 'Price: high to low', order: {price: -1, _id: 1}},
  newest: {label: 'Newest first', order: {createdAt: -1, _id: -1}},
  rating: {
    label: 'Customer rating',
    order: {ratingAverage: -1, ratingCount: -1, _id: 1},
  },
  discount: {
    label: 'Biggest discount',
    order: {discountPercent: -1, price: 1, _id: 1},
  },
  name_asc: {label: 'Name: A to Z', order: {name: 1, _id: 1}},
};
const DISCOUNT_STEPS = [10, 20, 30, 40, 50];
const RATING_STEPS = [4, 3, 2];
const MAX_BRANDS = 20;
const MAX_OPTION_FILTERS = 20;
const CATEGORY_FIELDS = 'name slug offerPercent';

// Stops search text from being read as a regular expression.
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toPositiveInt(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= 10000
    ? number
    : fallback;
}

// Whole rupees from the URL (prices in links stay human: ?min=1000&max=2999).
function toRupees(value) {
  if (value === undefined || value === '' || Array.isArray(value)) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 10_000_000
    ? number
    : null;
}

function readList(value, max) {
  const list = (Array.isArray(value) ? value : [value])
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim().slice(0, 60))
    .filter(Boolean);
  return [...new Set(list)].slice(0, max);
}

// Turns raw query values into a safe filter. Bad values are ignored, never trusted.
function readFilters(query = {}) {
  const q =
    typeof query.q === 'string'
      ? query.q.trim().replace(/\s+/g, ' ').slice(0, 80)
      : '';
  const category =
    typeof query.category === 'string'
      ? query.category.trim().toLowerCase().slice(0, 80)
      : '';
  const brands = readList(query.brand, MAX_BRANDS);
  let min = toRupees(query.min);
  let max = toRupees(query.max);
  if (min !== null && max !== null && min > max) [min, max] = [max, min];
  const discount = DISCOUNT_STEPS.includes(Number(query.discount))
    ? Number(query.discount)
    : 0;
  const rating = RATING_STEPS.includes(Number(query.rating))
    ? Number(query.rating)
    : 0;
  const inStock = query.inStock === '1' || query.inStock === 'true';
  const sort =
    typeof query.sort === 'string' && Object.hasOwn(SORTS, query.sort)
      ? query.sort
      : 'relevance';
  const view = query.view === 'list' ? 'list' : 'grid';
  const page = toPositiveInt(query.page, 1);
  // Sizes and colours (product options): "available in size 9", "available in Black".
  const sizes = readList(query.size, MAX_OPTION_FILTERS).map((value) =>
    value.slice(0, 20),
  );
  const colours = readList(query.colour, MAX_OPTION_FILTERS).map((value) =>
    value.slice(0, 30),
  );
  return {
    q,
    category,
    brands,
    sizes,
    colours,
    min,
    max,
    discount,
    rating,
    inStock,
    sort,
    view,
    page,
  };
}

// Sizes in the order people expect: numbers by value (6, 7, 8.5, 10), then letter sizes from small to
// large (XS, S, M, L, XL, XXL), then anything else alphabetically.
const LETTER_SIZES = [
  'XXS',
  'XS',
  'S',
  'M',
  'L',
  'XL',
  'XXL',
  'XXXL',
  '3XL',
  '4XL',
];
function sizeOrder(a, b) {
  const na = Number(a);
  const nb = Number(b);
  const numA = a !== '' && Number.isFinite(na);
  const numB = b !== '' && Number.isFinite(nb);
  if (numA && numB) return na - nb;
  if (numA !== numB) return numA ? -1 : 1;
  const la = LETTER_SIZES.indexOf(String(a).toUpperCase());
  const lb = LETTER_SIZES.indexOf(String(b).toUpperCase());
  if (la !== -1 && lb !== -1) return la - lb;
  if ((la !== -1) !== (lb !== -1)) return la !== -1 ? -1 : 1;
  return String(a).localeCompare(String(b), 'en', {numeric: true});
}

// Every word the store uses in product names, brands and category names, for spelling help
// (utils/fuzzy.js). The same for everyone, so kept for 5 minutes; any product change clears it.
function searchVocabulary() {
  return memo.remember('catalog:vocab', 5 * 60 * 1000, async () => {
    const [products, categories] = await Promise.all([
      Product.find({...LISTED_PRODUCT})
        .select('name brand')
        .lean(),
      categoryService.listedCategories(),
    ]);
    return vocabularyFrom([
      ...products.map((p) => p.name),
      ...products.map((p) => p.brand),
      ...categories.map((c) => c.name),
    ]);
  });
}

// The search part of a query. MongoDB text search handles whole words ("trail shoes");
// when it finds nothing, a plain "contains" match on name, brand and description catches
// partial words ("tra") so suggestions still work while typing. When that finds nothing either, the
// words are checked for spelling against the store's own words ("shoees" becomes "shoes") and the
// corrected search is used; the page then says "Showing results for shoes".
async function searchClause(base, q) {
  if (!q) return {clause: {}, mode: 'none'};
  // Synonyms (utils/synonyms.js): "sneakers" also finds shoes.
  const expanded = require('../utils/synonyms').expandQuery(q);
  const text = {$text: {$search: expanded}};
  if (await Product.exists({...base, ...text}))
    return {clause: text, mode: 'text'};
  const pattern = new RegExp(escapeRegex(q), 'i');
  const contains = {
    $or: [{name: pattern}, {brand: pattern}, {description: pattern}],
  };
  if (await Product.exists({...base, ...contains}))
    return {clause: contains, mode: 'contains'};
  const corrected = correctQuery(q, await searchVocabulary());
  if (corrected) {
    const fixed = {$text: {$search: corrected}};
    if (await Product.exists({...base, ...fixed}))
      return {clause: fixed, mode: 'corrected', corrected};
  }
  return {clause: contains, mode: 'contains'};
}

// The one place a validated filter becomes a database query. readFilters() has already thrown
// away anything unsafe (bad numbers, unknown sorts, junk arrays), so every value here is a known
// shape and nothing from the URL reaches MongoDB raw. scope is the search/category the shopper is
// already inside; the facets are built from that same scope, so choosing a brand never hides the rest.
function toProductQuery(filters, scope = {}) {
  const query = {...scope};
  if (filters.brands.length) query.brand = {$in: filters.brands};
  if (filters.min !== null || filters.max !== null) {
    // Prices are whole rupees in the URL and paise in the database.
    query.price = {};
    if (filters.min !== null) query.price.$gte = filters.min * 100;
    if (filters.max !== null) query.price.$lte = filters.max * 100;
  }
  if (filters.discount) query.discountPercent = {$gte: filters.discount};
  if (filters.rating) query.ratingAverage = {$gte: filters.rating};
  if (filters.inStock) query.stock = {$gt: 0};
  // A size or colour filter means "you can buy it in that one now": one option has to match all of
  // the chosen kinds and still have stock (size 9 in Black, not size 9 in Red plus Black in size 10).
  if (filters.sizes.length || filters.colours.length) {
    const option = {stock: {$gt: 0}};
    if (filters.sizes.length) option.size = {$in: filters.sizes};
    if (filters.colours.length) option.colour = {$in: filters.colours};
    query.variants = {$elemMatch: option};
  }
  return query;
}

async function listProducts(query) {
  const filters = readFilters(query);
  let category = null;
  if (filters.category) {
    category = await categoryService.findListedBySlug(filters.category);
    if (!category) throw new HttpError(404, 'That category is not available.');
  }

  const base = {...LISTED_PRODUCT};
  if (category) base.category = category._id;
  const {clause, mode, corrected} = await searchClause(base, filters.q);
  // "scope" is everything the shopper searched for; the facets (brands, price range) come from it,
  // so picking a brand never hides the other brands.
  const scope = {...base, ...clause};

  const filter = toProductQuery(filters, scope);

  const useScore =
    filters.sort === 'relevance' && (mode === 'text' || mode === 'corrected');
  const order = useScore
    ? {score: {$meta: 'textScore'}, _id: 1}
    : SORTS[filters.sort].order;
  const finder = Product.find(
    filter,
    useScore ? {score: {$meta: 'textScore'}} : undefined,
  )
    .sort(order)
    .skip((filters.page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .populate('category', CATEGORY_FIELDS)
    .lean();

  const [products, total, facets] = await Promise.all([
    finder,
    Product.countDocuments(filter),
    getFacets(scope),
  ]);

  return {
    products,
    category,
    facets,
    filters,
    searchMode: mode,
    // The spelling-corrected search, when the words as typed found nothing ("shoees" -> "shoes").
    correctedQuery: corrected || null,
    pagination: {
      page: filters.page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      limit: PAGE_SIZE,
    },
  };
}

// One option kind (size or colour) for the facets: its values that have stock, counted once per product.
function optionFacet(field) {
  return [
    {$unwind: '$variants'},
    {
      $match: {
        [`variants.${field}`]: {$nin: ['', null]},
        'variants.stock': {$gt: 0},
      },
    },
    {$group: {_id: `$variants.${field}`, products: {$addToSet: '$_id'}}},
    {$project: {count: {$size: '$products'}}},
    {$limit: 40},
  ];
}

// Brands with counts, and the cheapest and dearest price (in whole rupees) for the price slider.
async function getFacets(scope) {
  const [result] = await Product.aggregate([
    {$match: scope},
    {
      $facet: {
        brands: [
          {$group: {_id: '$brand', count: {$sum: 1}}},
          {$sort: {count: -1, _id: 1}},
          {$limit: 30},
        ],
        range: [
          {$group: {_id: null, low: {$min: '$price'}, high: {$max: '$price'}}},
        ],
        // Sizes and colours that are in stock somewhere in this list, each with how many products have it.
        sizes: optionFacet('size'),
        colours: optionFacet('colour'),
      },
    },
  ]);
  const range = result && result.range[0];
  const options = (list) =>
    (list || []).map((row) => ({name: row._id, count: row.count}));
  return {
    brands: result
      ? result.brands
          .filter((b) => b._id)
          .map((b) => ({name: b._id, count: b.count}))
      : [],
    sizes: options(result && result.sizes).sort((a, b) =>
      sizeOrder(a.name, b.name),
    ),
    colours: options(result && result.colours).sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    ),
    priceLow: range ? Math.floor(range.low / 100) : 0,
    priceHigh: range ? Math.ceil(range.high / 100) : 0,
  };
}

// Listed categories that have at least one listed product, with counts and a "from" price.
async function getCategorySummaries() {
  const [categories, groups] = await Promise.all([
    categoryService.listedCategories(),
    Product.aggregate([
      {$match: {...LISTED_PRODUCT}},
      {$sort: {discountPercent: -1}},
      {
        $group: {
          _id: '$category',
          count: {$sum: 1},
          fromPrice: {$min: '$price'},
          image: {$first: '$image'},
        },
      },
    ]),
  ]);
  const byId = new Map(groups.map((group) => [String(group._id), group]));
  return categories
    .filter((category) => byId.has(String(category._id)))
    .map((category) => {
      const group = byId.get(String(category._id));
      return {
        id: String(category._id),
        name: category.name,
        slug: category.slug,
        offerPercent: category.offerPercent || 0,
        image: category.image || group.image,
        count: group.count,
        fromPrice: group.fromPrice,
      };
    });
}

// Accepts a slug like "trailflex-2-trail-running-shoes" or a MongoDB id.
// Unlisted products, and products in unlisted categories, are not found.
async function getProduct(idOrSlug) {
  const key = String(idOrSlug || '')
    .trim()
    .toLowerCase();
  if (!key || key.length > 120) return null;
  const conditions = [{slug: key}];
  if (mongoose.isValidObjectId(key)) conditions.push({_id: key});
  return Product.findOne({$or: conditions, ...LISTED_PRODUCT})
    .populate('category', CATEGORY_FIELDS)
    .lean();
}

// The same for every visitor, so kept for 60 seconds (utils/memo.js; any product change clears it).
function getRelatedProducts(product, limit = 8) {
  const categoryId =
    product.category && product.category._id
      ? product.category._id
      : product.category;
  return memo.remember(
    `catalog:related:${product._id}:${limit}`,
    60 * 1000,
    () =>
      Product.find({
        ...LISTED_PRODUCT,
        category: categoryId,
        _id: {$ne: product._id},
      })
        .sort({ratingAverage: -1, discountPercent: -1, _id: 1})
        .limit(limit)
        .lean(),
  );
}

// "Similar products" at the end of every product page. Never empty while the shop has other
// products: the same category first, then the same brand, then gear at a similar price
// (half to double this price), then the best-rated of the rest. No product appears twice.
function getSimilarProducts(product, limit = 8) {
  const categoryId =
    product.category && product.category._id
      ? product.category._id
      : product.category;
  return memo.remember(
    `catalog:similar:${product._id}:${limit}`,
    60 * 1000,
    async () => {
      const picked = [];
      const seen = new Set([String(product._id)]);
      const add = (list) =>
        list.forEach((item) => {
          if (picked.length < limit && !seen.has(String(item._id))) {
            seen.add(String(item._id));
            picked.push(item);
          }
        });
      const sort = {ratingAverage: -1, discountPercent: -1, _id: 1};
      const tiers = [
        categoryId ? {category: categoryId} : null,
        product.brand ? {brand: product.brand} : null,
        product.price
          ? {
              price: {
                $gte: Math.floor(product.price / 2),
                $lte: product.price * 2,
              },
            }
          : null,
        {},
      ].filter(Boolean);
      for (const filter of tiers) {
        if (picked.length >= limit) break;
        add(
          await Product.find({
            ...LISTED_PRODUCT,
            ...filter,
            _id: {$nin: [...seen]},
          })
            .sort(sort)
            .limit(limit)
            .lean(),
        );
      }
      return picked;
    },
  );
}

// Deals of the day: the deals an admin has running now (services/dealService.js), or, when there
// are none, the products with the biggest discounts.
async function homeDeals() {
  const picked = await dealService.liveDealProducts();
  if (picked.products.length) return picked;
  const products = await Product.find({
    ...LISTED_PRODUCT,
    discountPercent: {$gt: 0},
  })
    .sort({discountPercent: -1, _id: 1})
    .limit(10)
    .lean();
  return {products, endsAt: null};
}

async function getHomeSections() {
  const [dealRow, newest, categories, brands] = await Promise.all([
    homeDeals(),
    Product.find({...LISTED_PRODUCT})
      .sort({createdAt: -1, _id: -1})
      .limit(10)
      .lean(),
    getCategorySummaries(),
    Product.distinct('brand', {...LISTED_PRODUCT}),
  ]);
  const deals = dealRow.products;
  // Best sellers: the best-rated in-stock items that are not already in the deals row
  // (highest price first while there are no ratings yet).
  const bestSellers = await Product.find({
    ...LISTED_PRODUCT,
    stock: {$gt: 0},
    _id: {$nin: deals.map((p) => p._id)},
  })
    .sort({ratingCount: -1, ratingAverage: -1, price: -1, _id: 1})
    .limit(10)
    .lean();
  return {
    deals,
    // When the admin's first running deal ends (null: the usual midnight countdown).
    adminDealEndsAt: dealRow.endsAt,
    newest,
    bestSellers,
    categories,
    brands: brands.filter(Boolean).sort(),
  };
}

// Listed products for the given ids, in the same order as the ids. Unknown or unlisted ids are skipped.
async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const found = await Product.find({...LISTED_PRODUCT, _id: {$in: ids}})
    .populate('category', CATEGORY_FIELDS)
    .lean();
  const byId = new Map(found.map((p) => [String(p._id), p]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// The offer that set the price, for the price block ("Extra 10% off with the Running offer").
function offerLabel(product) {
  const offer = bestOfferFor(product);
  if (!offer.percent) return null;
  const name = product.category && product.category.name;
  return {
    percent: offer.percent,
    source: offer.source,
    text:
      offer.source === 'deal'
        ? `${offer.percent}% Deal of the Day applied`
        : offer.source === 'category' && name
          ? `${offer.percent}% ${name} offer applied`
          : `${offer.percent}% product offer applied`,
  };
}

// What the JSON API returns for one product. Money is in paise.
function toPublicProduct(product) {
  const category =
    product.category && product.category.name ? product.category : null;
  return {
    id: String(product._id),
    slug: product.slug,
    name: product.name,
    category: category ? category.name : '',
    categorySlug: category ? category.slug : '',
    brand: product.brand,
    price: product.price,
    mrp: product.mrp,
    discountPercent: product.discountPercent,
    offer: offerLabel(product),
    stock: product.stock,
    inStock: product.stock > 0,
    rating: {
      average: product.ratingAverage || 0,
      count: product.ratingCount || 0,
    },
    image: product.image,
    gallery: product.gallery,
    description: product.description,
    highlights: product.highlights,
    specs: product.specs || {},
    // Sizes and colours, each with its own stock. A product with options needs one chosen to buy it.
    hasOptions: Boolean(product.variants && product.variants.length),
    options: (product.variants || []).map((v) => ({
      id: String(v._id),
      size: v.size || '',
      colour: v.colour || '',
      sku: v.sku || '',
      stock: v.stock,
      inStock: v.stock > 0,
    })),
  };
}

module.exports = {
  PAGE_SIZE,
  SORTS,
  DISCOUNT_STEPS,
  RATING_STEPS,
  escapeRegex,
  toPositiveInt,
  readFilters,
  sizeOrder,
  toProductQuery,
  listProducts,
  getFacets,
  getCategorySummaries,
  searchVocabulary,
  getProduct,
  getRelatedProducts,
  getSimilarProducts,
  getHomeSections,
  getProductsByIds,
  offerLabel,
  toPublicProduct,
};
