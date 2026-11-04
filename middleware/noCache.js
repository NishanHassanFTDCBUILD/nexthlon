// Pages and API replies can show signed-in data, so the browser must never keep a copy.
// Without this, pressing Back after signing out shows the cached dashboard or profile.
function noCache(req, res, next) {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private, max-age=0",
    Pragma: "no-cache",
    Expires: "0"
  });
  next();
}

module.exports = { noCache };
