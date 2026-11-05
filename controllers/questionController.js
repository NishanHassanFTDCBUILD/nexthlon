// Questions & Answers, from the store's side. Reading is open to everyone; asking, answering and
// voting need a signed-in customer (the routes enforce that). Every field is plain text and the
// pages print it escaped, so a question containing markup is shown as text and never runs.
const questionService = require("../services/questionService");
const { validateQuestion, validateAnswer, hasErrors } = require("../utils/validators");
const { HttpError, asyncHandler } = require("../utils/http");

function checked(validate, body) {
  const { errors, value } = validate(body || {});
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

const page = value => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : 1;
};

// GET /api/products/:id/questions?page=&q=
// Open to everyone. A signed-in customer also learns which Helpful buttons they have pressed.
const listQuestions = asyncHandler(async (req, res) => {
  const viewer = req.user && req.user.role === "customer" ? req.user : null;
  const data = await questionService.publicList(req.params.id, { page: page(req.query.page), q: req.query.q }, viewer);
  res.json(data);
});

// POST /api/products/:id/questions   body: { body }
const ask = asyncHandler(async (req, res) => {
  const value = checked(validateQuestion, req.body);
  const question = await questionService.ask(req.user, req.params.id, value.body);
  res.status(201).json({ message: "Your question has been posted. We'll answer it soon.", question });
});

// POST /api/questions/:questionId/answers   body: { body }
const answer = asyncHandler(async (req, res) => {
  const value = checked(validateAnswer, req.body);
  const question = await questionService.answer(req.user, req.params.questionId, value.body);
  res.status(201).json({ message: "Thank you for helping another shopper.", question });
});

// POST /api/questions/:questionId/helpful   body: { answerId? }
// A toggle: pressing it again takes the vote back.
const helpful = asyncHandler(async (req, res) => {
  const answerId = req.body && req.body.answerId ? String(req.body.answerId) : null;
  const result = await questionService.vote(req.user, req.params.questionId, answerId);
  res.json({ message: result.voted ? "Marked as helpful." : "Your vote has been taken back.", ...result });
});

module.exports = { listQuestions, ask, answer, helpful };
