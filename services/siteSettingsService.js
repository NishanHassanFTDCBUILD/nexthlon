// Store-wide settings an admin changes from Settings, and that take effect at once:
// business details, delivery and returns, catalogue limits, and what shoppers see
// (an announcement bar, home page sections, reviews, questions, back-in-stock alerts).
//
// How it works:
//   - Every setting has a default (the values the store shipped with, or STORE_* in .env).
//   - What an admin saves is kept in one Setting document ("site"). Only changed values are stored.
//   - The live values are copied onto the objects the rest of the code already reads
//     (STORE in config/store.js, RULES in config/catalog.js), so prices, policy pages,
//     invoices and emails all follow without each of them asking the database.
//   - Each server loads them at start-up and again every 30 seconds, so several copies of the
//     app agree within half a minute; the server that saved the change applies it straight away.
const Setting = require('../models/Setting');
const {STORE} = require('../config/store');
const {RULES} = require('../config/catalog');
const {HttpError} = require('../utils/http');
const logger = require('../utils/logger');

const KEY = 'site';
const REFRESH_MS = 30 * 1000;

// The home page sections an admin can switch off, in page order.
const HOME_SECTIONS = [
  ['homeShowroom', 'Featured gear showroom'],
  ['homeSports', 'Sports ring'],
  ['homeSpotlight', 'In the spotlight'],
  ['homeDeals', 'Deals of the day'],
  ['homeShopSports', 'Shop by sport'],
  ['homeStats', 'Store numbers'],
  ['homeBestSellers', 'Best sellers'],
  ['homeSignup', 'Free account invite'],
  ['homeNewArrivals', 'New arrivals'],
];

// type: text | money (paise; typed in rupees) | int | bool | path
// target: the live object the value is copied onto (null: read through current()).
const FIELDS = {
  // ---------- Business details (policy pages, footer, invoices, emails) ----------
  legalName: {group: 'business', type: 'text', max: 120, target: STORE},
  address: {group: 'business', type: 'text', max: 240, target: STORE},
  supportEmail: {group: 'business', type: 'email', max: 120, target: STORE},
  supportPhone: {group: 'business', type: 'text', max: 20, target: STORE},
  supportHours: {group: 'business', type: 'text', max: 80, target: STORE},
  grievanceOfficer: {group: 'business', type: 'text', max: 80, target: STORE},

  // ---------- Delivery and returns ----------
  freeDeliveryMin: {
    group: 'delivery',
    type: 'money',
    min: 0,
    max: 10000000,
    target: STORE,
  },
  deliveryFee: {
    group: 'delivery',
    type: 'money',
    min: 0,
    max: 100000,
    target: STORE,
  },
  dispatchDays: {group: 'delivery', type: 'text', max: 40, target: STORE},
  deliveryDays: {group: 'delivery', type: 'text', max: 40, target: STORE},
  returnDays: {group: 'delivery', type: 'int', min: 0, max: 30, target: STORE},
  refundDays: {group: 'delivery', type: 'text', max: 40, target: STORE},

  // ---------- Catalogue and cart ----------
  lowStockLimit: {
    group: 'catalog',
    type: 'int',
    min: 0,
    max: 100,
    target: RULES,
  },
  maxPerProduct: {
    group: 'catalog',
    type: 'int',
    min: 1,
    max: 20,
    target: RULES,
  },

  // ---------- What shoppers see ----------
  announceOn: {group: 'shopper', type: 'bool', target: null},
  announceText: {group: 'shopper', type: 'text', max: 140, target: null},
  announceLink: {group: 'shopper', type: 'path', max: 200, target: null},
  reviewsOn: {group: 'shopper', type: 'bool', target: null},
  questionsOn: {group: 'shopper', type: 'bool', target: null},
  stockAlertsOn: {group: 'shopper', type: 'bool', target: null},
  dealsCountdownMode: {
    group: 'countdown',
    type: 'choice',
    options: ['auto', 'custom', 'hidden'],
    target: null,
  },
  dealsCountdownEndsAt: {group: 'countdown', type: 'datetime', target: null},
  ...Object.fromEntries(
    HOME_SECTIONS.map(([key]) => [
      key,
      {group: 'home', type: 'bool', target: null},
    ]),
  ),
};

// The values the store starts with. Business details and delivery rules come from config/store.js
// (and so from STORE_* in .env); the catalogue limits from config/catalog.js.
const DEFAULTS = Object.freeze({
  ...Object.fromEntries(
    Object.entries(FIELDS)
      .filter(([, field]) => field.target)
      .map(([key, field]) => [key, field.target[key]]),
  ),
  announceOn: false,
  announceText: '',
  announceLink: '',
  reviewsOn: true,
  questionsOn: true,
  stockAlertsOn: true,
  dealsCountdownMode: 'auto',
  dealsCountdownEndsAt: '',
  ...Object.fromEntries(HOME_SECTIONS.map(([key]) => [key, true])),
});

let saved = {};
let live = {...DEFAULTS};
let timer = null;

function apply(values) {
  saved = values || {};
  live = {...DEFAULTS, ...saved};
  for (const [key, field] of Object.entries(FIELDS))
    if (field.target) field.target[key] = live[key];
}

// The values in force right now (a copy, safe to hand to a view).
const current = () => ({...live});

async function load() {
  const row = await Setting.findOne({key: KEY}).lean();
  apply(row && row.value && typeof row.value === 'object' ? row.value : {});
  return current();
}

// Load now, then keep up with changes made on other servers.
async function start() {
  try {
    await load();
  } catch (error) {
    logger.warn('site_settings.load_failed', {error});
  }
  if (!timer) {
    timer = setInterval(() => {
      load().catch((error) =>
        logger.warn('site_settings.refresh_failed', {error}),
      );
    }, REFRESH_MS);
    timer.unref();
  }
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

// ---------- Reading what the admin typed ----------
const text = (value) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readField(key, field, raw) {
  if (field.type === 'choice') {
    return field.options.includes(raw)
      ? {value: raw}
      : {error: 'Choose a countdown option.'};
  }
  if (field.type === 'datetime') {
    if (raw === '') return {value: ''};
    if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))
      return {error: 'Choose an end date and time in IST.'};
    const date = new Date(`${raw}:00+05:30`);
    if (
      !Number.isFinite(date.getTime()) ||
      new Date(date.getTime() + 330 * 60000).toISOString().slice(0, 16) !== raw
    )
      return {error: 'Choose a valid date and time.'};
    return {value: date.toISOString()};
  }
  if (field.type === 'bool')
    return {value: raw === true || raw === 'true' || raw === 'on' || raw === 1};
  if (field.type === 'money' || field.type === 'int') {
    const typed = typeof raw === 'number' ? String(raw) : text(raw);
    if (!/^\d{1,8}$/.test(typed))
      return {error: 'Enter a whole number, without letters or decimals.'};
    const number = Number(typed);
    const value = field.type === 'money' ? number * 100 : number;
    if (value < field.min || value > field.max) {
      const show = (n) =>
        field.type === 'money' ? `₹${(n / 100).toLocaleString('en-IN')}` : n;
      return {
        error: `Enter a value from ${show(field.min)} to ${show(field.max)}.`,
      };
    }
    return {value};
  }
  const value = text(raw);
  if (value.length > field.max)
    return {error: `Keep it to ${field.max} characters.`};
  if (field.type === 'email' && value && !EMAIL.test(value))
    return {error: 'Enter an email address like help@example.in.'};
  if (field.type === 'path' && value && !/^\/[^\s/][^\s]*$|^\/$/.test(value))
    return {
      error: 'Use a link on this site that starts with /, like /products.',
    };
  return {value};
}

// Saves the fields of one group (the form sends a whole group at once). Empty text in the
// business group means "use the default" (from .env), so a half-filled form never wipes a value.
async function update(group, body = {}) {
  const keys = Object.keys(FIELDS).filter((key) => FIELDS[key].group === group);
  if (!keys.length) throw new HttpError(404, 'Unknown settings section.');
  const errors = {};
  const changes = {};
  for (const key of keys) {
    const field = FIELDS[key];
    if (!Object.hasOwn(body, key)) continue;
    const {value, error} = readField(key, field, body[key]);
    if (error) errors[key] = error;
    else changes[key] = value;
  }
  if (group === 'shopper' && changes.announceOn && !changes.announceText)
    errors.announceText = 'Write the message, or switch the bar off.';
  if (group === 'countdown') {
    const mode = changes.dealsCountdownMode ?? live.dealsCountdownMode;
    const endsAt = changes.dealsCountdownEndsAt ?? live.dealsCountdownEndsAt;
    if (mode === 'custom' && !errors.dealsCountdownEndsAt) {
      const remaining = new Date(endsAt).getTime() - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0)
        errors.dealsCountdownEndsAt = 'Choose a future end date and time.';
      else if (remaining > 31 * 86400000)
        errors.dealsCountdownEndsAt =
          'Choose an end time within the next 31 days.';
    }
  }
  if (Object.keys(errors).length)
    throw new HttpError(400, 'Please fix the highlighted fields.', errors);

  const before = Object.fromEntries(keys.map((key) => [key, live[key]]));
  const next = {...saved};
  for (const [key, value] of Object.entries(changes)) {
    const keepDefault =
      (group === 'business' && value === '') || value === DEFAULTS[key];
    if (keepDefault) delete next[key];
    else next[key] = value;
  }
  await Setting.updateOne({key: KEY}, {$set: {value: next}}, {upsert: true});
  apply(next);
  const after = Object.fromEntries(keys.map((key) => [key, live[key]]));
  return {before, after, settings: current()};
}

// For the settings form: every value, and which are still the shipped default.
function forAdmin() {
  return {
    values: current(),
    defaults: DEFAULTS,
    custom: Object.keys(saved),
    homeSections: HOME_SECTIONS,
  };
}

// Tests only: back to the defaults.
async function reset() {
  await Setting.deleteOne({key: KEY});
  apply({});
}

module.exports = {
  FIELDS,
  DEFAULTS,
  HOME_SECTIONS,
  current,
  load,
  start,
  stop,
  update,
  forAdmin,
  reset,
};
