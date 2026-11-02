const { INDIAN_STATES } = require("../config/catalog");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^[6-9]\d{9}$/;
const PINCODE = /^[1-9]\d{5}$/;
const NAME = /^\p{L}[\p{L} .'-]*$/u;

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

module.exports = {
  hasErrors,
  validateSignup,
  validateLogin,
  validateProfile,
  validatePasswordChange,
  validateAddress
};
