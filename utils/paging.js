// Rows per page for the admin tables: the admin picks 20, 50 or 100 (?limit=), anything else
// falls back to the table's own size. Kept small and fixed so a link can never ask for everything.
const PAGE_SIZES = Object.freeze([20, 50, 100]);

function pageSize(query, fallback = 20) {
  const wanted = Number.parseInt(query && query.limit, 10);
  return PAGE_SIZES.includes(wanted) ? wanted : fallback;
}

module.exports = {PAGE_SIZES, pageSize};
