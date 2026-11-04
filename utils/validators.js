const { INDIAN_STATES } = require("../config/catalog");
const { rupeesToPaise } = require("./money");
const { CONTACT_TOPICS } = require("../config/store");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[6-9]\d{9}$/;
const PINCODE = /^[1-9]\d{5}$/;
const NAME = /^\p{L}[\p{L} .'-]*$/u;
const WHOLE = /^\d{1,6}$/;
const MAX_PRICE = 10_000_000 * 100; // ₹1 crore, in paise
const OBJECT_ID = /^[a-f0-9]{24}$/i;

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cleanPhone(value) {
  return text(value).replace(/[\s-]/g, "").replace(/^\+91/, "");
}

function hasErrors(errors) {
  return Object.keys(errors).length > 0;
}

function checkName(name) {
  if (name.length < 2 || name.length > 60) return "Enter a name of 2 to 60 characters.";
  if (!NAME.test(name)) return "Use letters, spaces, dots, apostrophes or hyphens only.";
  return null;
}

function checkPassword(password) {
  if (password.length < 8 || password.length > 64) return "Use 8 to 64 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  return null;
}

function validateSignup(body = {}) {
  const errors = {};
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";

  const nameProblem = checkName(name);
  if (nameProblem) errors.name = nameProblem;
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  const passwordProblem = checkPassword(password);
  if (passwordProblem) errors.password = passwordProblem;
  if (body.confirmPassword !== undefined && body.confirmPassword !== password) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return { errors, value: { name, email, password } };
}

function validateLogin(body = {}) {
  const errors = {};
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (!password || password.length > 64) errors.password = "Enter your password.";
  return { errors, value: { email, password } };
}

function validateProfile(body = {}) {
  const errors = {};
  const name = text(body.name);
  const phone = cleanPhone(body.phone);
  const nameProblem = checkName(name);
  if (nameProblem) errors.name = nameProblem;
  if (phone && !PHONE.test(phone)) errors.phone = "Enter a 10-digit Indian mobile number.";
  return { errors, value: { name, phone } };
}

function validatePasswordChange(body = {}) {
  const errors = {};
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword) errors.currentPassword = "Enter your current password.";
  const problem = checkPassword(newPassword);
  if (problem) errors.newPassword = problem;
  else if (newPassword === currentPassword) errors.newPassword = "Choose a password different from your current one.";
  if (body.confirmPassword !== newPassword) errors.confirmPassword = "Passwords do not match.";
  return { errors, value: { currentPassword, newPassword } };
}

function validateAddress(body = {}) {
  const errors = {};
  const value = {
    fullName: text(body.fullName),
    phone: cleanPhone(body.phone),
    line1: text(body.line1),
    line2: text(body.line2),
    landmark: text(body.landmark),
    city: text(body.city),
    state: text(body.state),
    pincode: text(body.pincode),
    isDefault: body.isDefault === true || body.isDefault === "true" || body.isDefault === "on"
  };

  const nameProblem = checkName(value.fullName);
  if (nameProblem) errors.fullName = nameProblem;
  if (!PHONE.test(value.phone)) errors.phone = "Enter a 10-digit Indian mobile number.";
  if (value.line1.length < 5 || value.line1.length > 120) errors.line1 = "Enter the house number and street (5 to 120 characters).";
  if (value.line2.length > 120) errors.line2 = "Keep this under 120 characters.";
  if (value.landmark.length > 80) errors.landmark = "Keep this under 80 characters.";
  if (value.city.length < 2 || value.city.length > 50) errors.city = "Enter your city.";
  if (!INDIAN_STATES.includes(value.state)) errors.state = "Choose your state.";
  if (!PINCODE.test(value.pincode)) errors.pincode = "Enter a valid 6-digit PIN code.";
  return { errors, value };
}

// Long text keeps its line breaks; only the ends are trimmed.
function longText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

// Form fields arrive as rupees typed as text ("2999" or "2999.50"); they are stored as paise.
function readMoney(value) {
  return rupeesToPaise(typeof value === "number" ? String(value) : text(value));
}

// A whole-number percentage from 0 to max, sent as a number or text. Empty means 0.
function readPercent(value, max = 90) {
  const raw = typeof value === "number" ? String(value) : text(value);
  if (raw === "") return 0;
  return /^\d{1,2}$/.test(raw) && Number(raw) <= max ? Number(raw) : null;
}

// Admin product form. The selling price, discount and slug are never read from here; the server
// works them out from the base price, the M.R.P. and the offers. category is the category's id
// (the service checks that it exists).
function validateProduct(body = {}) {
  const errors = {};
  const value = {
    name: text(body.name),
    description: longText(body.description),
    category: text(body.category),
    brand: text(body.brand) || "Nexthlon",
    basePrice: readMoney(body.price),
    mrp: readMoney(body.mrp),
    offerPercent: readPercent(body.offerPercent),
    stock: null
  };
  const stockRaw = typeof body.stock === "number" ? String(body.stock) : text(body.stock);
  if (WHOLE.test(stockRaw)) value.stock = Number(stockRaw);

  if (value.name.length < 3 || value.name.length > 120) errors.name = "Enter a product name of 3 to 120 characters.";
  if (value.description.length > 4000) errors.description = "Keep the description under 4000 characters.";
  if (!OBJECT_ID.test(value.category)) errors.category = "Choose a category.";
  if (value.brand.length > 60) errors.brand = "Keep the brand under 60 characters.";
  if (value.basePrice === null || value.basePrice <= 0 || value.basePrice > MAX_PRICE) {
    errors.price = "Enter a price greater than 0 (up to 2 decimal places).";
  }
  if (value.mrp === null || value.mrp > MAX_PRICE) errors.mrp = "Enter the M.R.P. as a number.";
  else if (value.basePrice !== null && value.mrp < value.basePrice) errors.mrp = "M.R.P. must be the same as or higher than the price.";
  if (value.offerPercent === null) errors.offerPercent = "Enter an offer from 0 to 90 percent.";
  if (value.stock === null) errors.stock = "Enter stock as a whole number, 0 or more.";
  return { errors, value };
}

// A product review. Only the stars, title and text are read; who wrote it comes from the login.
function validateReview(body = {}) {
  const errors = {};
  const rating = typeof body.rating === "number" ? body.rating : Number(text(body.rating));
  const value = { rating, title: text(body.title), body: longText(body.body) };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = "Choose from 1 to 5 stars.";
  if (value.title.length > 80) errors.title = "Keep the title under 80 characters.";
  if (value.body.length < 10 || value.body.length > 1000) errors.body = "Write a review of 10 to 1000 characters.";
  return { errors, value };
}

// A quantity from the cart: a whole number, sent as a number or as text like "2".
// Stock and the 5-per-product limit are checked in cartService against the database.
function readQuantity(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : null;
  const raw = text(value);
  return /^\d{1,3}$/.test(raw) ? Number(raw) : null;
}

function validateCartQuantity(body = {}) {
  const errors = {};
  const quantity = readQuantity(body.quantity);
  if (quantity === null || quantity < 1) errors.quantity = "Choose a quantity of at least 1.";
  return { errors, value: { quantity } };
}

// Only the product and quantity are read. Any price sent by the browser is ignored.
function validateCartItem(body = {}) {
  const errors = {};
  const productId = text(body.productId);
  if (!/^[a-f0-9]{24}$/i.test(productId)) errors.productId = "Choose a product.";
  const quantity = body.quantity === undefined ? 1 : readQuantity(body.quantity);
  if (quantity === null || quantity < 1) errors.quantity = "Choose a quantity of at least 1.";
  return { errors, value: { productId, quantity } };
}

// Contact form. "website" is a hidden trap field: people never see it, so only bots fill it in.
function validateContact(body = {}) {
  const errors = {};
  const value = {
    name: text(body.name),
    email: text(body.email).toLowerCase(),
    phone: cleanPhone(body.phone),
    topic: text(body.topic),
    message: longText(body.message),
    isBot: text(body.website) !== ""
  };
  const nameProblem = checkName(value.name);
  if (nameProblem) errors.name = nameProblem;
  if (!EMAIL.test(value.email) || value.email.length > 254) errors.email = "Enter a valid email address.";
  if (value.phone && !PHONE.test(value.phone)) errors.phone = "Enter a 10-digit Indian mobile number, or leave it empty.";
  if (!CONTACT_TOPICS.includes(value.topic)) errors.topic = "Choose what your message is about.";
  if (value.message.length < 10 || value.message.length > 2000) errors.message = "Write a message of 10 to 2000 characters.";
  return { errors, value };
}

function validateNewsletter(body = {}) {
  const errors = {};
  const email = text(body.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  return { errors, value: { email } };
}

// "id1,id2,..." from a query string: only real 24-character ids, no repeats, at most `max`.
function readIdList(raw, max = 50) {
  const parts = typeof raw === "string" ? raw.split(",") : [];
  const ids = [];
  for (const part of parts) {
    const id = part.trim().toLowerCase();
    if (/^[a-f0-9]{24}$/.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length === max) break;
  }
  return ids;
}

module.exports = {
  hasErrors,
  validateContact,
  validateNewsletter,
  readIdList,
  readMoney,
  readPercent,
  validateReview,
  validateSignup,
  validateLogin,
  validateProfile,
  validatePasswordChange,
  validateAddress,
  validateProduct,
  validateCartItem,
  validateCartQuantity
};
