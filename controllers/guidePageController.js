const guideService = require("../services/guideService");
const { asyncHandler } = require("../utils/http");

const hub = asyncHandler(async (req, res) => {
  const data = await guideService.list(req.query.page, req.query.tag);
  res.render("pages/guides", { title: "Sport guides and stories | Nexthlon", metaDescription: "Training tips, gear guides and athlete stories from the Nexthlon team.", ...data, tag: req.query.tag || "" });
});
const guide = asyncHandler(async (req, res) => {
  const item = await guideService.bySlug(req.params.slug);
  res.render("pages/guide", { title: `${item.title} | Nexthlon`, metaDescription: item.summary || item.title, guide: item, blocks: guideService.blocks(item) });
});

module.exports = { hub, guide };
