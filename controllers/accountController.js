// My Account JSON API: sign-in email, sign out everywhere, preferences, recently viewed, deleting
// the account, the customer's reviews, shopping lists and help requests. Thin handlers: the rules
// live in the services. Every route is for a signed-in customer (see routes/accountRoutes.js).
const accountService = require('../services/accountService');
const privacyService = require('../services/privacyService');
const reviewService = require('../services/reviewService');
const listService = require('../services/listService');
const supportService = require('../services/supportService');
const auditService = require('../services/auditService');
const {endSession, readSessionCookie} = require('../services/tokenService');
const emailVerificationService = require('../services/emailVerificationService');
const {siteUrlFor} = require('../utils/emailLayout');
const {
  validateEmailChange,
  validatePreferences,
  validateDeleteAccount,
  validateReview,
  validateListName,
  validateTicket,
  validateTicketReply,
  hasErrors,
} = require('../utils/validators');
const {HttpError, asyncHandler} = require('../utils/http');
const {TICKET_TOPICS} = require('../config/support');
const {toPublicUser} = require('../utils/publicUser');

function checked(validate, body, ...extra) {
  const {errors, value} = validate(body, ...extra);
  if (hasErrors(errors))
    throw new HttpError(
      400,
      errors.form || 'Please fix the highlighted fields.',
      errors,
    );
  return value;
}

// ---------- Sign-in and security ----------

// PATCH /api/account/email   { email, password }
const changeEmail = asyncHandler(async (req, res) => {
  const user = await accountService.changeEmail(
    req.user._id,
    checked(validateEmailChange, req.body),
    auditService.fromRequest(req),
  );
  emailVerificationService.sendInBackground(user, {
    baseUrl: siteUrlFor(req),
    ip: req.ip,
  });
  res.json({
    message:
      'Your sign-in email has been changed. We sent a link to the new address: please confirm it.',
    user: toPublicUser(user),
  });
});

// POST /api/account/logout-all
// Every token, on every device, stops working at once, including this one.
const logoutAll = asyncHandler(async (req, res) => {
  await accountService.logoutEverywhere(
    req.user._id,
    auditService.fromRequest(req),
  );
  endSession(res, 'customer');
  res.json({message: 'You have been signed out of all devices.'});
});

// GET /api/account/sessions
// The devices signed in to this account: one row per live refresh token. The nx_sid cookie only
// says which row is this device; it is not a key and cannot sign anybody in.
const listSessions = asyncHandler(async (req, res) => {
  res.json({
    sessions: await accountService.sessions(
      req.user._id,
      readSessionCookie(req, 'customer'),
    ),
  });
});

// DELETE /api/account/sessions/:sessionId   ("Log out this device")
const endDeviceSession = asyncHandler(async (req, res) => {
  const here = readSessionCookie(req, 'customer');
  const result = await accountService.endSession(
    req.user._id,
    req.params.sessionId,
    here,
    auditService.fromRequest(req),
  );
  // Logging out the device you are on: drop this browser's cookies too.
  if (result.current) endSession(res, 'customer');
  res.json({
    message: result.current
      ? 'This device has been signed out.'
      : `${result.device} has been signed out.`,
    current: result.current,
    sessions: result.current
      ? []
      : await accountService.sessions(req.user._id, here),
  });
});

// PATCH /api/account/preferences   { orderUpdates?, offers?, newsletter? } (true/false)
const updatePreferences = asyncHandler(async (req, res) => {
  const prefs = await accountService.updatePreferences(
    req.user._id,
    checked(validatePreferences, req.body),
  );
  res.json({message: 'Preferences saved.', preferences: prefs});
});

// DELETE /api/account/recent
const clearRecent = asyncHandler(async (req, res) => {
  await accountService.clearRecent(req.user._id);
  res.json({message: 'Your recently viewed list has been cleared.'});
});

// GET /api/account/export   Everything we keep about you, as a JSON file (D2).
const exportData = asyncHandler(async (req, res) => {
  const data = await privacyService.exportData(
    req.user._id,
    auditService.fromRequest(req),
  );
  const day = new Date().toISOString().slice(0, 10);
  res.set('Cache-Control', 'no-store');
  res.attachment(`nexthlon-my-data-${day}.json`);
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

// POST /api/account/delete   { password, confirm: "DELETE" }
const deleteAccount = asyncHandler(async (req, res) => {
  const {password} = checked(validateDeleteAccount, req.body);
  await accountService.deleteAccount(
    req.user._id,
    password,
    auditService.fromRequest(req),
  );
  endSession(res, 'customer');
  res.json({
    message: 'Your account has been deleted. We are sorry to see you go.',
  });
});

// ---------- Reviews ----------

// PATCH /api/account/reviews/:reviewId   { rating, title?, body }
const updateReview = asyncHandler(async (req, res) => {
  const result = await reviewService.updateMine(
    req.user._id,
    req.params.reviewId,
    checked(validateReview, req.body),
  );
  res.json({message: 'Review updated.', ...result});
});

// DELETE /api/account/reviews/:reviewId
const deleteReview = asyncHandler(async (req, res) => {
  const rating = await reviewService.deleteMine(
    req.user._id,
    req.params.reviewId,
  );
  res.json({message: 'Review deleted.', rating});
});

// ---------- Shopping lists ("default" is the main wishlist) ----------

const getLists = asyncHandler(async (req, res) => {
  res.json(await listService.getLists(req.user._id));
});

const createList = asyncHandler(async (req, res) => {
  const list = await listService.createList(
    req.user._id,
    checked(validateListName, req.body),
  );
  res.status(201).json({message: `"${list.name}" created.`, list});
});

const renameList = asyncHandler(async (req, res) => {
  const list = await listService.renameList(
    req.user._id,
    req.params.listId,
    checked(validateListName, req.body),
  );
  res.json({message: 'List renamed.', list});
});

const deleteList = asyncHandler(async (req, res) => {
  await listService.deleteList(req.user._id, req.params.listId);
  res.json({message: 'List deleted.'});
});

const addListItem = asyncHandler(async (req, res) => {
  const lists = await listService.addItem(
    req.user._id,
    req.params.listId,
    req.body && req.body.productId,
  );
  res.status(201).json({message: 'Saved to your list.', ...lists});
});

const removeListItem = asyncHandler(async (req, res) => {
  const lists = await listService.removeItem(
    req.user._id,
    req.params.listId,
    req.params.productId,
  );
  res.json({message: 'Removed from the list.', ...lists});
});

// POST /api/lists/move   { productId, from, to }
const moveListItem = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const ids = [body.from, body.to].map((value) =>
    typeof value === 'string' ? value : '',
  );
  if (!ids[0] || !ids[1])
    throw new HttpError(400, 'Choose the list to move it to.');
  const lists = await listService.moveItem(req.user._id, {
    productId: body.productId,
    from: ids[0],
    to: ids[1],
  });
  res.json({message: 'Moved.', ...lists});
});

const listItemToCart = asyncHandler(async (req, res) => {
  const {product, cart} = await listService.moveToCart(
    req.user._id,
    req.params.listId,
    req.params.productId,
  );
  res.json({message: `${product.name} moved to your cart.`, cart});
});

// PATCH /api/lists/:listId/share   { enabled: true|false }
const shareList = asyncHandler(async (req, res) => {
  const enabled = req.body ? req.body.enabled : undefined;
  if (typeof enabled !== 'boolean')
    throw new HttpError(400, 'Choose whether to share the list.');
  const list = await listService.setSharing(
    req.user._id,
    req.params.listId,
    enabled,
  );
  res.json({
    message: enabled
      ? 'Anyone with the link can now see this list.'
      : 'Sharing turned off.',
    list,
  });
});

// ---------- Help requests ----------

const createTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.createTicket(
    req.user,
    checked(validateTicket, req.body, TICKET_TOPICS),
  );
  res.status(201).json({
    message: `Request ${ticket.ticketId} sent. We usually reply within a day.`,
    ticket,
  });
});

const listTickets = asyncHandler(async (req, res) => {
  res.json({tickets: await supportService.listMine(req.user._id)});
});

const replyTicket = asyncHandler(async (req, res) => {
  const ticket = await supportService.replyAsCustomer(
    req.user,
    req.params.ticketId,
    checked(validateTicketReply, req.body),
  );
  res.json({message: 'Reply sent.', ticket});
});

module.exports = {
  changeEmail,
  logoutAll,
  listSessions,
  endDeviceSession,
  updatePreferences,
  clearRecent,
  deleteAccount,
  exportData,
  updateReview,
  deleteReview,
  getLists,
  createList,
  renameList,
  deleteList,
  addListItem,
  removeListItem,
  moveListItem,
  listItemToCart,
  shareList,
  createTicket,
  listTickets,
  replyTicket,
};
