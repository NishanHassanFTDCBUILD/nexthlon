// My Account end-to-end tests: ownership on lists, reviews, tickets and returns; read-only shared
// lists with no private data; log out of all devices; deleting the account; the audit log.
// They use their own database (the test database name + "_account"), so they can run alongside
// api.test.js. Like the other API tests they only run when TEST_MONGODB_URI is set.
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.TEST_MONGODB_URI) {
  test(
    'account tests (set TEST_MONGODB_URI to run them)',
    {skip: true},
    () => {},
  );
  return;
}

const mongoose = require('mongoose');
const app = require('../app');
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const AuditLog = require('../models/AuditLog');
const LoginActivity = require('../models/LoginActivity');
const {hashPassword} = require('../services/authService');
const categoryService = require('../services/categoryService');

const dbUrl = new URL(process.env.TEST_MONGODB_URI);
dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_account`;

let server;
let base;
let shoe;
let socks;

async function call(
  method,
  path,
  {body, cookie, form, headers: extra = {}} = {},
) {
  const headers = {Accept: 'application/json', Origin: base, ...extra};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + path, {
    method,
    headers,
    redirect: 'manual',
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const setCookie = response.headers.get('set-cookie') || '';
  const match = setCookie.match(/(nx_token|nx_admin)=([^;]*)/);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json')
    ? await response.json()
    : await response.text();
  return {
    status: response.status,
    data,
    location: response.headers.get('location'),
    setCookie,
    cookie: match && match[2] ? `${match[1]}=${match[2]}` : null,
  };
}

async function signUp(name, email, password = 'account2024') {
  const res = await call('POST', '/api/signup', {
    body: {name, email, password, confirmPassword: password},
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return {cookie: res.cookie, user: await User.findOne({email})};
}

async function deliveredOrder(user, product, orderId) {
  return Order.create({
    orderId,
    user: user._id,
    items: [
      {
        product: product._id,
        name: product.name,
        slug: product.slug,
        image: product.image,
        price: product.price,
        mrp: product.mrp,
        quantity: 1,
        lineTotal: product.price,
        status: 'delivered',
      },
    ],
    address: {
      fullName: user.name,
      phone: '9876543210',
      line1: '12 Track Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    },
    mrpTotal: product.mrp,
    subtotal: product.price,
    total: product.price,
    paymentMethod: 'cod',
    paymentStatus: 'paid',
    orderStatus: 'delivered',
    deliveredAt: new Date(),
  });
}

test.before(async () => {
  if (!/test/i.test(dbUrl.pathname))
    throw new Error("The account test database must have 'test' in its name.");
  await mongoose.connect(dbUrl.href);
  await mongoose.connection.dropDatabase();
  // Build every model's indexes now (unique, text). Background index builds could race with the
  // drop above and make index-dependent tests flaky.
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes()),
  );
  await User.create({
    name: 'Store Admin',
    email: 'admin@account.test',
    passwordHash: await hashPassword('AdminPass123'),
    role: 'admin',
  });
  const running = await categoryService.ensureCategory('Running');
  categoryService.invalidate();
  shoe = await Product.create({
    name: 'Account Trail Shoe',
    slug: 'account-trail-shoe',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 299900,
    mrp: 399900,
    stock: 5,
    image: '/img/favicon.svg',
  });
  socks = await Product.create({
    name: 'Account Trail Socks',
    slug: 'account-trail-socks',
    category: running._id,
    brand: 'Nexthlon',
    basePrice: 49900,
    mrp: 59900,
    stock: 9,
    image: '/img/favicon.svg',
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => server.close(resolve));
});

test('account pages: every section renders for a customer and sends guests to sign in', async () => {
  const {cookie} = await signUp('Mira Rao', 'mira@account.test');
  const pages = [
    '/account',
    '/account/orders',
    '/account/buy-again',
    '/account/addresses',
    '/account/wallet',
    '/account/coupons',
    '/account/lists',
    '/account/recent',
    '/account/security',
    '/account/notifications',
    '/account/referral',
    '/account/help',
  ];
  for (const path of pages) {
    const res = await call('GET', path, {cookie});
    assert.equal(res.status, 200, path);
    assert.match(res.data, /data-acct-nav/, path);
    assert.match(res.data, /aria-current="page"/, path);
    assert.doesNotMatch(res.data, /<script>/, path);
  }
  // The older short addresses still work.
  for (const path of ['/profile', '/orders', '/wallet', '/wishlist'])
    assert.equal((await call('GET', path, {cookie})).status, 200, path);
  assert.equal(
    (await call('GET', '/account')).location,
    '/login?next=%2Faccount',
  );
  assert.equal(
    (await call('GET', '/account/security')).location,
    '/login?next=%2Faccount%2Fsecurity',
  );
});

test('account sections: X-Partial returns only the content, without store motion; the full page stays calm', async () => {
  const {cookie} = await signUp('Pia Nair', 'pia@account.test');
  const sections = {
    '/account': 'account-overview',
    '/account/orders': 'account-orders',
    '/account/wallet': 'account-wallet',
    '/account/lists': 'account-lists',
    '/account/addresses': 'account-addresses',
    '/account/security': 'account-security',
    '/account/help': 'account-help',
    '/wishlist': 'account-lists',
  };
  for (const [path, name] of Object.entries(sections)) {
    const partial = await call('GET', path, {
      cookie,
      headers: {'X-Partial': '1'},
    });
    assert.equal(partial.status, 200, path);
    assert.match(partial.data, new RegExp(`data-page="${name}"`), path);
    assert.match(partial.data, /data-page-title="[^"]+\| Nexthlon"/, path);
    // Only the section: no document, header, sidebar or footer.
    assert.doesNotMatch(
      partial.data,
      /<html|<header|data-acct-nav|<footer|<script/,
      path,
    );

    const full = await call('GET', path, {cookie});
    assert.match(full.data, /<!doctype html>/i, path);
    assert.match(full.data, /data-acct-nav/, path);
    assert.match(full.data, /\/js\/section-nav\.js/, path);
    // No store motion on account pages.
    assert.doesNotMatch(
      full.data,
      /motion\.css|\/js\/motion\.js|footer-wave\.js|confetti\.js/,
      path,
    );
  }
  // Store pages keep their motion layer.
  assert.match((await call('GET', '/products')).data, /\/js\/motion\.js/);
  // Signed out, a partial request is sent to sign in like any other (the router then loads it in full).
  assert.equal(
    (await call('GET', '/account/wallet', {headers: {'X-Partial': '1'}}))
      .location,
    '/login?next=%2Faccount%2Fwallet',
  );
});

test('lists: create, add, move between lists, and nobody else can touch them', async () => {
  const owner = await signUp('Kabir Das', 'kabir@account.test');
  const other = await signUp('Leela Iyer', 'leela@account.test');

  assert.equal(
    (await call('POST', '/api/lists', {body: {name: ''}, cookie: owner.cookie}))
      .status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/lists', {
        body: {name: 'Wishlist'},
        cookie: owner.cookie,
      })
    ).status,
    400,
  );
  const created = await call('POST', '/api/lists', {
    body: {name: 'Gym kit'},
    cookie: owner.cookie,
  });
  assert.equal(created.status, 201);
  const listId = created.data.list.id;
  assert.equal(
    (
      await call('POST', '/api/lists', {
        body: {name: 'gym KIT'},
        cookie: owner.cookie,
      })
    ).status,
    409,
  );

  // Default wishlist -> Gym kit.
  await call('POST', '/api/wishlist', {
    body: {productId: String(shoe._id)},
    cookie: owner.cookie,
  });
  const moved = await call('POST', '/api/lists/move', {
    body: {productId: String(shoe._id), from: 'default', to: listId},
    cookie: owner.cookie,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.wishlist.count, 0);
  assert.deepEqual(
    moved.data.lists[0].items.map((i) => i.slug),
    ['account-trail-shoe'],
  );
  // Moving something that is not on the list is refused.
  assert.equal(
    (
      await call('POST', '/api/lists/move', {
        body: {productId: String(socks._id), from: listId, to: 'default'},
        cookie: owner.cookie,
      })
    ).status,
    404,
  );

  // Ownership: another customer gets "not found" for everything.
  assert.equal(
    (
      await call('PATCH', `/api/lists/${listId}`, {
        body: {name: 'Mine now'},
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (await call('DELETE', `/api/lists/${listId}`, {cookie: other.cookie}))
      .status,
    404,
  );
  assert.equal(
    (
      await call('POST', `/api/lists/${listId}/items`, {
        body: {productId: String(socks._id)},
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call('PATCH', `/api/lists/${listId}/share`, {
        body: {enabled: true},
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        'POST',
        `/api/lists/${listId}/items/${shoe._id}/move-to-cart`,
        {cookie: other.cookie},
      )
    ).status,
    404,
  );
  assert.equal(
    (await call('GET', '/api/lists', {cookie: other.cookie})).data.lists.length,
    0,
  );
  assert.equal((await call('GET', '/api/lists')).status, 401);

  // Move to cart takes it off the list.
  const toCart = await call(
    'POST',
    `/api/lists/${listId}/items/${shoe._id}/move-to-cart`,
    {cookie: owner.cookie},
  );
  assert.equal(toCart.status, 200);
  assert.equal(toCart.data.cart.summary.count, 1);
});

test('shared lists: a random read-only link with the products and nothing about the owner', async () => {
  const owner = await signUp('Priyanka Sen', 'priyanka.share@account.test');
  const createdList = await call('POST', '/api/lists', {
    body: {name: 'Race day'},
    cookie: owner.cookie,
  });
  assert.equal(createdList.status, 201, JSON.stringify(createdList.data));
  const list = createdList.data.list;
  await call('POST', `/api/lists/${list.id}/items`, {
    body: {productId: String(socks._id)},
    cookie: owner.cookie,
  });
  // Not shared yet: there is no link at all.
  assert.equal(list.sharePath, '');

  const shared = await call('PATCH', `/api/lists/${list.id}/share`, {
    body: {enabled: true},
    cookie: owner.cookie,
  });
  assert.equal(shared.status, 200);
  const path = shared.data.list.sharePath;
  assert.match(path, /^\/lists\/[A-Za-z0-9_-]{16}$/);
  assert.equal(
    (
      await call('PATCH', `/api/lists/${list.id}/share`, {
        body: {enabled: 'yes'},
        cookie: owner.cookie,
      })
    ).status,
    400,
  );

  // Anyone (signed out) can see it; no name, email or ids of the owner appear.
  const page = await call('GET', path);
  assert.equal(page.status, 200);
  assert.match(page.data, /Race day/);
  assert.match(page.data, /Account Trail Socks/);
  assert.doesNotMatch(page.data, /Priyanka|priyanka\.share@account\.test/);
  assert.doesNotMatch(page.data, new RegExp(String(owner.user._id)));
  assert.doesNotMatch(page.data, /data-list-remove|data-list-delete/);

  // Turning sharing off makes the link stop working; a guessed id never works.
  await call('PATCH', `/api/lists/${list.id}/share`, {
    body: {enabled: false},
    cookie: owner.cookie,
  });
  assert.equal((await call('GET', path)).status, 404);
  assert.equal((await call('GET', '/lists/AAAAAAAAAAAAAAAA')).status, 404);
  assert.equal((await call('GET', '/lists/not-valid')).status, 404);
  // Sharing again keeps the same link.
  const again = await call('PATCH', `/api/lists/${list.id}/share`, {
    body: {enabled: true},
    cookie: owner.cookie,
  });
  assert.equal(again.data.list.sharePath, path);
});

test('log out of all devices: every older token stops working, and sign-ins are listed', async () => {
  const {cookie} = await signUp('Arjun Mehta', 'arjun@account.test');
  const second = await call('POST', '/api/login', {
    body: {email: 'arjun@account.test', password: 'account2024'},
  });
  assert.equal(
    (await call('GET', '/api/me', {cookie: second.cookie})).status,
    200,
  );

  // Sign-up and sign-in were both recorded, with a masked IP and no raw User-Agent.
  const activity = await LoginActivity.find({}).lean();
  const mine = activity.filter(
    (row) => String(row.user) === String(second.data.user.id),
  );
  assert.equal(mine.length, 2);
  mine.forEach((row) => assert.doesNotMatch(row.ip, /\d+\.\d+\.\d+\.\d+$/));
  assert.match(
    (await call('GET', '/account/security', {cookie})).data,
    /Recent sign-ins/,
  );

  const out = await call('POST', '/api/account/logout-all', {cookie});
  assert.equal(out.status, 200);
  assert.match(out.setCookie, /nx_token=;/);
  assert.equal((await call('GET', '/api/me', {cookie})).status, 401);
  assert.equal(
    (await call('GET', '/api/me', {cookie: second.cookie})).status,
    401,
  );
  assert.equal(
    (await call('GET', '/account', {cookie: second.cookie})).location,
    '/login?next=%2Faccount&reason=expired',
  );
  // Signing in again works.
  assert.equal(
    (
      await call('POST', '/api/login', {
        body: {email: 'arjun@account.test', password: 'account2024'},
      })
    ).status,
    200,
  );
  assert.ok(await AuditLog.exists({action: 'account.logout_all'}));
});

test('changing the sign-in email needs the password; the audit log never stores secrets', async () => {
  const {cookie} = await signUp('Nisha Kapoor', 'nisha@account.test');
  await signUp('Taken Person', 'taken@account.test');
  assert.equal(
    (
      await call('PATCH', '/api/account/email', {
        body: {email: 'nisha.new@account.test', password: 'wrong-pass1'},
        cookie,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('PATCH', '/api/account/email', {
        body: {email: 'taken@account.test', password: 'account2024'},
        cookie,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call('PATCH', '/api/account/email', {
        body: {email: 'nope', password: 'account2024'},
        cookie,
      })
    ).status,
    400,
  );
  const ok = await call('PATCH', '/api/account/email', {
    body: {email: 'Nisha.New@account.test', password: 'account2024'},
    cookie,
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.email, 'nisha.new@account.test');
  assert.equal(
    (
      await call('POST', '/api/login', {
        body: {email: 'nisha.new@account.test', password: 'account2024'},
      })
    ).status,
    200,
  );

  const entry = await AuditLog.findOne({
    action: 'account.email_changed',
  }).lean();
  assert.deepEqual(entry.before, {email: 'nisha@account.test'});
  assert.deepEqual(entry.after, {email: 'nisha.new@account.test'});
  const all = JSON.stringify(await AuditLog.find({}).lean());
  assert.doesNotMatch(all, /account2024|passwordHash/);
});

test('deleting the account: password and DELETE needed, then no sign-in, but orders are kept', async () => {
  const {cookie, user} = await signUp('Rohan Gill', 'rohan@account.test');
  await deliveredOrder(user, shoe, 'NX-2026-900001');
  assert.equal(
    (
      await call('POST', '/api/account/delete', {
        body: {password: 'account2024', confirm: 'delete me'},
        cookie,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/account/delete', {
        body: {password: 'wrong-pass1', confirm: 'DELETE'},
        cookie,
      })
    ).status,
    400,
  );
  const res = await call('POST', '/api/account/delete', {
    body: {password: 'account2024', confirm: 'delete'},
    cookie,
  });
  assert.equal(res.status, 200);
  assert.match(res.setCookie, /nx_token=;/);

  assert.equal((await call('GET', '/api/me', {cookie})).status, 401);
  // A deleted account answers exactly like a wrong password.
  const login = await call('POST', '/api/login', {
    body: {email: 'rohan@account.test', password: 'account2024'},
  });
  assert.equal(login.status, 401);
  assert.equal(login.data.message, 'Incorrect email or password.');
  const stored = await User.findById(user._id).lean();
  assert.equal(stored.isDeleted, true);
  assert.ok(stored.deletedAt);
  assert.equal(await Order.countDocuments({user: user._id}), 1);
  assert.ok(
    await AuditLog.exists({
      action: 'account.deleted',
      target: `user:${user._id}`,
    }),
  );
});

test('reviews: only the author can edit or delete, and the product rating follows', async () => {
  const author = await signUp('Sara Khan', 'sara@account.test');
  const other = await signUp('Vikram Joshi', 'vikram@account.test');
  await deliveredOrder(author.user, socks, 'NX-2026-900002');
  // The "Your reviews" page is gone from My Account; reviews are deleted from the product page.
  assert.equal(
    (await call('GET', '/account/reviews', {cookie: author.cookie})).status,
    404,
  );
  const added = await call('POST', `/api/products/${socks._id}/reviews`, {
    body: {rating: 4, title: 'Comfy', body: 'Soft and warm on long runs.'},
    cookie: author.cookie,
  });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  const reviewId = added.data.review.id;

  assert.equal(
    (
      await call('PATCH', `/api/account/reviews/${reviewId}`, {
        body: {rating: 1, body: "Someone else's words."},
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call('DELETE', `/api/account/reviews/${reviewId}`, {
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call('PATCH', `/api/account/reviews/${reviewId}`, {
        body: {rating: 9, body: 'x'},
        cookie: author.cookie,
      })
    ).status,
    400,
  );

  const edited = await call('PATCH', `/api/account/reviews/${reviewId}`, {
    body: {rating: 2, title: 'Changed', body: 'They wore out after a month.'},
    cookie: author.cookie,
  });
  assert.equal(edited.status, 200);
  assert.equal((await Product.findById(socks._id).lean()).ratingAverage, 2);
  assert.equal(
    (
      await call('DELETE', `/api/account/reviews/${reviewId}`, {
        cookie: author.cookie,
      })
    ).status,
    200,
  );
  assert.equal((await Product.findById(socks._id).lean()).ratingCount, 0);
});

test('help requests: own orders only, the admin replies, and other customers cannot read them', async () => {
  const customer = await signUp('Anil Verma', 'anil@account.test');
  const other = await signUp('Bina Shah', 'bina@account.test');
  await deliveredOrder(customer.user, shoe, 'NX-2026-900003');
  await deliveredOrder(other.user, shoe, 'NX-2026-900004');

  const bad = await call('POST', '/api/support/tickets', {
    body: {
      topic: 'Order',
      subject: 'Late',
      message: 'Where is it?',
      orderId: 'NX-2026-900004',
    },
    cookie: customer.cookie,
  });
  assert.equal(bad.status, 400);
  assert.equal(
    (
      await call('POST', '/api/support/tickets', {
        body: {topic: 'Nope', subject: 'Hello', message: 'short'},
        cookie: customer.cookie,
      })
    ).status,
    400,
  );
  const made = await call('POST', '/api/support/tickets', {
    body: {
      topic: 'Order',
      subject: 'Size swap',
      message: 'Can I swap for a size 9?',
      orderId: 'nx-2026-900003',
    },
    cookie: customer.cookie,
  });
  assert.equal(made.status, 201);
  const ticketId = made.data.ticket.ticketId;
  assert.match(ticketId, /^HLP-\d{6}$/);
  assert.equal(made.data.ticket.orderId, 'NX-2026-900003');

  assert.equal(
    (await call('GET', `/account/help/${ticketId}`, {cookie: other.cookie}))
      .status,
    404,
  );
  assert.equal(
    (
      await call('POST', `/api/support/tickets/${ticketId}/messages`, {
        body: {message: 'Let me in'},
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call('POST', `/api/admin/tickets/${ticketId}/reply`, {
        body: {message: 'Hi'},
        cookie: customer.cookie,
      })
    ).status,
    401,
  );

  const admin = await call('POST', '/api/admin/login', {
    body: {email: 'admin@account.test', password: 'AdminPass123'},
  });
  const reply = await call('POST', `/api/admin/tickets/${ticketId}/reply`, {
    body: {message: 'Yes, we will arrange it.', status: 'pending'},
    cookie: admin.cookie,
  });
  assert.equal(reply.status, 200);
  assert.equal(reply.data.ticket.status, 'pending');
  assert.equal(
    (
      await call('POST', `/api/admin/tickets/${ticketId}/reply`, {
        body: {message: 'x', status: 'weird'},
        cookie: admin.cookie,
      })
    ).status,
    400,
  );
  // The admin console no longer has a tickets screen, but its API still lists them.
  assert.equal(
    (await call('GET', '/admin/tickets', {cookie: admin.cookie})).status,
    404,
  );
  const listed = await call('GET', '/api/admin/tickets', {
    cookie: admin.cookie,
  });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.tickets.some((row) => row.ticketId === ticketId));

  const page = await call('GET', `/account/help/${ticketId}`, {
    cookie: customer.cookie,
  });
  assert.match(page.data, /Yes, we will arrange it\./);
  // A customer reply reopens it.
  const back = await call('POST', `/api/support/tickets/${ticketId}/messages`, {
    body: {message: 'Thank you!'},
    cookie: customer.cookie,
  });
  assert.equal(back.data.ticket.status, 'open');
  assert.ok(await AuditLog.exists({action: 'support.replied'}));
});

test("returns can carry up to 3 real photos, saved only for the owner's returnable order", async () => {
  const customer = await signUp('Farah Ali', 'farah@account.test');
  const other = await signUp('Gita Rao', 'gita@account.test');
  await deliveredOrder(customer.user, socks, 'NX-2026-900005');
  // A real 1x1 PNG: photos are now decoded and re-saved as WebP, so a bare PNG signature would be refused.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const formWith = (files) => {
    const form = new FormData();
    form.append('reason', 'Damaged or defective');
    files.forEach((file, i) =>
      form.append(
        'photos',
        new Blob([file.data], {type: file.type}),
        file.name || `p${i}.png`,
      ),
    );
    return form;
  };
  // Someone else's order: not found, nothing saved.
  assert.equal(
    (
      await call('POST', '/api/orders/NX-2026-900005/return', {
        form: formWith([{data: png, type: 'image/png'}]),
        cookie: other.cookie,
      })
    ).status,
    404,
  );
  // A fake image is refused.
  const fake = await call('POST', '/api/orders/NX-2026-900005/return', {
    form: formWith([
      {
        data: Buffer.from('not an image at all'),
        type: 'image/png',
        name: 'fake.png',
      },
    ]),
    cookie: customer.cookie,
  });
  assert.equal(fake.status, 400);
  assert.ok(fake.data.errors.photos);
  // Four photos is too many.
  const four = await call('POST', '/api/orders/NX-2026-900005/return', {
    form: formWith([1, 2, 3, 4].map(() => ({data: png, type: 'image/png'}))),
    cookie: customer.cookie,
  });
  assert.equal(four.status, 400);

  const ok = await call('POST', '/api/orders/NX-2026-900005/return', {
    form: formWith([{data: png, type: 'image/png'}]),
    cookie: customer.cookie,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  const order = await Order.findOne({orderId: 'NX-2026-900005'}).lean();
  assert.equal(order.returnPhotos.length, 1);
  assert.match(
    order.returnPhotos[0],
    /^\/uploads\/returns\/[a-f0-9]{32}\.webp$/,
  );
  const fs = require('fs/promises');
  const path = require('path');
  await fs.unlink(path.join(__dirname, '..', 'public', order.returnPhotos[0]));
});

test('recently viewed keeps only the last 5 products, newest first', async () => {
  const accountService = require('../services/accountService');
  const {user} = await signUp('Ten Views', 'ten-views@account.test');
  const mongoose = require('mongoose');
  const ids = Array.from({length: 12}, () => new mongoose.Types.ObjectId());
  for (const id of ids) await accountService.recordView(user._id, id);
  const stored = (await User.findById(user._id).lean()).recentlyViewed.map(
    (entry) => String(entry.product),
  );
  assert.equal(stored.length, 5);
  // The seven oldest dropped off; the newest is first.
  assert.deepEqual(stored, ids.slice(7).reverse().map(String));
});

test('recently viewed is synced to the account, preferences are true/false only', async () => {
  const {cookie} = await signUp('Hari Menon', 'hari@account.test');
  await call('GET', '/products/account-trail-socks', {cookie});
  await call('GET', '/products/account-trail-shoe', {cookie});
  await call('GET', '/products/account-trail-socks', {cookie});
  // Recorded in the background: wait until it shows up (a fixed sleep was flaky under load).
  let page;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    page = await call('GET', '/account/recent', {cookie});
    if (page.data.includes('Account Trail Shoe')) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const socksAt = page.data.indexOf('Account Trail Socks');
  const shoeAt = page.data.indexOf('Account Trail Shoe');
  assert.ok(socksAt > 0 && shoeAt > socksAt, 'newest first, no repeats');
  assert.equal(
    (await call('DELETE', '/api/account/recent', {cookie})).status,
    200,
  );
  assert.match(
    (await call('GET', '/account/recent', {cookie})).data,
    /Nothing viewed yet/,
  );

  assert.equal(
    (
      await call('PATCH', '/api/account/preferences', {
        body: {offers: 'yes'},
        cookie,
      })
    ).status,
    400,
  );
  assert.equal(
    (await call('PATCH', '/api/account/preferences', {body: {}, cookie}))
      .status,
    400,
  );
  const saved = await call('PATCH', '/api/account/preferences', {
    body: {offers: false, newsletter: true, admin: true},
    cookie,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(
    saved.data.preferences,
    {orderUpdates: true, offers: false, newsletter: true},
    'only the three email choices; anything else is ignored',
  );
});
