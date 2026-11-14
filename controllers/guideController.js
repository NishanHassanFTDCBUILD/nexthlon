const guideService = require("../services/guideService");
const { asyncHandler, HttpError } = require("../utils/http");

// Admin: POST /api/admin/guides { title, slug?, summary, body: [paragraphs], tag, image }
const createGuide = asyncHandler(async (req, res) => {
  const body = req.body || {};
  const paragraphs = Array.isArray(body.body) ? body.body.map(text => String(text || "").slice(0, 4000)).filter(Boolean) : [];
  if (!String(body.title || "").trim() || !paragraphs.length) throw new HttpError(400, "A guide needs a title and at least one paragraph.", { title: "Give it a title." });
  const guide = await guideService.create({ title: String(body.title).trim(), summary: String(body.summary || "").trim(), body: paragraphs, tag: String(body.tag || "").trim(), image: String(body.image || "").trim(), slug: body.slug });
  res.status(201).json({ message: "Guide saved as a draft. Publish it when it is ready.", guide: { slug: guide.slug } });
});
const publishGuide = asyncHandler(async (req, res) => {
  const guide = await guideService.setPublished(String(req.params.slug || "").toLowerCase(), req.body && req.body.published === true);
  res.json({ message: guide.isPublished ? "Guide published." : "Guide hidden.", guide: { slug: guide.slug, isPublished: guide.isPublished } });
});

module.exports = { createGuide, publishGuide };
