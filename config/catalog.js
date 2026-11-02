// Fixed lists shared by the models, validation and the pages.

const CATEGORIES = [
  "Running", "Football", "Fitness", "Cricket", "Cycling",
  "Outdoor", "Swimming", "Tennis", "Hiking", "Camping"
];

const LOW_STOCK_LIMIT = 5;
const MAX_ADDRESSES = 10;

const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka",
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

module.exports = { CATEGORIES, LOW_STOCK_LIMIT, MAX_ADDRESSES, INDIAN_STATES };
