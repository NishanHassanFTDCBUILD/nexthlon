// Two-step sign-in for the admin console: a 6-digit code from an authenticator app (TOTP, RFC 6238), plus
// one-time recovery codes. No outside library: the code is computed with Node's crypto.
//
//   beginSetup(userId)            makes a secret; nothing changes until the code is confirmed
//   enable(userId, code)          confirms the setup and returns the recovery codes (shown once)
//   disable(userId, code)         turns it off, with a current code or a recovery code
//   issueChallenge(userId)        after the password: a short-lived token for the second step
//   readChallenge(token)          the user id from that token, or null
//   verifyLogin(user, code)       a current code, or an unused recovery code (which is then used up)
const crypto = require('crypto');
const config = require('../config/env');
const User = require('../models/User');
const {HttpError} = require('../utils/http');

const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // one step either side, for clock drift
const CHALLENGE_MS = 5 * 60 * 1000;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(text).toUpperCase().replace(/=+$/, '')) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// The 6-digit code for a moment in time (RFC 6238, HMAC-SHA1).
function codeAt(secretBuffer, timeMs) {
  const counter = Math.floor(timeMs / 1000 / STEP_SECONDS);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuffer).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

function codeMatches(secretBuffer, input, now = Date.now()) {
  const given = String(input || '').replace(/\s+/g, '');
  if (!/^[0-9]{6}$/.test(given)) return false;
  let ok = false;
  for (let step = -WINDOW; step <= WINDOW; step += 1) {
    const expected = codeAt(secretBuffer, now + step * STEP_SECONDS * 1000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given)))
      ok = true;
  }
  return ok;
}

const hashRecovery = (code) =>
  crypto
    .createHash('sha256')
    .update(String(code).replace(/-/g, '').toUpperCase())
    .digest('hex');

function newRecoveryCodes() {
  const codes = [];
  for (let i = 0; i < 8; i += 1) {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

async function loadWithSecrets(userId) {
  return User.findOne({_id: userId, role: 'admin'})
    .select(
      '+twoFactor.secret +twoFactor.pendingSecret +twoFactor.recoveryHashes',
    )
    .exec();
}

async function beginSetup(userId) {
  const user = await loadWithSecrets(userId);
  if (!user) throw new HttpError(404, 'Admin account not found.');
  if (user.twoFactor && user.twoFactor.enabled)
    throw new HttpError(409, 'Two-step sign-in is already on.');
  const secret = base32Encode(crypto.randomBytes(20));
  user.twoFactor = {
    ...(user.twoFactor ? user.twoFactor.toObject() : {}),
    pendingSecret: secret,
  };
  await user.save();
  const label = encodeURIComponent(`Nexthlon admin:${user.email}`);
  return {
    secret,
    otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Nexthlon&digits=${DIGITS}&period=${STEP_SECONDS}`,
  };
}

async function enable(userId, code) {
  const user = await loadWithSecrets(userId);
  if (!user) throw new HttpError(404, 'Admin account not found.');
  const pending = user.twoFactor && user.twoFactor.pendingSecret;
  if (!pending) throw new HttpError(409, 'Start the setup first.');
  if (!codeMatches(base32Decode(pending), code))
    throw new HttpError(
      400,
      'That code is not right. Check the time on your phone and try again.',
      {code: 'That code is not right.'},
    );
  const recovery = newRecoveryCodes();
  user.twoFactor = {
    enabled: true,
    secret: pending,
    pendingSecret: '',
    recoveryHashes: recovery.map(hashRecovery),
    enabledAt: new Date(),
  };
  await user.save();
  return {recoveryCodes: recovery};
}

async function disable(userId, code) {
  const user = await loadWithSecrets(userId);
  if (!user || !user.twoFactor || !user.twoFactor.enabled)
    throw new HttpError(409, 'Two-step sign-in is not on.');
  if (!(await useCodeOrRecovery(user, code)))
    throw new HttpError(400, 'That code is not right.', {
      code: 'That code is not right.',
    });
  user.twoFactor = {
    enabled: false,
    secret: '',
    pendingSecret: '',
    recoveryHashes: [],
  };
  await user.save();
  return {message: 'Two-step sign-in is off.'};
}

// A current code, or an unused recovery code (which is then spent). Returns true when it matched.
async function useCodeOrRecovery(user, input) {
  const given = String(input || '').trim();
  if (codeMatches(base32Decode(user.twoFactor.secret), given)) return true;
  const hash = hashRecovery(given);
  const left = user.twoFactor.recoveryHashes || [];
  if (given.length >= 8 && left.includes(hash)) {
    user.twoFactor.recoveryHashes = left.filter((h) => h !== hash);
    await user.save();
    return true;
  }
  return false;
}

async function verifyLogin(user, code) {
  const full = await loadWithSecrets(user._id);
  if (!full || !full.twoFactor || !full.twoFactor.enabled) return false;
  return useCodeOrRecovery(full, code);
}

function issueChallenge(userId, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({id: String(userId), exp: now + CHALLENGE_MS}),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', String(config.jwtSecret))
    .update(`2fa:${payload}`)
    .digest('base64url');
  return `${payload}.${sig}`;
}

function readChallenge(token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto
    .createHmac('sha256', String(config.jwtSecret))
    .update(`2fa:${payload}`)
    .digest('base64url');
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > now ? data.id : null;
  } catch {
    return null;
  }
}

module.exports = {
  beginSetup,
  enable,
  disable,
  verifyLogin,
  issueChallenge,
  readChallenge,
  codeAt,
  codeMatches,
  base32Encode,
  base32Decode,
};
