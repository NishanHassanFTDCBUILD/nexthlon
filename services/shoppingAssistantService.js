// Shopping assistant: answers questions about the store and finds products from a plain sentence,
// e.g. "waterproof jacket for a monsoon trek under ₹3,000". Rules-based: no AI service is called and no
// message is stored. It reads only listed, in-stock products and the store's own settings (config/store).
const Product = require('../models/Product');
const {LISTED_PRODUCT} = require('../utils/queryFilters');
const {STORE} = require('../config/store');
const {toPublicProduct, escapeRegex} = require('./productService');

const MAX_MESSAGE = 300;
const MAX_RESULTS = 4;

const STOP = new Set([
  'a',
  'an',
  'the',
  'for',
  'with',
  'and',
  'or',
  'in',
  'on',
  'of',
  'to',
  'me',
  'my',
  'i',
  'want',
  'need',
  'find',
  'show',
  'some',
  'any',
  'is',
  'are',
  'do',
  'you',
  'have',
  'looking',
  'look',
  'under',
  'below',
  'over',
  'above',
  'less',
  'than',
  'upto',
  'up',
  'max',
  'min',
  'within',
  'budget',
  'rs',
  'inr',
  'please',
  'can',
  'get',
  'buy',
  'good',
  'best',
  'nice',
  'cheap',
  'something',
  'at',
  'least',
  'from',
  'that',
  'this',
  'it',
  'be',
  'would',
  'like',
  'checkout',
  'k',
]);

// Words shoppers use for a need, mapped to the words the catalogue uses.
const NEEDS = Object.freeze({
  monsoon: ['waterproof', 'rain'],
  rain: ['waterproof', 'rain'],
  rainy: ['waterproof', 'rain'],
  wet: ['waterproof'],
  trek: ['trekking', 'hiking'],
  trekking: ['trekking', 'hiking'],
  hike: ['hiking'],
  hiking: ['hiking'],
  run: ['running'],
  running: ['running'],
  marathon: ['running'],
  gym: ['fitness', 'gym'],
  workout: ['fitness'],
  yoga: ['yoga'],
  swim: ['swimming'],
  swimming: ['swimming'],
  cycle: ['cycling'],
  cycling: ['cycling'],
  camp: ['camping'],
  camping: ['camping'],
  sneakers: ['shoes'],
  trainers: ['shoes'],
  soccer: ['football'],
});

const GREETING = new Set(['hi', 'hello', 'hey', 'namaste']);

// Questions about the store, answered with the store's own facts and a link to the full page.
const TOPICS = Object.freeze([
  {
    words: [
      'refund',
      'refunds',
      'return',
      'returns',
      'cancel',
      'cancellation',
      'cancelled',
    ],
    label: 'Refund and cancellation policy',
    href: '/refund-policy',
    answer:
      'Our refund and cancellation policy explains when you can cancel, how to return an item, and how refunds are paid.',
  },
  {
    words: ['shipping', 'delivery', 'deliver', 'dispatch', 'ship', 'courier'],
    label: 'Shipping and delivery policy',
    href: '/shipping-policy',
    get answer() {
      return `Delivery is free on orders of ₹${Math.round(STORE.freeDeliveryMin / 100).toLocaleString('en-IN')} or more. Below that a delivery fee of ₹${Math.round(STORE.deliveryFee / 100)} applies.`;
    },
  },
  {
    words: ['track', 'tracking', 'status'],
    label: 'Track your order',
    href: '/track',
    answer:
      'Enter your order number on the tracking page to see where your order is.',
  },
  {
    words: ['cod', 'cash'],
    label: 'Shipping and delivery policy',
    href: '/shipping-policy',
    answer:
      'Cash on delivery is offered on some orders. Checkout shows whether it is available for your order and address.',
  },
  {
    words: ['size', 'sizes', 'fit', 'measure', 'sizing'],
    label: 'Size finder',
    href: '/size-finder',
    answer:
      'The size finder helps you choose the right fit for shoes and clothing.',
  },
  {
    words: ['gift', 'giftcard', 'voucher'],
    label: 'Gift cards',
    href: '/account/gift-card',
    answer: 'Gift cards can be bought for yourself or for someone else.',
  },
  {
    words: ['payment', 'pay', 'upi', 'card', 'cards', 'netbanking', 'razorpay'],
    label: 'Shipping and delivery policy',
    href: '/shipping-policy',
    answer:
      'You can pay online at checkout. Cash on delivery is available on some orders.',
  },
  {
    words: ['contact', 'human', 'agent', 'support', 'help', 'person'],
    label: 'Contact us',
    href: '/contact',
    answer:
      'Our team can help with anything else. Send us a message and we will reply.',
  },
]);

// "under ₹3,000", "below 3k", "over 500": the price limits, in whole rupees.
function parsePrice(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/,/g, '');
  const money = '(?:₹|rs\\.?\\s*|inr\\s*)?(\\d+(?:\\.\\d+)?)\\s*(k)?';
  const max = t.match(
    new RegExp(
      '(?:under|below|less than|upto|up to|max(?:imum)?|within|budget(?: of)?|cheaper than)\\s*' +
        money,
    ),
  );
  const min = t.match(
    new RegExp('(?:over|above|more than|at least|minimum|min)\\s*' + money),
  );
  const toRupees = (m) =>
    m ? Math.round(Number(m[1]) * (m[2] ? 1000 : 1)) : null;
  return {max: toRupees(max), min: toRupees(min)};
}

// The meaningful words of a request, and the catalogue words they stand for.
function productTerms(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/,/g, '')
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z]/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w));
  const original = [...new Set(words)];
  const terms = [];
  for (const word of original) {
    for (const term of NEEDS[word] || [word])
      if (!terms.includes(term)) terms.push(term);
  }
  return {words: original.slice(0, 3), terms: terms.slice(0, 8)};
}

// Finds listed, in-stock products that match the words and price limits, best matches first.
async function findProducts({terms, min, max}) {
  const query = {...LISTED_PRODUCT, stock: {$gt: 0}};
  if (min !== null || max !== null) {
    query.price = {};
    if (min !== null) query.price.$gte = min * 100;
    if (max !== null) query.price.$lte = max * 100;
  }
  if (terms.length) {
    const pattern = new RegExp(terms.map(escapeRegex).join('|'), 'i');
    query.$or = [{name: pattern}, {brand: pattern}, {description: pattern}];
  }
  const rows = await Product.find(query)
    .sort({ratingAverage: -1, _id: 1})
    .limit(60)
    .populate('category', 'name slug')
    .lean();
  const scored = rows.map((p) => {
    const name = String(p.name || '').toLowerCase();
    const category = String(
      (p.category && p.category.name) || '',
    ).toLowerCase();
    const description = String(p.description || '').toLowerCase();
    let score = 0;
    let named = false;
    for (const term of terms) {
      if (hasWord(name, term) || hasWord(category, term)) named = true;
      if (hasWord(name, term)) score += 3;
      if (hasWord(category, term)) score += 2;
      if (hasWord(description, term)) score += 1;
    }
    return {p, score, named};
  });
  // Products named for the request (name or category) come first. A description-only match, such as a
  // backpack that mentions "waterproof", is shown only when nothing is named for it.
  const named = scored.filter((s) => s.named);
  const pool = named.length ? named : scored;
  pool.sort(
    (a, b) =>
      b.score - a.score || (b.p.ratingAverage || 0) - (a.p.ratingAverage || 0),
  );
  return pool
    .filter((s) => !terms.length || s.score > 0)
    .slice(0, MAX_RESULTS)
    .map((s) => toPublicProduct(s.p));
}

// Whole words only: 'rain' must not match 'training'.
const hasWord = (text, term) =>
  new RegExp('\\b' + escapeRegex(term)).test(text);

// The requested words that no shown product mentions (name, category, brand or description).
function missingWords(words, products) {
  return words.filter(
    (word) =>
      !products.some((p) =>
        hasWord(
          [p.name, p.category, p.brand, p.description].join(' ').toLowerCase(),
          word,
        ),
      ),
  );
}

const rupees = (n) => `₹${n.toLocaleString('en-IN')}`;

// The reply to one question: text, matching products, links, and whether to hand over to the team.
async function answer(message) {
  const text = String(message || '')
    .trim()
    .slice(0, MAX_MESSAGE);
  if (!text) {
    return {
      reply: 'Ask me about a product, or about delivery, returns or sizes.',
      products: [],
      links: [],
      handoff: false,
    };
  }
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= 3 && words.some((w) => GREETING.has(w))) {
    return {
      reply:
        'Hi! Ask me to find something, like "running shoes under ₹2,000", or ask about delivery, returns or sizes.',
      products: [],
      links: [],
      handoff: false,
    };
  }
  const topic = TOPICS.find((t) => words.some((w) => t.words.includes(w)));
  if (topic) {
    return {
      reply: topic.answer,
      products: [],
      links: [{label: topic.label, href: topic.href}],
      handoff: false,
    };
  }

  const {min, max} = parsePrice(text);
  const {words: shown, terms} = productTerms(text);
  if (!terms.length && min === null && max === null) {
    return {
      reply:
        'I am not sure what you are looking for. Try "waterproof jacket under ₹3,000", or ask about delivery, returns or sizes.',
      products: [],
      links: [{label: 'Contact us', href: '/contact'}],
      handoff: true,
    };
  }

  const products = await findProducts({terms, min, max});
  const what = shown.length ? ` for ${shown.join(' ')}` : '';
  const limit =
    max !== null
      ? ` under ${rupees(max)}`
      : min !== null
        ? ` over ${rupees(min)}`
        : '';
  if (products.length) {
    const count =
      products.length === 1 ? '1 match' : `${products.length} matches`;
    // A word the shopper asked for that no shown product mentions is said plainly, not hidden.
    const missing = missingWords(shown, products);
    const reply = missing.length
      ? `I couldn't find "${missing.join(' ')}" in the store, so these are the closest matches${limit}.`
      : `I found ${count}${what}${limit}.`;
    return {reply, products, links: [], handoff: false};
  }
  return {
    reply: `I couldn't find a match${what}${limit}. Try a simpler word or a wider price, or ask our team.`,
    products: [],
    links: [{label: 'Contact us', href: '/contact'}],
    handoff: true,
  };
}

module.exports = {
  MAX_MESSAGE,
  TOPICS,
  parsePrice,
  productTerms,
  missingWords,
  answer,
};
