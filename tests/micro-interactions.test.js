// Shopping micro-interactions (C2): the "just saved" address tick, and reduced motion covering every
// animation. No database needed.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (file) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('micro: a saved address is marked with a tick, on the account page and at checkout', () => {
  const app = read('public/js/app.js');
  assert.match(app, /Nx\.markSaved = function markSaved\(card\)/);
  assert.match(app, /card\.classList\.add\('is-just-saved'\)/);
  assert.match(app, /tick\.remove\(\)/, 'the tick goes away on its own');
  // Checkout and the old profile page reload: the id travels in sessionStorage, and checkout selects it.
  const profile = read('public/js/profile.js');
  assert.match(profile, /sessionStorage\.setItem\(SAVED_KEY/);
  assert.match(profile, /radio\.checked = true/);
  assert.match(profile, /Nx\.markSaved\(/);
  // My Account reloads the section in place, then marks the card.
  const account = read('public/js/account.js');
  assert.match(account, /NxNav\.reload\(\)\.then\(\(\) => \{[\s\S]*?mark\(\);/);
  assert.match(
    read('views/pages/profile.ejs'),
    /data-address-id="<%= a\._id %>"/,
  );
});

test('micro: the tick is styled where every page can see it, and only draws itself with motion on', () => {
  const components = read('public/css/components.css');
  assert.match(
    components,
    /\.saved-tick \{\s*position: absolute;/,
    'My Account pages skip motion.css, so the look lives in components.css',
  );
  const motion = read('public/css/motion.css');
  const draw = motion.indexOf('nx-tick-draw');
  const block = motion.lastIndexOf(
    '@media (prefers-reduced-motion: no-preference)',
    draw,
  );
  assert.ok(
    block > 0 && block < draw,
    'the drawing animation is inside the no-preference block',
  );
});

test('micro: reduced motion stops every animation and transition across the site', () => {
  const components = read('public/css/components.css');
  assert.match(
    components,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{\s*animation: none !important;\s*transition: none !important;/,
  );
  // The script-driven ones check it too.
  assert.match(
    read('public/js/store.js'),
    /reducedMotion\.matches/,
    'fly-to-cart',
  );
  assert.match(
    read('public/js/app.js'),
    /reduceMotion\.matches/,
    'rolling numbers and count-ups',
  );
  assert.match(
    read('public/js/confetti.js'),
    /prefers-reduced-motion: reduce/,
    'order confetti',
  );
});
