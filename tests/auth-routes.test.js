// The pages call these addresses, and Google sends people back to the callback, so each must reach a real route
// (a missing one answers "No API route"; Google's own routes answer an empty 404 while it is switched off).
// Regression: they were once mounted without the /auth part.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const app = require('../app');

let server;
let base;

test.before(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
});

for (const path of ['/api/auth/google', '/api/auth/google/callback']) {
  test(`auth routes: GET ${path} exists`, async () => {
    const res = await fetch(base + path, {redirect: 'manual'});
    assert.doesNotMatch(await res.text(), /No API route/);
  });
}
