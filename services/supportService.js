const SupportTicket = require('../models/SupportTicket');
const Order = require('../models/Order');
const auditService = require('./auditService');
const {HttpError} = require('../utils/http');
const {TICKET_STATUSES} = require('../config/support');
const counterService = require('../services/counterService');

const PAGE_SIZE = 20;
const TICKET_ID = /^HLP-\d{6}$/;

async function nextTicketId() {
  return `HLP-${String(await counterService.nextNumber('ticket')).padStart(6, '0')}`;
}

// What the customer and the admin see. The customer's email is only shown to admins.
function toTicket(ticket, {forAdmin = false} = {}) {
  const user = ticket.user && ticket.user.name ? ticket.user : null;
  return {
    ticketId: ticket.ticketId,
    topic: ticket.topic,
    subject: ticket.subject,
    status: ticket.status,
    orderId: ticket.orderId || '',
    messages: (ticket.messages || []).map((message) => ({
      from: message.from,
      authorName: message.authorName,
      body: message.body,
      at: message.at,
    })),
    lastMessage: (ticket.messages || []).slice(-1)[0] || null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    ...(forAdmin && user
      ? {customer: {name: user.name, email: user.email}}
      : {}),
  };
}

// ---------- Customers ----------

async function createTicket(user, {topic, subject, message, orderId}) {
  let order = null;
  if (orderId) {
    order = await Order.findOne({orderId, user: user._id})
      .select('_id orderId')
      .lean();
    if (!order)
      throw new HttpError(400, 'Choose one of your orders.', {
        orderId: 'Choose one of your orders.',
      });
  }
  const ticket = await SupportTicket.create({
    ticketId: await nextTicketId(),
    user: user._id,
    order: order ? order._id : null,
    orderId: order ? order.orderId : '',
    topic,
    subject,
    messages: [{from: 'customer', authorName: user.name, body: message}],
  });
  return toTicket(ticket);
}

async function findOwnedTicket(userId, ticketId) {
  const id = String(ticketId || '').toUpperCase();
  if (!TICKET_ID.test(id)) throw new HttpError(404, 'Request not found.');
  const ticket = await SupportTicket.findOne({ticketId: id, user: userId});
  if (!ticket) throw new HttpError(404, 'Request not found.');
  return ticket;
}

async function listMine(userId) {
  const tickets = await SupportTicket.find({user: userId})
    .sort({updatedAt: -1})
    .limit(50)
    .lean();
  return tickets.map((ticket) => toTicket(ticket));
}

async function getMine(userId, ticketId) {
  return toTicket(await findOwnedTicket(userId, ticketId));
}

// A customer reply reopens the request.
async function replyAsCustomer(user, ticketId, {message}) {
  const ticket = await findOwnedTicket(user._id, ticketId);
  ticket.messages.push({
    from: 'customer',
    authorName: user.name,
    body: message,
  });
  ticket.status = 'open';
  await ticket.save();
  return toTicket(ticket);
}

// ---------- Admins ----------

async function listAll({status = 'all', page = 1} = {}) {
  const filter = TICKET_STATUSES.includes(status) ? {status} : {};
  const current = Math.max(1, Number.parseInt(page, 10) || 1);
  const [tickets, total, counts] = await Promise.all([
    SupportTicket.find(filter)
      .sort({updatedAt: -1})
      .skip((current - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('user', 'name email')
      .lean(),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([{$group: {_id: '$status', count: {$sum: 1}}}]),
  ]);
  const countOf = (name) =>
    (counts.find((row) => row._id === name) || {count: 0}).count;
  return {
    tickets: tickets.map((ticket) => toTicket(ticket, {forAdmin: true})),
    counts: {
      open: countOf('open'),
      pending: countOf('pending'),
      resolved: countOf('resolved'),
    },
    filters: {status: TICKET_STATUSES.includes(status) ? status : 'all'},
    pagination: {
      page: current,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      total,
      limit: PAGE_SIZE,
    },
  };
}

async function getForAdmin(ticketId) {
  const id = String(ticketId || '').toUpperCase();
  if (!TICKET_ID.test(id)) throw new HttpError(404, 'Request not found.');
  const ticket = await SupportTicket.findOne({ticketId: id})
    .populate('user', 'name email')
    .lean();
  if (!ticket) throw new HttpError(404, 'Request not found.');
  return toTicket(ticket, {forAdmin: true});
}

// An admin reply sets the status (waiting for the customer by default). Logged in the audit log.
async function replyAsAdmin(admin, ticketId, {message, status}, context = {}) {
  const id = String(ticketId || '').toUpperCase();
  if (!TICKET_ID.test(id)) throw new HttpError(404, 'Request not found.');
  const ticket = await SupportTicket.findOne({ticketId: id});
  if (!ticket) throw new HttpError(404, 'Request not found.');
  const before = ticket.status;
  ticket.messages.push({
    from: 'admin',
    authorName: 'Nexthlon support',
    body: message,
  });
  ticket.status = status || 'pending';
  await ticket.save();
  await auditService.record({
    ...context,
    action: 'support.replied',
    target: `ticket:${ticket.ticketId}`,
    before: {status: before},
    after: {status: ticket.status},
  });
  return getForAdmin(ticket.ticketId);
}

module.exports = {
  PAGE_SIZE,
  TICKET_ID,
  toTicket,
  createTicket,
  listMine,
  getMine,
  replyAsCustomer,
  listAll,
  getForAdmin,
  replyAsAdmin,
};
