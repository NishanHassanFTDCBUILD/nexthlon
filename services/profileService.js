const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const User = require("../models/User");
const Address = require("../models/Address");
const { hashPassword } = require("./authService");
const { MAX_ADDRESSES } = require("../config/catalog");
const { HttpError } = require("../utils/http");

async function updateProfile(userId, { name, phone }) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { name, phone } },
    { new: true, runValidators: true }
  );
  if (!user) throw new HttpError(404, "Account not found.");
  return user;
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new HttpError(404, "Account not found.");
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new HttpError(400, "Your current password is incorrect.", {
      currentPassword: "Your current password is incorrect."
    });
  }
  user.passwordHash = await hashPassword(newPassword);
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();
  return user;
}

function listAddresses(userId) {
  return Address.find({ user: userId }).sort({ isDefault: -1, updatedAt: -1 }).lean();
}

// Every lookup includes the owner's id, so nobody can read or change another customer's address.
async function findOwnedAddress(userId, addressId) {
  if (!mongoose.isValidObjectId(addressId)) throw new HttpError(404, "Address not found.");
  const address = await Address.findOne({ _id: addressId, user: userId });
  if (!address) throw new HttpError(404, "Address not found.");
  return address;
}

async function clearDefault(userId) {
  await Address.updateMany({ user: userId, isDefault: true }, { $set: { isDefault: false } });
}

async function addAddress(userId, data) {
  const count = await Address.countDocuments({ user: userId });
  if (count >= MAX_ADDRESSES) {
    throw new HttpError(400, `You can save up to ${MAX_ADDRESSES} addresses. Delete one to add another.`);
  }
  // The first address is always the default.
  const isDefault = data.isDefault || count === 0;
  if (isDefault) await clearDefault(userId);
  return Address.create({ ...data, isDefault, user: userId });
}

async function updateAddress(userId, addressId, data) {
  const address = await findOwnedAddress(userId, addressId);
  const { isDefault, ...fields } = data;
  Object.assign(address, fields);
  if (isDefault && !address.isDefault) {
    await clearDefault(userId);
    address.isDefault = true;
  }
  return address.save();
}

async function setDefaultAddress(userId, addressId) {
  const address = await findOwnedAddress(userId, addressId);
  await clearDefault(userId);
  address.isDefault = true;
  return address.save();
}

async function deleteAddress(userId, addressId) {
  const address = await findOwnedAddress(userId, addressId);
  await address.deleteOne();
  // If the default was deleted, make the most recently used address the new default.
  if (address.isDefault) {
    const next = await Address.findOne({ user: userId }).sort({ updatedAt: -1 });
    if (next) {
      next.isDefault = true;
      await next.save();
    }
  }
}

module.exports = {
  updateProfile,
  changePassword,
  listAddresses,
  addAddress,
  updateAddress,
  setDefaultAddress,
  deleteAddress
};
