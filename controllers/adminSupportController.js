// The support inbox: every customer request, one page to read and reply. Replies go through the
// existing admin API (POST /api/admin/tickets/:ticketId/reply), which sets the status and audits it.
const supportService = require('../services/supportService');
const config = require('../config/env');
const {TICKET_STATUSES} = require('../config/support');
const {CANNED_REPLIES} = require('../config/support');
const {linkBuilder} = require('../utils/queryString');
const {asyncHandler, HttpError} = require('../utils/http');

const base = `${config.adminPath}/support`;

// GET <ADMIN_PATH>/support?status=open|pending|resolved|all&page=
const inbox = asyncHandler(async (req, res) => {
  const data = await supportService.listAll(req.query);
  const current = {};
  if (data.filters.status !== 'all') current.status = data.filters.status;
  res.render('admin/support', {
    title: 'Support inbox | Nexthlon Admin',
    ...data,
    statusList: TICKET_STATUSES,
    link: linkBuilder(base, current),
  });
});

// GET <ADMIN_PATH>/support/:ticketId
const ticket = asyncHandler(async (req, res) => {
  const found = await supportService.getForAdmin(req.params.ticketId);
  if (!found) throw new HttpError(404, 'Request not found.');
  res.render('admin/support-ticket', {
    title: `${found.ticketId} | Nexthlon Admin`,
    ticket: found,
    cannedReplies: CANNED_REPLIES,
    statusList: TICKET_STATUSES,
  });
});

module.exports = {inbox, ticket};
