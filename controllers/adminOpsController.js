// Operations for the team: the webhook log and the GST report. Each has its page and its API.
// Changes (re-running a payment event) are audit-logged.
const webhookLogService = require('../services/webhookLogService');
const gstReportService = require('../services/gstReportService');
const paymentService = require('../services/paymentService');
const auditService = require('../services/auditService');
const config = require('../config/env');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler} = require('../utils/http');

// ---------- Webhooks ----------
const listWebhooks = asyncHandler(async (req, res) => {
  res.json(await webhookLogService.list(req.query));
});

// POST /api/admin/webhooks/:webhookId/rerun
const rerunWebhook = asyncHandler(async (req, res) => {
  const result = await webhookLogService.rerun(
    req.params.webhookId,
    (raw, signature) => paymentService.handleWebhook(raw, signature),
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'webhook.rerun',
    target: `webhook:${req.params.webhookId}`,
    after: result,
  });
  res.json({message: `${result.event || 'Event'} run again.`, ...result});
});

const webhooksPage = asyncHandler(async (req, res) => {
  const data = await webhookLogService.list(req.query);
  const current = {};
  if (data.filters.provider) current.provider = data.filters.provider;
  if (data.filters.outcome) current.outcome = data.filters.outcome;
  res.render('admin/webhooks', {
    title: 'Webhooks | Nexthlon Admin',
    ...data,
    link: linkBuilder(`${config.adminPath}/webhooks`, current),
  });
});

// ---------- GST ----------
// GET /api/admin/reports/gst.csv?month=YYYY-MM
const gstCsv = asyncHandler(async (req, res) => {
  const result = await gstReportService.report(req.query.month);
  res
    .set('Cache-Control', 'no-store')
    .attachment(`nexthlon-gst-${result.month}.csv`)
    .type('text/csv')
    .send(result.csv);
});

const gstPage = asyncHandler(async (req, res) => {
  const month = req.query.month || gstReportService.currentMonth();
  const result = await gstReportService.report(month);
  res.render('admin/gst', {
    title: 'GST report | Nexthlon Admin',
    ...result,
    columns: gstReportService.COLUMNS,
  });
});

module.exports = {
  listWebhooks,
  rerunWebhook,
  webhooksPage,
  gstCsv,
  gstPage,
};
