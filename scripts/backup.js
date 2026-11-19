// Database backup and restore without MongoDB's separate tools (D3). Atlas's free M0 plan has no automatic
// backups, so run a backup at least weekly and keep the folder somewhere safe (not only on this computer).
//
//   npm run db:backup                                   backs up MONGODB_URI into backups/<date-time>/
//   npm run db:backup -- --uri "<connection string>"    another database
//   npm run db:restore -- --from backups/<folder> --to-db nexthlon_restore_check
//                                                       restores into a NEW database (on the same server)
//
// Each collection is one gzipped file of Extended JSON lines (types such as ObjectId and Date survive
// exactly), plus its indexes. A restore refuses to write into a database that already has data unless
// --force is given, so a typo can never overwrite the live store. Connection strings are never printed.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const mongoose = require('mongoose');

const {EJSON} = mongoose.mongo.BSON;
const BATCH = 500;

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      out[key] = next && !next.startsWith('--') ? argv[(i += 1)] : true;
    }
  }
  return out;
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

async function backup(uri, folder) {
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  fs.mkdirSync(folder, {recursive: true});
  const collections = (await db.listCollections({}, {nameOnly: true}).toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));
  const summary = {
    database: db.databaseName,
    at: new Date().toISOString(),
    collections: {},
  };
  for (const name of collections) {
    const file = fs.createWriteStream(path.join(folder, `${name}.jsonl.gz`));
    const gzip = zlib.createGzip();
    gzip.pipe(file);
    let count = 0;
    for await (const doc of db.collection(name).find({})) {
      if (!gzip.write(`${EJSON.stringify(doc, {relaxed: false})}\n`))
        await new Promise((resolve) => gzip.once('drain', resolve));
      count += 1;
    }
    gzip.end();
    await new Promise((resolve) => file.on('close', resolve));
    const indexes = (await db.collection(name).indexes()).filter(
      (index) => index.name !== '_id_',
    );
    fs.writeFileSync(
      path.join(folder, `${name}.indexes.json`),
      JSON.stringify(indexes, null, 2),
    );
    summary.collections[name] = count;
    console.log(`  ${name}: ${count}`);
  }
  fs.writeFileSync(
    path.join(folder, 'backup.json'),
    JSON.stringify(summary, null, 2),
  );
  await mongoose.disconnect();
  return summary;
}

async function restore(uri, folder, toDb, {force = false} = {}) {
  const summary = JSON.parse(
    fs.readFileSync(path.join(folder, 'backup.json'), 'utf8'),
  );
  await mongoose.connect(uri);
  const db = mongoose.connection.useDb(toDb, {useCache: false}).db;
  const existing = (
    await db.listCollections({}, {nameOnly: true}).toArray()
  ).map((c) => c.name);
  if (existing.length && !force) {
    await mongoose.disconnect();
    throw new Error(
      `Database "${toDb}" already has ${existing.length} collections. Restore into a new database name, or add --force to replace them.`,
    );
  }
  const counts = {};
  for (const name of Object.keys(summary.collections)) {
    const collection = db.collection(name);
    if (force) await collection.deleteMany({});
    const lines = readline.createInterface({
      input: fs
        .createReadStream(path.join(folder, `${name}.jsonl.gz`))
        .pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    let batch = [];
    let count = 0;
    for await (const line of lines) {
      if (!line) continue;
      batch.push(EJSON.parse(line, {relaxed: false}));
      if (batch.length >= BATCH) {
        await collection.insertMany(batch, {ordered: false});
        count += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await collection.insertMany(batch, {ordered: false});
      count += batch.length;
    }
    const indexFile = path.join(folder, `${name}.indexes.json`);
    const indexes = fs.existsSync(indexFile)
      ? JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      : [];
    for (const {key, v, ns, ...options} of indexes)
      await collection.createIndex(key, options);
    counts[name] = count;
    console.log(
      `  ${name}: ${count}${count === summary.collections[name] ? '' : ` (backup had ${summary.collections[name]})`}`,
    );
  }
  await mongoose.disconnect();
  return {expected: summary.collections, restored: counts};
}

async function main() {
  require('dotenv').config();
  const [command, ...rest] = process.argv.slice(2);
  const options = args(rest);
  const uri =
    typeof options.uri === 'string' ? options.uri : process.env.MONGODB_URI;
  if (!uri)
    throw new Error('No database: set MONGODB_URI in .env or pass --uri.');
  if (command === 'backup') {
    const folder =
      typeof options.out === 'string'
        ? options.out
        : path.join('backups', stamp());
    console.log(`Backing up into ${folder}`);
    const summary = await backup(uri, folder);
    console.log(
      `Done: ${Object.keys(summary.collections).length} collections from "${summary.database}". Copy the folder somewhere safe.`,
    );
  } else if (command === 'restore') {
    if (
      typeof options.from !== 'string' ||
      typeof options['to-db'] !== 'string'
    )
      throw new Error(
        'Usage: restore --from <backup folder> --to-db <new database name> [--force]',
      );
    console.log(`Restoring ${options.from} into "${options['to-db']}"`);
    const {expected, restored} = await restore(
      uri,
      options.from,
      options['to-db'],
      {force: options.force === true},
    );
    const missing = Object.keys(expected).filter(
      (name) => expected[name] !== restored[name],
    );
    console.log(
      missing.length
        ? `Check these collections: ${missing.join(', ')}`
        : 'Done: every collection has the same number of documents as the backup.',
    );
  } else {
    console.log(
      'Usage: node scripts/backup.js backup [--uri <uri>] [--out <folder>]\n       node scripts/backup.js restore --from <folder> --to-db <name> [--uri <uri>] [--force]',
    );
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {backup, restore};
