// My Account pages are calm and fast: the store's motion layer (motion.css, motion.js, the footer
// wave and any page transitions) is not loaded on them at all. The templates read res.locals.motion.
function accountShell(req, res, next) {
  res.locals.motion = false;
  next();
}

module.exports = { accountShell };
