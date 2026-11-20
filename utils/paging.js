// Rows per page for the admin tables: the admin picks 20, 50 or 100 (?limit=), anything else
// falls back to the table's own size. Kept small and fixed so a link can never ask for everything.
const PAGE_SIZES = Object.freeze([20, 50, 100]);
const MAX_PAGE = 100000;

function pageSize(query, fallback = 20) {
  const wanted = Number.parseInt(query && query.limit, 10);
  return PAGE_SIZES.includes(wanted) ? wanted : fallback;
}

// The page asked for (?page=, from 1). Junk and out-of-range values fall back to page 1.
function pageNumber(query) {
  const wanted = Number.parseInt(query && query.page, 10);
  return Number.isInteger(wanted) && wanted >= 1 && wanted <= MAX_PAGE
    ? wanted
    : 1;
}

// What the table footer needs (views/partials/admin-pager.ejs). A page past the end shows the last one.
function pagination(total, query, fallback = 20) {
  const limit = pageSize(query, fallback);
  const pages = Math.max(1, Math.ceil(total / limit));
  return {page: Math.min(pageNumber(query), pages), pages, total, limit};
}

// One page of a short list that is already in memory (capped by its service, such as the staff list).
function pageOf(rows, query, fallback = 20) {
  const pager = pagination(rows.length, query, fallback);
  const start = (pager.page - 1) * pager.limit;
  return {rows: rows.slice(start, start + pager.limit), pagination: pager};
}

module.exports = {PAGE_SIZES, pageSize, pageNumber, pagination, pageOf};
