// Money is stored as whole paise (₹1 = 100 paise), so sums never pick up floating-point errors.
// Forms and URLs use rupees; these helpers convert at the edges.

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

// "2999" or "2999.50" (rupees, as typed) -> 299900 or 299950 paise. Anything else -> null.
function rupeesToPaise(value) {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!MONEY.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function paiseToRupees(paise) {
  return Math.round(Number(paise) || 0) / 100;
}

const whole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 12345600 -> "₹1,23,456". Paise are shown only when there are some: 12345650 -> "₹1,23,456.50".
function formatPaise(paise) {
  const value = Math.round(Number(paise) || 0);
  return value % 100 === 0 ? whole.format(value / 100) : exact.format(value / 100);
}

// A share of an amount, rounded to whole paise (half rounds up).
function percentOf(paise, percent) {
  return Math.floor((paise * percent) / 100 + 0.5);
}

module.exports = { rupeesToPaise, paiseToRupees, formatPaise, percentOf };
