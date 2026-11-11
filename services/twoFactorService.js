// Two-step login for admins: after the password, a 6-digit code from an authenticator app (Google
// Authenticator, Microsoft Authenticator, Authy, 1Password...). TOTP, RFC 6238: SHA-1, 6 digits, 30
// seconds, which every one of those apps understands. Written with Node's crypto, no extra library.
//
// How it is kept safe:
//   - The secret is stored encrypted (AES-256-GCM, key derived from JWT_SECRET), and never selected
//     unless asked for. A copy of the database alone does not give the codes.
//   - A code works once: the last accepted 30-second step is stored, and an older or equal step is refused,
//     so a code someone watched you type cannot be replayed.
//   - Wrong codes are counted. After MAX_FAILURES the account is locked for LOCK_MS, however many
//     IP addresses the guesses come from (the limit follows the account, not the visitor).
//   - Ten one-time recovery codes are made at setup for a lost phone. Only their hashes are stored, and
//     each is deleted when used.
//   - Turning it off, or making new recovery codes, needs the password AND a code.
// Changing JWT_SECRET makes stored secrets unreadable: admins then need "npm run admin:reset-2fa".
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const User = require("../models/User");
const config = require("../config/env");
const auditService = require("./auditService");
const { HttpError } = require("../utils/http");

const PERIOD_S = 30;
const DIGITS = 6;
// A code is accepted for the step before and after the current one (clocks drift by a few seconds).
const WINDOW = 1;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const RECOVERY_COUNT = 10;
const ISSUER = "Nexthlon";

// ---------- Base32 (the form authenticator apps take) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text).toUpperCase().replace(/=+$/, "")) {
    const index = B32.indexOf(char);
    if (index < 0) throw new Error("Not base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- The code itself ----------
// HOTP (RFC 4226): HMAC-SHA1 of the counter, cut down to 6 digits.
function hotp(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = crypto.createHmac("sha1", secret).update(message).digest();
  const offset = hash[19] & 0x0f;
  const number = ((hash[offset] & 0x7f) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(number % 10 ** DIGITS).padStart(DIGITS, "0");
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / PERIOD_S);

// The step a code is valid for (within the window), or null. Every step is compared, so the time taken
// does not say which one matched.
function matchStep(secret, code, now = Date.now()) {
  let matched = null;
  const wanted = Buffer.from(String(code));
  for (let delta = -WINDOW; delta <= WINDOW; delta += 1) {
    const step = currentStep(now) + delta;
    const candidate = Buffer.from(hotp(secret, step));
    if (wanted.length === candidate.length && crypto.timingSafeEqual(wanted, candidate)) matched = step;
  }
  return matched;
}

// ---------- Keeping the secret ----------
const encryptionKey = () => Buffer.from(crypto.hkdfSync("sha256", Buffer.from(config.jwtSecret), Buffer.from("nexthlon.two-factor"), Buffer.from("secret-encryption"), 32));

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

function decrypt(stored) {
  const [version, iv, tag, body] = String(stored).split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unreadable secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

// ---------- Recovery codes ----------
// No 0/o/1/l/i: they are read out and typed by hand. 10 characters from 31 is about 50 bits.
const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newRecoveryCode() {
  const chars = Array.from({ length: 10 }, () => RC_ALPHABET[crypto.randomInt(RC_ALPHABET.length)]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const normaliseRecovery = text => String(text).toLowerCase().replace(/[^a-z0-9]/g, "");
const hashRecovery = text => crypto.createHash("sha256").update(normaliseRecovery(text)).digest("hex");

// What the person typed: a 6-digit code, or a recovery code. Spaces and dashes are ignored.
function classify(input) {
  const text = String(input ?? "").trim();
  const digits = text.replace(/[\s-]/g, "");
  if (/^\d{6}$/.test(digits)) return { kind: "totp", value: digits };
  const recovery = normaliseRecovery(text);
  if (/^[a-z2-9]{10}$/.test(recovery) && [...recovery].every(char => RC_ALPHABET.includes(char))) return { kind: "recovery", value: recovery };
  return null;
}

// ---------- Loading and checking ----------
const SECRETS = "+twoFactor.secretEnc +twoFactor.pendingSecretEnc +twoFactor.recoveryHashes";
const loadWithSecrets = id => User.findById(id).select(SECRETS);

function lockedMessage(until) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return `Too many wrong codes. This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;
}

async function recordFailure(userId) {
  const updated = await User.findByIdAndUpdate(userId, { $inc: { "twoFactor.failedAttempts": 1 } }, { new: true }).select("twoFactor.failedAttempts");
  const failures = updated ? updated.twoFactor.failedAttempts : 0;
  if (failures >= MAX_FAILURES) {
    await User.updateOne({ _id: userId }, { $set: { "twoFactor.lockedUntil": new Date(Date.now() + LOCK_MS), "twoFactor.failedAttempts": 0 } });
    await auditService.record({ actor: userId, actorRole: "admin", action: "auth.2fa_locked", target: `user:${userId}` });
    throw new HttpError(429, lockedMessage(new Date(Date.now() + LOCK_MS)));
  }
  const left = MAX_FAILURES - failures;
  throw new HttpError(401, `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left before this account is locked for 15 minutes.`, { code: "That code is not right." });
}

// Checks a code (or recovery code) against this user, and uses it up. Throws when it is wrong.
// Returns { method: "totp" | "recovery", recoveryLeft }.
async function checkCode(user, input) {
  if (user.twoFactor.lockedUntil && user.twoFactor.lockedUntil > new Date()) throw new HttpError(429, lockedMessage(user.twoFactor.lockedUntil));
  const parsed = classify(input);
  if (!parsed) return recordFailure(user._id);

  if (parsed.kind === "totp") {
    let step = null;
    try {
      step = matchStep(base32Decode(decrypt(user.twoFactor.secretEnc)), parsed.value);
    } catch {
      throw new HttpError(500, "Two-step login could not be checked. Ask another admin to reset it.");
    }
    if (step === null) return recordFailure(user._id);
    // Atomic: of two requests carrying the same code, only one moves lastStep forward.
    const used = await User.findOneAndUpdate(
      { _id: user._id, "twoFactor.lastStep": { $lt: step } },
      { $set: { "twoFactor.lastStep": step, "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null } },
      { new: true }
    );
    if (!used) throw new HttpError(401, "That code was already used. Wait for the next one and try again.", { code: "That code was already used." });
    return { method: "totp", recoveryLeft: (user.twoFactor.recoveryHashes || []).length };
  }

  const hash = hashRecovery(parsed.value);
  const used = await User.findOneAndUpdate(
    { _id: user._id, "twoFactor.recoveryHashes": hash },
    { $pull: { "twoFactor.recoveryHashes": hash }, $set: { "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null } },
    { new: true }
  ).select("+twoFactor.recoveryHashes");
  if (!used) return recordFailure(user._id);
  await auditService.record({ actor: user._id, actorRole: "admin", action: "auth.2fa_recovery_used", target: `user:${user._id}`, after: { left: used.twoFactor.recoveryHashes.length } });
  return { method: "recovery", recoveryLeft: used.twoFactor.recoveryHashes.length };
}

// ---------- The password half of "turn off" and "new recovery codes" ----------
async function confirmPassword(user, password) {
  const ok = typeof password === "string" && password && await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new HttpError(401, "Incorrect password.", { password: "Incorrect password." });
}

// ---------- The public functions ----------

async function status(userId) {
  const user = await User.findById(userId).select("+twoFactor.recoveryHashes");
  return {
    enabled: Boolean(user.twoFactor.enabled),
    enabledAt: user.twoFactor.enabledAt,
    recoveryCodesLeft: user.twoFactor.enabled ? user.twoFactor.recoveryHashes.length : 0
  };
}

// Step 1 of setup: a fresh secret, shown as a QR code (and as text, for typing in). Not active yet.
async function startSetup(userId) {
  const user = await User.findById(userId);
  if (user.twoFactor.enabled) throw new HttpError(409, "Two-step login is already on. Turn it off first if you want to set it up again.");
  const secret = base32Encode(crypto.randomBytes(20));
  await User.updateOne({ _id: userId }, { $set: { "twoFactor.pendingSecretEnc": encrypt(secret) } });
  const uri = `otpauth://totp/${encodeURIComponent(`${ISSUER}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=${DIGITS}&period=${PERIOD_S}`;
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  // Groups of four are easier to type from a phone screen.
  return { secret: secret.replace(/(.{4})/g, "$1 ").trim(), uri, qrSvg };
}

// Step 2: the first code proves the app really holds the secret. Turns it on and returns the recovery codes.
async function confirmSetup(userId, input) {
  const user = await loadWithSecrets(userId);
  if (user.twoFactor.enabled) throw new HttpError(409, "Two-step login is already on.");
  if (!user.twoFactor.pendingSecretEnc) throw new HttpError(400, "Start the setup first: scan the code, then enter the 6 digits it shows.");
  if (user.twoFactor.lockedUntil && user.twoFactor.lockedUntil > new Date()) throw new HttpError(429, lockedMessage(user.twoFactor.lockedUntil));
  const parsed = classify(input);
  const secret = decrypt(user.twoFactor.pendingSecretEnc);
  const step = parsed && parsed.kind === "totp" ? matchStep(base32Decode(secret), parsed.value) : null;
  if (step === null) return recordFailure(user._id);

  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  await User.updateOne({ _id: userId }, { $set: {
    "twoFactor.enabled": true,
    "twoFactor.secretEnc": encrypt(secret),
    "twoFactor.pendingSecretEnc": "",
    "twoFactor.recoveryHashes": codes.map(hashRecovery),
    "twoFactor.lastStep": step,
    "twoFactor.failedAttempts": 0,
    "twoFactor.lockedUntil": null,
    "twoFactor.enabledAt": new Date()
  } });
  await auditService.record({ actor: userId, actorRole: "admin", action: "auth.2fa_enabled", target: `user:${userId}` });
  return { recoveryCodes: codes };
}

// The second half of signing in: the code after the password.
async function verifyLogin(userId, input) {
  const user = await loadWithSecrets(userId);
  if (!user || !user.twoFactor.enabled) throw new HttpError(400, "Two-step login is not on for this account.");
  return checkCode(user, input);
}

// Turning it off needs the password AND a code, so a stolen session alone cannot remove the protection.
async function disable(userId, { password, code }) {
  const user = await User.findById(userId).select(`+passwordHash ${SECRETS}`);
  if (!user.twoFactor.enabled) throw new HttpError(400, "Two-step login is not on.");
  await confirmPassword(user, password);
  await checkCode(user, code);
  await User.updateOne({ _id: userId }, { $set: {
    "twoFactor.enabled": false, "twoFactor.secretEnc": "", "twoFactor.pendingSecretEnc": "", "twoFactor.recoveryHashes": [],
    "twoFactor.lastStep": 0, "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null, "twoFactor.enabledAt": null
  } });
  await auditService.record({ actor: userId, actorRole: "admin", action: "auth.2fa_disabled", target: `user:${userId}` });
}

// New recovery codes replace all the old ones.
async function regenerateRecoveryCodes(userId, { password, code }) {
  const user = await User.findById(userId).select(`+passwordHash ${SECRETS}`);
  if (!user.twoFactor.enabled) throw new HttpError(400, "Two-step login is not on.");
  await confirmPassword(user, password);
  await checkCode(user, code);
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  await User.updateOne({ _id: userId }, { $set: { "twoFactor.recoveryHashes": codes.map(hashRecovery) } });
  await auditService.record({ actor: userId, actorRole: "admin", action: "auth.2fa_recovery_regenerated", target: `user:${userId}` });
  return { recoveryCodes: codes };
}

// The command-line escape hatch (scripts/resetTwoFactor.js): for a lost phone AND lost recovery codes,
// or after JWT_SECRET changed.
async function resetByEmail(email) {
  const result = await User.updateOne({ email: String(email).toLowerCase(), role: "admin" }, { $set: {
    "twoFactor.enabled": false, "twoFactor.secretEnc": "", "twoFactor.pendingSecretEnc": "", "twoFactor.recoveryHashes": [],
    "twoFactor.lastStep": 0, "twoFactor.failedAttempts": 0, "twoFactor.lockedUntil": null, "twoFactor.enabledAt": null
  } });
  return result.matchedCount > 0;
}

module.exports = {
  status, startSetup, confirmSetup, verifyLogin, disable, regenerateRecoveryCodes, resetByEmail,
  // Exported for tests.
  hotp, matchStep, currentStep, base32Encode, base32Decode, encrypt, decrypt, classify, hashRecovery, newRecoveryCode,
  MAX_FAILURES, LOCK_MS, RECOVERY_COUNT, PERIOD_S
};
