const router = require("express").Router();
const account = require("../controllers/accountController");
const { requireAuth, requireRole } = require("../middleware/auth");
const { sensitiveLimiter } = require("../middleware/rateLimit");

// Mounted at /api/support. Signed-in customers only.
router.use(requireAuth, requireRole("customer"));
router.get("/tickets", account.listTickets);
router.post("/tickets", sensitiveLimiter, account.createTicket);
router.post("/tickets/:ticketId/messages", sensitiveLimiter, account.replyTicket);

module.exports = router;
