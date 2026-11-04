// Builds links like "/products?category=running&brand=Strike&brand=Volt&page=2", keeping the
// current filters and leaving out empty values. A list becomes one parameter per value.
function linkBuilder(basePath, current) {
  return function link(overrides = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...current, ...overrides })) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item !== undefined && item !== null && item !== "" && item !== false) params.append(key, String(item));
      }
    }
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
}

module.exports = { linkBuilder };
