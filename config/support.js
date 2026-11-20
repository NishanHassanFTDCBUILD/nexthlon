// Fixed lists for help requests, shared by the model, validation and the pages.

// "pending" means support has replied and is waiting for the customer.
const TICKET_STATUSES = ['open', 'pending', 'resolved'];
const TICKET_TOPICS = [
  'Order',
  'Payment',
  'Delivery',
  'Return or refund',
  'Account',
  'Other',
];

// Ready-made replies for the support inbox. The support team picks one and edits it before sending.
// Keep them plain and polite; they never promise a refund or a date the team cannot keep.
const CANNED_REPLIES = [
  {
    label: 'Thanks, we are looking into it',
    body: 'Thank you for writing to us. We are looking into this now and will get back to you as soon as we have an answer.',
  },
  {
    label: 'Where is my order?',
    body: 'Thanks for your patience. We have checked your order and will share the latest courier update with you shortly. You can also follow it under My orders.',
  },
  {
    label: 'Return instructions',
    body: 'You can return an item within the return window shown on your order. Open My orders, choose the item and select Return. We will confirm the pickup by email.',
  },
  {
    label: 'Refund timing',
    body: 'Refunds go back to the original payment method or your Nexthlon wallet. They usually reach your bank in 5 to 7 working days after we receive the item.',
  },
  {
    label: 'Could you share more details?',
    body: 'Could you tell us a little more about what happened, and share a photo if it helps? That lets us solve this faster.',
  },
  {
    label: 'Issue resolved, thank you',
    body: 'We are glad this is now sorted. If anything else comes up, just reply to this request and we will help.',
  },
];

module.exports = {TICKET_STATUSES, TICKET_TOPICS, CANNED_REPLIES};
