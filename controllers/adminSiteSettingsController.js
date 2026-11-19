// The admin API for store-wide settings (services/siteSettingsService.js): business details,
// delivery and returns, catalogue limits, and what shoppers see. Each save is audit-logged.
const siteSettingsService = require('../services/siteSettingsService');
const auditService = require('../services/auditService');
const {asyncHandler} = require('../utils/http');

const MESSAGES = {
  business:
    'Business details saved. Policy pages, invoices and emails use them now.',
  delivery:
    'Delivery and returns saved. Checkout and the policy pages use them now.',
  catalog: 'Catalogue limits saved.',
  shopper: 'Shopper features saved. The store shows the change now.',
  home: 'Home page sections saved. The home page shows the change within a minute.',
};

// GET /api/admin/settings/site
const getSite = asyncHandler(async (req, res) => {
  res.json(siteSettingsService.forAdmin());
});

// PATCH /api/admin/settings/site/:group   body: the group's fields
const updateSite = asyncHandler(async (req, res) => {
  const {group} = req.params;
  const {before, after, settings} = await siteSettingsService.update(
    group,
    req.body || {},
  );
  const changed = Object.keys(after).filter(
    (key) => String(before[key]) !== String(after[key]),
  );
  if (changed.length) {
    await auditService.record({
      ...auditService.fromRequest(req),
      action: 'settings.updated',
      target: `setting:site.${group}`,
      before: Object.fromEntries(changed.map((key) => [key, before[key]])),
      after: Object.fromEntries(changed.map((key) => [key, after[key]])),
    });
    // Home page sections and the announcement live in the cached home page.
    if (group === 'home' || group === 'shopper')
      require('../utils/memo').forget('catalog:');
  }
  res.json({
    message: changed.length ? MESSAGES[group] : 'Nothing changed.',
    settings,
    changed,
  });
});

module.exports = {getSite, updateSite};
