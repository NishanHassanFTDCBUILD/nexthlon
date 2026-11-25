const User = require('../models/User');
const {HttpError} = require('../utils/http');
const {SPORTS, CLOTHING, SYSTEMS} = require('../config/fitProfile');

function validate(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, 'Invalid profile preferences.');
  const sports = body.sports === undefined ? [] : body.sports;
  const clothing = body.clothing ?? '';
  const shoeSystem = body.shoeSystem ?? 'UK';
  const shoeSize = body.shoeSize ?? '';
  if (
    !Array.isArray(sports) ||
    sports.length > SPORTS.length ||
    sports.some((sport) => !SPORTS.includes(sport))
  )
    throw new HttpError(400, 'Choose sports from the available options.');
  if (!CLOTHING.includes(clothing) || !SYSTEMS.includes(shoeSystem))
    throw new HttpError(400, 'Choose a valid size and size system.');
  if (
    typeof shoeSize !== 'string' ||
    (shoeSize !== '' &&
      (!/^\d{1,2}(\.5)?$/.test(shoeSize) ||
        Number(shoeSize) < 1 ||
        Number(shoeSize) > 55))
  )
    throw new HttpError(
      400,
      'Enter a footwear size from 1 to 55, using whole or half sizes.',
    );
  return {sports: [...new Set(sports)], clothing, shoeSystem, shoeSize};
}

async function update(userId, body) {
  const fit = validate(body);
  const user = await User.findOneAndUpdate(
    {_id: userId, role: 'customer', isDeleted: {$ne: true}},
    {$set: {fitProfile: fit}},
    {new: true, runValidators: true},
  );
  if (!user) throw new HttpError(404, 'Account not found.');
  return fit;
}
module.exports = {validate, update};
