// A small in-memory cache for data that is the same for every visitor (the home page sections, related
// products). It keeps each value for a short time, and while a value is being loaded every other request
// for it waits for that one load instead of starting its own (no stampede on the database when a value
// runs out under load). Clearing a group (memo.forget("catalog:")) also stops any load of that group
// already running from putting an old value back; other groups are left alone.
// Never cache anything that belongs to one shopper (a cart, an account, an order), and treat cached
// values as read-only: every request gets the same object.
const MAX_ENTRIES = 500;
const entries = new Map(); // key -> { value, expires } or { pending }
const cancelled = new WeakSet(); // loads whose group was cleared while they ran

async function remember(key, ttlMs, load) {
  const hit = entries.get(key);
  if (hit && "value" in hit && hit.expires > Date.now()) return hit.value;
  if (hit && hit.pending) return hit.pending;
  // The load starts now; an error it throws straight away becomes a rejected promise like any other.
  const pending = new Promise(resolve => resolve(load()))
    .then(value => {
      // Cleared while loading: hand this value to the waiting requests, but do not keep it.
      if (!cancelled.has(pending)) {
        entries.set(key, { value, expires: Date.now() + ttlMs });
        trim();
      }
      return value;
    }, error => {
      if (entries.get(key) && entries.get(key).pending === pending) entries.delete(key);
      throw error;
    });
  entries.set(key, { pending });
  return pending;
}

// Drops every key that starts with prefix ("" drops everything).
function forget(prefix = "") {
  for (const [key, entry] of [...entries]) {
    if (!key.startsWith(prefix)) continue;
    if (entry.pending) cancelled.add(entry.pending);
    entries.delete(key);
  }
}

// Oldest first: a Map keeps insertion order.
function trim() {
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

const size = () => entries.size;

module.exports = { remember, forget, size };
