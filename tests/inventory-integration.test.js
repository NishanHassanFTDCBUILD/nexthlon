require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');

test(
  'inventory database integration (set TEST_MONGODB_URI to a test replica set)',
  {skip: !process.env.TEST_MONGODB_URI},
  async (t) => {
    const mongoose = require('mongoose');
    const dbUrl = new URL(process.env.TEST_MONGODB_URI);
    dbUrl.pathname = `${dbUrl.pathname.replace(/\/$/, '')}_inventory_integration`;
    assert.match(
      dbUrl.pathname,
      /test/i,
      'only use a disposable test database',
    );
    const app = require('../app');
    const Product = require('../models/Product');
    const User = require('../models/User');
    const AuditLog = require('../models/AuditLog');
    const Receipt = require('../models/InventoryAdjustment');
    const inventory = require('../services/inventoryService');
    const adjustments = require('../services/inventoryAdjustmentService');
    const stock = require('../services/stockService');
    const productService = require('../services/productService');
    const mail = require('../services/mailService');
    const {signToken} = require('../services/tokenService');
    let server;
    let base;
    let admin;
    let customer;
    let packing;
    let category;

    async function call(method, route, body, user = admin) {
      const headers = {Accept: 'application/json', Origin: base};
      if (user) headers.Authorization = `Bearer ${signToken(user)}`;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const response = await fetch(base + route, {
        method,
        headers,
        redirect: 'manual',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = (response.headers.get('content-type') || '').includes('json')
        ? await response.json()
        : await response.text();
      return {status: response.status, data};
    }

    async function shoe(black = 4, blue = 2) {
      return Product.create({
        name: 'Inventory integration shoe',
        slug: `inventory-test-${randomUUID()}`,
        category: category._id,
        basePrice: 100000,
        mrp: 120000,
        stock: 0,
        image: '/img/favicon.svg',
        variants: [
          {size: '5', colour: 'Black', sku: 'SH-BLK-5', stock: black},
          {size: '6', colour: 'Blue', sku: 'SH-BLU-6', stock: blue},
        ],
      });
    }

    async function fresh(product) {
      const saved = await Product.findById(product._id).lean();
      if (saved.variants.length)
        assert.equal(
          saved.stock,
          saved.variants.reduce((sum, option) => sum + option.stock, 0),
          'the total must equal the individual size/color quantities',
        );
      assert.ok(saved.stock >= 0);
      for (const option of saved.variants) assert.ok(option.stock >= 0);
      return saved;
    }

    function body(product, overrides = {}) {
      return {
        action: 'add',
        units: 2,
        reason: 'restock',
        optionId: product.variants[0]
          ? String(product.variants[0]._id)
          : undefined,
        requestId: randomUUID(),
        ...overrides,
      };
    }

    const patch = (product, value, user) =>
      call('PATCH', `/api/admin/inventory/${product._id}`, value, user);
    const combination = (product, value) =>
      call('POST', `/api/admin/inventory/${product._id}/combinations`, value);
    const expectStatus = (response, status) =>
      assert.equal(response.status, status, JSON.stringify(response.data));
    const context = () => ({actor: admin._id, actorRole: 'admin'});

    try {
      await mongoose.connect(dbUrl.href, {serverSelectionTimeoutMS: 10000});
      if (!(await stock.supportsTransactions())) {
        t.skip('stock adjustment integration requires a replica set');
        return;
      }
      await mongoose.connection.dropDatabase();
      await Promise.all(
        Object.values(mongoose.models).map((model) => model.init()),
      );
      mail.useTestOutbox([]);
      category = await require('../services/categoryService').ensureCategory(
        'Running',
      );
      [admin, customer, packing] = await User.create([
        {
          name: 'Inventory Owner',
          email: 'owner@inventory.test',
          passwordHash: 'test-only',
          role: 'admin',
        },
        {
          name: 'Inventory Customer',
          email: 'customer@inventory.test',
          passwordHash: 'test-only',
        },
        {
          name: 'Inventory Packer',
          email: 'packer@inventory.test',
          passwordHash: 'test-only',
          role: 'admin',
          adminRole: 'packing',
        },
      ]);
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      base = `http://127.0.0.1:${server.address().port}`;

      await t.test(
        'add, remove and zero count persist only on the selected combination',
        async () => {
          const product = await shoe();
          expectStatus(await patch(product, body(product, {units: 3})), 200);
          let saved = await fresh(product);
          assert.deepEqual(
            saved.variants.map((option) => option.stock),
            [7, 2],
          );
          expectStatus(
            await patch(
              product,
              body(product, {action: 'remove', units: 2, reason: 'damage'}),
            ),
            200,
          );
          saved = await fresh(product);
          assert.deepEqual(
            saved.variants.map((option) => option.stock),
            [5, 2],
          );
          expectStatus(
            await patch(
              product,
              body(product, {
                action: 'count',
                units: 0,
                expectedStock: 5,
                reason: 'stock_count',
              }),
            ),
            200,
          );
          saved = await fresh(product);
          assert.deepEqual(
            saved.variants.map((option) => option.stock),
            [0, 2],
          );
          const view = await inventory.currentStock(product._id);
          assert.equal(view.product.options[0].state, 'out');
          assert.equal(view.product.stock, 2);
          assert.equal(
            await AuditLog.countDocuments({
              target: `product:${product._id}`,
              action: 'inventory.stock_changed',
            }),
            3,
          );
        },
      );

      await t.test(
        'new color/size persists, reuses canonical spelling and appears on the storefront',
        async () => {
          const product = await shoe();
          const value = {
            size: '7',
            colour: 'black',
            units: 6,
            requestId: randomUUID(),
          };
          const response = await combination(product, value);
          expectStatus(response, 200);
          assert.equal(response.data.optionCreated, true);
          expectStatus(await combination(product, value), 200);
          let saved = await fresh(product);
          assert.equal(saved.variants.length, 3);
          assert.deepEqual(
            saved.variants.map((option) => option.stock),
            [4, 2, 6],
          );
          assert.equal(saved.variants[2].colour, 'Black');
          const optionId = String(saved.variants[2]._id);
          expectStatus(
            await combination(product, {
              ...value,
              colour: 'BLACK',
              requestId: randomUUID(),
              units: 2,
            }),
            200,
          );
          saved = await fresh(product);
          assert.equal(saved.variants.length, 3);
          assert.equal(String(saved.variants[2]._id), optionId);
          assert.equal(saved.variants[2].stock, 8);
          const storefront = await productService.getProduct(product.slug);
          assert.equal(
            storefront.variants.find(
              (option) => String(option._id) === optionId,
            ).stock,
            8,
          );
          const page = await call(
            'GET',
            `/products/${product.slug}`,
            undefined,
            customer,
          );
          expectStatus(page, 200);
          assert.match(page.data, /data-options-json/);
          assert.ok(page.data.includes(optionId));
        },
      );

      await t.test(
        'concurrent retries commit one stock change, receipt and audit',
        async () => {
          const product = await shoe();
          const value = body(product);
          const replies = await Promise.all(
            Array.from({length: 5}, () => patch(product, value)),
          );
          replies.forEach((response) => expectStatus(response, 200));
          assert.equal((await fresh(product)).variants[0].stock, 6);
          assert.equal(
            await Receipt.countDocuments({
              actor: admin._id,
              requestId: value.requestId,
            }),
            1,
          );
          assert.equal(
            await AuditLog.countDocuments({'after.requestId': value.requestId}),
            1,
          );
          expectStatus(await patch(product, {...value, units: 3}), 409);
          assert.equal((await fresh(product)).variants[0].stock, 6);
        },
      );

      await t.test(
        'independent concurrent additions all persist without losing any units',
        async () => {
          const product = await shoe();
          const replies = await Promise.all(
            Array.from({length: 6}, () => patch(product, body(product))),
          );
          replies.forEach((response) => expectStatus(response, 200));
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [16, 2],
          );
        },
      );

      await t.test(
        'stale physical counts cannot overwrite a checkout or another admin change',
        async () => {
          const product = await shoe();
          await stock.takeStock([
            {
              product: product._id,
              variant: product.variants[0]._id,
              quantity: 1,
              name: product.name,
            },
          ]);
          expectStatus(
            await patch(
              product,
              body(product, {
                action: 'count',
                units: 9,
                expectedStock: 4,
                reason: 'stock_count',
              }),
            ),
            409,
          );
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [3, 2],
          );
        },
      );

      await t.test(
        'negative stock, invalid quantities and missing adjustment references are rejected',
        async () => {
          const product = await shoe();
          for (const units of [-1, 0, 1.5, 100001])
            expectStatus(await patch(product, body(product, {units})), 400);
          expectStatus(
            await patch(product, body(product, {action: 'remove', units: 5})),
            400,
          );
          expectStatus(
            await patch(product, body(product, {requestId: undefined})),
            400,
          );
          expectStatus(
            await patch(product, body(product, {action: 'count', units: 1})),
            400,
          );
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [4, 2],
          );
        },
      );

      await t.test(
        'a failed restock rolls back its new combination as well as its receipt',
        async () => {
          const product = await shoe(99999, 1);
          const value = {
            size: '7',
            colour: 'White',
            units: 1,
            requestId: randomUUID(),
          };
          expectStatus(await combination(product, value), 400);
          const saved = await fresh(product);
          assert.equal(saved.variants.length, 2);
          assert.equal(saved.stock, 100000);
          assert.equal(
            await Receipt.countDocuments({
              actor: admin._id,
              requestId: value.requestId,
            }),
            0,
          );
        },
      );

      await t.test(
        'simultaneous creation of the same new combination produces one row',
        async () => {
          const product = await shoe();
          const replies = await Promise.all(
            Array.from({length: 3}, () =>
              combination(product, {
                size: '7',
                colour: 'White',
                units: 2,
                requestId: randomUUID(),
              }),
            ),
          );
          replies.forEach((response) => expectStatus(response, 200));
          const saved = await fresh(product);
          assert.equal(saved.variants.length, 3);
          assert.deepEqual(
            saved.variants.map((option) => option.stock),
            [4, 2, 6],
          );
        },
      );

      await t.test(
        'general stock is not silently reassigned to a new size or color',
        async () => {
          const product = await shoe();
          product.variants = [];
          product.stock = 8;
          await product.save();
          expectStatus(
            await combination(product, {
              size: '7',
              colour: 'White',
              units: 2,
              requestId: randomUUID(),
            }),
            409,
          );
          assert.equal((await fresh(product)).stock, 8);
          assert.equal((await fresh(product)).variants.length, 0);
          expectStatus(
            await patch(product, {
              ...body(product, {optionId: undefined}),
              units: 2,
            }),
            200,
          );
          assert.equal((await fresh(product)).stock, 10);
        },
      );

      await t.test(
        'an old option cannot change a product that now has general stock',
        async () => {
          const product = await shoe();
          const value = body(product);
          product.variants = [];
          product.stock = 8;
          await product.save();
          expectStatus(await patch(product, value), 409);
          assert.equal((await fresh(product)).stock, 8);
          assert.equal(
            await Receipt.countDocuments({
              actor: admin._id,
              requestId: value.requestId,
            }),
            0,
          );
        },
      );

      await t.test(
        'cart reload uses new stock and prevents adding a sold-out combination',
        async () => {
          const product = await shoe();
          expectStatus(
            await call(
              'POST',
              '/api/cart/items',
              {
                productId: String(product._id),
                variantId: String(product.variants[0]._id),
                quantity: 3,
              },
              customer,
            ),
            201,
          );
          expectStatus(
            await patch(
              product,
              body(product, {
                action: 'count',
                units: 1,
                expectedStock: 4,
                reason: 'stock_count',
              }),
            ),
            200,
          );
          let cart = await call('GET', '/api/cart', undefined, customer);
          expectStatus(cart, 200);
          let line = cart.data.cart.items.find(
            (item) => item.productId === String(product._id),
          );
          assert.equal(line.stock, 1);
          assert.equal(line.quantity, 1);
          expectStatus(
            await patch(
              product,
              body(product, {
                action: 'count',
                units: 0,
                expectedStock: 1,
                reason: 'stock_count',
              }),
            ),
            200,
          );
          cart = await call('GET', '/api/cart', undefined, customer);
          line = cart.data.cart.items.find(
            (item) => item.productId === String(product._id),
          );
          assert.equal(line.available, false);
          expectStatus(
            await call(
              'POST',
              '/api/cart/items',
              {
                productId: String(product._id),
                variantId: String(product.variants[0]._id),
                quantity: 1,
              },
              customer,
            ),
            400,
          );
        },
      );

      await t.test(
        'two shoppers cannot buy the last unit; a retried cancellation returns it once',
        async () => {
          const product = await shoe(1, 2);
          const lines = [
            {
              product: product._id,
              variant: product.variants[0]._id,
              quantity: 1,
              name: product.name,
            },
          ];
          const keys = [randomUUID(), randomUUID()];
          const outcomes = await Promise.allSettled(
            keys.map((key) => stock.takeStockOnce(lines, key)),
          );
          assert.equal(
            outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
            1,
          );
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [0, 2],
          );
          const winner =
            keys[
              outcomes.findIndex((outcome) => outcome.status === 'fulfilled')
            ];
          await stock.takeStockOnce(lines, winner);
          const cancelKey = randomUUID();
          await stock.returnStockOnce(lines, cancelKey, winner);
          await stock.returnStockOnce(lines, cancelKey, winner);
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [1, 2],
          );
        },
      );

      await t.test(
        'bulk restock preview and repeated apply save each row once',
        async () => {
          const product = await shoe();
          const imports = require('../services/inventoryImportService');
          const preview = await imports.preview(
            {
              rows: [
                {
                  productId: String(product._id),
                  optionId: String(product.variants[0]._id),
                  units: 2,
                  reason: 'restock',
                },
                {
                  productId: String(product._id),
                  optionId: String(product.variants[1]._id),
                  units: 3,
                  reason: 'restock',
                },
              ],
            },
            admin._id,
          );
          assert.equal(preview.valid, true);
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [4, 2],
          );
          const apply = () =>
            imports.apply(preview.batchId, admin._id, (id, value) =>
              adjustments.apply(context(), id, value),
            );
          assert.equal(
            (await apply()).results.filter((row) => row.status === 'applied')
              .length,
            2,
          );
          await apply();
          assert.deepEqual(
            (await fresh(product)).variants.map((option) => option.stock),
            [6, 5],
          );
        },
      );

      await t.test(
        'unauthorized roles cannot change stock; read-only inventory hides its editor',
        async () => {
          const product = await shoe();
          expectStatus(await patch(product, body(product), null), 401);
          expectStatus(await patch(product, body(product), customer), 401);
          expectStatus(await patch(product, body(product), packing), 403);
          const page = await call(
            'GET',
            '/admin/inventory',
            undefined,
            packing,
          );
          expectStatus(page, 200);
          assert.ok(!page.data.includes('data-stock-drawer-form'));
          assert.equal((await fresh(product)).stock, 6);
        },
      );

      await t.test(
        'inventory export contains distinct option IDs and persisted counts',
        async () => {
          const product = await shoe();
          expectStatus(await patch(product, body(product, {units: 3})), 200);
          const response = await call('GET', '/api/admin/inventory/export.csv');
          expectStatus(response, 200);
          const {parseCsv} = require('../utils/parseCsv');
          const [header, ...rows] = parseCsv(response.data, {
            maxBytes: 1000000,
            maxColumns: 20,
            maxRows: 2000,
          });
          const matches = rows.filter(
            (row) => row[header.indexOf('productId')] === String(product._id),
          );
          assert.equal(matches.length, 3);
          const option = matches.find(
            (row) =>
              row[header.indexOf('optionId')] ===
              String(product.variants[0]._id),
          );
          assert.equal(Number(option[header.indexOf('Stock')]), 7);
        },
      );
    } finally {
      mail.useTestOutbox(null);
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
      if (mongoose.connection.readyState === 1)
        await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    }
  },
);
