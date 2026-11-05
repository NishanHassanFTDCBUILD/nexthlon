const mongoose = require("mongoose");

// One row per refresh token, which means one row per signed-in device.
//
// The raw token is sent to the browser once and NEVER stored here: we keep only its SHA-256 hash.
// So even someone reading this collection cannot sign in as anybody.
//
// familyId groups every token that came from one sign-in. Each refresh replaces the token with a
// new one in the same family (rotation). If an already-used token comes back, the whole family is
// revoked, because the only way that happens is that someone copied the token (stolen-token
// detection). Rows are kept after being revoked so that reuse can still be spotted; MongoDB
// removes them by itself once expiresAt passes (the TTL index below).
const refreshTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // Which session this belongs to, so a customer token can never renew an admin session.
  role: { type: String, enum: ["customer", "admin"], required: true },
  // SHA-256 of the raw token, in hex. Unique, so one token can never have two rows.
  tokenHash: { type: String, required: true, unique: true },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true },
  // "Chrome on Windows" (from utils/device.js), and the masked IP, e.g. 103.21.x.x.
  device: { type: String, default: "Unknown browser", maxlength: 80 },
  ip: { type: String, default: "", maxlength: 60 },
  lastUsedAt: { type: Date, default: null },
  revoked: { type: Boolean, default: false },
  revokedAt: { type: Date, default: null },
  // Why it was revoked: "rotated", "logout", "reuse", "password_change", "blocked"...
  revokedReason: { type: String, default: "", maxlength: 40 },
  // The token that took its place on rotation, so the chain can be followed.
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "RefreshToken", default: null }
}, { timestamps: true });

// The devices list: this customer's live sessions, newest first.
refreshTokenSchema.index({ user: 1, revoked: 1, createdAt: -1 });
// TTL: MongoDB deletes a row by itself once expiresAt has passed, so old tokens never pile up.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("RefreshToken", refreshTokenSchema);
