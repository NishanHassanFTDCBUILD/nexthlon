// Creates the first administrator from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env.
// Run: npm run seed:admin
const mongoose = require("mongoose");
const config = require("../config/env");
const User = require("../models/User");
const { hashPassword } = require("../services/authService");

async function seedAdmin() {
  const name = (process.env.ADMIN_NAME || "Nexthlon Admin").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new Error("Set ADMIN_EMAIL in .env to a valid email address.");
  }
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new Error("Set ADMIN_PASSWORD in .env: at least 10 characters with letters and numbers.");
  }

  await mongoose.connect(config.mongoUri);
  const passwordHash = await hashPassword(password);
  const existing = await User.findOne({ email });

  if (existing) {
    existing.role = "admin";
    existing.isBlocked = false;
    existing.passwordHash = passwordHash;
    existing.tokenVersion = (existing.tokenVersion || 0) + 1;
    await existing.save();
    console.log(`Updated ${email}: it is now an admin with the password from .env.`);
  } else {
    await User.create({ name, email, passwordHash, role: "admin" });
    console.log(`Created admin ${email}. Sign in at http://localhost:${config.port}/admin/login`);
  }
}

seedAdmin()
  .catch(error => {
    console.error(`Could not create the admin: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
