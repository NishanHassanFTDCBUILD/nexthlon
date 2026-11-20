// Cash-on-delivery risk: how likely a cash order is to come back undelivered (refused, not
// answered, or cancelled after dispatch). Pure: it only looks at what it is given, so the
// rules can be tested directly. Online payments are already paid, so they are not scored.
//
// Points, with the reason shown to the admin next to the order:
//   20  total of ₹2,000 or more (a large parcel refused at the door is a large loss)
//   25  the customer has no delivered order yet
//   40  an earlier parcel for this customer came back to us
//   20  two or more cancelled orders
//   15  the account is less than two days old
// level: 50 and above is high, 25 to 49 is medium, below 25 is low.

const HIGH_VALUE_PAISE = 200000;

function codRisk({
  paymentMethod,
  total = 0,
  deliveredOrders = 0,
  cancelledOrders = 0,
  returnedOrders = 0,
  accountAgeDays = 365,
} = {}) {
  if (paymentMethod !== 'cod')
    return {applies: false, score: 0, level: 'none', reasons: []};
  const reasons = [];
  let score = 0;
  const add = (points, reason) => {
    score += points;
    reasons.push(reason);
  };
  if (total >= HIGH_VALUE_PAISE) add(20, 'High value: ₹2,000 or more');
  if (deliveredOrders === 0)
    add(25, 'First delivered order from this customer');
  if (returnedOrders > 0)
    add(40, 'An earlier parcel for this customer came back');
  if (cancelledOrders >= 2) add(20, 'Has cancelled two or more orders');
  if (accountAgeDays < 2) add(15, 'Account is less than two days old');
  const level = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';
  return {applies: true, score, level, reasons};
}

module.exports = {codRisk, HIGH_VALUE_PAISE};
