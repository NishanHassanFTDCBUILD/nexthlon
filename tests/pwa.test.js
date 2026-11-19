// The installable app (E5): a valid manifest with real icons, a service worker that never stores
// private or live data, and an offline page that stands alone. No database needed.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('pwa: the manifest makes the store installable, with every icon it names', async () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.scope, '/');
  assert.match(manifest.start_url, /^\/\?source=app$/);
  assert.ok(
    manifest.name && manifest.short_name.length <= 12,
    'the short name fits under a home-screen icon',
  );
  const pngs = manifest.icons.filter((icon) => icon.type === 'image/png');
  for (const icon of pngs) {
    const file = path.join(root, 'public', icon.src);
    assert.ok(fs.existsSync(file), `${icon.src} exists`);
    const {width, height} = await sharp(file).metadata();
    assert.equal(
      `${width}x${height}`,
      icon.sizes,
      `${icon.src} is really ${icon.sizes}`,
    );
  }
  assert.ok(
    pngs.some((icon) => icon.sizes === '192x192'),
    '192px icon (Android)',
  );
  assert.ok(
    pngs.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'),
    '512px icon (splash screen)',
  );
  assert.ok(
    pngs.some((icon) => icon.purpose === 'maskable'),
    'a maskable icon, so Android does not shrink it into a white circle',
  );
  manifest.shortcuts.forEach((shortcut) =>
    assert.match(shortcut.url, /^\/[a-z]/),
  );
});

test('pwa: every page links the manifest and the iPhone icon', () => {
  const head = read('views/partials/head.ejs');
  assert.match(head, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(
    head,
    /<link rel="apple-touch-icon" href="\/img\/app\/apple-touch-icon\.png">/,
  );
  assert.ok(
    fs.existsSync(path.join(root, 'public/img/app/apple-touch-icon.png')),
  );
  const scripts = read('views/partials/scripts.ejs');
  assert.match(
    scripts,
    /consent === false\)\) \{ %><script src="<%= asset\('\/js\/pwa\.js'\) %>"/,
    'registered on store pages, not admin pages',
  );
});

test('pwa: the service worker never stores private or live data', () => {
  const sw = read('public/sw.js');
  assert.match(
    sw,
    /if \(request\.method !== 'GET'\) return;/,
    'only GET requests',
  );
  assert.match(
    sw,
    /if \(url\.origin !== self\.location\.origin\) return;/,
    'never payments or analytics on other sites',
  );
  assert.match(
    sw,
    /url\.pathname\.startsWith\('\/api\/'\)/,
    'never the API (cart, orders, account)',
  );
  // Pages: fetched fresh every time, and only the offline page is ever stored.
  const navigate = sw.slice(
    sw.indexOf("if (request.mode === 'navigate')"),
    sw.indexOf('// Versioned files'),
  );
  assert.match(navigate, /return await fetch\(request\);/);
  assert.doesNotMatch(
    navigate,
    /cache\.put|caches\.open/,
    'pages are never written to the cache',
  );
  assert.match(
    sw,
    /credentials: 'omit'/,
    'the offline page is fetched signed out',
  );
  assert.match(
    sw,
    /names\s*\.filter\(\(name\) => !name\.startsWith\(VERSION\)\)/,
    'old caches are cleared on update',
  );
  assert.match(read('routes/pageRoutes.js'), /router\.get\('\/offline'/);
});

test('pwa: the offline page stands alone (no scripts, no account, nothing to download)', async () => {
  const html = await ejs.renderFile(
    path.join(root, 'views/pages/offline.ejs'),
    {},
  );
  assert.doesNotMatch(
    html,
    /<script/i,
    'nothing to run, and the security policy allows no inline scripts',
  );
  assert.doesNotMatch(
    html,
    /<link rel="stylesheet"/,
    'its styles are inside it, so it looks right with no connection',
  );
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /href="">Try again</);
  assert.match(
    html,
    /prefers-reduced-motion: no-preference/,
    'the pulse only moves for those who want motion',
  );
});
