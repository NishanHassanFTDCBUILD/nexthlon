// Questions & Answers on a product.
//
// Anyone may read. A signed-in customer may ask a question, answer someone else's, and mark one
// answer or question as helpful (once each). The store answers from the admin console, and those
// answers carry the "Nexthlon Team" name and an official badge.
//
// Nothing here ever returns raw HTML: every field is plain text, and the pages print it with EJS's
// escaping (<%= %>), so a question containing <script> is shown as text and never runs.
const mongoose = require("mongoose");
const Question = require("../models/Question");
const Product = require("../models/Product");
const { HttpError } = require("../utils/http");
const { escapeRegex, toPositiveInt } = require("./productService");
const { shortName } = require("./reviewService");

const PAGE_SIZE = 5;
const ADMIN_PAGE_SIZE = 20;
const TEAM_NAME = "Nexthlon Team";
// One customer may not fill a product page with questions.
const MAX_OPEN_PER_PRODUCT = 3;

const ANSWERED = ["all", "yes", "no"];
const ANSWERED_LABELS = { all: "All questions", yes: "Answered", no: "Waiting for an answer" };
const ADMIN_SORTS = {
  waiting: { label: "Waiting longest first", order: { answered: 1, createdAt: 1 } },
  newest: { label: "Newest first", order: { createdAt: -1 } },
  oldest: { label: "Oldest first", order: { createdAt: 1 } },
  helpful: { label: "Most helpful votes", order: { helpfulCount: -1, createdAt: -1 } }
};

const objectId = id => new mongoose.Types.ObjectId(String(id));
const hasVoted = (list = [], userId) => list.some(id => String(id) === String(userId));

// ---------- What the store shows ----------

// One question as the product page needs it. "viewer" is the signed-in user or null: it only
// decides whether the Helpful buttons show as already pressed.
function publicQuestion(question, viewer = null) {
  const answers = question.answers
    .filter(answer => !answer.isHidden)
    // The store's own answer first, then the most helpful, then the oldest.
    .sort((a, b) => Number(b.byTeam) - Number(a.byTeam) || (b.helpfulBy || []).length - (a.helpfulBy || []).length || new Date(a.at) - new Date(b.at))
    .map(answer => ({
      id: String(answer._id),
      body: answer.body,
      author: answer.authorName,
      byTeam: Boolean(answer.byTeam),
      helpful: (answer.helpfulBy || []).length,
      votedByMe: Boolean(viewer) && hasVoted(answer.helpfulBy, viewer._id),
      at: answer.at
    }));
  return {
    id: String(question._id),
    body: question.body,
    author: question.authorName,
    helpful: (question.helpfulBy || []).length,
    votedByMe: Boolean(viewer) && hasVoted(question.helpfulBy, viewer._id),
    mine: Boolean(viewer) && String(question.user) === String(viewer._id),
    answerCount: answers.length,
    answers,
    createdAt: question.createdAt
  };
}

// The product page's Q&A block: visible questions, answered ones first (they help most), newest
// within that. ?q= searches the question text.
async function listForProduct(productId, { page = 1, q = "" } = {}) {
  const filter = { product: productId, isHidden: false };
  const search = typeof q === "string" ? q.trim().slice(0, 60) : "";
  if (search) filter.body = new RegExp(escapeRegex(search), "i");
  const skip = (Math.max(1, page) - 1) * PAGE_SIZE;
  const [rows, total, answeredCount] = await Promise.all([
    Question.find(filter).sort({ answered: -1, createdAt: -1 }).skip(skip).limit(PAGE_SIZE).lean(),
    Question.countDocuments(filter),
    Question.countDocuments({ product: productId, isHidden: false, answered: true })
  ]);
  return {
    questions: rows,
    total,
    answeredCount,
    search,
    pagination: { page: Math.max(1, page), pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, limit: PAGE_SIZE }
  };
}

// The same list, already shaped for the browser.
async function publicList(productId, options = {}, viewer = null) {
  const data = await listForProduct(productId, options);
  return { ...data, questions: data.questions.map(row => publicQuestion(row, viewer)) };
}

async function listedProduct(productId) {
  if (!mongoose.isValidObjectId(productId)) throw new HttpError(404, "Product not found.");
  const product = await Product.findOne({ _id: productId, ...Product.LISTED }).select("_id name slug").lean();
  if (!product) throw new HttpError(404, "Product not found.");
  return product;
}

// ---------- What customers do ----------

async function ask(user, productId, body) {
  const product = await listedProduct(productId);
  const open = await Question.countDocuments({ product: product._id, user: user._id, answered: false, isHidden: false });
  if (open >= MAX_OPEN_PER_PRODUCT) {
    throw new HttpError(429, `You already have ${MAX_OPEN_PER_PRODUCT} questions waiting on this product. Please wait for an answer.`);
  }
  const question = await Question.create({
    product: product._id,
    user: user._id,
    authorName: shortName(user.name),
    body
  });
  return publicQuestion(question, user);
}

async function findVisible(questionId) {
  if (!mongoose.isValidObjectId(questionId)) throw new HttpError(404, "Question not found.");
  const question = await Question.findOne({ _id: questionId, isHidden: false });
  if (!question) throw new HttpError(404, "Question not found.");
  return question;
}

// A customer answering another customer's question. Asking and answering your own is allowed:
// people often come back with the answer they found.
async function answer(user, questionId, body) {
  const question = await findVisible(questionId);
  const already = question.answers.some(row => !row.byTeam && String(row.user) === String(user._id));
  if (already) throw new HttpError(409, "You have already answered this question.");
  question.answers.push({ body, user: user._id, authorName: shortName(user.name), byTeam: false });
  question.answered = question.visibleAnswers().length > 0;
  await question.save();
  return publicQuestion(question, user);
}

// "Helpful" on a question, or on one of its answers. One vote per customer, and voting again
// takes the vote back, so the button is a toggle.
async function vote(user, questionId, answerId = null) {
  const question = await findVisible(questionId);
  const target = answerId ? question.answers.id(answerId) : question;
  if (!target || (answerId && target.isHidden)) throw new HttpError(404, "That answer no longer exists.");
  const voted = hasVoted(target.helpfulBy, user._id);
  target.helpfulBy = voted
    ? target.helpfulBy.filter(id => String(id) !== String(user._id))
    : [...target.helpfulBy, user._id];
  await question.save();
  return { question: publicQuestion(question, user), voted: !voted };
}

// ---------- What the admin does ----------

function adminQuestion(question) {
  return {
    id: String(question._id),
    body: question.body,
    author: question.authorName,
    isHidden: Boolean(question.isHidden),
    answered: Boolean(question.answered),
    helpful: (question.helpfulBy || []).length,
    createdAt: question.createdAt,
    product: question.product && question.product.name
      ? { id: String(question.product._id), name: question.product.name, slug: question.product.slug }
      : null,
    answers: (question.answers || []).map(answer => ({
      id: String(answer._id),
      body: answer.body,
      author: answer.authorName,
      byTeam: Boolean(answer.byTeam),
      isHidden: Boolean(answer.isHidden),
      helpful: (answer.helpfulBy || []).length,
      at: answer.at
    }))
  };
}

function readAdminFilters(query = {}) {
  return {
    q: typeof query.q === "string" ? query.q.trim().slice(0, 80) : "",
    product: typeof query.product === "string" && mongoose.isValidObjectId(query.product) ? query.product : "",
    answered: ANSWERED.includes(query.answered) ? query.answered : "all",
    hidden: query.hidden === "yes" ? "yes" : "no",
    sort: Object.hasOwn(ADMIN_SORTS, query.sort) ? query.sort : "waiting",
    page: toPositiveInt(query.page, 1)
  };
}

function adminFilterFrom(filters) {
  const filter = {};
  if (filters.product) filter.product = objectId(filters.product);
  if (filters.answered === "yes") filter.answered = true;
  if (filters.answered === "no") filter.answered = false;
  // Hidden questions are kept out of the way unless they are asked for.
  if (filters.hidden === "no") filter.isHidden = false;
  if (filters.q) filter.body = new RegExp(escapeRegex(filters.q), "i");
  return filter;
}

async function listForAdmin(query = {}) {
  const filters = readAdminFilters(query);
  const filter = adminFilterFrom(filters);
  const [rows, total, counts] = await Promise.all([
    Question.aggregate([
      { $match: filter },
      { $addFields: { helpfulCount: { $size: { $ifNull: ["$helpfulBy", []] } } } },
      { $sort: ADMIN_SORTS[filters.sort].order },
      { $skip: (filters.page - 1) * ADMIN_PAGE_SIZE },
      { $limit: ADMIN_PAGE_SIZE },
      { $lookup: { from: "products", localField: "product", foreignField: "_id", as: "product", pipeline: [{ $project: { name: 1, slug: 1 } }] } },
      { $addFields: { product: { $first: "$product" } } }
    ]),
    Question.countDocuments(filter),
    Question.aggregate([
      { $group: {
        _id: null,
        all: { $sum: 1 },
        waiting: { $sum: { $cond: [{ $and: [{ $eq: ["$answered", false] }, { $eq: ["$isHidden", false] }] }, 1, 0] } },
        hidden: { $sum: { $cond: [{ $eq: ["$isHidden", true] }, 1, 0] } }
      } }
    ])
  ]);
  const summary = counts[0] || { all: 0, waiting: 0, hidden: 0 };
  return {
    questions: rows.map(adminQuestion),
    filters,
    sorts: ADMIN_SORTS,
    answeredLabels: ANSWERED_LABELS,
    totals: { all: summary.all, waiting: summary.waiting, hidden: summary.hidden, answered: summary.all - summary.waiting - summary.hidden },
    pagination: { page: filters.page, pages: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)), total, limit: ADMIN_PAGE_SIZE }
  };
}

async function findAny(questionId) {
  if (!mongoose.isValidObjectId(questionId)) throw new HttpError(404, "Question not found.");
  const question = await Question.findById(questionId).populate("product", "name slug");
  if (!question) throw new HttpError(404, "Question not found.");
  return question;
}

// Keeps the "answered" flag true only while at least one answer is visible, so hiding the last
// answer puts the question back in the admin's queue.
function syncAnswered(question) {
  question.answered = question.answers.some(answer => !answer.isHidden);
}

// The store's own answer. One per question: answering again edits it, so the team never appears
// twice under the same question.
async function answerAsTeam(admin, questionId, body) {
  const question = await findAny(questionId);
  const existing = question.answers.find(answer => answer.byTeam);
  if (existing) {
    existing.body = body;
    existing.isHidden = false;
    existing.at = new Date();
  } else {
    question.answers.push({ body, user: admin._id, authorName: TEAM_NAME, byTeam: true });
  }
  syncAnswered(question);
  await question.save();
  return { question: adminQuestion(question), edited: Boolean(existing) };
}

// Editing the words of a question, or of any one answer.
async function editText(questionId, { answerId = null, body }) {
  const question = await findAny(questionId);
  if (!answerId) {
    const before = question.body;
    question.body = body;
    await question.save();
    return { question: adminQuestion(question), before };
  }
  const answer = question.answers.id(answerId);
  if (!answer) throw new HttpError(404, "That answer no longer exists.");
  const before = answer.body;
  answer.body = body;
  syncAnswered(question);
  await question.save();
  return { question: adminQuestion(question), before };
}

async function setHidden(questionId, { answerId = null, isHidden }) {
  const question = await findAny(questionId);
  if (!answerId) {
    question.isHidden = isHidden;
  } else {
    const answer = question.answers.id(answerId);
    if (!answer) throw new HttpError(404, "That answer no longer exists.");
    answer.isHidden = isHidden;
  }
  syncAnswered(question);
  await question.save();
  return adminQuestion(question);
}

// Deleting a question removes its answers with it; deleting one answer leaves the question.
async function remove(questionId, answerId = null) {
  const question = await findAny(questionId);
  const snapshot = adminQuestion(question);
  if (!answerId) {
    await question.deleteOne();
    return { question: snapshot, deleted: "question" };
  }
  const answer = question.answers.id(answerId);
  if (!answer) throw new HttpError(404, "That answer no longer exists.");
  answer.deleteOne();
  syncAnswered(question);
  await question.save();
  return { question: adminQuestion(question), deleted: "answer", answer: { id: answerId, body: answer.body, author: answer.authorName } };
}

// The product filter's dropdown: only products that have been asked about.
async function askedProducts() {
  const ids = await Question.distinct("product");
  if (!ids.length) return [];
  return Product.find({ _id: { $in: ids } }).sort({ name: 1 }).select("name").lean();
}

module.exports = {
  PAGE_SIZE,
  ADMIN_PAGE_SIZE,
  TEAM_NAME,
  MAX_OPEN_PER_PRODUCT,
  ANSWERED_LABELS,
  ADMIN_SORTS,
  publicQuestion,
  listForProduct,
  publicList,
  ask,
  answer,
  vote,
  readAdminFilters,
  listForAdmin,
  answerAsTeam,
  editText,
  setHidden,
  remove,
  askedProducts
};
