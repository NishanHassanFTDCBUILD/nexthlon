// Gives photos uploaded earlier their small copies, and (when STORAGE_DRIVER=s3) moves them to the bucket.
// See services/imageMigrationService.js for exactly what it changes.
//   npm run images:migrate -- --dry-run     shows what would happen, changes nothing
//   npm run images:migrate                  does it
const mongoose = require("mongoose");
const config = require("../config/env");
const { migrateImages } = require("../services/imageMigrationService");

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  const report = await migrateImages({ dryRun });

  console.log(`Photos go to: ${report.driver === "local" ? "this server's disk (public/uploads)" : `${report.driver === "cloudinary" ? "Cloudinary" : "the bucket"} (${config.storage.publicUrl})`}`);
  console.log(`${dryRun ? "[dry run, nothing was changed] " : ""}Photos to move: ${report.found}`);
  for (const { from, to } of report.moves) console.log(`  ${from}\n    -> ${to}`);
  if (report.missing.length) {
    console.log(`\nFile missing on disk (address left as it is): ${report.missing.length}`);
    for (const url of report.missing) console.log(`  ${url}`);
  }
  console.log(`\n${dryRun ? "Would write" : "Wrote"} ${report.filesWritten} files and ${dryRun ? "would change" : "changed"} ${report.migrated} addresses.`);
  if (!dryRun && report.migrated) console.log("The old files were left where they are, so nothing that still points at them breaks.");
  if (!report.found) console.log("Nothing to do: every photo is already in the current format and place.");
}

main()
  .then(() => mongoose.disconnect())
  .catch(async error => {
    console.error(`Failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
