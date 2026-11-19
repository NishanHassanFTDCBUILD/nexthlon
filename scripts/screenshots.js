// Screenshot set (C4): every page at a phone (390px) and a desktop (1440px) width, plus a gallery page.
// Drives headless Chrome directly over the DevTools protocol (Node's built-in WebSocket), so it needs no
// extra packages. Images go to docs/screenshots/ (kept out of git: run this to make them again).
//
//   node scripts/screenshots.js [--base http://localhost:3200] [--admin-path /nx-console] [--only home,cart]
//
// Signed-in pages need test accounts on the store you point it at (never real ones), given as settings:
//   SHOT_CUSTOMER_EMAIL, SHOT_CUSTOMER_PASSWORD   My Account, cart, checkout, orders
//   SHOT_ADMIN_EMAIL, SHOT_ADMIN_PASSWORD         the admin console (needs --admin-path)
// A group whose account is missing is skipped. Screens are taken with reduced motion on, so every
// entrance animation has finished and nothing is caught half-way.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const WIDTHS = [
  {name: 'phone', width: 390, height: 844, mobile: true},
  {name: 'desktop', width: 1440, height: 900, mobile: false},
];

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--'))
      out[argv[i].slice(2)] =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true;
  }
  return out;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found)
    throw new Error(
      'Chrome or Edge was not found. Set CHROME_PATH to its program file.',
    );
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A tiny DevTools protocol client for one page.
async function openPage(port) {
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    try {
      target = await (
        await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
          method: 'PUT',
        })
      ).json();
    } catch {
      await sleep(200);
    }
  }
  if (!target) throw new Error('Chrome did not start.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const waiting = new Map();
  const listeners = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const {resolve, reject} = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method && listeners.has(message.method)) {
      listeners.get(message.method).forEach((fn) => fn(message.params));
      listeners.delete(message.method);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1;
      waiting.set(id, {resolve, reject});
      socket.send(JSON.stringify({id, method, params}));
    });
  const once = (method) =>
    new Promise((resolve) => {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(resolve);
    });
  await send('Page.enable');
  await send('Runtime.enable');
  return {send, once, close: () => socket.close()};
}

async function go(page, url) {
  const loaded = page.once('Page.loadEventFired');
  await page.send('Page.navigate', {url});
  await Promise.race([loaded, sleep(15000)]);
  await sleep(1200);
}

// Runs code in the page and returns its JSON result.
async function run(page, expression) {
  const result = await page.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function signIn(page, base, url, email, password) {
  await go(page, base + '/');
  return run(
    page,
    `fetch(${JSON.stringify(url)}, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} }) }).then(r => r.status)`,
  );
}

async function main() {
  const options = args(process.argv.slice(2));
  const base = String(options.base || 'http://localhost:3200').replace(
    /\/$/,
    '',
  );
  const adminPath = options['admin-path'] ? String(options['admin-path']) : '';
  const only = options.only ? String(options.only).split(',') : null;
  const out = path.join(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(out, {recursive: true});

  const port = 9300 + Math.floor(Math.random() * 500);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-shots-'));
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      'about:blank',
    ],
    {stdio: 'ignore'},
  );

  const shots = [];
  try {
    const page = await openPage(port);
    await page.send('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-reduced-motion', value: 'reduce'}],
    });

    const pages = [
      ['home', 'Home', '/'],
      ['products', 'All products', '/products'],
      ['category', 'Category: Running', '/products?category=running'],
      [
        'product',
        'Product page (with sizes)',
        '/products/trailflex-2-trail-running-shoes',
      ],
      ['search', 'Search results', '/products?q=shoes'],
      ['about', 'About', '/about'],
      ['contact', 'Contact', '/contact'],
      ['privacy', 'Privacy policy', '/privacy'],
      ['terms', 'Terms', '/terms'],
      ['refund-policy', 'Refund policy', '/refund-policy'],
      ['shipping-policy', 'Shipping policy', '/shipping-policy'],
      ['login', 'Sign in', '/login'],
      ['signup', 'Create account', '/signup'],
      ['forgot-password', 'Forgot password', '/forgot-password'],
      ['not-found', 'Page not found', '/no-such-page'],
    ].map(([key, title, url]) => ({group: 'Store', key, title, url}));

    // Each group is taken at both widths before the next sign-in, so the signed-out pages (sign in,
    // create account) are seen signed out, and My Account before the admin signs in.
    const capture = async (items) => {
      const wanted = only ? items.filter((p) => only.includes(p.key)) : items;
      for (const size of WIDTHS) {
        await page.send('Emulation.setDeviceMetricsOverride', {
          width: size.width,
          height: size.height,
          deviceScaleFactor: 1,
          mobile: size.mobile,
        });
        await page.send(
          'Emulation.setTouchEmulationEnabled',
          size.mobile ? {enabled: true, maxTouchPoints: 5} : {enabled: false},
        );
        fs.mkdirSync(path.join(out, size.name), {recursive: true});
        for (const item of wanted) {
          await go(page, base + item.url);
          const {data} = await page.send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 82,
          });
          const file = `${size.name}/${item.key}.jpg`;
          fs.writeFileSync(path.join(out, file), Buffer.from(data, 'base64'));
          shots.push({...item, size: size.name, file});
          process.stdout.write(`  ${file}\n`);
        }
      }
    };
    await capture(pages);

    if (process.env.SHOT_CUSTOMER_EMAIL && process.env.SHOT_CUSTOMER_PASSWORD) {
      const status = await signIn(
        page,
        base,
        '/api/login',
        process.env.SHOT_CUSTOMER_EMAIL,
        process.env.SHOT_CUSTOMER_PASSWORD,
      );
      if (status !== 200)
        throw new Error(`Customer sign-in failed (${status}).`);
      const order = await run(
        page,
        `fetch("/api/orders", { headers: { Accept: "application/json" } }).then(r => r.json()).then(d => d.orders && d.orders[0] && d.orders[0].orderId)`,
      );
      await capture(
        [
          ['cart', 'Cart', '/cart'],
          ['checkout', 'Checkout', '/checkout'],
          ['orders', 'Your orders', '/orders'],
          ...(order
            ? [
                ['order', 'Order details', `/orders/${order}`],
                ['order-success', 'Order placed', `/orders/${order}/success`],
              ]
            : []),
          ['account', 'My Account', '/account'],
          ['addresses', 'Addresses', '/account/addresses'],
          ['buy-again', 'Buy it again', '/account/buy-again'],
          ['coupons', 'Coupons', '/account/coupons'],
          ['lists', 'Wishlist and lists', '/account/lists'],
          ['recent', 'Recently viewed', '/account/recent'],
          ['security', 'Login and security', '/account/security'],
          ['notifications', 'Notifications', '/account/notifications'],
          ['referral', 'Refer a friend', '/account/referral'],
          ['help', 'Help and support', '/account/help'],
          ['wallet', 'Wallet', '/wallet'],
        ].map(([key, title, url]) => ({group: 'My Account', key, title, url})),
      );
      // The customer signs out, so the admin pages are taken with only the admin signed in.
      await run(
        page,
        `fetch("/api/logout", { method: "POST", headers: { Accept: "application/json" } }).then(r => r.status)`,
      );
    } else
      console.log(
        'No SHOT_CUSTOMER_EMAIL/PASSWORD: signed-in store pages skipped.',
      );

    if (
      adminPath &&
      process.env.SHOT_ADMIN_EMAIL &&
      process.env.SHOT_ADMIN_PASSWORD
    ) {
      const status = await signIn(
        page,
        base,
        '/api/admin/login',
        process.env.SHOT_ADMIN_EMAIL,
        process.env.SHOT_ADMIN_PASSWORD,
      );
      if (status !== 200) throw new Error(`Admin sign-in failed (${status}).`);
      const ids = await run(
        page,
        `Promise.all([
        fetch("/api/admin/products", { headers: { Accept: "application/json" } }).then(r => r.json()),
        fetch("/api/admin/coupons", { headers: { Accept: "application/json" } }).then(r => r.json()),
        fetch("/api/admin/orders", { headers: { Accept: "application/json" } }).then(r => r.json())
      ]).then(([p, c, o]) => ({ product: p.products && p.products[0] && p.products[0].id, coupon: c.coupons && c.coupons[0] && (c.coupons[0].id || c.coupons[0]._id), order: o.orders && o.orders[0] && o.orders[0].orderId }))`,
      );
      const a = adminPath;
      await capture(
        [
          ['admin-dashboard', 'Dashboard', `${a}/dashboard`],
          ['admin-analytics', 'Analytics', `${a}/analytics`],
          ['admin-orders', 'Orders', `${a}/orders`],
          ...(ids.order
            ? [['admin-order', 'Order', `${a}/orders/${ids.order}`]]
            : []),
          ['admin-returns', 'Returns', `${a}/returns`],
          ['admin-transactions', 'Transactions', `${a}/transactions`],
          [
            'admin-reconciliation',
            'Reconciliation',
            `${a}/transactions/reconciliation`,
          ],
          ['admin-refunds', 'Refunds', `${a}/refunds`],
          ['admin-abandoned', 'Abandoned carts', `${a}/abandoned-carts`],
          ['admin-coupons', 'Coupons', `${a}/coupons`],
          ['admin-coupon-new', 'New coupon', `${a}/coupons/new`],
          ...(ids.coupon
            ? [
                [
                  'admin-coupon-edit',
                  'Edit coupon',
                  `${a}/coupons/${ids.coupon}/edit`,
                ],
              ]
            : []),
          ['admin-products', 'Products', `${a}/products`],
          ['admin-product-new', 'Add product', `${a}/products/new`],
          ...(ids.product
            ? [
                [
                  'admin-product-edit',
                  'Edit product',
                  `${a}/products/${ids.product}/edit`,
                ],
              ]
            : []),
          ['admin-inventory', 'Inventory', `${a}/inventory`],
          ['admin-customers', 'Customers', `${a}/customers`],
          ['admin-settings', 'Settings', `${a}/settings`],
          ['admin-system', 'System status', `${a}/system`],
        ].map(([key, title, url]) => ({group: 'Admin', key, title, url})),
      );
    } else
      console.log(
        'No --admin-path or SHOT_ADMIN_EMAIL/PASSWORD: admin pages skipped.',
      );
    page.close();
  } finally {
    chrome.kill();
  }

  // The gallery: each page with its phone and desktop screens side by side.
  const groups = [...new Set(shots.map((s) => s.group))];
  const esc = (s) =>
    String(s).replace(
      /[&<>"]/g,
      (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c],
    );
  const section = (group) => {
    const keys = [
      ...new Set(shots.filter((s) => s.group === group).map((s) => s.key)),
    ];
    return (
      `<h2>${esc(group)}</h2>\n` +
      keys
        .map((key) => {
          const phone = shots.find((s) => s.key === key && s.size === 'phone');
          const desktop = shots.find(
            (s) => s.key === key && s.size === 'desktop',
          );
          const item = phone || desktop;
          return (
            `<figure><figcaption><strong>${esc(item.title)}</strong> <code>${esc(item.url)}</code></figcaption><div class="pair">` +
            (phone
              ? `<a href="${phone.file}"><img src="${phone.file}" alt="${esc(item.title)} on a phone" width="390" height="844" loading="lazy"></a>`
              : '') +
            (desktop
              ? `<a href="${desktop.file}"><img src="${desktop.file}" alt="${esc(item.title)} on a desktop" width="1440" height="900" loading="lazy"></a>`
              : '') +
            '</div></figure>'
          );
        })
        .join('\n')
    );
  };
  fs.writeFileSync(
    path.join(out, 'index.html'),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nexthlon screenshot set</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px 16px 64px; background: #0a0a0b; color: #f4f4ef; font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 1400px; margin: 0 auto; }
  h1 { margin: 0 0 4px; } p.lead { margin: 0 0 32px; color: #a1a1a8; }
  h2 { margin: 48px 0 16px; padding-bottom: 8px; border-bottom: 1px solid #2a2a30; }
  figure { margin: 0 0 40px; } figcaption { margin-bottom: 10px; } code { color: #d4ff3a; font-size: 13px; margin-left: 8px; }
  .pair { display: grid; grid-template-columns: minmax(0, 260px) minmax(0, 1fr); gap: 16px; align-items: start; }
  .pair img { display: block; width: 100%; height: auto; border: 1px solid #2a2a30; border-radius: 10px; }
  @media (max-width: 700px) { .pair { grid-template-columns: minmax(0, 1fr); } }
</style></head>
<body><main>
<h1>Nexthlon screenshot set</h1>
<p class="lead">${(shots.length / 2) | 0} pages, each at 390px (phone) and 1440px (desktop) wide, taken ${new Date().toISOString().slice(0, 10)} with reduced motion on. Click a screen to open it full size.</p>
${groups.map(section).join('\n')}
</main></body></html>
`,
  );
  console.log(
    `Done: ${shots.length} screenshots and docs/screenshots/index.html`,
  );
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
