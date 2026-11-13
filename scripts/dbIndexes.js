// Makes sure every index the store needs exists in the database from MONGODB_URI (your .env, or the
// host's environment): npm run db:indexes
// Safe to run any time, on a live database: it only ADDS missing indexes and never deletes anything.
// Indexes the database has that the code no longer asks for are listed, for you to decide on.
// Prints the database name and the indexes, never the address or password.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const config = require("../config/env");

// Every model in models/, so each one's indexes are known.
fs.readdirSync(path.join(__dirname, "..", "models"))
  .filter(file => file.endsWith(".js"))
  .forEach(file => require(path.join(__dirname, "..", "models", file)));

const nameOf = index => index.name || Object.entries(index.key || {}).map(([field, dir]) => `${field}_${dir}`).join("_");

(async () => {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  console.log(`Database: ${mongoose.connection.name}\n`);
  let added = 0;
  const extra = [];
  for (const model of Object.values(mongoose.models).sort((a, b) => a.modelName.localeCompare(b.modelName))) {
    const before = new Set((await model.collection.indexes().catch(() => [])).map(nameOf));
    await model.createIndexes();
    const after = await model.collection.indexes();
    const created = after.map(nameOf).filter(name => !before.has(name));
    added += created.length;
    const wanted = new Set(["_id_", ...model.schema.indexes().map(([fields, options]) => (options && options.name) || Object.entries(fields).map(([f, d]) => `${f}_${d}`).join("_"))]);
    // unique: true on a field also makes an index named after the field.
    Object.entries(model.schema.paths).forEach(([field, schemaPath]) => {
      if (schemaPath.options && (schemaPath.options.unique || schemaPath.options.index)) wanted.add(`${field}_1`);
    });
    after.map(nameOf).filter(name => !wanted.has(name)).forEach(name => extra.push(`${model.collection.collectionName}.${name}`));
    console.log(`${model.collection.collectionName.padEnd(24)} ${String(after.length).padStart(2)} indexes${created.length ? `  (added: ${created.join(", ")})` : ""}`);
  }
  console.log(`\n${added ? `Added ${added} missing ${added === 1 ? "index" : "indexes"}.` : "Every index was already there."}`);
  if (extra.length) {
    console.log("\nIn the database but not asked for by the code (left alone; drop them in Compass or Atlas only if you are sure):");
    extra.forEach(name => console.log(`  ${name}`));
  }
  await mongoose.disconnect();
})().catch(async error => {
  console.error(`Could not update the indexes: ${error.message}`);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
