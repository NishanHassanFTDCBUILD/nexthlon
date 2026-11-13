// Per-request defaults for search engines and link previews (D1). Pages can override any of them:
//   canonical  the one address Google should index for this page (no query string by default)
//   noindex    keep the page out of search results (private pages, searches, errors)
//   ogImage, ogType, ogTitle, ogDescription  the link preview on WhatsApp, Instagram, X...
//   jsonLd     a list of schema.org objects (utils/seo.js)
const { siteOrigin, absoluteUrl, isPrivatePage, jsonLdText } = require("../utils/seo");

function seoDefaults(req, res, next) {
  const origin = siteOrigin(req);
  res.locals.siteOrigin = origin;
  res.locals.absoluteUrl = url => absoluteUrl(origin, url);
  res.locals.canonical = `${origin}${req.path}`;
  res.locals.ogType = "website";
  res.locals.ogImage = `${origin}/img/og-default.png`;
  res.locals.ogImageSize = [1200, 630];
  res.locals.jsonLd = [];
  res.locals.seoJson = jsonLdText;
  if (isPrivatePage(req.path)) {
    res.locals.noindex = true;
    res.set("X-Robots-Tag", "noindex, nofollow");
  }
  next();
}

module.exports = { seoDefaults };
