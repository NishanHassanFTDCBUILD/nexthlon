// Query filters the store uses again and again, so "what a shopper may see" is written once.
// Spread them into a query: Product.find({ ...LISTED_PRODUCT, category }).

// Only listed products in listed categories are ever shown to shoppers.
const LISTED_PRODUCT = Object.freeze({isListed: true, categoryListed: true});

// Unlisted categories (and every product in them) are hidden from shoppers.
const LISTED_CATEGORY = Object.freeze({isListed: true});

// Reviews an admin has not hidden.
const VISIBLE_REVIEW = Object.freeze({isHidden: {$ne: true}});

module.exports = {LISTED_PRODUCT, LISTED_CATEGORY, VISIBLE_REVIEW};
