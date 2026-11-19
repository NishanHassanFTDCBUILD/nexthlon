// The real server process: it starts, answers health checks, logs each request with its ID, and
// shuts down cleanly when asked (what a deploy does). Needs the test database, like the API tests.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'server process tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const {spawn} = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const root = path.join(__dirname, '..');

function freePort() {
  return new Promise((resolve) => {
    const probe = net.createServer().listen(0, () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('the server starts, logs requests with IDs, drains and exits 0 on SIGTERM', async () => {
  const port = await freePort();
  // The child starts the server, and treats a line on stdin as the SIGTERM a host would send. (On
  // Windows a real signal kills a process outright, so the handler is triggered the same way.)
  const child = spawn(
    process.execPath,
    [
      '-e',
      "require('./server'); process.stdin.on('data', () => process.emit('SIGTERM'));",
    ],
    {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        PORT: String(port),
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
        MONGODB_URI: process.env.MONGODB_URI,
        JWT_SECRET: process.env.JWT_SECRET,
        ADMIN_PATH: '/admin',
      },
    },
  );
  const logs = [];
  let output = '';
  const take = (chunk) => {
    output += chunk;
    for (const line of String(chunk).split('\n')) {
      if (line.startsWith('{')) {
        try {
          logs.push(JSON.parse(line));
        } catch {
          /* not a log line */
        }
      }
    }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => resolve({code, signal})),
  );

  try {
    // Wait until it is listening (it connects to MongoDB first).
    const deadline = Date.now() + 30_000;
    while (!/Nexthlon running at/.test(output)) {
      assert.ok(Date.now() < deadline, `the server did not start:\n${output}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const base = `http://127.0.0.1:${port}`;

    assert.equal((await fetch(`${base}/healthz`)).status, 200);
    assert.equal((await fetch(`${base}/readyz`)).status, 200);

    // One log line per request: the path without its query string, the status, and the request's ID.
    const page = await fetch(`${base}/products?token=do-not-log-me`);
    const id = page.headers.get('x-request-id');
    await page.text();
    await new Promise((resolve) => setTimeout(resolve, 200));
    const access = logs.find(
      (entry) => entry.event === 'http.request' && entry.req === id,
    );
    assert.ok(access, 'the request is logged with its ID');
    assert.equal(access.path, '/products');
    assert.equal(access.method, 'GET');
    assert.equal(access.status, 200);
    assert.doesNotMatch(output, /do-not-log-me/);
    // Health checks and assets do not fill the log.
    assert.ok(
      !logs.some(
        (entry) =>
          entry.event === 'http.request' &&
          /healthz|readyz/.test(entry.path || ''),
      ),
    );

    // A deploy: it stops, finishes cleanly and exits with 0.
    child.stdin.write('stop\n');
    const result = await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`did not exit after SIGTERM:\n${output}`)),
          15_000,
        ),
      ),
    ]);
    assert.equal(result.code, 0, output);
    assert.ok(
      logs.some(
        (entry) =>
          entry.event === 'shutdown.start' && entry.signal === 'SIGTERM',
      ),
    );
    assert.ok(logs.some((entry) => entry.event === 'shutdown.done'));
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
