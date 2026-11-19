// Meta Pixel: only a numeric id, loaded only after consent, and its hosts only when set.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {readMetaPixel, metaHosts} = require('../utils/analytics');

test('meta pixel: only a real numeric id turns it on', () => {
  assert.deepEqual(readMetaPixel({}), {enabled: false, id: ''});
  assert.deepEqual(readMetaPixel({META_PIXEL_ID: '123456789012345'}), {
    enabled: true,
    id: '123456789012345',
  });
  assert.equal(
    readMetaPixel({META_PIXEL_ID: '<script>'}).enabled,
    false,
    'never injected as text',
  );
  assert.equal(readMetaPixel({META_PIXEL_ID: '12'}).enabled, false);
});

test("meta pixel: the policy only lets Facebook's hosts in when it is on", () => {
  assert.deepEqual(metaHosts({enabled: false}), {
    script: [],
    connect: [],
    img: [],
  });
  assert.ok(
    metaHosts({enabled: true, id: '1234567890'}).script.includes(
      'https://connect.facebook.net',
    ),
  );
});

test("meta pixel: nothing loads before consent (only the consent script's allow path loads it)", () => {
  const consent = fs.readFileSync(
    path.join(__dirname, '../public/js/consent.js'),
    'utf8',
  );
  assert.match(consent, /function loadMetaPixel\(\)/);
  const loadFn = consent.slice(
    consent.indexOf('function load()'),
    consent.indexOf('function load()') + 120,
  );
  assert.match(loadFn, /loadMetaPixel\(\);/);
  assert.match(consent, /if \(value === 'analytics'\) \{\s*load\(\);/);
});
