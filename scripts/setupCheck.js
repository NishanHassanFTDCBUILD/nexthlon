// Tests every outside service from your .env and says, in plain words, what works and what to fix.
// Never prints a key or password.
//   npm run setup:check            database, settings, photo storage
//   npm run setup:check -- --mail  also sends one real test email to ADMIN_EMAIL
const mongoose = require("mongoose");
const sharp = require("sharp");
const config = require("../config/env");
const { checkEnv } = require("../config/schema");
const storage = require("../providers/storage");
const mailService = require("../services/mailService");

const ok = text => console.log(`  OK    ${text}`);
const bad = text => { console.log(`  FIX   ${text}`); failures += 1; };
const note = text => console.log(`  NOTE  ${text}`);
let failures = 0;

async function checkDatabase() {
  console.log("\nDatabase");
  try {
    await mongoose.connect(config.mongoUri || process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
    ok(`connected to "${mongoose.connection.name}"`);
    if (mongoose.connection.name === "test") bad('the database is called "test": add /nexthlon to MONGODB_URI after the host.');
  } catch (error) {
    bad(`could not connect (${error.message.slice(0, 120)}). Run npm run db:check for help.`);
  }
}

function checkSettings() {
  console.log("\nSettings");
  const { errors, warnings } = checkEnv(process.env);
  if (!errors.length && !warnings.length) ok("all settings are valid");
  errors.forEach(line => bad(line));
  warnings.forEach(line => note(line));
}

async function checkStorage() {
  console.log(`\nPhoto storage (${config.storage.driver})`);
  if (config.storage.driver === "local") return note("photos go to this computer's disk: fine for development, not for hosting.");
  const provider = storage.current();
  // Cloudinary's Usage endpoint is an administrative API with different permissions from
  // Upload/Destroy. Exercise the exact least-privilege operations this app needs instead.
  const key = `products/${require("crypto").randomBytes(16).toString("hex")}-full.webp`;
  try {
    // Generate a standards-compliant image instead of relying on an embedded byte sequence. This
    // tests the exact upload/delete permissions without involving Cloudinary's Admin/Usage API.
    const probe = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000000" } }).webp().toBuffer();
    await provider.put(key, probe, { contentType: "image/webp" });
    ok("upload works");
    await provider.remove([key]);
    ok("delete works");
    ok(`photos will be served from ${config.storage.publicUrl}`);
  } catch (error) {
    bad(`${error.message.slice(0, 160)}`);
  }
}

async function checkMail() {
  console.log(`\nEmail (${config.mail.driver})`);
  if (!mailService.isConfigured()) return note("not set up yet: emails are printed in the terminal instead of sent.");
  if (!process.argv.includes("--mail")) return note("settings present. Run with --mail to send a real test email to ADMIN_EMAIL.");
  const to = process.env.ADMIN_EMAIL;
  if (!to) return bad("ADMIN_EMAIL is empty, so there is nowhere to send the test.");
  try {
    await mailService.send({ to, subject: "Nexthlon setup check", text: "If you can read this, email sending works.", html: "<p>If you can read this, email sending works.</p>" });
    ok(`test email sent to ${mailService.maskEmail(to)}. Check the inbox (and spam).`);
  } catch (error) {
    bad(error.message.slice(0, 160));
  }
}

(async () => {
  checkSettings();
  await checkDatabase();
  await checkStorage();
  await checkMail();
  console.log(failures ? `\n${failures} thing(s) to fix.` : "\nAll good.");
  await mongoose.disconnect().catch(() => {});
  process.exit(failures ? 1 : 0);
})();
