const express = require('express');
const {searchLimiter} = require('../middleware/rateLimit');
const assistant = require('../controllers/assistantController');

const router = express.Router();

// Shares the search limit: each question is a small search, so the same cap protects the database.
router.post('/message', searchLimiter, assistant.message);

module.exports = router;
