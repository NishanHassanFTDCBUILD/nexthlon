const router = require('express').Router();
const {sendMessage, subscribe} = require('../controllers/contactController');
const {formLimiter} = require('../middleware/rateLimit');

// Mounted at /api. Open to everyone; originCheck (in app.js) still blocks other websites.
router.post('/contact', formLimiter, sendMessage);
router.post('/newsletter', formLimiter, subscribe);

module.exports = router;
