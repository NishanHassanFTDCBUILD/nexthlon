const { INDIAN_STATES } = require("../config/catalog");
const { rupeesToPaise } = require("./money");
const { CANCEL_REASONS, RETURN_REASONS } = require("./orderRules");
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
  // Optional: a friend's referral code. Whether it exists is checked by the referral service.
  const referralCode = text(body.referralCode).replace(/\s+/g, "").toUpperCase();
  if (referralCode && !/^[A-Z0-9]{6,12}$/.test(referralCode)) errors.referralCode = "A referral code has 6 to 12 letters and numbers.";
  return { errors, value: { name, email, password, referralCode } };
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

// "Forgot password": just the email.
function validateForgot(body = {}) {
  const errors = {};
  const email = text(body.email).toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  return { errors, value: { email } };
}

// The token from an emailed link: 64 hex characters, nothing else.
const LINK_TOKEN = /^[a-f0-9]{64}$/;
function validateToken(body = {}) {
  const errors = {};
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!LINK_TOKEN.test(token)) errors.form = "This link is not valid. Please ask for a new one.";
  return { errors, value: { token } };
}

// The new password from the reset page.
function validatePasswordReset(body = {}) {
  const { errors, value } = validateToken(body);
  const password = typeof body.password === "string" ? body.password : "";
  const problem = checkPassword(password);
  if (problem) errors.password = problem;
  if (body.confirmPassword !== undefined && body.confirmPassword !== password) errors.confirmPassword = "Passwords do not match.";
  return { errors, value: { ...value, password } };
}

// A 6-digit code from the authenticator app, or a recovery code. Its format is checked when it is used.
function validateTwoFactorCode(body = {}) {
  const errors = {};
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code || code.length > 24) errors.code = "Enter the 6-digit code from your authenticator app.";
  return { errors, value: { code } };
}

function validatePasswordAndCode(body = {}) {
  const { errors, value } = validateTwoFactorCode(body);
  const password = typeof body.password === "string" ? body.password : "";
  if (!password || password.length > 64) errors.password = "Enter your password.";
  return { errors, value: { ...value, password } };
}

// The second step of the admin sign-in: the challenge from the first step, and the code.
function validateTwoFactorLogin(body = {}) {
  const { errors, value } = validateTwoFactorCode(body);
  const challenge = typeof body.challenge === "string" ? body.challenge.trim() : "";
  if (!challenge || challenge.length > 2000) errors.form = "Your sign-in timed out. Enter your email and password again.";
  return { errors, value: { ...value, challenge } };
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
    type: ["home", "work", "other"].includes(text(body.type).toLowerCase()) ? text(body.type).toLowerCase() : "home",
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
  // Sizes and colours. Left out (an older form or an API call without them) means "keep what is there".
  if (body.options !== undefined) {
    const options = readProductOptions(body.options);
    if (options.error) errors.options = options.error;
    else value.variants = options.list;
  }
  // With options, the product's stock is the sum of theirs (models/Product.js), so the field is ignored.
  if (value.variants && value.variants.length) {
    value.stock = value.variants.reduce((sum, option) => sum + option.stock, 0);
    delete errors.stock;
  } else if (value.stock === null) errors.stock = "Enter stock as a whole number, 0 or more.";
  return { errors, value };
}

// The admin's size and colour rows: [{ id, size, colour, sku, stock }], sent as JSON text.
// Every row needs a size or a colour; either all rows have a size or none do (the same for colour),
// so the shopper's picker always has a full set to choose from. No two rows may be the same option.
const MAX_OPTIONS = 60;
const MAX_OPTION_STOCK = 100000;
function readProductOptions(raw) {
  let list = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return { list: [] };
    try {
      list = JSON.parse(raw);
    } catch {
      return { error: "The sizes list could not be read. Reload the page and try again." };
    }
  }
  if (!Array.isArray(list)) return { error: "The sizes list could not be read. Reload the page and try again." };
  if (list.length > MAX_OPTIONS) return { error: `A product can have up to ${MAX_OPTIONS} sizes and colours.` };
  const out = [];
  const seen = new Set();
  for (const [index, row] of list.entries()) {
    const n = index + 1;
    if (!row || typeof row !== "object") return { error: `Row ${n} could not be read.` };
    const option = {
      id: OBJECT_ID.test(text(row.id)) ? text(row.id) : "",
      size: text(row.size),
      colour: text(row.colour),
      sku: text(row.sku),
      stock: null
    };
    const stockRaw = typeof row.stock === "number" ? String(row.stock) : text(row.stock);
    if (WHOLE.test(stockRaw) && Number(stockRaw) <= MAX_OPTION_STOCK) option.stock = Number(stockRaw);
    if (!option.size && !option.colour) return { error: `Row ${n}: enter a size, a colour, or both.` };
    if (option.size.length > 20) return { error: `Row ${n}: keep the size under 20 characters.` };
    if (option.colour.length > 30) return { error: `Row ${n}: keep the colour under 30 characters.` };
    if (option.sku.length > 40) return { error: `Row ${n}: keep the SKU under 40 characters.` };
    if (option.stock === null) return { error: `Row ${n}: enter stock as a whole number from 0 to ${MAX_OPTION_STOCK.toLocaleString("en-IN")}.` };
    const key = `${option.size.toLowerCase()}|${option.colour.toLowerCase()}`;
    if (seen.has(key)) return { error: `Row ${n} is the same as an earlier row (${[option.size, option.colour].filter(Boolean).join(", ")}).` };
    seen.add(key);
    out.push(option);
  }
  const sized = out.filter(option => option.size).length;
  const coloured = out.filter(option => option.colour).length;
  if (sized && sized !== out.length) return { error: "Give every row a size, or leave size empty on all of them." };
  if (coloured && coloured !== out.length) return { error: "Give every row a colour, or leave colour empty on all of them." };
  return { list: out };
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
  // The chosen size or colour, for products that have them. Anything that is not an id is ignored.
  const raw = text(body.variantId);
  const variantId = /^[a-f0-9]{24}$/i.test(raw) ? raw : null;
  return { errors, value: { productId, quantity, variantId } };
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

function readFlag(value) {
  return value === true || value === "true" || value === "1" || value === 1;
}

// Checkout: which address, how to pay and whether to use the wallet. Prices, the coupon and
// every total are worked out on the server.
function validatePlaceOrder(body = {}) {
  const errors = {};
  const value = { addressId: text(body.addressId), paymentMethod: text(body.paymentMethod), useWallet: readFlag(body.useWallet), source: text(body.source) === "buynow" ? "buynow" : "cart" };
  if (!OBJECT_ID.test(value.addressId)) errors.addressId = "Choose a delivery address.";
  if (!value.paymentMethod) errors.paymentMethod = "Choose a payment method.";
  return { errors, value };
}

// Cancelling: an optional reason from the list; anything else is dropped.
function validateCancel(body = {}) {
  const reason = text(body.reason);
  const refundMethod = text(body.refundMethod) === "original" ? "original" : "wallet";
  return { errors: {}, value: { reason: CANCEL_REASONS.includes(reason) ? reason : "", refundMethod } };
}

function validateReturn(body = {}) {
  const errors = {};
  const value = { reason: text(body.reason), note: longText(body.note).slice(0, 500) };
  if (!RETURN_REASONS.includes(value.reason)) errors.reason = "Choose why you are returning it.";
  return { errors, value };
}

// Admin: the referral reward in rupees (0 turns referrals off).
function validateReferralSetting(body = {}) {
  const errors = {};
  const raw = typeof body.referralReward === "number" ? String(body.referralReward) : text(body.referralReward);
  const referralReward = /^\d{1,4}$/.test(raw) ? rupeesToPaise(raw) : NaN;
  if (!Number.isInteger(referralReward) || referralReward > 100000) errors.referralReward = "Enter a whole amount from ₹0 to ₹1,000.";
  return { errors, value: { referralReward } };
}

// Admin: the Cash on Delivery limit in whole rupees, 0 to 50,000 (0 turns cash on delivery off).
function validateCodSetting(body = {}) {
  const errors = {};
  const raw = typeof body.codLimit === "number" ? String(body.codLimit) : text(body.codLimit);
  const codLimit = /^\d{1,5}$/.test(raw) ? rupeesToPaise(raw) : NaN;
  if (!Number.isInteger(codLimit) || codLimit > 5000000) errors.codLimit = "Enter a whole amount from ₹0 to ₹50,000.";
  return { errors, value: { codLimit } };
}

// ---------- My Account ----------

// Changing the sign-in email needs the current password.
function validateEmailChange(body = {}) {
  const errors = {};
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === "string" ? body.password : "";
  if (!EMAIL.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (!password || password.length > 64) errors.password = "Enter your current password.";
  return { errors, value: { email, password } };
}

// Notification switches: only these three keys are read, and only true/false.
const PREFERENCE_KEYS = ["orderUpdates", "offers", "newsletter"];
function validatePreferences(body = {}) {
  const errors = {};
  const value = {};
  PREFERENCE_KEYS.forEach(key => {
    if (body[key] === undefined) return;
    if (typeof body[key] !== "boolean") errors[key] = "Choose on or off.";
    else value[key] = body[key];
  });
  if (!Object.keys(value).length && !hasErrors(errors)) errors.form = "Nothing to change.";
  return { errors, value };
}

function validateListName(body = {}) {
  const errors = {};
  const name = text(body.name);
  if (name.length < 1 || name.length > 40) errors.name = "Give the list a name of up to 40 characters.";
  else if (/^(wishlist|your wishlist|default)$/i.test(name)) errors.name = "Choose a name other than Wishlist.";
  return { errors, value: { name } };
}

// A help request. orderId is optional; the service checks that the order belongs to the customer.
function validateTicket(body = {}, topics = []) {
  const errors = {};
  const value = {
    topic: text(body.topic),
    subject: text(body.subject),
    message: longText(body.message),
    orderId: text(body.orderId).toUpperCase()
  };
  if (!topics.includes(value.topic)) errors.topic = "Choose what it is about.";
  if (value.subject.length < 4 || value.subject.length > 100) errors.subject = "Write a short subject (4 to 100 characters).";
  if (value.message.length < 10 || value.message.length > 2000) errors.message = "Tell us more (10 to 2000 characters).";
  if (value.orderId && !/^[A-Z0-9-]{4,30}$/.test(value.orderId)) errors.orderId = "Choose one of your orders.";
  return { errors, value };
}

function validateTicketReply(body = {}, statuses = null) {
  const errors = {};
  const value = { message: longText(body.message) };
  if (value.message.length < 2 || value.message.length > 2000) errors.message = "Write a reply of 2 to 2000 characters.";
  if (statuses) {
    const status = text(body.status);
    if (status && !statuses.includes(status)) errors.status = "Choose a valid status.";
    value.status = status || null;
  }
  return { errors, value };
}

// Deleting the account needs the password and the word DELETE typed out.
function validateDeleteAccount(body = {}) {
  const errors = {};
  const password = typeof body.password === "string" ? body.password : "";
  const confirm = text(body.confirm).toUpperCase();
  if (!password || password.length > 64) errors.password = "Enter your password.";
  if (confirm !== "DELETE") errors.confirm = "Type DELETE to confirm.";
  return { errors, value: { password } };
}

// Admin top bar search: 2 to 60 characters of plain text.
function validateAdminSearch(query = {}) {
  const q = typeof query.q === "string" ? query.q.trim().replace(/\s+/g, " ").slice(0, 60) : "";
  const errors = {};
  if (q.length < 2) errors.q = "Type at least 2 characters to search.";
  return { errors, value: { q } };
}

// Admin quick restock: a whole number of units to add, 1 to 10,000.
function validateRestock(body = {}) {
  const raw = typeof body.add === "number" ? String(body.add) : typeof body.add === "string" ? body.add.trim() : "";
  const add = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  const errors = {};
  if (!Number.isInteger(add) || add < 1 || add > 10000) errors.add = "Enter how many units to add (1 to 10,000).";
  return { errors, value: { add } };
}

// ---------- Admin: orders, returns, refunds ----------
const ORDER_ID = /^NX-\d{4}-\d{6}$/;
const FORWARD = ["confirmed", "shipped", "out_for_delivery", "delivered"];
const REFUND_METHODS = ["wallet", "original"];

// One order's next status (forward-only is checked against the order itself in the service).
function validateStatusChange(body = {}) {
  const status = text(body.status);
  return { errors: FORWARD.includes(status) ? {} : { status: "Choose the next status." }, value: { status } };
}

// Bulk status: 1 to 100 order numbers and one next status.
function validateBulkStatus(body = {}) {
  const errors = {};
  const ids = Array.isArray(body.orderIds) ? [...new Set(body.orderIds.map(id => text(String(id)).toUpperCase()))] : [];
  if (!ids.length || ids.length > 100 || !ids.every(id => ORDER_ID.test(id))) errors.orderIds = "Select between 1 and 100 orders.";
  const { errors: statusErrors, value } = validateStatusChange(body);
  return { errors: { ...errors, ...statusErrors }, value: { orderIds: ids, status: value.status } };
}

// Admin cancellation: no item ids means every item that can still be cancelled.
function validateAdminCancel(body = {}) {
  const errors = {};
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
  if (itemIds.length > 50 || !itemIds.every(id => OBJECT_ID.test(id))) errors.itemIds = "Pick the items to cancel.";
  const reason = text(body.reason).slice(0, 200);
  const refundMethod = REFUND_METHODS.includes(body.refundMethod) ? body.refundMethod : "wallet";
  return { errors, value: { itemIds, reason, refundMethod } };
}

function validateShipment(body = {}, now = new Date()) {
  const errors = {};
  const courier = text(body.courier);
  const trackingNumber = text(body.trackingNumber).replace(/\s/g, "");
  if (courier.length < 2 || courier.length > 60) errors.courier = "Enter the courier (2 to 60 characters).";
  if (!/^[A-Za-z0-9-]{4,40}$/.test(trackingNumber)) errors.trackingNumber = "Enter the tracking number (4 to 40 letters, numbers or -).";
  let expectedAt = null;
  const day = text(body.expectedAt);
  if (day) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    expectedAt = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)) : null;
    if (!expectedAt || Number.isNaN(expectedAt.getTime())) errors.expectedAt = "Pick a valid date.";
    else if (expectedAt.getTime() < now.getTime() - 2 * 24 * 60 * 60 * 1000) errors.expectedAt = "The expected date can't be in the past.";
    else if (expectedAt.getTime() > now.getTime() + 60 * 24 * 60 * 60 * 1000) errors.expectedAt = "Pick a date within the next 60 days.";
  }
  return { errors, value: { courier, trackingNumber: trackingNumber.toUpperCase(), expectedAt, markShipped: body.markShipped === true || body.markShipped === "true" } };
}

function validateOrderNote(body = {}) {
  const note = longText(body.body);
  return { errors: note.length >= 2 && note.length <= 1000 ? {} : { body: "Write a note (2 to 1,000 characters)." }, value: { body: note } };
}

// A manual refund in rupees (₹1 to ₹10,00,000), to the wallet or back to the card/UPI, with a reason.
function validateManualRefund(body = {}) {
  const errors = {};
  const amount = readMoney(body.amount);
  if (amount === null || amount < 100 || amount > 100_000_000) errors.amount = "Enter an amount from ₹1 to ₹10,00,000.";
  const method = text(body.method);
  if (!REFUND_METHODS.includes(method)) errors.method = "Choose where the money goes.";
  const reason = text(body.reason);
  if (reason.length < 3 || reason.length > 200) errors.reason = "Give a reason (3 to 200 characters).";
  return { errors, value: { amount, method, reason } };
}

// Approve or reject a return. Rejecting needs a note, because the customer sees it.
function validateReturnDecision(body = {}) {
  const errors = {};
  const decision = text(body.decision);
  if (!["approve", "reject"].includes(decision)) errors.decision = "Approve or reject the return.";
  const note = longText(body.note).slice(0, 500);
  if (decision === "reject" && note.length < 5) errors.note = "Tell the customer why (at least 5 characters).";
  const refundMethod = REFUND_METHODS.includes(body.refundMethod) ? body.refundMethod : "wallet";
  return { errors, value: { decision, note, refundMethod } };
}

// ---------- Admin: coupons ----------

const COUPON_CODE = /^[A-Z0-9]{3,20}$/;
// Rupees that may arrive as a number (JSON) or as text (a form). An empty box means 0.
function readOptionalMoney(value) {
  if (typeof value === "number") return readMoney(value);
  return text(value) === "" ? 0 : readMoney(value);
}

// A whole count that may arrive as a number (JSON) or as text (a form). Empty means 0.
function readWhole(value, digits) {
  const raw = typeof value === "number" ? String(value) : text(value);
  if (raw === "") return 0;
  return raw.length <= digits && WHOLE.test(raw) ? Number(raw) : NaN;
}
// A date from a date input (YYYY-MM-DD). Start dates begin at midnight IST, end dates run to the
// very end of that day, so "expires 31 March" really includes the 31st.
function readDay(value, endOfDay = false) {
  const raw = text(value);
  if (raw === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NaN;
  const at = new Date(`${raw}T${endOfDay ? "18:29:59.999Z" : "00:00:00.000Z"}`);
  // Written as UTC minus the 5.5 hour offset, so the day is an Indian calendar day.
  const shifted = new Date(at.getTime() - (endOfDay ? 0 : 330 * 60 * 1000));
  return Number.isNaN(shifted.getTime()) ? NaN : shifted;
}

// The admin coupon form. Percent coupons carry a whole percent in "value"; flat ones carry paise.
// Money fields are typed in rupees and kept in paise. usageLimit / perUserLimit of 0 mean no limit.
function validateCoupon(body = {}) {
  const errors = {};
  const code = text(body.code).replace(/\s+/g, "").toUpperCase();
  const type = text(body.type);
  const description = text(body.description).slice(0, 140);
  const isPercent = type === "percent";
  const value = isPercent ? readPercent(body.value, 90) : readMoney(body.value);
  // The cap and the minimum order are optional on the form: an empty box means "no limit".
  const maxDiscount = readOptionalMoney(body.maxDiscount);
  const minOrder = readOptionalMoney(body.minOrder);
  const startsAt = readDay(body.startsAt);
  const endsAt = readDay(body.endsAt, true);
  const usageLimit = readWhole(body.usageLimit, 6);
  const perUserLimit = readWhole(body.perUserLimit, 4);

  if (!COUPON_CODE.test(code)) errors.code = "Use 3 to 20 capital letters and numbers, for example RUN10.";
  if (type !== "percent" && type !== "flat") errors.type = "Choose a percent or a flat discount.";
  else if (isPercent) {
    if (!Number.isInteger(value) || value < 1 || value > 90) errors.value = "Enter a whole percentage from 1 to 90.";
  } else if (!Number.isInteger(value) || value < 100) errors.value = "Enter a flat discount of at least Rs 1.";
  if (!Number.isInteger(maxDiscount) || maxDiscount < 0 || maxDiscount > MAX_PRICE) errors.maxDiscount = "Enter a cap of Rs 0 or more (0 means no cap).";
  else if (!isPercent && maxDiscount > 0) errors.maxDiscount = "A cap only applies to a percent coupon.";
  if (!Number.isInteger(minOrder) || minOrder < 0 || minOrder > MAX_PRICE) errors.minOrder = "Enter a minimum order of Rs 0 or more.";
  if (Number.isNaN(startsAt)) errors.startsAt = "Enter a start date, or leave it empty.";
  if (Number.isNaN(endsAt)) errors.endsAt = "Enter an expiry date, or leave it empty.";
  if (startsAt && endsAt && endsAt <= startsAt) errors.endsAt = "The expiry date must be after the start date.";
  if (!Number.isInteger(usageLimit) || usageLimit > 100000) errors.usageLimit = "Enter a total limit from 0 to 100,000 (0 means no limit).";
  if (!Number.isInteger(perUserLimit) || perUserLimit > 100) errors.perUserLimit = "Enter a per-customer limit from 0 to 100 (0 means no limit).";
  // A flat coupon bigger than the minimum order would pay the customer to shop.
  if (!errors.value && !errors.minOrder && !isPercent && minOrder > 0 && value > minOrder) {
    errors.value = "A flat discount cannot be more than the minimum order.";
  }

  return {
    errors,
    value: {
      code, description, type, value,
      maxDiscount: isPercent ? maxDiscount : 0,
      minOrder, startsAt: startsAt || null, endsAt: endsAt || null,
      usageLimit, perUserLimit, isActive: readFlag(body.isActive)
    }
  };
}

// ---------- Admin: inventory ----------

// One stock correction: add units, remove units, or set the exact count on the shelf.
function validateStockChange(body = {}) {
  const errors = {};
  const action = text(body.action);
  const raw = typeof body.units === "number" ? String(body.units) : text(body.units);
  const units = /^\d{1,6}$/.test(raw) ? Number(raw) : NaN;
  const note = text(body.note).slice(0, 120);
  if (!["add", "remove", "count"].includes(action)) errors.action = "Choose add, remove or set.";
  if (!Number.isInteger(units) || units > 100000) errors.units = "Enter a whole number of units up to 100,000.";
  else if (action !== "count" && units < 1) errors.units = "Enter at least 1 unit.";
  return { errors, value: { action, units, note } };
}

module.exports = {
  validateCoupon,
  validateStockChange,
  validateStatusChange,
  validateBulkStatus,
  validateAdminCancel,
  validateShipment,
  validateOrderNote,
  validateManualRefund,
  validateReturnDecision,
  validateRestock,
  validateAdminSearch,
  hasErrors,
  readFlag,
  validateReferralSetting,
  validateCodSetting,
  validatePlaceOrder,
  validateCancel,
  validateReturn,
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
  validateForgot,
  validateToken,
  validatePasswordReset,
  validateTwoFactorCode,
  validatePasswordAndCode,
  validateTwoFactorLogin,
  validateAddress,
  validateProduct,
  readProductOptions,
  validateCartItem,
  validateCartQuantity,
  validateEmailChange,
  validatePreferences,
  validateListName,
  validateTicket,
  validateTicketReply,
  validateDeleteAccount,
  checkPassword
};
