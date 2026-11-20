// POST /api/assistant/message  {message}: the shopping assistant's reply (services/shoppingAssistantService.js).
// Nothing the shopper types is stored; the reply only uses listed, in-stock products and the store's own settings.
const assistant = require('../services/shoppingAssistantService');
const {asyncHandler, HttpError} = require('../utils/http');

const message = asyncHandler(async (req, res) => {
  const text = req.body && req.body.message;
  if (typeof text !== 'string' || !text.trim()) {
    throw new HttpError(400, 'Type a question first.');
  }
  if (text.length > assistant.MAX_MESSAGE) {
    throw new HttpError(
      400,
      `Keep questions under ${assistant.MAX_MESSAGE} characters.`,
    );
  }
  res.json(await assistant.answer(text));
});

module.exports = {message};
