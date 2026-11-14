// The content hub (E7): reader pages (public, cacheable) and the team's API (mounted in admin routes).
const router = require("express").Router();
const pages = require("../controllers/guidePageController");
const { publicCache } = require("../middleware/publicCache");

router.get("/guides", publicCache, pages.hub);
router.get("/guides/:slug", publicCache, pages.guide);

module.exports = router;
