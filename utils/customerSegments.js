// Customer segments: labels worked out from what we know about a customer. Pure, so the rules are
// tested directly. A customer can be in several segments.
//
//   New            joined less than 30 days ago
//   No orders yet  has never ordered
//   Loyal          three or more delivered orders
//   High value     paid ₹10,000 or more in total
//   At risk        ordered before, but not in the last 180 days
//   Returns often  two or more parcels came back
//   Blocked        the account is blocked from signing in

const HIGH_VALUE_PAISE = 1000000;

function segmentsOf({
  joinedDays = 0,
  orderCount = 0,
  deliveredCount = 0,
  paidTotal = 0,
  lastOrderDays = null,
  returnedCount = 0,
  blocked = false,
} = {}) {
  const labels = [];
  if (joinedDays < 30) labels.push('New');
  if (orderCount === 0) labels.push('No orders yet');
  if (deliveredCount >= 3) labels.push('Loyal');
  if (paidTotal >= HIGH_VALUE_PAISE) labels.push('High value');
  if (orderCount > 0 && lastOrderDays !== null && lastOrderDays > 180)
    labels.push('At risk');
  if (returnedCount >= 2) labels.push('Returns often');
  if (blocked) labels.push('Blocked');
  return labels;
}

module.exports = {segmentsOf, HIGH_VALUE_PAISE};
