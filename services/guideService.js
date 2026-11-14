// The content hub (E7): published guides for readers, and create/publish for the team.
const Guide = require("../models/Guide");
const { slugify } = require("./bundleService");
const { HttpError } = require("../utils/http");

const PAGE_SIZE = 12;

async function list(page = 1, tag = "") {
  const current = Math.max(1, Number.parseInt(page, 10) || 1);
  const filter = { isPublished: true, ...(tag ? { tag: String(tag).slice(0, 40) } : {}) };
  const [rows, total] = await Promise.all([
    Guide.find(filter).sort({ publishedAt: -1 }).skip((current - 1) * PAGE_SIZE).limit(PAGE_SIZE).select("title slug summary tag image publishedAt").lean(),
    Guide.countDocuments(filter)
  ]);
  return { guides: rows, pagination: { page: current, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), total } };
}

async function bySlug(slug) {
  const guide = await Guide.findOne({ slug: String(slug || "").toLowerCase(), isPublished: true }).lean();
  if (!guide) throw new HttpError(404, "That guide is not here (yet).");
  return guide;
}

async function create(value) {
  const slug = value.slug ? slugify(value.slug) : slugify(value.title);
  return Guide.create({ ...value, slug });
}

async function setPublished(slug, published) {
  const guide = await Guide.findOneAndUpdate({ slug }, { $set: { isPublished: Boolean(published), publishedAt: published ? new Date() : null } }, { new: true }).lean();
  if (!guide) throw new HttpError(404, "Guide not found.");
  return guide;
}

// Paragraphs to HTML-safe blocks: "## " starts a heading; everything else is a paragraph.
function blocks(guide) {
  return (guide.body || []).map(text => (text.startsWith("## ") ? { heading: true, text: text.slice(3) } : { heading: false, text }));
}

module.exports = { PAGE_SIZE, list, bySlug, create, setPublished, blocks };
