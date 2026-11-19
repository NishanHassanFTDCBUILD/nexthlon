// Operations for the team: the webhook log, the job queue, and the GST report. Each has its page and
// its API. Changes (re-running a payment event, retrying a job) are audit-logged.
const webhookLogService = require('../services/webhookLogService');
const jobMonitorService = require('../services/jobMonitorService');
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

// ---------- Jobs ----------
const listJobs = asyncHandler(async (req, res) => {
  res.json({
    summary: await jobMonitorService.summary(),
    ...(await jobMonitorService.list(req.query)),
  });
});

// POST /api/admin/jobs/:jobId/retry
const retryJob = asyncHandler(async (req, res) => {
  const result = await jobMonitorService.retry(req.params.jobId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'job.retried',
    target: `job:${req.params.jobId}`,
    before: result.before,
    after: result.after,
  });
  res.json({
    message: `The ${result.type} job is queued to run again.`,
    ...result,
  });
});

const jobsPage = asyncHandler(async (req, res) => {
  const data = await jobMonitorService.list(req.query);
  const current = data.status === 'failed' ? {} : {status: data.status};
  res.render('admin/jobs', {
    title: 'Job queue | Nexthlon Admin',
    summary: await jobMonitorService.summary(),
    ...data,
    link: linkBuilder(`${config.adminPath}/jobs`, current),
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
  listJobs,
  retryJob,
  jobsPage,
  gstCsv,
  gstPage,
};
