// Sales by category and by state: the JSON and CSV for the reports, and the page. Read-only.
const salesBreakdownService = require('../services/salesBreakdownService');
const config = require('../config/env');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler} = require('../utils/http');

// GET /api/admin/reports/breakdown?from=YYYY-MM-DD&to=YYYY-MM-DD
const breakdownApi = asyncHandler(async (req, res) => {
  res.json(await salesBreakdownService.breakdown(req.query));
});

// GET /api/admin/reports/breakdown.csv?from=&to=
const breakdownCsv = asyncHandler(async (req, res) => {
  const data = await salesBreakdownService.breakdown(req.query);
  res
    .set('Cache-Control', 'no-store')
    .attachment(`nexthlon-sales-${data.from}-to-${data.to}.csv`)
    .type('text/csv')
    .send(salesBreakdownService.toCsv(data));
});

// GET <ADMIN_PATH>/sales-breakdown
const breakdownPage = asyncHandler(async (req, res) => {
  const data = await salesBreakdownService.breakdown(req.query);
  res.render('admin/sales-breakdown', {
    title: 'Sales breakdown | Nexthlon Admin',
    ...data,
    link: linkBuilder(`${config.adminPath}/sales-breakdown`, {
      from: data.from,
      to: data.to,
    }),
    maxState: Math.max(1, ...data.states.map((s) => s.revenue)),
    maxCategory: Math.max(1, ...data.categories.map((c) => c.revenue)),
  });
});

module.exports = {breakdownApi, breakdownCsv, breakdownPage};
