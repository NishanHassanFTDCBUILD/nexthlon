// Fills the city and state for a PIN code, so a shopper types six digits instead of two fields.
// India Post's public PIN code directory gives the district (city) and state. If it is slow or down,
// the state still comes from the PIN code itself: its first digits are the postal circle.
// The answer is only a suggestion: the shopper can change both fields, and addresses are validated as usual.
const { INDIAN_STATES } = require("../config/catalog");
const logger = require("../utils/logger");

const PINCODE = /^[1-9]\d{5}$/;
const LOOKUP_URL = "https://api.postalpincode.in/pincode/";
const TIMEOUT_MS = 2500;
const CACHE_LIMIT = 5000;
const cache = new Map();

// Postal circles by the first digits of the PIN code (longest prefix wins).
const PREFIX_STATES = [
  ["11", "Delhi"], ["12", "Haryana"], ["13", "Haryana"], ["140", "Punjab"], ["14", "Punjab"], ["15", "Punjab"],
  ["160", "Chandigarh"], ["16", "Punjab"], ["17", "Himachal Pradesh"], ["194", "Ladakh"], ["18", "Jammu and Kashmir"], ["19", "Jammu and Kashmir"],
  ["246", "Uttarakhand"], ["247", "Uttarakhand"], ["248", "Uttarakhand"], ["249", "Uttarakhand"], ["262", "Uttarakhand"], ["263", "Uttarakhand"],
  ["20", "Uttar Pradesh"], ["21", "Uttar Pradesh"], ["22", "Uttar Pradesh"], ["23", "Uttar Pradesh"], ["24", "Uttar Pradesh"],
  ["25", "Uttar Pradesh"], ["26", "Uttar Pradesh"], ["27", "Uttar Pradesh"], ["28", "Uttar Pradesh"],
  ["30", "Rajasthan"], ["31", "Rajasthan"], ["32", "Rajasthan"], ["33", "Rajasthan"], ["34", "Rajasthan"],
  ["396", "Dadra and Nagar Haveli and Daman and Diu"], ["36", "Gujarat"], ["37", "Gujarat"], ["38", "Gujarat"], ["39", "Gujarat"],
  ["403", "Goa"], ["40", "Maharashtra"], ["41", "Maharashtra"], ["42", "Maharashtra"], ["43", "Maharashtra"], ["44", "Maharashtra"],
  ["45", "Madhya Pradesh"], ["46", "Madhya Pradesh"], ["47", "Madhya Pradesh"], ["48", "Madhya Pradesh"], ["49", "Chhattisgarh"],
  ["50", "Telangana"], ["51", "Andhra Pradesh"], ["52", "Andhra Pradesh"], ["53", "Andhra Pradesh"],
  ["56", "Karnataka"], ["57", "Karnataka"], ["58", "Karnataka"], ["59", "Karnataka"],
  ["605", "Puducherry"], ["60", "Tamil Nadu"], ["61", "Tamil Nadu"], ["62", "Tamil Nadu"], ["63", "Tamil Nadu"], ["64", "Tamil Nadu"],
  ["682", "Kerala"], ["67", "Kerala"], ["68", "Kerala"], ["69", "Kerala"],
  ["737", "Sikkim"], ["744", "Andaman and Nicobar Islands"], ["70", "West Bengal"], ["71", "West Bengal"], ["72", "West Bengal"], ["73", "West Bengal"], ["74", "West Bengal"],
  ["75", "Odisha"], ["76", "Odisha"], ["77", "Odisha"], ["78", "Assam"],
  ["790", "Arunachal Pradesh"], ["791", "Arunachal Pradesh"], ["792", "Arunachal Pradesh"], ["793", "Meghalaya"], ["794", "Meghalaya"],
  ["795", "Manipur"], ["796", "Mizoram"], ["797", "Nagaland"], ["798", "Nagaland"], ["799", "Tripura"],
  ["814", "Jharkhand"], ["815", "Jharkhand"], ["816", "Jharkhand"], ["82", "Jharkhand"], ["83", "Jharkhand"],
  ["80", "Bihar"], ["81", "Bihar"], ["84", "Bihar"], ["85", "Bihar"]
].sort((a, b) => b[0].length - a[0].length);

function stateFromPrefix(pin) {
  const hit = PREFIX_STATES.find(([prefix]) => pin.startsWith(prefix));
  return hit ? hit[1] : "";
}

// India Post spells a few states differently from our list.
const STATE_ALIASES = { "andaman & nicobar islands": "Andaman and Nicobar Islands", "jammu & kashmir": "Jammu and Kashmir",
  "nct of delhi": "Delhi", "pondicherry": "Puducherry", "orissa": "Odisha", "dadra & nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman & diu": "Dadra and Nagar Haveli and Daman and Diu", "the dadra and nagar haveli and daman and diu": "Dadra and Nagar Haveli and Daman and Diu" };
function knownState(name) {
  const clean = String(name || "").trim().toLowerCase();
  return STATE_ALIASES[clean] || INDIAN_STATES.find(state => state.toLowerCase() === clean) || "";
}

// Title case for district names that come back in capitals ("BANGALORE" → "Bangalore").
function tidy(name) {
  const text = String(name || "").trim();
  return text === text.toUpperCase() ? text.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase()) : text;
}

async function fromIndiaPost(pin, fetchImpl) {
  const response = await fetchImpl(LOOKUP_URL + pin, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const [body] = await response.json();
  const office = body && body.Status === "Success" && Array.isArray(body.PostOffice) ? body.PostOffice[0] : null;
  if (!office) return null;
  return { city: tidy(office.District || office.Block || ""), state: knownState(office.State) };
}

// { pincode, city, state, source } or null for a malformed PIN code.
// source is "post" (India Post answered) or "prefix" (state only, from the PIN code).
async function lookupPincode(pincode, { fetchImpl = globalThis.fetch, remote = process.env.NODE_ENV !== "test" } = {}) {
  const pin = String(pincode || "").trim();
  if (!PINCODE.test(pin)) return null;
  if (cache.has(pin)) return cache.get(pin);
  let result = null;
  if (remote && fetchImpl) {
    try {
      const found = await fromIndiaPost(pin, fetchImpl);
      if (found && (found.city || found.state)) result = { pincode: pin, city: found.city, state: found.state || stateFromPrefix(pin), source: "post" };
    } catch (error) {
      logger.warn("pincode.lookup_failed", { pincode: pin, error: error.name === "TimeoutError" ? "timeout" : error.message });
    }
  }
  if (!result) result = { pincode: pin, city: "", state: stateFromPrefix(pin), source: "prefix" };
  // Only answers from India Post are kept; a prefix guess is cheap to repeat and the next try may get the city.
  if (result.source === "post") {
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
    cache.set(pin, result);
  }
  return result;
}

module.exports = { lookupPincode, stateFromPrefix, knownState };
