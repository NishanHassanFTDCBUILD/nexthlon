const mongoose = require("mongoose");

// One-time links sent by email: "reset your password" and "confirm your email".
//
// The link carries a random token that is shown once, in the email. Only its SHA-256 hash is stored,
// so someone reading this collection cannot use a link. A token works once (usedAt), only until
// expiresAt, and issuing a new one for the same person and purpose replaces the older one
// (supersededAt), so only the newest email's link works.
//
// Rows stay for a while after they stop working (deleteAt, then MongoDB removes them by itself), so
// "how many reset emails did this person ask for in the last hour" can be answered.
const authTokenSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  purpose: { type: String, enum: ["password_reset", "email_verify"], required: true },
  // SHA-256 of the raw token, in hex. Unique, so one token can never have two rows.
  tokenHash: { type: String, required: true, unique: true },
  // The email address the link was sent to. A confirmation link for an address the person has since
  // changed must not confirm the new one.
  sentTo: { type: String, default: "" },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
  supersededAt: { type: Date, default: null },
  // Masked (103.21.x.x), so a customer can be shown "requested from this network" if ever needed.
  ip: { type: String, default: "", maxlength: 60 },
  // MongoDB deletes the row when this time passes.
  deleteAt: { type: Date, required: true }
}, { timestamps: { createdAt: true, updatedAt: false } });

authTokenSchema.index({ user: 1, purpose: 1, createdAt: -1 });
authTokenSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("AuthToken", authTokenSchema);
