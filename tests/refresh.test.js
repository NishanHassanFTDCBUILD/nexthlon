// Access token + refresh token, end to end against a real MongoDB test database.
// They only run when TEST_MONGODB_URI is set, and refuse any database whose name lacks "test".
//   PowerShell:  $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/nexthlon_test"; npm test
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");

if (!process.env.TEST_MONGODB_URI) {
  test("refresh token tests (set TEST_MONGODB_URI to run them)", { skip: true }, () => {});
  return;
}

const mongoose = require("mongoose");
const app = require("../app");
const User = require("../models/User");
const RefreshToken = require("../models/RefreshToken");
const AuditLog = require("../models/AuditLog");
const { hashPassword } = require("../services/authService");
const refreshTokenService = require("../services/refreshTokenService");

const REFRESH_PATH = "/api/auth/refresh";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36";

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, "")}_refresh`;

let server;
let base;

// A tiny cookie jar that respects each cookie's path, exactly as a browser does. That is what
// makes these tests meaningful: the refresh cookie must NOT reach ordinary requests.
function newJar() {
  return new Map();
}

function readCookies(jar, response) {
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(";");
    const index = pair.indexOf("=");
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1);
    const path = (attrs.find(a => /^\s*path=/i.test(a)) || "=/").split("=")[1].trim();
    if (value === "") jar.delete(name);
    else jar.set(name, { value, path });
  }
}

// Only the cookies whose path covers this URL, joined the way a browser would send them.
function cookieHeader(jar, path) {
  return [...jar.entries()]
    .filter(([, cookie]) => path === cookie.path || path.startsWith(cookie.path === "/" ? "/" : `${cookie.path}/`))
    .map(([name, cookie]) => `${name}=${cookie.value}`)
    .join("; ");
}

async function call(method, path, { body, jar, cookie, origin = true } = {}) {
  const headers = { Accept: "text/html,application/json", "User-Agent": UA };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin) headers.Origin = base;
  const sending = cookie !== undefined ? cookie : jar ? cookieHeader(jar, path) : "";
  if (sending) headers.Cookie = sending;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: "manual",
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (jar) readCookies(jar, response);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("json") ? await response.json() : await response.text();
  return { status: response.status, data, sentCookie: sending, location: response.headers.get("location") };
}

const signIn = async (jar, email, password) => call("POST", "/api/login", { body: { email, password }, jar });
const renew = (jar, body) => call("POST", REFRESH_PATH, { body: body || {}, jar });
const refreshValue = jar => (jar.get("nx_refresh") || {}).value || "";
const tokenRow = raw => RefreshToken.findOne({ tokenHash: refreshTokenService.hashToken(raw) });
// Makes a rotation look older than the grace window, without waiting for it.
const ageRotation = raw => RefreshToken.updateOne(
  { tokenHash: refreshTokenService.hashToken(raw) },
  { $set: { revokedAt: new Date(Date.now() - refreshTokenService.REUSE_GRACE_MS - 5000) } }
);

const asha = { email: "asha@refresh.test", password: "trail2024" };
const ravi = { email: "ravi@refresh.test", password: "trail2024" };

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname)) throw new Error("The test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(model => model.syncIndexes()));
  await User.create([
    { name: "Asha Nair", email: asha.email, passwordHash: await hashPassword(asha.password), role: "customer" },
    { name: "Ravi Menon", email: ravi.email, passwordHash: await hashPassword(ravi.password), role: "customer" },
    { name: "Store Admin", email: "admin@refresh.test", passwordHash: await hashPassword("AdminPass123"), role: "admin" }
  ]);
  server = app.listen(0);
  await new Promise(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise(resolve => server.close(resolve));
});

test("signing in gives an access token and a refresh token, in separate cookies", async () => {
  const jar = newJar();
  const login = await signIn(jar, asha.email, asha.password);
  assert.equal(login.status, 200);

  // Three cookies: the short access JWT, the long refresh token, and the session label.
  assert.equal(jar.get("nx_token").path, "/");
  assert.equal(jar.get("nx_refresh").path, REFRESH_PATH);
  assert.equal(jar.get("nx_sid").path, "/");

  // One row per signed-in device, and the raw token is nowhere in it: only its hash.
  const rows = await RefreshToken.find({ role: "customer" }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].revoked, false);
  assert.equal(rows[0].device, "Chrome on Windows");
  assert.equal(rows[0].familyId, jar.get("nx_sid").value);
  assert.notEqual(rows[0].tokenHash, refreshValue(jar));
  assert.equal(rows[0].tokenHash, refreshTokenService.hashToken(refreshValue(jar)));
  // Nothing anywhere in the row contains the token itself.
  assert.ok(!JSON.stringify(rows[0]).includes(refreshValue(jar)));
});

test("the refresh cookie is sent only to the renewal endpoint", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);

  const ordinary = await call("GET", "/api/me", { jar });
  assert.equal(ordinary.status, 200);
  assert.ok(ordinary.sentCookie.includes("nx_token="));
  assert.ok(!ordinary.sentCookie.includes("nx_refresh="), "the long-lived token must stay off ordinary requests");

  const renewal = await renew(jar);
  assert.equal(renewal.status, 200);
  assert.ok(renewal.sentCookie.includes("nx_refresh="));
});

test("renewing rotates: a new refresh token is issued and the old one is revoked", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const first = refreshValue(jar);
  const family = jar.get("nx_sid").value;

  const renewal = await renew(jar);
  assert.equal(renewal.status, 200);
  assert.equal(renewal.data.user.email, asha.email);
  // A brand new access token, and a brand new refresh token.
  assert.ok(renewal.data.token);
  const second = refreshValue(jar);
  assert.notEqual(second, first);

  const [old, fresh] = await Promise.all([
    RefreshToken.findOne({ tokenHash: refreshTokenService.hashToken(first) }).lean(),
    RefreshToken.findOne({ tokenHash: refreshTokenService.hashToken(second) }).lean()
  ]);
  assert.equal(old.revoked, true);
  assert.equal(old.revokedReason, "rotated");
  assert.equal(String(old.replacedBy), String(fresh._id));
  assert.equal(fresh.revoked, false);
  // Both belong to the same sign-in, so the session label never changes under the customer.
  assert.equal(fresh.familyId, family);
  assert.equal(jar.get("nx_sid").value, family);

  // The renewed access token works on an ordinary request.
  assert.equal((await call("GET", "/api/me", { jar })).status, 200);
});

test("without an access token a request is refused, and renewing gets a working one back", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);

  // What the browser sees once the 15 minutes are up: the access cookie is gone.
  jar.delete("nx_token");
  assert.equal((await call("GET", "/api/me", { jar })).status, 401);

  // This is the 401 -> renew -> retry path that Nx.api walks through in public/js/app.js.
  assert.equal((await renew(jar)).status, 200);
  assert.ok(jar.get("nx_token").value);
  assert.equal((await call("GET", "/api/me", { jar })).status, 200);
});

test("reusing an old refresh token revokes the whole family (stolen-token detection)", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const stolen = refreshValue(jar);
  await renew(jar);
  const current = refreshValue(jar);
  const family = jar.get("nx_sid").value;

  // The thief's copy comes back well after the real browser has rotated (past the grace window).
  await ageRotation(stolen);
  const reuse = await call("POST", REFRESH_PATH, { body: { refreshToken: stolen } });
  assert.equal(reuse.status, 401);
  assert.match(reuse.data.message, /signed you out everywhere/i);

  // The real browser's own token is dead too: that is the point of killing the family.
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: current } })).status, 401);
  const rows = await RefreshToken.find({ familyId: family }).lean();
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(row => row.revoked));
  assert.ok(rows.some(row => row.revokedReason === "reuse"));
  assert.ok(await AuditLog.exists({ action: "auth.refresh_reuse" }));
});

test("renewing needs a real token, and the cookies are cleared when it fails", async () => {
  assert.equal((await call("POST", REFRESH_PATH, { body: {} })).status, 401);
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: "not-a-real-token" } })).status, 401);

  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  jar.set("nx_refresh", { value: refreshTokenService.newToken(), path: REFRESH_PATH });
  const failed = await renew(jar);
  assert.equal(failed.status, 401);
  // All three cookies are wiped, so the browser stops pretending to be signed in.
  assert.equal(jar.has("nx_token"), false);
  assert.equal(jar.has("nx_refresh"), false);
  assert.equal(jar.has("nx_sid"), false);
});

test("a store refresh token can never renew the admin console, or the other way round", async () => {
  const shopper = newJar();
  await signIn(shopper, asha.email, asha.password);
  const customerToken = refreshValue(shopper);

  const asAdmin = await call("POST", REFRESH_PATH, { body: { refreshToken: customerToken, scope: "admin" } });
  assert.equal(asAdmin.status, 401);

  const console_ = newJar();
  const adminLogin = await call("POST", "/api/admin/login", { body: { email: "admin@refresh.test", password: "AdminPass123" }, jar: console_ });
  assert.equal(adminLogin.status, 200);
  assert.equal(console_.get("nx_admin_refresh").path, REFRESH_PATH);
  const adminToken = console_.get("nx_admin_refresh").value;

  // The admin session renews only when the request says it is the admin one.
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: adminToken } })).status, 401);
  const renewed = await call("POST", REFRESH_PATH, { body: { refreshToken: adminToken, scope: "admin" }, jar: console_ });
  assert.equal(renewed.status, 200);
  assert.equal(renewed.data.user.role, "admin");
  // A caller that sent the token in the body gets the new one back the same way.
  assert.match(renewed.data.refreshToken, /^[a-f0-9]{64}$/);
});

test("logging out revokes that device's refresh token", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const token = refreshValue(jar);

  // The browser does not send the refresh cookie here (wrong path), so logout works from the
  // session label it does send. Note what the request actually carried:
  const out = await call("POST", "/api/logout", { jar });
  assert.equal(out.status, 200);
  assert.ok(out.sentCookie.includes("nx_sid="));
  assert.ok(!out.sentCookie.includes("nx_refresh="));
  assert.equal(jar.has("nx_token"), false);
  assert.equal(jar.has("nx_refresh"), false);
  assert.equal(jar.has("nx_sid"), false);

  // Even with a saved copy of the token, the session cannot come back.
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: token } })).status, 401);
  const row = await RefreshToken.findOne({ tokenHash: refreshTokenService.hashToken(token) }).lean();
  assert.equal(row.revoked, true);
  assert.equal(row.revokedReason, "logout");
});

test("changing the password signs out every other device, and keeps this one", async () => {
  const phone = newJar();
  const laptop = newJar();
  await signIn(phone, ravi.email, ravi.password);
  await signIn(laptop, ravi.email, ravi.password);

  const changed = await call("PATCH", "/api/profile/password", {
    body: { currentPassword: ravi.password, newPassword: "summit2025", confirmPassword: "summit2025" },
    jar: laptop
  });
  assert.equal(changed.status, 200);
  ravi.password = "summit2025";

  // The phone's access token is dead (tokenVersion) and it cannot renew either.
  assert.equal((await call("GET", "/api/me", { jar: phone })).status, 401);
  assert.equal((await renew(phone)).status, 401);

  // The laptop was handed a whole new pair, so it carries on.
  assert.equal((await call("GET", "/api/me", { jar: laptop })).status, 200);
  assert.equal((await renew(laptop)).status, 200);
});

test("blocking a customer stops them renewing", async () => {
  const jar = newJar();
  await signIn(jar, ravi.email, ravi.password);

  const adminJar = newJar();
  await call("POST", "/api/admin/login", { body: { email: "admin@refresh.test", password: "AdminPass123" }, jar: adminJar });
  const ravisId = String((await User.findOne({ email: ravi.email }).lean())._id);
  const blocked = await call("PATCH", `/api/admin/customers/${ravisId}/block`, { body: { isBlocked: true }, jar: adminJar });
  assert.equal(blocked.status, 200);

  assert.equal((await call("GET", "/api/me", { jar })).status, 403);
  assert.equal((await renew(jar)).status, 401);

  await call("PATCH", `/api/admin/customers/${ravisId}/block`, { body: { isBlocked: false }, jar: adminJar });
});

test("logged-in devices: list them, log one out, and log them all out", async () => {
  await RefreshToken.deleteMany({});
  const phone = newJar();
  const laptop = newJar();
  await signIn(phone, asha.email, asha.password);
  await signIn(laptop, asha.email, asha.password);

  const list = await call("GET", "/api/account/sessions", { jar: laptop });
  assert.equal(list.status, 200);
  assert.equal(list.data.sessions.length, 2);
  // Exactly one row is this browser, found from the nx_sid label, not from the token.
  assert.equal(list.data.sessions.filter(s => s.current).length, 1);
  assert.ok(list.data.sessions.every(s => s.device === "Chrome on Windows" && s.id));

  // Log out the other device from here.
  const other = list.data.sessions.find(s => !s.current);
  const gone = await call("DELETE", `/api/account/sessions/${other.id}`, { jar: laptop });
  assert.equal(gone.status, 200);
  assert.equal(gone.data.current, false);
  assert.equal(gone.data.sessions.length, 1);
  // That device can no longer renew, and its own access token dies with the next 15 minutes.
  assert.equal((await renew(phone)).status, 401);

  // Logging out the device you are on ends this session too.
  const self = gone.data.sessions[0];
  const here = await call("DELETE", `/api/account/sessions/${self.id}`, { jar: laptop });
  assert.equal(here.data.current, true);
  assert.equal(laptop.has("nx_token"), false);
  assert.equal(await RefreshToken.countDocuments({ user: self.id, revoked: false }), 0);

  // "Log out of all devices" clears the lot in one go.
  const again = newJar();
  await signIn(again, asha.email, asha.password);
  assert.equal((await call("POST", "/api/account/logout-all", { jar: again })).status, 200);
  const ashaId = (await User.findOne({ email: asha.email }).lean())._id;
  assert.equal(await RefreshToken.countDocuments({ user: ashaId, revoked: false }), 0);
  assert.equal((await renew(again)).status, 401);
});

test("one customer can never end another customer's session", async () => {
  const mine = newJar();
  const theirs = newJar();
  await signIn(mine, asha.email, asha.password);
  await signIn(theirs, ravi.email, ravi.password);

  const theirSessions = await call("GET", "/api/account/sessions", { jar: theirs });
  const victim = theirSessions.data.sessions[0].id;
  const attempt = await call("DELETE", `/api/account/sessions/${victim}`, { jar: mine });
  assert.equal(attempt.status, 404);
  // A made-up id is refused the same way, never a server error.
  assert.equal((await call("DELETE", "/api/account/sessions/not-an-id", { jar: mine })).status, 404);
  // Their session is untouched.
  assert.equal((await call("GET", "/api/account/sessions", { jar: theirs })).data.sessions.length, 1);
});

test("the security page lists the logged-in devices", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const page = await call("GET", "/account/security", { jar });
  assert.equal(page.status, 200);
  assert.match(page.data, /Logged-in devices/);
  assert.match(page.data, /This device/);
  assert.match(page.data, /Log out this device/);
  // The page never contains the refresh token itself.
  assert.ok(!page.data.includes(refreshValue(jar)));
});

// A plain page load cannot renew by itself (the refresh cookie is only sent to the renewal
// endpoint), so the server points the browser at the login page with reason=expired, and the
// page script renews there and returns. These two tests check that signpost.
test("an expired page load is told the session can be renewed; a guest is not", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  jar.delete("nx_token");

  const expired = await call("GET", "/account/security", { jar });
  assert.equal(expired.status, 302);
  assert.equal(expired.location, "/login?next=%2Faccount%2Fsecurity&reason=expired");

  // Someone who was never signed in has nothing to renew, so no reason is given.
  const guest = await call("GET", "/account/security", { cookie: "" });
  assert.equal(guest.location, "/login?next=%2Faccount%2Fsecurity");
});

test("an expired admin session reaches the console login; a stranger still gets a plain 404", async () => {
  const jar = newJar();
  await call("POST", "/api/admin/login", { body: { email: "admin@refresh.test", password: "AdminPass123" }, jar });
  assert.equal((await call("GET", "/admin/dashboard", { jar })).status, 200);

  jar.delete("nx_admin");
  const expired = await call("GET", "/admin/dashboard", { jar });
  assert.equal(expired.status, 302);
  assert.equal(expired.location, "/admin/login?next=%2Fadmin%2Fdashboard&reason=expired");

  // The console's address is still never given away to anyone who was not signed in to it.
  assert.equal((await call("GET", "/admin/dashboard", { cookie: "" })).status, 404);
  const shopper = newJar();
  await signIn(shopper, asha.email, asha.password);
  assert.equal((await call("GET", "/admin/dashboard", { jar: shopper })).status, 404);
});

test("renewing is still blocked from another website (CSRF)", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const crossSite = await call("POST", REFRESH_PATH, { body: {}, jar, origin: false });
  assert.equal(crossSite.status, 403);
});

// ---------- Two tabs renewing at once ----------

test("renewals from several tabs at the same instant: one wins, nobody is signed out", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const original = refreshValue(jar);
  const family = jar.get("nx_sid").value;

  // Six tabs, all holding the same refresh cookie, all renewing together.
  const tabs = Array.from({ length: 6 }, () => new Map(jar));
  const replies = await Promise.all(tabs.map(tab => renew(tab)));

  assert.ok(replies.every(reply => reply.status === 200), "every tab gets a working session");
  const winners = replies.filter(reply => !reply.data.concurrent);
  assert.equal(winners.length, 1, "exactly one renewal rotates the token");
  assert.equal(replies.filter(reply => reply.data.concurrent === true).length, 5);
  assert.ok(replies.every(reply => reply.data.token), "each one has a fresh access token");

  // One new refresh token, not six: the family holds the original and a single replacement.
  const rows = await RefreshToken.find({ familyId: family }).lean();
  assert.equal(rows.length, 2);
  assert.equal(rows.filter(row => !row.revoked).length, 1);
  assert.ok(!(await AuditLog.exists({ action: "auth.refresh_reuse", "after.familyId": family })), "no theft alarm");

  // The winning tab's new refresh token is the live one, and it keeps working.
  const winnerTab = tabs[replies.indexOf(winners[0])];
  assert.notEqual(refreshValue(winnerTab), original);
  assert.equal((await renew(winnerTab)).status, 200);
  // The tabs that lost never received a refresh cookie of their own to overwrite the winner's.
  const loserTab = tabs[replies.findIndex(reply => reply.data.concurrent)];
  assert.equal(refreshValue(loserTab), original);
});

test("a token replaced a moment ago gets an access token only, and the session carries on", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const first = refreshValue(jar);
  assert.equal((await renew(jar)).status, 200);
  const second = refreshValue(jar);

  // The slower tab arrives with the old cookie.
  const late = await call("POST", REFRESH_PATH, { body: { refreshToken: first } });
  assert.equal(late.status, 200);
  assert.equal(late.data.concurrent, true);
  assert.ok(late.data.token);
  assert.equal(late.data.refreshToken, undefined, "a replaced token never earns a new refresh token");

  // Nothing was revoked by it, and the browser's current token still renews.
  assert.equal((await tokenRow(second)).revoked, false);
  assert.equal((await renew(jar)).status, 200);
});

test("the grace window ends: replaying a replaced token later still revokes the whole family", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const family = jar.get("nx_sid").value;
  const first = refreshValue(jar);
  await renew(jar);
  await ageRotation(first);

  const replay = await call("POST", REFRESH_PATH, { body: { refreshToken: first } });
  assert.equal(replay.status, 401);
  assert.match(replay.data.message, /signed you out everywhere/i);
  assert.ok((await RefreshToken.find({ familyId: family }).lean()).every(row => row.revoked));
});

test("the grace window never helps after a sign-out, a block, or in the other session", async () => {
  // Signed out in between: the replacement was revoked for another reason, so nothing renews.
  const out = newJar();
  await signIn(out, asha.email, asha.password);
  const outFirst = refreshValue(out);
  await renew(out);
  await call("POST", "/api/logout", { jar: out });
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: outFirst } })).status, 401);

  // Blocked in between.
  const blocked = newJar();
  await signIn(blocked, ravi.email, ravi.password);
  const blockedFirst = refreshValue(blocked);
  await renew(blocked);
  await User.updateOne({ email: ravi.email }, { isBlocked: true });
  try {
    assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: blockedFirst } })).status, 401);
  } finally {
    await User.updateOne({ email: ravi.email }, { isBlocked: false });
  }

  // A store token replayed against the admin console is not a "concurrent renewal" either.
  const shop = newJar();
  await signIn(shop, asha.email, asha.password);
  const shopFirst = refreshValue(shop);
  await renew(shop);
  assert.equal((await call("POST", REFRESH_PATH, { body: { refreshToken: shopFirst, scope: "admin" } })).status, 401);
});

test("if issuing the new token fails, the old one is given back instead of signing the customer out", async () => {
  const jar = newJar();
  await signIn(jar, asha.email, asha.password);
  const first = refreshValue(jar);

  const original = RefreshToken.create;
  RefreshToken.create = async () => { throw new Error("database hiccup"); };
  let status;
  try {
    status = (await renew(jar)).status;
  } finally {
    RefreshToken.create = original;
  }
  assert.equal(status, 500);
  assert.equal((await tokenRow(first)).revoked, false, "the customer can simply try again");
  assert.equal((await renew(jar)).status, 200);
});

// ---------- The CSRF check knows every session cookie ----------

test("a request with no Origin is refused when it carries ANY session cookie, admin and refresh included", async () => {
  // The admin cookie alone (it used to slip through: only the customer cookie was looked at).
  const admin = newJar();
  assert.equal((await call("POST", "/api/admin/login", { body: { email: "admin@refresh.test", password: "AdminPass123" }, jar: admin })).status, 200);
  assert.ok(admin.get("nx_admin"));
  const adminNoOrigin = await call("POST", "/api/admin/logout", { jar: admin, origin: false });
  assert.equal(adminNoOrigin.status, 403);
  assert.ok(admin.get("nx_admin"), "and the admin was not signed out by it");
  // The same request from the console's own page works.
  assert.equal((await call("POST", "/api/admin/logout", { jar: admin })).status, 200);

  // A lone refresh cookie, and a lone customer cookie.
  assert.equal((await call("POST", REFRESH_PATH, { body: {}, cookie: "nx_refresh=abc", origin: false })).status, 403);
  assert.equal((await call("POST", REFRESH_PATH, { body: {}, cookie: "nx_admin_refresh=abc", origin: false })).status, 403);
  assert.equal((await call("POST", "/api/logout", { cookie: "nx_token=abc", origin: false })).status, 403);

  // Tools with no cookie at all (Postman, curl, a mobile app) are unaffected.
  const tool = await call("POST", "/api/login", { body: { email: asha.email, password: asha.password }, origin: false });
  assert.equal(tool.status, 200);
});
