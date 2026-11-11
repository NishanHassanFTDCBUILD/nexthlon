require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Job = require("../models/Job");
const queue = require("../jobs/queue");
const registry = require("../jobs/registry");
const events = require("../events");
const { createWorker, tickSchedules } = require("../jobs/worker");
const { createBrevoProvider, parseAddress } = require("../providers/mail/brevo");
const { createSmtpProvider } = require("../providers/mail/smtp");

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_jobs`;

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
});
test.beforeEach(() => Job.deleteMany({}));
test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("a job runs once and is marked done", async () => {
  const seen = [];
  registry.register("t.once", payload => { seen.push(payload.n); });
  await queue.enqueue("t.once", { n: 1 });
  assert.equal(await createWorker().drain(), 1);
  assert.deepEqual(seen, [1]);
  assert.equal((await Job.findOne({ type: "t.once" })).status, "done");
  assert.equal(await createWorker().drain(), 0, "nothing left to run");
});

test("the same dedupe key queues one job", async () => {
  const a = await queue.enqueue("t.once", {}, { dedupeKey: "same" });
  const b = await queue.enqueue("t.once", {}, { dedupeKey: "same" });
  assert.equal(String(a._id), String(b._id));
  assert.equal(await Job.countDocuments({ dedupeKey: "same" }), 1);
});

test("a failing job is retried later with a growing wait, then succeeds", async () => {
  let calls = 0;
  registry.register("t.flaky", () => { calls += 1; if (calls < 3) throw new Error("mail server down"); });
  await queue.enqueue("t.flaky");
  const worker = createWorker();
  assert.equal(await worker.drain(), 1);
  let job = await Job.findOne({ type: "t.flaky" });
  assert.equal(job.status, "queued");
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /mail server down/);
  assert.ok(job.runAt > new Date(Date.now() + 20_000), "waits about 30 seconds");
  assert.equal(await worker.drain(), 0, "not due yet");

  await Job.updateOne({ _id: job._id }, { runAt: new Date(Date.now() - 1000) });
  await worker.drain();
  job = await Job.findOne({ type: "t.flaky" });
  assert.equal(job.attempts, 2);
  assert.ok(job.runAt > new Date(Date.now() + 90_000), "the wait grows");

  await Job.updateOne({ _id: job._id }, { runAt: new Date(Date.now() - 1000) });
  await worker.drain();
  assert.equal((await Job.findOne({ type: "t.flaky" })).status, "done");
  assert.equal(calls, 3);
});

test("backoff grows and is capped", () => {
  const fixed = () => 0.5;
  assert.equal(queue.backoffMs(1, fixed), 30_000);
  assert.equal(queue.backoffMs(2, fixed), 120_000);
  assert.equal(queue.backoffMs(3, fixed), 480_000);
  assert.equal(queue.backoffMs(9, fixed), 2 * 60 * 60 * 1000);
});

test("a job that keeps failing gives up after its attempts", async () => {
  registry.register("t.never", () => { throw new Error("nope"); });
  await queue.enqueue("t.never", {}, { maxAttempts: 2 });
  const worker = createWorker();
  await worker.drain();
  await Job.updateOne({ type: "t.never" }, { runAt: new Date(Date.now() - 1000) });
  await worker.drain();
  const job = await Job.findOne({ type: "t.never" });
  assert.equal(job.status, "failed");
  assert.equal(job.attempts, 2);
  assert.equal(await queue.retryFailed({ type: "t.never" }), 1);
  assert.equal((await Job.findOne({ type: "t.never" })).status, "queued");
});

test("a permanent error is not retried; an unknown job type fails at once", async () => {
  registry.register("t.permanent", () => { throw Object.assign(new Error("bad address"), { permanent: true }); });
  await queue.enqueue("t.permanent");
  await queue.enqueue("t.nobody-handles-this");
  await createWorker().drain();
  assert.equal((await Job.findOne({ type: "t.permanent" })).status, "failed");
  const unknown = await Job.findOne({ type: "t.nobody-handles-this" });
  assert.equal(unknown.status, "failed");
  assert.match(unknown.lastError, /No handler/);
});

test("a job left running by a dead worker is taken over after its lease", async () => {
  const seen = [];
  registry.register("t.lease", () => { seen.push(1); });
  const job = await queue.enqueue("t.lease");
  const first = await queue.claim();
  assert.equal(String(first._id), String(job._id));
  assert.equal(await queue.claim(), null, "held by the first worker");
  const later = new Date(Date.now() + queue.LEASE_MS + 1000);
  const second = await queue.claim(later);
  assert.equal(String(second._id), String(job._id));
  assert.equal(second.attempts, 2);
});

test("two workers never claim the same job", async () => {
  for (let i = 0; i < 10; i += 1) await queue.enqueue("t.race", { i });
  const claimed = await Promise.all(Array.from({ length: 20 }, () => queue.claim()));
  const ids = claimed.filter(Boolean).map(job => String(job._id));
  assert.equal(ids.length, 10);
  assert.equal(new Set(ids).size, 10);
});

test("events: one job per listener; the same key is queued once; a listener failing does not break emit", async () => {
  const got = [];
  events.on("t.happened", "a", payload => { got.push(["a", payload.id]); });
  events.on("t.happened", "b", () => { throw new Error("boom"); });
  await events.emit("t.happened", { id: 7 }, { key: "k1" });
  await events.emit("t.happened", { id: 7 }, { key: "k1" });
  assert.equal(await Job.countDocuments({ type: /^event:t\.happened:/ }), 2);
  await createWorker().drain();
  assert.deepEqual(got, [["a", 7]]);
  assert.equal(await events.emit("t.nobody-listens", {}), undefined);
});

test("schedules queue one job per time slot, however many times they are checked", async () => {
  let ran = 0;
  registry.register("t.tick", () => { ran += 1; });
  registry.schedule("t-tick", { everyMs: 60_000, type: "t.tick", enabled: () => true });
  const now = new Date();
  await tickSchedules(now);
  await tickSchedules(now);
  await tickSchedules(new Date(now.getTime() + 1000));
  const queued = await Job.countDocuments({ type: "t.tick", status: "queued" });
  assert.ok(queued >= 1 && queued <= 2);
  await Job.deleteMany({});
});

// ---------- mail providers ----------

test("parseAddress reads 'Name <email>' and a bare email", () => {
  assert.deepEqual(parseAddress("Nexthlon <orders@nexthlon.in>"), { name: "Nexthlon", email: "orders@nexthlon.in" });
  assert.deepEqual(parseAddress("a@b.co"), { email: "a@b.co" });
});

test("Brevo: sends the right request and returns the message id", async () => {
  let seen;
  const provider = createBrevoProvider({ apiKey: "key-123" }, {
    fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true, status: 201, json: async () => ({ messageId: "<abc@brevo>" }) }; }
  });
  const result = await provider.send({ from: "Nexthlon <orders@nexthlon.in>", to: "asha@example.com", subject: "Hi", text: "t", html: "<p>h</p>", headers: { "List-Unsubscribe": "<https://x>" } });
  assert.equal(result.id, "<abc@brevo>");
  assert.equal(seen.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(seen.init.headers["api-key"], "key-123");
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body.sender, { name: "Nexthlon", email: "orders@nexthlon.in" });
  assert.deepEqual(body.to, [{ email: "asha@example.com" }]);
  assert.equal(body.subject, "Hi");
  assert.equal(body.htmlContent, "<p>h</p>");
  assert.equal(body.headers["List-Unsubscribe"], "<https://x>");
});

test("Brevo: 4xx is permanent (except 429), 5xx and network errors are retried, and the key never shows in errors", async () => {
  const make = response => createBrevoProvider({ apiKey: "secret-key" }, { fetchImpl: async () => { if (response instanceof Error) throw response; return response; } });
  const args = { from: "a <a@b.co>", to: "c@d.co", subject: "s", text: "t", html: "h" };
  await assert.rejects(make({ ok: false, status: 400 }).send(args), error => error.permanent === true);
  await assert.rejects(make({ ok: false, status: 401 }).send(args), error => error.permanent === true);
  await assert.rejects(make({ ok: false, status: 429 }).send(args), error => error.permanent === false);
  await assert.rejects(make({ ok: false, status: 503 }).send(args), error => error.permanent === false);
  await assert.rejects(make(new Error("socket hang up")).send(args), error => !error.permanent && !/secret-key/.test(error.message));
});

test("SMTP: passes the message to the transport; 5xx replies are permanent, others retried", async () => {
  let sent;
  const ok = createSmtpProvider({}, { transport: { sendMail: async message => { sent = message; return { messageId: "<m1>" }; } } });
  assert.equal((await ok.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t", html: "h", headers: { X: "1" } })).id, "<m1>");
  assert.equal(sent.subject, "s");
  const rejects = code => createSmtpProvider({}, { transport: { sendMail: async () => { throw Object.assign(new Error("x"), { responseCode: code }); } } });
  await assert.rejects(rejects(550).send({}), error => error.permanent === true);
  await assert.rejects(rejects(451).send({}), error => error.permanent === false);
});
