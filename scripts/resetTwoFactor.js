// Turns two-step login off for one admin: for a lost phone AND lost recovery codes, or after JWT_SECRET
// was changed (the stored secrets can no longer be read). The admin signs in with the password alone,
// then sets two-step login up again under Security.
//   npm run admin:reset-2fa -- admin@your-store.in
// Whoever can run this has the database and the server already, so it asks for nothing more.
const mongoose = require("mongoose");
const config = require("../config/env");
const twoFactorService = require("../services/twoFactorService");
const auditService = require("../services/auditService");

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  if (!email) throw new Error("Give the admin's email: npm run admin:reset-2fa -- admin@your-store.in");
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const found = await twoFactorService.resetByEmail(email);
  if (!found) throw new Error(`No admin with the email ${email}.`);
  await auditService.record({ actorRole: "system", action: "auth.2fa_reset_by_script", target: `email:${email}` });
  console.log(`Two-step login is off for ${email}. They can sign in with the password and set it up again under Security.`);
}

main()
  .then(() => mongoose.disconnect())
  .catch(async error => {
    console.error(`Failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
