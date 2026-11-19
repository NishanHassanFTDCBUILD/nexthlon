// GET /compare?items=slug-a,slug-b  (public, read only)
const compareService = require('../services/compareService');
const {asyncHandler} = require('../utils/http');

const compare = asyncHandler(async (req, res) => {
  const slugs = compareService.parseSlugs(req.query.items);
  const products = await compareService.forSlugs(slugs);
  // The spec names every product has, so the table can show one row per spec.
  const specKeys = [...new Set(products.flatMap((p) => Object.keys(p.specs)))];
  res.render('pages/compare', {
    title: 'Compare products | Nexthlon',
    products,
    specKeys,
    maxItems: compareService.MAX_ITEMS,
  });
});

module.exports = {compare};
