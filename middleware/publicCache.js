const config = require("../config/env");
const { KINDS } = require("../services/tokenService");

// Lets a CDN (Cloudflare) keep a page for signed-out visitors for a short time, so a rush of visitors is
// served from the CDN instead of this server. Browsers still ask every time (max-age=0); only shared
// caches keep it (s-maxage), and may serve a slightly old copy while fetching a new one.
//
// Only for requests that carry no sign-in at all: no session cookie of either kind and no Bearer token.
// Every other reply keeps "private, no-store" (middleware/noCache.js), so a page with someone's name on it
// can never be stored. A signed-out page is the same for everyone (the guest cart badge is filled in by
// store.js after the page loads), so a stored copy is right for every other signed-out visitor.
// The CDN must also be told to cache only requests without these cookies: docs/SCALING.md.
const SIGNED_IN_COOKIES = Object.values(KINDS).flatMap(kind => [kind.cookie, kind.sessionCookie]);

function isSignedOut(req) {
  if ((req.get("authorization") || "").startsWith("Bearer ")) return false;
  const cookies = req.cookies || {};
  return !SIGNED_IN_COOKIES.some(name => cookies[name]);
}

function publicCache(req, res, next) {
  const seconds = config.publicCacheSeconds;
  if (!seconds || req.method !== "GET" || req.user || !isSignedOut(req)) return next();
  // Search results are counted for "Trending searches" (searchInsightService), so they must reach the
  // server; they are rarely asked for twice in the same words anyway.
  if (typeof req.query.q === "string" && req.query.q.trim()) return next();
  res.set("Cache-Control", `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`);
  res.removeHeader("Pragma");
  res.removeHeader("Expires");
  // A shared cache must keep separate copies for signed-in and signed-out visitors.
  res.vary("Cookie");
  return next();
}

module.exports = { publicCache, isSignedOut, SIGNED_IN_COOKIES };
