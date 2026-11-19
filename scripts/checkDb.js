// Checks the database connection from MONGODB_URI (your .env, or the host's environment) and says what to
// fix when it fails. Prints the cluster, the database and what it found, never the address or password.
//   npm run db:check
const mongoose = require('mongoose');
const config = require('../config/env');

// "mongodb+srv://user:pass@cluster0.ab12c.mongodb.net/nexthlon?x=y" -> what is safe to show.
function describe(uri) {
  const match =
    /^(mongodb(?:\+srv)?):\/\/(?:([^:@/]+)(?::[^@]*)?@)?([^/?]+)(?:\/([^?]*))?/.exec(
      uri,
    ) || [];
  return {
    srv: match[1] === 'mongodb+srv',
    user: match[2] ? decodeURIComponent(match[2]) : '',
    hosts: match[3] || '',
    database: match[4] || '',
  };
}

// The most common ways connecting goes wrong, in plain words.
function advice(error) {
  const text = `${error.name} ${error.message} ${error.code || ''}`;
  if (/bad auth|AuthenticationFailed|Authentication failed/i.test(text)) {
    return 'Wrong user name or password. In Atlas: Database Access, check the user and set a new password if unsure. Special characters in the password must be URL-encoded (@ is %40, : is %3A, / is %2F, # is %23, ? is %3F), or use a password with only letters and numbers.';
  }
  if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(text)) {
    return "The cluster's address could not be found. Check the host in the connection string (cluster0.xxxxx.mongodb.net) and this computer's internet or DNS.";
  }
  if (/ssl|tls|certificate/i.test(text)) {
    return 'A secure-connection (TLS) problem. Check the system clock, and that nothing (a proxy, antivirus) is intercepting the connection.';
  }
  if (
    /ServerSelection|timed out|ReplicaSetNoPrimary|ECONNREFUSED|ETIMEDOUT/i.test(
      text,
    )
  ) {
    return 'Nothing answered within 10 seconds. With Atlas this is almost always the IP allow-list: Atlas, Network Access, Add IP Address (your own IP, or 0.0.0.0/0 for a host whose address changes, protected by a strong password). A cluster that was just created can also take a few minutes to start. For a local MongoDB: is it running?';
  }
  return 'See the message above. If it mentions the user or password, check Database Access in Atlas.';
}

async function main() {
  const info = describe(config.mongoUri);
  const kind = info.srv
    ? 'MongoDB Atlas style address (mongodb+srv)'
    : 'direct address (mongodb)';
  console.log(`Address: ${kind}`);
  console.log(`  host:     ${info.hosts}`);
  console.log(
    `  database: ${info.database || '(none given: MongoDB would use "test")'}`,
  );
  console.log(`  user:     ${info.user || '(none)'}`);
  console.log('\nConnecting (up to 10 seconds)...');

  const started = Date.now();
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 2,
    });
  } catch (error) {
    console.error(
      `\nCould not connect: ${error.message}\n\nWhat to check: ${advice(error)}`,
    );
    process.exit(1);
  }
  const db = mongoose.connection.db;
  console.log(`Connected in ${Date.now() - started} ms.`);

  const hello = await db.admin().command({hello: 1});
  const version = await db
    .admin()
    .command({buildInfo: 1})
    .then((r) => r.version)
    .catch(() => 'unknown');
  const replicated = Boolean(hello.setName || hello.msg === 'isdbgrid');
  console.log(
    `\nServer:   MongoDB ${version}${hello.setName ? `, replica set "${hello.setName}"` : ''}`,
  );
  console.log(
    `Orders:   ${replicated ? 'multi-step changes (orders, wallet, stock) run as real transactions' : "a single server: multi-step changes use the app's undo steps instead of transactions (fine for development; Atlas always supports transactions)"}`,
  );

  // Can this user read AND write? A read-only user would connect fine and then fail on the first order.
  const probe = db.collection('_healthcheck');
  try {
    const {insertedId} = await probe.insertOne({
      at: new Date(),
      note: 'npm run db:check',
    });
    await probe.deleteOne({_id: insertedId});
    console.log('Access:   can read and write');
  } catch (error) {
    console.error(
      `\nConnected, but this user cannot write: ${error.message}\nIn Atlas: Database Access, edit the user and give it "Read and write to any database" (or readWrite on ${info.database || 'your database'}).`,
    );
    process.exit(1);
  }

  const collections = (await db.listCollections().toArray())
    .map((collection) => collection.name)
    .filter((name) => name !== '_healthcheck')
    .sort();
  console.log(
    `\nDatabase "${mongoose.connection.name}" has ${collections.length} collection${collections.length === 1 ? '' : 's'}${collections.length ? ':' : '.'}`,
  );
  for (const name of collections)
    console.log(
      `  ${name.padEnd(24)} ${await db.collection(name).estimatedDocumentCount()}`,
    );

  if (!collections.includes('products')) {
    console.log(
      '\nNo products yet. This is normal for a new database. Start the app once (it creates the indexes), then:\n  npm run seed:admin      the first administrator (needs ADMIN_EMAIL and ADMIN_PASSWORD)\n  npm run seed:products   the sample products (or add real ones in the admin console)',
    );
  } else {
    const indexes = await db.collection('products').indexes();
    if (!indexes.some((index) => Object.values(index.key).includes('text'))) {
      console.log(
        '\nThe products search index is missing. Start the app once and it creates it.',
      );
    }
  }
  console.log('\nAll good.');
}

main()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(`Failed: ${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
