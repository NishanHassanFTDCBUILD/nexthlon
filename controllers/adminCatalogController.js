// The admin API for the Catalog group: inventory corrections, review moderation and Q&A.
// Every change is written to the audit log, so there is always a record of who changed what.
const inventoryService = require("../services/inventoryService");
const adminReviewService = require("../services/adminReviewService");
const questionService = require("../services/questionService");
const systemService = require("../services/systemService");
const auditService = require("../services/auditService");
const { validateStockChange, validateReviewHide, validateAnswer, validateQuestion, hasErrors } = require("../utils/validators");
const { row } = require("../utils/csv");
const { HttpError, asyncHandler } = require("../utils/http");

const rupees = paise => (Number(paise || 0) / 100).toFixed(2);

function checked(validate, body) {
  const { errors, value } = validate(body || {});
  if (hasErrors(errors)) throw new HttpError(400, Object.values(errors)[0], errors);
  return value;
}

// ---------- Inventory ----------

// GET /api/admin/inventory?q=&category=&status=&sort=&page=
const listInventory = asyncHandler(async (req, res) => {
  res.json(await inventoryService.listInventory(req.query));
});

// PATCH /api/admin/inventory/:productId   body: { action: "add"|"remove"|"count", units, note? }
const adjustStock = asyncHandler(async (req, res) => {
  const value = checked(validateStockChange, req.body);
  const result = await inventoryService.adjustStock(req.params.productId, value);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: "inventory.stock_changed",
    target: `product:${result.product.id}`,
    before: { stock: result.before },
    after: { stock: result.after, action: value.action, units: value.units, note: value.note }
  });
  const moved = result.after - result.before;
  const how = moved === 0 ? "unchanged" : moved > 0 ? `up ${moved}` : `down ${Math.abs(moved)}`;
  res.json({ message: `${result.product.name}: stock ${how}, now ${result.after}.`, product: result.product });
});

// GET /api/admin/inventory/export.csv?...   One line per product that matches the filters.
const exportInventory = asyncHandler(async (req, res) => {
  const { cursor } = inventoryService.cursorFor(req.query);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="nexthlon-inventory-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.write("﻿");
  res.write(row(["Product", "Brand", "Category", "Listed", "Stock", "State", "Selling price (Rs)", "Stock value (Rs)", "Last changed"]));
  for await (const product of cursor) {
    res.write(row([
      product.name,
      product.brand || "",
      product.category ? product.category.name : "",
      product.isListed === false ? "No" : "Yes",
      product.stock,
      inventoryService.stateOf(product),
      rupees(product.price),
      rupees(product.stock * product.price),
      product.updatedAt ? new Date(product.updatedAt).toISOString() : ""
    ]));
  }
  res.end();
});

// ---------- Reviews ----------

// GET /api/admin/reviews?q=&product=&rating=&visibility=&sort=&page=
const listReviews = asyncHandler(async (req, res) => {
  res.json(await adminReviewService.listReviews(req.query));
});

// PATCH /api/admin/reviews/:reviewId/hidden   body: { isHidden: true, reason: "..." }
const setReviewHidden = asyncHandler(async (req, res) => {
  const value = checked(validateReviewHide, req.body);
  const result = await adminReviewService.setHidden(req.params.reviewId, value.isHidden, value.reason);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: value.isHidden ? "review.hidden" : "review.shown",
    target: `review:${result.review.id}`,
    before: result.before,
    after: { isHidden: value.isHidden, reason: value.reason, product: result.review.product ? result.review.product.name : "" }
  });
  res.json({
    message: value.isHidden
      ? "The review is hidden and no longer counts towards the product's stars."
      : "The review is visible again.",
    review: result.review,
    rating: result.rating
  });
});

// DELETE /api/admin/reviews/:reviewId
const deleteReview = asyncHandler(async (req, res) => {
  const result = await adminReviewService.deleteReview(req.params.reviewId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: "review.deleted",
    target: `review:${result.review.id}`,
    before: { rating: result.review.rating, author: result.review.author, product: result.review.product ? result.review.product.name : "", body: result.review.body.slice(0, 200) }
  });
  res.json({ message: "The review has been deleted.", rating: result.rating });
});

// ---------- Questions & answers ----------

// GET /api/admin/questions?q=&product=&answered=&hidden=&sort=&page=
const listQuestions = asyncHandler(async (req, res) => {
  res.json(await questionService.listForAdmin(req.query));
});

// POST /api/admin/questions/:questionId/answer   body: { body }
// The store's own answer, shown with the official badge.
const answerQuestion = asyncHandler(async (req, res) => {
  const value = checked(validateAnswer, req.body);
  const result = await questionService.answerAsTeam(req.user, req.params.questionId, value.body);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: result.edited ? "question.answer_edited" : "question.answered",
    target: `question:${result.question.id}`,
    after: { body: value.body.slice(0, 200) }
  });
  res.json({ message: result.edited ? "Your answer has been updated." : `Answered as ${questionService.TEAM_NAME}.`, question: result.question });
});

// PATCH /api/admin/questions/:questionId   body: { body, answerId? }
// Edits the wording of the question, or of one answer.
const editQuestion = asyncHandler(async (req, res) => {
  const answerId = req.body && req.body.answerId ? String(req.body.answerId) : null;
  const value = checked(answerId ? validateAnswer : validateQuestion, req.body);
  const result = await questionService.editText(req.params.questionId, { answerId, body: value.body });
  await auditService.record({
    ...auditService.fromRequest(req),
    action: answerId ? "question.answer_edited" : "question.edited",
    target: `question:${result.question.id}`,
    before: { body: result.before.slice(0, 200) },
    after: { body: value.body.slice(0, 200) }
  });
  res.json({ message: answerId ? "The answer has been saved." : "The question has been saved.", question: result.question });
});

// PATCH /api/admin/questions/:questionId/hidden   body: { isHidden, answerId? }
const setQuestionHidden = asyncHandler(async (req, res) => {
  const { isHidden, answerId } = req.body || {};
  if (typeof isHidden !== "boolean") throw new HttpError(400, "isHidden must be true or false.");
  const target = answerId ? String(answerId) : null;
  const question = await questionService.setHidden(req.params.questionId, { answerId: target, isHidden });
  await auditService.record({
    ...auditService.fromRequest(req),
    action: `question.${target ? "answer_" : ""}${isHidden ? "hidden" : "shown"}`,
    target: `question:${question.id}`,
    after: { answerId: target, isHidden }
  });
  const what = target ? "answer" : "question";
  res.json({ message: isHidden ? `The ${what} is hidden from the store.` : `The ${what} is visible again.`, question });
});

// DELETE /api/admin/questions/:questionId?answerId=...
const deleteQuestion = asyncHandler(async (req, res) => {
  const answerId = req.query.answerId ? String(req.query.answerId) : null;
  const result = await questionService.remove(req.params.questionId, answerId);
  await auditService.record({
    ...auditService.fromRequest(req),
    action: answerId ? "question.answer_deleted" : "question.deleted",
    target: `question:${req.params.questionId}`,
    before: answerId
      ? { answer: result.answer.body.slice(0, 200), author: result.answer.author }
      : { body: result.question.body.slice(0, 200), author: result.question.author, answers: result.question.answers.length }
  });
  res.json({
    message: answerId ? "The answer has been deleted." : "The question and its answers have been deleted.",
    deleted: result.deleted,
    question: result.deleted === "answer" ? result.question : null
  });
});

// ---------- System status ----------

// GET /api/admin/system   The same figures as the System status page, for a quick check.
const systemStatus = asyncHandler(async (req, res) => {
  res.json(await systemService.status());
});

module.exports = {
  listInventory,
  adjustStock,
  exportInventory,
  listReviews,
  setReviewHidden,
  deleteReview,
  listQuestions,
  answerQuestion,
  editQuestion,
  setQuestionHidden,
  deleteQuestion,
  systemStatus
};
