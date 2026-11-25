require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const Setting = require('../models/Setting');
const settings = require('../services/siteSettingsService');
const {resolveCountdown} = require('../services/homeService');
const fixedNow = new Date('2026-11-20T10:00:00Z');
let writes;

test.beforeEach(async () => {
  writes = [];
  test.mock.method(Setting, 'updateOne', async (...args) => {
    writes.push(args);
    return {modifiedCount: 1};
  });
  test.mock.method(Setting, 'deleteOne', async () => ({deletedCount: 1}));
  test.mock.method(Date, 'now', () => fixedNow.getTime());
  await settings.reset();
});
test.afterEach(async () => {
  await settings.reset();
  test.mock.restoreAll();
});

test('countdown: saves the admin IST date in UTC and exposes it to the home page', async () => {
  const result = await settings.update('countdown', {
    dealsCountdownMode: 'custom',
    dealsCountdownEndsAt: '2026-11-21T21:30',
  });
  assert.equal(writes.length, 1);
  assert.equal(
    writes[0][1].$set.value.dealsCountdownEndsAt,
    '2026-11-21T16:00:00.000Z',
  );
  const view = resolveCountdown(result.settings, null, fixedNow);
  assert.equal(view.dealCountdownCustom, true);
  assert.equal(view.dealCountdownVisible, true);
  assert.equal(view.dealEndsAt.toISOString(), '2026-11-21T16:00:00.000Z');
});

test('countdown: rejects invalid, past, and excessively distant dates before writing', async () => {
  for (const endsAt of [
    'not a date',
    '2027-02-30T12:00',
    '2026-11-20T12:00',
    '2027-01-31T12:00',
  ]) {
    await assert.rejects(
      settings.update('countdown', {
        dealsCountdownMode: 'custom',
        dealsCountdownEndsAt: endsAt,
      }),
      (error) =>
        error.status === 400 && Boolean(error.fieldErrors.dealsCountdownEndsAt),
    );
  }
  assert.equal(writes.length, 0);
});

test('countdown: unknown modes cannot be saved', async () => {
  await assert.rejects(
    settings.update('countdown', {dealsCountdownMode: 'surprise'}),
    (error) =>
      error.status === 400 && Boolean(error.fieldErrors.dealsCountdownMode),
  );
  assert.equal(writes.length, 0);
});

test('countdown: expired custom deadlines never restart at midnight', () => {
  const view = resolveCountdown(
    {
      dealsCountdownMode: 'custom',
      dealsCountdownEndsAt: '2026-11-19T18:30:00Z',
    },
    null,
    fixedNow,
  );
  assert.equal(view.dealEndsAt.toISOString(), '2026-11-19T18:30:00.000Z');
  assert.equal(Math.max(0, view.dealEndsAt - fixedNow), 0);
});

test('countdown: automatic mode follows live deals, otherwise the next IST midnight', () => {
  assert.equal(
    resolveCountdown(
      {},
      '2026-11-20T11:00:00Z',
      fixedNow,
    ).dealEndsAt.toISOString(),
    '2026-11-20T11:00:00.000Z',
  );
  assert.equal(
    resolveCountdown(
      {},
      '2026-11-19T11:00:00Z',
      fixedNow,
    ).dealEndsAt.toISOString(),
    '2026-11-20T18:30:00.000Z',
  );
});

test('countdown: hiding and restoring automatic mode are persisted', async () => {
  await settings.update('countdown', {
    dealsCountdownMode: 'hidden',
    dealsCountdownEndsAt: '',
  });
  assert.equal(
    resolveCountdown(settings.current(), null, fixedNow).dealCountdownVisible,
    false,
  );
  await settings.update('countdown', {
    dealsCountdownMode: 'auto',
    dealsCountdownEndsAt: '',
  });
  assert.equal(
    resolveCountdown(settings.current(), null, fixedNow).dealCountdownVisible,
    true,
  );
  assert.equal(settings.current().dealsCountdownMode, 'auto');
});
