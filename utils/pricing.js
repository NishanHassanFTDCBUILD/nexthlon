// Every price rule in one place. All amounts are in paise. The cart, checkout, online payment
// and the tests all use these functions, so a total is worked out the same way everywhere.
//
// Products
//   basePrice     the price the admin sets (never above the M.R.P.)
//   offerPercent  the product offer
//   categoryOffer the offer on the product's category
// The higher of the two offers applies (they never add up), and the discount shown to shoppers
// is measured against the M.R.P.
//
// Orders
//   subtotal (items at their offer prices) − coupon + delivery fee = payable
//   payable − wallet = total, the amount still to pay (cash on delivery or online)
const { STORE } = require("../config/store");
const { formatPaise } = require("./money");

function bestOfferFor({ offerPercent = 0, categoryOffer = 0 } = {}) {
  const product = Number(offerPercent) || 0;
  const category = Number(categoryOffer) || 0;
  if (!product && !category) return { percent: 0, source: null };
  return product >= category ? { percent: product, source: "product" } : { percent: category, source: "category" };
}

// Half rounds up, written as floor(x + 0.5) so it matches PRICE_PIPELINE below.
const roundHalfUp = value => Math.floor(value + 0.5);

function priceFor({ basePrice, mrp, offerPercent = 0, categoryOffer = 0 }) {
  const offer = bestOfferFor({ offerPercent, categoryOffer });
  const price = roundHalfUp((basePrice * (100 - offer.percent)) / 100);
  const discountPercent = mrp > price ? roundHalfUp(((mrp - price) / mrp) * 100) : 0;
  return { price, bestOffer: offer.percent, offerSource: offer.source, discountPercent };
}

// Delivery is free from STORE.freeDeliveryMin (₹499) of items; below that a flat fee applies.
// It is measured on the items' subtotal, before any coupon.
function deliveryFeeFor(subtotal) {
  if (subtotal <= 0) return 0;
  return subtotal >= STORE.freeDeliveryMin ? 0 : STORE.deliveryFee;
}

// What a coupon takes off this subtotal. A percent coupon is rounded down to whole rupees, so
// totals stay clean. Never more than its cap, and never more than the subtotal.
function couponDiscountFor(coupon, subtotal) {
  if (!coupon || !(subtotal > 0)) return 0;
  let amount = coupon.type === "percent" ? Math.floor((subtotal * coupon.value) / 10000) * 100 : coupon.value;
  if (coupon.maxDiscount > 0) amount = Math.min(amount, coupon.maxDiscount);
  return Math.max(0, Math.min(amount, subtotal));
}

// Why this coupon cannot be used right now, or null if it can.
// usedByUser is how many of this customer's orders already used it.
function couponProblem(coupon, { subtotal = 0, usedByUser = 0, now = new Date() } = {}) {
  if (!coupon || !coupon.isActive) return "This coupon code is not valid.";
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return "This coupon is not active yet.";
  if (coupon.endsAt && now > new Date(coupon.endsAt)) return "This coupon has expired.";
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return "This coupon has been fully used.";
  if (coupon.perUserLimit > 0 && usedByUser >= coupon.perUserLimit) {
    return coupon.perUserLimit === 1 ? "You have already used this coupon." : `You can use this coupon ${coupon.perUserLimit} times, and you have.`;
  }
  if (subtotal < (coupon.minOrder || 0)) return `Add items worth ${formatPaise(coupon.minOrder - subtotal)} more to use this coupon.`;
  return null;
}

// The totals of an order, from the cart's subtotal and M.R.P. total.
// coupon: an already checked coupon (or null). walletBalance is only used when useWallet is true.
function orderTotals({ itemCount = 0, mrpTotal = 0, subtotal = 0, coupon = null, walletBalance = 0, useWallet = false }) {
  const couponDiscount = couponDiscountFor(coupon, subtotal);
  const deliveryFee = deliveryFeeFor(subtotal);
  const payable = subtotal - couponDiscount + deliveryFee;
  const walletUsed = useWallet ? Math.max(0, Math.min(walletBalance, payable)) : 0;
  return {
    itemCount,
    mrpTotal,
    subtotal,
    discount: Math.max(0, mrpTotal - subtotal),
    couponCode: couponDiscount > 0 ? coupon.code : "",
    couponDiscount,
    deliveryFee,
    payable,
    walletUsed,
    total: payable - walletUsed
  };
}

// The same sums as priceFor, written as a database update pipeline, for changing many products at
// once (a category offer changed, or old products being upgraded).
const halfUp = expr => ({ $floor: { $add: [expr, 0.5] } });
const PRICE_PIPELINE = Object.freeze([
  { $set: { bestOffer: { $max: [{ $ifNull: ["$offerPercent", 0] }, { $ifNull: ["$categoryOffer", 0] }] } } },
  { $set: { price: halfUp({ $divide: [{ $multiply: ["$basePrice", { $subtract: [100, "$bestOffer"] }] }, 100] }) } },
  {
    $set: {
      discountPercent: {
        $cond: [{ $gt: ["$mrp", "$price"] }, halfUp({ $multiply: [{ $divide: [{ $subtract: ["$mrp", "$price"] }, "$mrp"] }, 100] }), 0]
      }
    }
  }
]);

module.exports = { PRICE_PIPELINE, halfUp, bestOfferFor, priceFor, roundHalfUp, deliveryFeeFor, couponDiscountFor, couponProblem, orderTotals };
