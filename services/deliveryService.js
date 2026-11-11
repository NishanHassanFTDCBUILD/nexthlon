// Delivery date estimates by PIN code. There is no courier API yet, so this uses simple, honest
// rules: big metro areas are fastest, the north-east, Jammu & Kashmir, Ladakh and the islands
// are slowest, and everywhere else is in between. Orders after the cut-off ship the next day,
// and nothing is delivered on a Sunday.

const PINCODE = /^[1-9]\d{5}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOFF_HOUR_IST = 14;

const ZONES = {
  metro: { label: "Metro city", minDays: 2, maxDays: 3 },
  standard: { label: "Standard", minDays: 4, maxDays: 6 },
  remote: { label: "Remote area", minDays: 6, maxDays: 9 }
};
// First two or three digits of the PIN code.
const METRO_PREFIXES = ["11", "40", "41", "56", "60", "70", "50", "38"];
const REMOTE_PREFIXES = ["18", "19", "78", "79", "744", "6825"];

function zoneFor(pincode) {
  if (REMOTE_PREFIXES.some(prefix => pincode.startsWith(prefix))) return "remote";
  if (METRO_PREFIXES.some(prefix => pincode.startsWith(prefix))) return "metro";
  return "standard";
}

// Adds working days (Monday to Saturday) to a date given as days since 1970 in IST.
function addDeliveryDays(dayNumber, days) {
  let day = dayNumber;
  let left = days;
  while (left > 0) {
    day += 1;
    // 1 January 1970 was a Thursday, so (day + 4) % 7 === 0 is a Sunday.
    if ((day + 4) % 7 !== 0) left -= 1;
  }
  return day;
}

const dateLabel = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// PIN codes starting with 9 belong to the Army Postal Service (APO/FPO). Couriers do not deliver there.
function isServiceable(pincode) {
  return !String(pincode).startsWith("9");
}

function estimateDelivery(pincode, now = new Date()) {
  const pin = String(pincode || "").trim();
  if (!PINCODE.test(pin)) return null;
  if (!isServiceable(pin)) {
    return { pincode: pin, deliverable: false, reason: "We can't deliver to Army Post Office (APO/FPO) PIN codes yet." };
  }
  const zone = zoneFor(pin);
  const ist = now.getTime() + IST_OFFSET_MS;
  let today = Math.floor(ist / DAY_MS);
  const hour = Math.floor((ist % DAY_MS) / (60 * 60 * 1000));
  // Today's cut-off moment, so the page can count down to it.
  const cutoffAt = hour >= CUTOFF_HOUR_IST ? null
    : new Date(today * DAY_MS + CUTOFF_HOUR_IST * 60 * 60 * 1000 - IST_OFFSET_MS).toISOString();
  // Orders after the cut-off are packed tomorrow.
  if (hour >= CUTOFF_HOUR_IST) today += 1;
  const fromDay = addDeliveryDays(today, ZONES[zone].minDays);
  const toDay = addDeliveryDays(today, ZONES[zone].maxDays);
  const from = new Date(fromDay * DAY_MS);
  const to = new Date(toDay * DAY_MS);
  return {
    pincode: pin,
    deliverable: true,
    cutoffAt,
    zone,
    zoneLabel: ZONES[zone].label,
    minDays: ZONES[zone].minDays,
    maxDays: ZONES[zone].maxDays,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    label: `${dateLabel.format(from)} – ${dateLabel.format(to)}`,
    orderBy: hour >= CUTOFF_HOUR_IST ? null : `${CUTOFF_HOUR_IST - 12} pm today`
  };
}

module.exports = { PINCODE, ZONES, zoneFor, isServiceable, estimateDelivery, addDeliveryDays };
