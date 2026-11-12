// Fixed lists for help requests, shared by the model, validation and the pages.

// "pending" means support has replied and is waiting for the customer.
const TICKET_STATUSES = ["open", "pending", "resolved"];
const TICKET_TOPICS = ["Order", "Payment", "Delivery", "Return or refund", "Account", "Other"];

module.exports = { TICKET_STATUSES, TICKET_TOPICS };
