// Builds links like "/products?category=Running&page=2", keeping the current filters
// and leaving out empty values.
function linkBuilder(basePath, current) {
  return function link(overrides = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...overrides })) {
      if (value !== undefined && value !== null && value !== "" && value !== false) {
        params.set(key, String(value));
      }
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
}

module.exports = { linkBuilder };
