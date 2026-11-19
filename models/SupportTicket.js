const mongoose = require('mongoose');
const {TICKET_STATUSES, TICKET_TOPICS} = require('../config/support');

const messageSchema = new mongoose.Schema(
  {
    from: {type: String, enum: ['customer', 'admin'], required: true},
    authorName: {type: String, required: true, maxlength: 60},
    body: {type: String, required: true, maxlength: 2000},
    at: {type: Date, default: Date.now},
  },
  {_id: false},
);

// A help request from a signed-in customer, optionally about one of their orders.
// "pending" means support has replied and is waiting for the customer.
const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {type: String, required: true, unique: true},
    user: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},
    order: {type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null},
    orderId: {type: String, default: ''},
    topic: {type: String, enum: TICKET_TOPICS, required: true},
    subject: {type: String, required: true, trim: true, maxlength: 100},
    status: {type: String, enum: TICKET_STATUSES, default: 'open'},
    messages: {type: [messageSchema], default: []},
  },
  {timestamps: true},
);

supportTicketSchema.index({user: 1, updatedAt: -1});
supportTicketSchema.index({status: 1, updatedAt: -1});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
