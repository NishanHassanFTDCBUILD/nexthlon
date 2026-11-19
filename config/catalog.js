// Fixed lists shared by the models, validation and the pages.

const CATEGORIES = [
  'Running',
  'Football',
  'Fitness',
  'Cricket',
  'Cycling',
  'Outdoor',
  'Swimming',
  'Tennis',
  'Hiking',
  'Camping',
];

const LOW_STOCK_LIMIT = 5;
// Limits an admin can change in Settings (services/siteSettingsService.js copies the saved values
// in here). Code reads RULES.x when it needs the value, so a change applies at once.
const RULES = {
  // Stock at or below this shows as "low stock" in the admin.
  lowStockLimit: LOW_STOCK_LIMIT,
  // The most of one product (or one size) a shopper can put in the cart.
  maxPerProduct: 5,
};
const MAX_ADDRESSES = 5;

const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
];

module.exports = {
  CATEGORIES,
  LOW_STOCK_LIMIT,
  RULES,
  MAX_ADDRESSES,
  INDIAN_STATES,
};
