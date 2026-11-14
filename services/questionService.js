// Product questions and answers (E3).
//   list(productId, page)          answered questions first, then the newest; hidden ones never
//   ask(user, productId, body)     signed-in customers, at most 5 unanswered questions per product
//   answer(user, questionId, body) customers who received the product, or the store's team (isStaff)
//   adminList / hide               the admin's "Questions" page
// The asker is emailed when an answer arrives (a background job, events/listeners/questionEmails.js).
const mongoose = require("mongoose");
const Question = require("../models/Question");
const Product = require("../models/Product");
const events = require("../events");
const { hasReceived, shortName } = require("./reviewService");
const { LISTED_PRODUCT } = require("../utils/queryFilters");
const { HttpError } = require("../utils/http");

const PAGE_SIZE = 5;
const MAX_OPEN_PER_PRODUCT = 5;
const ADMIN_PAGE_SIZE = 20;

function publicQuestion(question, viewerId = null) {
  return {
    id: String(question._id),
    author: question.authorName,
    body: question.body,
    createdAt: question.createdAt,
    mine: Boolean(viewerId && String(question.user) === String(viewerId)),
    answers: (question.answers || []).map(answer => ({
      id: String(answer._id),
      author: answer.isStaff ? "Nexthlon team" : answer.authorName,
      body: answer.body,
      at: answer.at,
      isStaff: Boolean(answer.isStaff),
      verifiedBuyer: Boolean(answer.verifiedBuyer)
    }))
  };
}

const readBody = (value, min, max, what) => {
  const body = String(value || "").replace(/\s+/g, " ").trim();
  if (body.length < min || body.length > max) throw new HttpError(400, `Write ${what} of ${min} to ${max} characters.`, { body: `Write ${what} of ${min} to ${max} characters.` });
  return body;
};

async function list(productId, page = 1, viewerId = null) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const current = Math.max(1, Math.min(200, Number.parseInt(page, 10) || 1));
  const filter = { product: productId, isHidden: false };
  const [rows, total] = await Promise.all([
    Question.find(filter).sort({ answerCount: -1, createdAt: -1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE).lean(),
    Question.countDocuments(filter)
  ]);
  return { questions: rows.map(row => publicQuestion(row, viewerId)), pagination: { page: current, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total } };
}

async function ask(user, productId, value) {
  if (!user || user.role !== "customer") throw new HttpError(403, "Sign in with a customer account to ask a question.");
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findOne({ _id: productId, ...LISTED_PRODUCT }).select("_id").lean();
  if (!product) throw new HttpError(404, "Product not found.");
  const body = readBody(value, 10, 300, "a question");
  const open = await Question.countDocuments({ product: product._id, user: user._id, answerCount: 0 });
  if (open >= MAX_OPEN_PER_PRODUCT) throw new HttpError(429, "You have 5 questions here waiting for an answer. We will get to them soon.", null, "question_limit");
  const question = await Question.create({ product: product._id, user: user._id, authorName: shortName(user.name), body });
  await events.emit("question.asked", { questionId: String(question._id) });
  return publicQuestion(question.toObject(), user._id);
}

async function answer(user, questionId, value) {
  if (!user) throw new HttpError(401, "Sign in to answer.");
  if (!mongoose.isValidObjectId(questionId)) throw new HttpError(404, "Question not found.");
  const question = await Question.findOne({ _id: questionId, isHidden: false });
  if (!question) throw new HttpError(404, "Question not found.");
  const isStaff = user.role === "admin";
  const verifiedBuyer = !isStaff && await hasReceived(user._id, question.product);
  if (!isStaff && !verifiedBuyer) throw new HttpError(403, "Only customers who received this product can answer.", null, "answer_not_buyer");
  if (!isStaff && String(question.user) === String(user._id)) throw new HttpError(400, "You can't answer your own question.");
  const body = readBody(value, 2, 1000, "an answer");
  const updated = await Question.findOneAndUpdate(
    { _id: question._id, answerCount: { $lt: 20 } },
    { $push: { answers: { body, user: user._id, authorName: isStaff ? "Nexthlon team" : shortName(user.name), isStaff, verifiedBuyer } }, $inc: { answerCount: 1 } },
    { new: true }
  ).lean();
  if (!updated) throw new HttpError(409, "This question has enough answers.");
  const added = updated.answers[updated.answers.length - 1];
  await events.emit("question.answered", { questionId: String(updated._id), answerId: String(added._id) }, { key: String(added._id) });
  return publicQuestion(updated, user._id);
}

async function adminList({ status = "waiting", page = 1 } = {}) {
  const current = Math.max(1, Number.parseInt(page, 10) || 1);
  const filter = status === "all" ? {} : status === "hidden" ? { isHidden: true } : { answerCount: 0, isHidden: false };
  const [rows, total] = await Promise.all([
    Question.find(filter).sort({ createdAt: -1 }).skip((current - 1) * ADMIN_PAGE_SIZE).limit(ADMIN_PAGE_SIZE).populate("product", "name slug image").lean(),
    Question.countDocuments(filter)
  ]);
  return {
    status: ["waiting", "all", "hidden"].includes(status) ? status : "waiting",
    questions: rows.map(row => ({ ...publicQuestion(row), isHidden: row.isHidden, product: row.product ? { name: row.product.name, slug: row.product.slug, image: row.product.image } : null })),
    pagination: { page: current, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)), total }
  };
}

async function setHidden(questionId, isHidden) {
  if (!mongoose.isValidObjectId(questionId)) throw new HttpError(404, "Question not found.");
  const question = await Question.findByIdAndUpdate(questionId, { $set: { isHidden: Boolean(isHidden) } }, { new: true }).lean();
  if (!question) throw new HttpError(404, "Question not found.");
  return question;
}

module.exports = { PAGE_SIZE, list, ask, answer, adminList, setHidden, publicQuestion };
