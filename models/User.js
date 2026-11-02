const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  phone: { type: String, trim: true, default: "" },
  role: { type: String, enum: ["customer", "admin"], default: "customer", index: true },
  isBlocked: { type: Boolean, default: false, index: true },
  // Copied into every token. Changing the password adds 1, so all older tokens stop working.
  tokenVersion: { type: Number, default: 0 },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true });

// The only user fields that are ever sent to the browser.
userSchema.methods.toSafeJSON = function toSafeJSON() {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    isBlocked: this.isBlocked,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model("User", userSchema);
