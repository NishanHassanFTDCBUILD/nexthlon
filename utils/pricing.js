// How a product's selling price is worked out. All amounts are in paise.
//   basePrice     the price the admin sets (never above the M.R.P.)
//   offerPercent  the product offer
//   categoryOffer the offer on the product's category
// The higher of the two offers applies (they never add up), and the discount shown to shoppers
// is measured against the M.R.P.

function bestOfferFor({ offerPercent = 0, categoryOffer = 0 } = {}) {
  const product = Number(offerPercent) || 0;
  const category = Number(categoryOffer) || 0;
  if (!product && !category) return { percent: 0, source: null };
  return product >= category ? { percent: product, source: "product" } : { percent: category, source: "category" };
}

// Half rounds up, written as floor(x + 0.5) so it matches the database pipeline in models/Product.js.
const roundHalfUp = value => Math.floor(value + 0.5);

function priceFor({ basePrice, mrp, offerPercent = 0, categoryOffer = 0 }) {
  const offer = bestOfferFor({ offerPercent, categoryOffer });
  const price = roundHalfUp((basePrice * (100 - offer.percent)) / 100);
  const discountPercent = mrp > price ? roundHalfUp(((mrp - price) / mrp) * 100) : 0;
  return { price, bestOffer: offer.percent, offerSource: offer.source, discountPercent };
}

module.exports = { bestOfferFor, priceFor, roundHalfUp };
