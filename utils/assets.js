// Versioned URLs for the site's own CSS and JS: "/css/style.css" becomes "/css/style.css?v=3f9a1c02be".
// The version is a short hash of the file's contents, so it only changes when the file does. Browsers
// can then keep these files for a year (app.js marks them immutable) and still get every update the
// moment it ships, because the page asks for a new URL.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const isProduction = process.env.NODE_ENV === 'production';
const cache = new Map();

function assetUrl(urlPath) {
  const file = path.join(PUBLIC_DIR, urlPath);
  // Only files inside public/; anything else is returned as given.
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return urlPath;
  const known = cache.get(file);
  // In production files never change while the server runs, so the first hash is kept.
  if (known && isProduction) return known.url;
  try {
    const {mtimeMs} = fs.statSync(file);
    if (known && known.mtimeMs === mtimeMs) return known.url;
    const hash = crypto
      .createHash('sha1')
      .update(fs.readFileSync(file))
      .digest('hex')
      .slice(0, 10);
    const url = `${urlPath}?v=${hash}`;
    cache.set(file, {mtimeMs, url});
    return url;
  } catch {
    return urlPath;
  }
}

// ---------- Stylesheet bundles ----------
// A page needs five to seven stylesheets. On a phone each one is a separate request that holds back
// the first paint, so head.ejs asks for them as one file instead:
//   /css/bundle.css?files=tokens,components,style,motion,mobile&v=<hash>
// The server joins the files in that order (so the cascade is exactly the same) and the hash makes
// the URL change whenever any of them does. The list is in the URL, so any server can build it.
const NAME = /^[a-z0-9-]+$/;
const bundles = new Map();

// A safe minifier: the stylesheets are a third comments and indentation. It drops comments and collapses
// runs of whitespace (around braces and semicolons entirely) and touches nothing else, so selectors, calc()
// and strings mean exactly what they did. The file markers between stylesheets stay for debugging.
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};])\s*/g, '$1')
    .trim();
}

function readBundle(names) {
  const key = names.join(',');
  const files = names.map((name) =>
    path.join(PUBLIC_DIR, 'css', `${name}.css`),
  );
  const stamp = files.map((file) => fs.statSync(file).mtimeMs).join(',');
  const known = bundles.get(key);
  if (known && (isProduction || known.stamp === stamp)) return known;
  const css = files
    .map(
      (file, i) =>
        `/* ---- ${names[i]}.css ---- */\n${minifyCss(fs.readFileSync(file, 'utf8'))}`,
    )
    .join('\n');
  const hash = crypto.createHash('sha1').update(css).digest('hex').slice(0, 10);
  const bundle = {
    css,
    hash,
    stamp,
    url: `/css/bundle.css?files=${key}&v=${hash}`,
  };
  // The site uses a dozen or so combinations; a cap stops made-up lists from filling memory.
  if (bundles.has(key) || bundles.size < 64) bundles.set(key, bundle);
  return bundle;
}

// For templates: the URL of one bundle holding these stylesheets, in this order.
function styleBundleUrl(names) {
  try {
    return readBundle(names).url;
  } catch {
    return `/css/${names[0]}.css`;
  }
}

// GET /css/bundle.css?files=a,b,c&v=hash
function serveStyleBundle(req, res, next) {
  const names = String(req.query.files || '')
    .split(',')
    .filter(Boolean);
  if (
    !names.length ||
    names.length > 12 ||
    new Set(names).size !== names.length ||
    !names.every((name) => NAME.test(name))
  )
    return next();
  let bundle;
  try {
    bundle = readBundle(names);
  } catch {
    return next();
  }
  res.type('text/css');
  // A matching hash is the exact content: keep it for a year. Anything else is re-checked.
  res.set(
    'Cache-Control',
    req.query.v === bundle.hash
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  );
  res.send(bundle.css);
}

module.exports = {assetUrl, styleBundleUrl, serveStyleBundle};
