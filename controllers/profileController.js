const profileService = require("../services/profileService");
const { signToken, setAuthCookie } = require("../services/tokenService");
const { validateProfile, validatePasswordChange, validateAddress, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");

function checked(validate, body) {
  const { errors, value } = validate(body);
  if (hasErrors(errors)) throw new HttpError(400, "Please fix the highlighted fields.", errors);
  return value;
}

// GET /api/profile
function getProfile(req, res) {
  res.json({ user: req.user.toSafeJSON() });
}

// PATCH /api/profile
const updateProfile = asyncHandler(async (req, res) => {
  const user = await profileService.updateProfile(req.user._id, checked(validateProfile, req.body));
  res.json({ message: "Your profile has been updated.", user: user.toSafeJSON() });
});

// PATCH /api/profile/password
// Older tokens stop working after this, so this device gets a fresh token.
const changePassword = asyncHandler(async (req, res) => {
  const user = await profileService.changePassword(req.user._id, checked(validatePasswordChange, req.body));
  setAuthCookie(res, signToken(user));
  res.json({ message: "Password changed. Your other devices have been signed out." });
});

// GET /api/addresses
const listAddresses = asyncHandler(async (req, res) => {
  res.json({ addresses: await profileService.listAddresses(req.user._id) });
});

// POST /api/addresses
const addAddress = asyncHandler(async (req, res) => {
  const address = await profileService.addAddress(req.user._id, checked(validateAddress, req.body));
  res.status(201).json({ message: "Address saved.", address });
});

// PATCH /api/addresses/:addressId
const updateAddress = asyncHandler(async (req, res) => {
  const address = await profileService.updateAddress(
    req.user._id, req.params.addressId, checked(validateAddress, req.body)
  );
  res.json({ message: "Address updated.", address });
});

// PATCH /api/addresses/:addressId/default
const setDefaultAddress = asyncHandler(async (req, res) => {
  const address = await profileService.setDefaultAddress(req.user._id, req.params.addressId);
  res.json({ message: "Default address updated.", address });
});

// DELETE /api/addresses/:addressId
const deleteAddress = asyncHandler(async (req, res) => {
  await profileService.deleteAddress(req.user._id, req.params.addressId);
  res.json({ message: "Address deleted." });
});

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  listAddresses,
  addAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress
};
