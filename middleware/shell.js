// My Account and the admin console are calm, fast work areas:
// - the store's motion layer (motion.css, motion.js, the footer wave and any page transitions)
//   is not loaded on them at all (res.locals.motion = false);
// - with the "X-Partial: 1" header (sent by section-nav.js) only the section's content is
//   rendered, without the header, sidebar and footer, so sections switch without a reload.
//   Direct links and refresh send no header and get the full page.
function workArea(req, res, next) {
  res.locals.motion = false;
  res.locals.partial = req.get('X-Partial') === '1';
  // The same URL answers with two shapes, so caches must keep them apart (pages are no-store anyway).
  res.vary('X-Partial');
  next();
}

module.exports = {accountShell: workArea, adminShell: workArea};
