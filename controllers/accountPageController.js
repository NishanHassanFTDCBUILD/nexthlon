const config = require("../config/env");
// My Account pages (server-rendered, customer only), the public page for a shared list, and the
// admin's support-ticket pages. The rules live in the services; these only pick the data to show.
const accountService = require("../services/accountService");
const listService = require("../services/listService");
const reviewService = require("../services/reviewService");
const supportService = require("../services/supportService");
const Order = require("../models/Order");
const SupportTicket = require("../models/SupportTicket");
const orderRules = require("../utils/orderRules");
const { readSessionCookie } = require("../services/tokenService");
const { HttpError, asyncHandler } = require("../utils/http");
const { linkBuilder } = require("../utils/queryString");

const baseUrl = req => `${req.protocol}://${req.get("host")}`;

// GET /account
const overview = asyncHandler(async (req, res) => {
  const data = await accountService.overview(req.user);
  res.render("account/overview", {
    title: "Your account | Nexthlon",
    labels: orderRules.STATUS_LABELS,
    memberTier: data.stats.orders >= 10 ? "Elite" : data.stats.orders >= 3 ? "Pro" : "Member",
    ...data
  });
});

// GET /account/buy-again
const buyAgain = asyncHandler(async (req, res) => {
  res.render("account/buy-again", { title: "Buy it again | Nexthlon", rows: await accountService.buyAgain(req.user._id) });
});

// GET /account/coupons
const coupons = asyncHandler(async (req, res) => {
  res.render("account/coupons", { title: "Coupons & offers | Nexthlon", ...(await accountService.coupons(req.user._id)) });
});

// GET /account/lists and /wishlist (the default wishlist plus the customer's own lists)
const lists = asyncHandler(async (req, res) => {
  res.render("account/lists", { title: "Your wishlist & lists | Nexthlon", maxLists: listService.MAX_LISTS, ...(await listService.getLists(req.user._id)) });
});

// GET /account/reviews
const reviews = asyncHandler(async (req, res) => {
  const [mine, waiting] = await Promise.all([reviewService.listMine(req.user._id), reviewService.waitingForReview(req.user._id)]);
  res.render("account/reviews", { title: "Your reviews | Nexthlon", mine, waiting });
});

// GET /account/recent
const recent = asyncHandler(async (req, res) => {
  res.render("account/recent", { title: "Recently viewed | Nexthlon", products: await accountService.recentlyViewed(req.user._id) });
});

// GET /account/security
const security = asyncHandler(async (req, res) => {
  const [activity, sessions] = await Promise.all([
    accountService.loginActivity(req.user._id),
    // The live sessions, with this browser's one marked "This device" (from the nx_sid cookie).
    accountService.sessions(req.user._id, readSessionCookie(req, "customer"))
  ]);
  res.render("account/security", {
    title: "Login & security | Nexthlon",
    activity,
    sessions,
    phone: req.user.phone || ""
  });
});

// GET /account/notifications
function notifications(req, res) {
  const prefs = req.user.notifyPrefs || {};
  res.render("account/notifications", {
    title: "Notification preferences | Nexthlon",
    prefs: { orderUpdates: prefs.orderUpdates !== false, offers: prefs.offers !== false, newsletter: Boolean(prefs.newsletter) }
  });
}

// GET /account/referral
const referral = asyncHandler(async (req, res) => {
  res.render("account/referral", { title: "Refer a friend | Nexthlon", referral: await accountService.referral(req.user, baseUrl(req)) });
});

// GET /account/help   (?order=NX-... preselects an order in the form)
const help = asyncHandler(async (req, res) => {
  const [tickets, orders] = await Promise.all([
    supportService.listMine(req.user._id),
    Order.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(20).select("orderId createdAt orderStatus").lean()
  ]);
  const wanted = typeof req.query.order === "string" ? req.query.order.toUpperCase() : "";
  res.render("account/help", {
    title: "Help & support | Nexthlon",
    tickets,
    orders,
    topics: SupportTicket.TOPICS,
    selectedOrder: orders.some(order => order.orderId === wanted) ? wanted : "",
    labels: orderRules.STATUS_LABELS
  });
});

// GET /account/help/:ticketId
const ticket = asyncHandler(async (req, res) => {
  const data = await supportService.getMine(req.user._id, req.params.ticketId);
  res.render("account/ticket", { title: `Request ${data.ticketId} | Nexthlon`, ticket: data });
});

// GET /lists/:shareId (public, read-only; shows nothing about the owner)
const sharedList = asyncHandler(async (req, res) => {
  const list = await listService.getShared(req.params.shareId);
  if (!list) throw new HttpError(404, "This list is private or no longer exists.");
  res.render("account/shared-list", { title: `${list.name} | A Nexthlon list`, list, metaDescription: `A list of ${list.count} items on Nexthlon.` });
});

// ---------- Admin: support tickets ----------

const adminTickets = asyncHandler(async (req, res) => {
  const data = await supportService.listAll(req.query);
  const link = linkBuilder(`${config.adminPath}/tickets`, { status: data.filters.status === "all" ? "" : data.filters.status });
  res.render("admin/tickets", { title: "Support tickets | Nexthlon Admin", link, statuses: SupportTicket.STATUSES, ...data });
});

const adminTicket = asyncHandler(async (req, res) => {
  const data = await supportService.getForAdmin(req.params.ticketId);
  res.render("admin/ticket", { title: `Ticket ${data.ticketId} | Nexthlon Admin`, ticket: data, statuses: SupportTicket.STATUSES });
});

module.exports = { overview, buyAgain, coupons, lists, reviews, recent, security, notifications, referral, help, ticket, sharedList, adminTickets, adminTicket };
