const contactService = require('../services/contactService');
const {
  validateContact,
  validateNewsletter,
  hasErrors,
} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');

function checked(validate, body) {
  const {errors, value} = validate(body);
  if (hasErrors(errors))
    throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

// POST /api/contact   body: { name, email, phone?, topic, message }
const sendMessage = asyncHandler(async (req, res) => {
  const value = checked(validateContact, req.body);
  await contactService.saveContactMessage(value, req.user);
  res.status(201).json({
    message:
      'Thanks! Your message has reached our support team. We reply within one working day.',
  });
});

// POST /api/newsletter   body: { email }
const subscribe = asyncHandler(async (req, res) => {
  const {email} = checked(validateNewsletter, req.body);
  await contactService.subscribe(email);
  res.status(201).json({
    message: "You're on the list. Watch your inbox for our next deals.",
  });
});

module.exports = {sendMessage, subscribe};
