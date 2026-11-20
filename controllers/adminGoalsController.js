// Monthly revenue goal (the API, and the goal card on the Sales breakdown page) and the return-reasons
// report (the API, its CSV and its page). Changing a goal is audit-logged.
const revenueGoalService = require('../services/revenueGoalService');
const returnReasonsService = require('../services/returnReasonsService');
const returnRulesService = require('../services/returnRulesService');
const auditService = require('../services/auditService');
const {can, roleOf} = require('../utils/permissions');
const config = require('../config/env');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler} = require('../utils/http');

// GET /api/admin/goals?month=YYYY-MM
const goalApi = asyncHandler(async (req, res) => {
  res.json(await revenueGoalService.progress(req.query.month));
});

// PATCH /api/admin/goals/:month   body: { amount: 500000 }  (rupees; 0 clears the goal)
const setGoalApi = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await revenueGoalService.setGoal(
    req.params.month,
    body.amount,
  );
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'goal.set',
    target: `goal:${req.params.month}`,
    before: {goal: result.before},
    after: {goal: result.after},
  });
  res.json({
    message: result.after
      ? `Goal for ${result.month} saved.`
      : `Goal for ${result.month} cleared.`,
    ...(await revenueGoalService.progress(result.month)),
  });
});

// PATCH /api/admin/returns/rules   body: { autoApproveRupees, ownerApproveRupees }  (0 turns a rule off)
const setReturnRulesApi = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const result = await returnRulesService.setRules({
    autoApproveRupees: body.autoApproveRupees,
    ownerApproveRupees: body.ownerApproveRupees,
  });
  await auditService.record({
    ...auditService.fromRequest(req),
    action: 'returns.rules',
    target: 'returns:rules',
    before: result.before,
    after: result.after,
  });
  res.json({message: 'Return rules saved.', rules: result.after});
});

// GET /api/admin/reports/returns?from=&to=
const returnsApi = asyncHandler(async (req, res) => {
  res.json(await returnReasonsService.report(req.query));
});

// GET /api/admin/reports/returns.csv?from=&to=
const returnsCsv = asyncHandler(async (req, res) => {
  const data = await returnReasonsService.report(req.query);
  res
    .set('Cache-Control', 'no-store')
    .attachment(`nexthlon-returns-${data.from}-to-${data.to}.csv`)
    .type('text/csv')
    .send(returnReasonsService.toCsv(data));
});

// GET <ADMIN_PATH>/returns-report?from=&to=
const returnsPage = asyncHandler(async (req, res) => {
  const data = await returnReasonsService.report(req.query);
  const limits = await returnRulesService.rules();
  res.render('admin/returns-report', {
    title: 'Return reasons | Nexthlon Admin',
    ...data,
    limits,
    canSetRules: can(roleOf(req.user), 'settings.write'),
    link: linkBuilder(`${config.adminPath}/returns-report`, {
      from: data.from,
      to: data.to,
    }),
    maxShare: Math.max(1, ...data.reasons.map((r) => r.items)),
  });
});

module.exports = {
  goalApi,
  setGoalApi,
  setReturnRulesApi,
  returnsApi,
  returnsCsv,
  returnsPage,
};
