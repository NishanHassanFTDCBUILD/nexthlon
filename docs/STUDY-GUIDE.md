# Nexthlon Study Guide

How to study this project from zero, in the right order, one file at a time.
Every "what it does" below comes from reading the actual code. When a file is not
explained line by line, the guide says "open it and read" rather than guess.

---

## 0. The big picture (read this first, 10 minutes)

Nexthlon is a sports gear store.

| Layer | Technology | Where |
|---|---|---|
| Web server | Node.js + Express 4 | `server.js`, `app.js` |
| Pages (HTML) | EJS templates, rendered on the server | `views/` |
| Database | MongoDB through Mongoose | `models/`, `config/db.js` |
| Login | JWT in HttpOnly cookies + revocable refresh token | `middleware/auth.js`, `services/tokenService.js` |
| Payments | Razorpay (online), wallet, cash on delivery | `services/paymentService.js`, `razorpayService.js` |
| Browser code | Plain JavaScript, no framework; WebGL 3D | `public/js/` |
| Styling | Plain CSS with design tokens | `public/css/` |
| Background work | A job queue stored in MongoDB | `jobs/`, `events/` |
| Tests | Node's built-in test runner | `tests/` |

**The one idea that explains the whole backend:** every feature is the same four-layer chain.

```
Browser  →  route  →  controller  →  service  →  model (MongoDB)
            (URL)     (HTTP in/out)  (business rules)  (data shape)
```

- **Route** (`routes/`): "this URL, this HTTP method, these guards, call this controller."
- **Controller** (`controllers/`): reads `req`, validates input, calls a service, sends `res`. No business rules.
- **Service** (`services/`): the real logic. Prices, stock, coupons, orders. Knows nothing about HTTP.
- **Model** (`models/`): the shape of a MongoDB document, its indexes and its hooks.
- **utils/** are small pure helpers used by every layer (money, pricing, validators).

Money rule you must remember: **all money is stored as integer paise** (₹1 = 100 paise).
`12345600` shows as ₹1,23,456. That is why the sums are exact.

---

## 1. Study order (the roadmap)

Do these in order. Do not jump to the 3D or admin code first.

| Step | Topic | Files | Time |
|---|---|---|---|
| 1 | JavaScript + Node basics you need | see section 2 | as needed |
| 2 | Start the app and click around | section 3 | 30 min |
| 3 | Startup and config | `server.js`, `config/env.js`, `config/schema.js`, `config/db.js` | 1 hr |
| 4 | The request pipeline | `app.js` | 1 hr |
| 5 | One complete slice: the cart | section 6 | 2 hr |
| 6 | Login and sessions | section 7 | 2 hr |
| 7 | Checkout, stock, orders | section 8 | 3 hr |
| 8 | Pricing and money | `utils/pricing.js`, `utils/money.js` | 1 hr |
| 9 | Background jobs and events | section 9 | 1 hr |
| 10 | Views (EJS) and browser JS | section 10 | 3 hr |
| 11 | Admin console | section 11 | 2 hr |
| 12 | Scale, security, ops | section 12 | 2 hr |
| 13 | 3D and motion | section 13 | 3 hr |
| 14 | Tests, then change something | sections 14-15 | ongoing |

---

## 2. What to learn first (so the code is readable)

You only need these, in this order:

1. JavaScript: `const/let`, arrow functions, destructuring, spread (`...obj`), `async/await`, `Promise`, modules via `require` / `module.exports`.
2. HTTP: GET/POST/PATCH/DELETE, status codes (200, 201, 400, 401, 403, 404, 409), cookies, JSON.
3. Express: middleware is a function `(req, res, next)`. Routers group URLs. Order matters.
4. MongoDB + Mongoose: a Schema, `find`, `findOne`, `updateOne`, `$inc`, indexes, `populate`.
5. EJS: `<%= value %>` prints escaped, `<%- html %>` prints raw, `<% code %>` runs code, `include('partial')`.
6. Browser: `fetch`, `document.querySelector`, `data-*` attributes, events.

---

## 3. Run it and look at it

```bash
npm install
cp .env.example .env     # then fill MONGODB_URI and JWT_SECRET
npm run setup:check      # checks your .env
npm run seed:products
npm run seed:admin
npm run dev              # nodemon server.js
npm test                 # node --test, runs tests/*.test.js
```

Open http://localhost:3000. Then:

1. Browse products. Add one to the cart **without logging in** (guest cart).
2. Sign up, log in. Notice the cart is still there (guest cart merged).
3. Check out with cash on delivery.
4. Open the browser DevTools → Network tab and watch the `/api/...` calls while you do all of the above. This single exercise teaches you the whole API.
5. Log into the admin console (path is `ADMIN_PATH` in `.env`) and find your order.

---

## 4. Startup: `server.js` explained block by block

File: `server.js` (173 lines).

**Lines 1-7: load config, or die.**
`require("./config/env")` validates every `.env` setting. If something is wrong it prints *all* problems at once and exits. Never start a half-configured server.

**Lines 9-15: tools.** `cluster` (Node's multi-process module), the `logger`, error `monitor` (Sentry, optional), and `lifecycle` (a flag for "we are shutting down"). `monitor.init()` runs first so even startup crashes are reported.

**Line 21: the big decision.**
```js
if (config.webConcurrency > 1 && cluster.isPrimary) startSupervisor();
else startServer();
```
One Node process uses one CPU core. If `WEB_CONCURRENCY` is above 1 (or `"auto"`), this process becomes a **supervisor** that starts one copy of the server per core. Otherwise it just starts one server.

**`startSupervisor()` (lines 24-81):**
- Forks N copies, tagging each with `NX_COPY=index`.
- Runs database migrations **once** (`migrationService.runMigrations`), on its own connection, then closes it. Copies get `NX_SKIP_MIGRATIONS=1` so they do not all migrate at once.
- If a copy crashes it restarts it, but never more than 5 times a minute (then waits 30 s). This avoids a crash loop.
- On SIGTERM/SIGINT it tells all copies to stop, with a 15 s backstop.

**`startServer()` (lines 83-173):**
- Loads `app` (the Express app), the DB connector, and the job worker.
- **Only copy 0 runs background jobs** (`runsJobs`), so emails are not sent N times.
- `shutdown()` is graceful: stop accepting visitors → let running requests finish → stop the job worker → close Redis → close MongoDB → flush error reports → exit. A 10 s timer forces exit if it hangs.
- `unhandledRejection`: log and keep running. `uncaughtException`: log, report, **exit** (state is unknown, let the host restart it).
- Then: connect DB → run migrations (unless the supervisor did) → `app.listen(port, "0.0.0.0")`.
- `keepAliveTimeout = 65s`, `headersTimeout = 66s`: deliberately longer than a load balancer's 60 s, so the server never reuses a connection the balancer already closed.

**Why it matters:** this file is why the app survives deploys, crashes and many CPUs. Interviewers love this.

---

## 5. The request pipeline: `app.js` explained in order

Express runs middleware **top to bottom**. The order in `app.js` is the order a request travels.

| # | Line | What it does | Why here |
|---|---|---|---|
| 1 | `require("./jobs/handlers")` | Registers what happens on events (order emails) | Before any order code can emit |
| 2 | `cacheSync.start()` | With Redis, clearing the catalogue cache on one copy clears all copies | |
| 3 | `app.disable("x-powered-by")` | Hides "Express" header | Tells attackers less |
| 4 | `trust proxy` | Believe the hosting proxy for real IP and https | Rate limits and Secure cookies need it |
| 5 | `requestId` | Gives every request an ID used in logs/errors | First, so everything has one |
| 6 | `healthRoutes` | Liveness / readiness for the host | Before heavy middleware |
| 7 | `view engine ejs` | Templates live in `views/` | |
| 8 | `helmet({...})` | Security headers + Content Security Policy | Only allows own scripts, Razorpay, Unsplash, the photo bucket |
| 9 | `compression()` | gzip text responses | ~70% smaller |
| 10 | `/css/bundle.css` + `express.static` | Serves `public/` with smart caching | `?v=hash` files cached 1 year (immutable); others re-checked |
| 11 | `noCache` | Everything after this is never cached | Static files above keep their caching |
| 12 | Razorpay **webhook** | Uses `express.raw` | Signature check needs the exact raw bytes, so it must come **before** `express.json` and before `originCheck` |
| 13 | `express.json({limit:"20kb"})`, `urlencoded` | Parse bodies, small limit | Stops giant payloads |
| 14 | `cookieParser` | Fills `req.cookies` | JWT lives in a cookie |
| 15 | `viewLocals` | Puts helpers (`formatPrice`, `icon`, `asset`...) into every template | |
| 16 | `attachUser` | Works out who is logged in → `req.user` | See section 7 |
| 17 | `cartCount` | Header cart badge number | |
| 18 | `navCategories` | Menu categories for every page | |
| 19 | `app.use("/api", originCheck)` | CSRF-style defence: checks the Origin header on API writes | |
| 20 | API routers | `/api/...` JSON endpoints | |
| 21 | `adminPageRoutes` at `config.adminPath` | Admin pages at a private URL | |
| 22 | `pageRoutes` at `/` | Store pages (EJS) | |
| 23 | `notFound`, `errorHandler` | 404 and the single place errors become responses | Must be last |

**Study exercise:** add `console.log(req.method, req.url)` as middleware at different positions and watch what changes.

---

## 6. Worked example 1: the cart, end to end

This is the best file set to learn the architecture. Read them in this order.

### 6.1 Route: `routes/cartRoutes.js`
```js
router.use(cartLimiter, cartOwner);          // runs for every cart URL
router.get("/", cart.getCart);
router.post("/items", cart.addItem);
router.patch("/items/:productId", cart.updateItem);
router.delete("/items/:productId", cart.removeItem);
router.post("/items/:productId/save-for-later", requireAuth, requireRole("customer"), saveForLater);
```
- Mounted at `/api/cart` in `app.js`, so `POST /api/cart/items` is "add to cart".
- `cartLimiter` (rate limit) then `cartOwner` (who owns this cart).
- "Save for later" additionally needs a real account (`requireAuth`, `requireRole`) because the wishlist belongs to an account.

### 6.2 Middleware: `middleware/guestCart.js`
Decides `req.cartOwner`:
- Logged-in customer → their user id.
- Guest → `{ guest: <hash> }`. A random 32-byte token is put in the httpOnly cookie `nx_cart`; **the database stores only its SHA-256 hash**, so a leaked database cannot be used to steal guest carts.
- A GET from a guest with no cart returns `null` (empty cart) and does **not** create a cookie. Cookies are only created on the first change.
- `nx_has_cart` is a *readable* twin cookie that holds no secret; it lets the page ask for the badge count after load, so the HTML itself can be identical for every guest and cached by a CDN.
- If the login expired it answers 401 so the browser renews it, instead of silently showing an empty guest cart.

### 6.3 Controller: `controllers/cartController.js`
Pattern repeated everywhere:
```js
const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity } = checked(validateCartItem, req.body); // 1. validate
  const { product, cart } = await cartService.addItem(req.cartOwner, productId, quantity); // 2. service
  res.status(201).json({ message: `${product.name} added to your cart.`, cart }); // 3. respond
});
```
- `asyncHandler` (in `utils/http.js`) catches a thrown error and passes it to `next`, so you can just `throw`.
- `checked()` throws `HttpError(400, firstMessage, allFieldErrors)` if validation fails.
- The controller has **no** rules about stock or price. That lives in the service.

### 6.4 Service: `services/cartService.js`
The rules, in one place:
- `MAX_PER_PRODUCT = 5`.
- `isSold(product)`: listed and its category listed. `isAvailable`: sold and `stock > 0`.
- `limitFor(product)`: `min(stock, 5)`.
- `quantityProblem(product, qty)`: returns a message or `null`. Every quantity rule is here.
- `buildCartView(lines)`: turns stored lines into what the UI shows. **Prices always come from the product in the database**, never from the cart. Unavailable lines stay visible but are excluded from totals. It also computes `subtotal`, `mrpTotal`, `savings`, `deliveryFee`, `freeDeliveryGap`, `grandTotal`.
- `storeFor(owner)`: the *only* difference between a guest and a customer is which model is used (`GuestCart` vs `Cart`).
- `findOrCreateCart`: an atomic upsert with `$setOnInsert`. If two first-time adds race, one hits duplicate-key error `11000` and just reads the cart the other made.
- `getCart(owner)`: loads with `.populate("items.product")` so prices are live.

### 6.5 Model: `models/Product.js`
- Price fields: `basePrice`, `mrp`, `offerPercent`, `categoryOffer`, then the computed `price`, `bestOffer`, `discountPercent`.
- `pre("validate")` hook recalculates the price using `priceFor()` **on every save**, so the price can never be set by a form.
- Indexes: compound ones for filtering/sorting listings, and a **text index** (name weight 10, brand 5, description 1) for search.
- `post(...)` hooks call `memo.forget("catalog:")` after any change, so the cached catalogue is cleared.

### 6.6 Tests for it: `tests/cart.test.js`
Pure-function tests with no database, e.g. "quantity can never go above stock", "delivery is free from ₹499". **Reading the tests is the fastest way to learn the rules.**

### 6.7 Browser side
`views/pages/cart.ejs` renders the first version of the cart on the server, with `data-*` hooks (`data-cart-item`, `data-cart-step`, `data-cart-qty`). `public/js/cart.js` finds those hooks, calls the API with `Nx.api(...)`, and updates the DOM from the JSON the server returns.

**Exercise:** trace "click + on an item" through every file above. Write the list yourself, then check it.

---

## 7. Worked example 2: login and sessions

Files: `middleware/auth.js`, `services/tokenService.js`, `services/refreshTokenService.js`, `models/RefreshToken.js`, `controllers/authController.js`, `public/js/app.js`.

### The design
Three cookies per session:
| Cookie | Holds | Sent to | Lifetime |
|---|---|---|---|
| `nx_token` | Short-lived **access JWT** | every request | ~15 min |
| `nx_refresh` | Long-lived random **refresh token** | **only** `/api/auth/refresh` (cookie `path`) | days |
| `nx_sid` | A session label, grants nothing | | used to show "this device" |

Admins have a separate set (`nx_admin`, `nx_admin_refresh`, `nx_admin_sid`), a different JWT audience (`nexthlon-admin` vs `nexthlon-web`), `SameSite=Strict`, and a shorter life. **A customer token can never open the admin console.**

### How `attachUser` works (runs on every request)
1. `scopeOf(req)`: admin paths → "admin", everything else → "customer". Each only reads its own cookie.
2. `readToken`: a `Bearer` header (Postman/mobile) or the cookie.
3. `verifyToken` checks signature, issuer, audience, expiry, algorithm HS256.
4. Loads the user from MongoDB and checks: exists, right role, not deleted, **`tokenVersion` matches** (bumping it on password change instantly kills all old tokens), not blocked.
5. Sets `req.user` or `req.authProblem` ("expired" / "blocked").
6. If the access cookie is bad it clears **only** that cookie, never the refresh cookie. The refresh token is what renews it.

### Why two tokens?
A JWT cannot be cancelled once issued, so it must expire fast. The refresh token **can** be revoked (it is stored in MongoDB), so it may live for days. The browser's `Nx.api()` in `public/js/app.js` handles it: on a 401 it calls `/api/auth/refresh` **once** (several simultaneous 401s share one renewal, because rotation would otherwise look like token theft) and replays the original request.

### Guards (in `middleware/auth.js`)
- `requireAuth` / `requireRole("customer")`: API guards, reply JSON 401/403.
- `customerPage`: redirects to `/login?next=...`.
- `adminPage`: **returns a plain 404** to non-admins, so the console's existence is not revealed.
- `guestOnly`: signed-in users skip login/signup pages.

Also read `utils/http.js` `safeNextPath()`: the `next=` redirect must be a local path, never `//evil.com` (open-redirect protection).

---

## 8. Worked example 3: checkout, stock and orders

Files: `services/checkoutService.js`, `services/stockService.js`, `utils/pricing.js`, `utils/transaction.js`, `models/Order.js`, `services/couponService.js`, `services/walletService.js`.

### 8.1 Never trust the browser's prices
`buildQuote(userId, {useWallet, source})` recomputes everything on the server: cart items (or the single "Buy now" product), wallet balance, coupon (re-checked), COD limit. The browser only says *whether* to use the wallet. `publicQuote` returns only what the browser may see.

### 8.2 `placeOrder()` step by step
1. Method must be `cod` or `wallet` (online goes through `paymentService`).
2. `findAddress`: the address must belong to this user.
3. `buildQuote`, then `assertOrderable` (cart not empty, nothing unavailable, coupon still valid).
4. If the wallet covers the whole amount the order becomes a "wallet" order. COD is refused if above the COD limit.
5. `nextOrderId()` → `NX-2026-000123` (year in India time + a counter from `counterService`).
6. **`stockService.withStock(lines, work)`**:
   - `takeStock` does, per product, one atomic operation: `updateOne({_id, listed, stock: {$gte: qty}}, {$inc: {stock: -qty}})`. If it modified 0 documents, someone else bought it first → HttpError 409 "just sold out". **Two shoppers can never buy the last item and stock never goes below 0.**
   - It runs inside a MongoDB **transaction** when the server supports one (replica set). On a single server it falls back to `undo` callbacks that put things back (`utils/transaction.js`).
   - Inside `work`: `saveOrder` redeems the coupon, debits the wallet, creates the `Order` with **snapshots** of name/price/address (so later price edits never change old orders), then clears the cart.
   - All of it happens, or none of it.
7. **After** it is saved: `events.emit("order.placed", { orderId }, { key: orderId })`.

### 8.3 Pricing rules (`utils/pricing.js`, read the whole file)
- Best of product offer and category offer applies. They never add up.
- `price = floor(basePrice × (100 − offer) / 100 + 0.5)` (round half up).
- Delivery: free from `STORE.freeDeliveryMin` (₹499), else a flat fee, measured before coupon.
- Coupon: percent is rounded down to whole rupees, capped by `maxDiscount`, never above the subtotal. `couponProblem()` returns the reason or `null`.
- `orderTotals`: `payable = subtotal − coupon + delivery`; `total = payable − walletUsed`.
- `PRICE_PIPELINE` is the *same maths* as a MongoDB update pipeline for repricing many products at once. A test keeps the two in sync.

**Exercise:** write down by hand the total for 2 × ₹2,999 shoes with a 10% coupon and the wallet holding ₹100. Then find the matching test and confirm.

---

## 9. Background jobs and events

Files: `events/index.js`, `jobs/queue.js`, `jobs/worker.js`, `jobs/registry.js`, `jobs/handlers.js`, `events/listeners/orderEmails.js`, `models/Job.js`.

**Idea:** the code that places an order only *announces* it. Emails (and later WhatsApp, etc.) are listeners.
```js
events.on("order.placed", "email", handler);                       // once at startup
events.emit("order.placed", { orderId }, { key: orderId });        // where it happens
```
- Each listener becomes a **job saved in MongoDB**, so it survives restarts.
- `key` makes it idempotent: the same event+key is queued once (`dedupeKey` + duplicate-key `11000`). A double click cannot send two emails.
- `emit` never throws. A broken email must never fail an order that is already saved.
- `queue.claim()` takes the next due job in **one atomic `findOneAndUpdate`**, so two workers never run the same job. A job held past its lease (worker died, 5 min) becomes claimable again.
- Failures retry with exponential backoff: 30 s, 2 min, 8 min, 32 min, then 2 h, with ±20% jitter. `error.permanent` stops retrying.
- Done jobs are kept 7 days, failed 30 (the `deleteAt` field).
- Tools: `npm run jobs:status`, `npm run jobs:retry`, `npm run worker`.

---

## 10. Views and browser JavaScript

### Server-rendered pages
- `views/pages/*.ejs` are pages. `views/partials/*.ejs` are reused pieces (`head`, `header`, `footer`, `product-card`, `scripts`).
- `controllers/pageController.js` calls `res.render("pages/home", data)` after asking a service for the data. Read the first 70 lines.
- `middleware/viewLocals.js` gives templates helpers: `formatPrice`, `icon`, `asset`, `sizedUrl`.
- `views/partials/scripts.ejs` is the script loader: `ticker.js` first (the shared animation loop), then `app.js`, `header.js`, `store.js`, optional `motion.js`, then each page's own `scripts` list, then ES `modules` (the 3D engine). All use `defer`, and `asset()` adds `?v=hash`.
- Security detail: the CSP forbids inline scripts, so page behaviour is in files, and templates pass data through `data-*` attributes.

### Browser files (`public/js/`), by job
| File(s) | Job |
|---|---|
| `app.js` | **Read first.** `Nx.api`, money formatting, session renewal, toasts, form errors |
| `header.js`, `store.js` | header/menu, badge, search panel |
| `cart.js`, `checkout.js`, `payment.js` | cart UI, checkout, Razorpay |
| `catalog.js`, `product.js`, `home.js` | listing/filters, product page, home |
| `account.js`, `profile.js`, `auth.js` | account area, forms |
| `admin*.js`, `section-nav.js` | admin console; `section-nav` swaps sections without reload using the `X-Partial: 1` header |
| `motion.js`, `motion/ticker.js` | scroll/reveal animation on one shared requestAnimationFrame loop |
| `theme.js` | light/dark |

`app.js` key ideas to study line by line:
- `Nx.formatPrice(paise)`: `Intl.NumberFormat("en-IN")`, drops ".00".
- `Nx.photoSized(url, width)`: picks `-200/-400/-800/-1600.webp` variants of your own uploads, or rewrites Unsplash `w=`.
- `send()`: never throws for HTTP errors, returns `{response, data}`; throws only on network failure.
- `renewSession()`: a single shared in-flight promise.

### CSS (`public/css/`)
Start with `tokens.css` (colours, spacing, radii: the design system), then `style.css`, `components.css`, then the page files. `mobile.css` holds the responsive rules, `motion.css` the animation. `utils/assets.js` can bundle a page's CSS into one request.

---

## 11. Admin console

- Private URL: `ADMIN_PATH` (e.g. `/nx-console-7f3k`). Anyone not an admin gets a normal 404.
- Pages: `routes/adminPageRoutes.js` → `controllers/admin*PageController.js` → `views/admin/*.ejs`.
- APIs: `routes/adminRoutes.js` under `/api/admin`.
- Sections and nav: `config/adminNav.js`. (There is no two-step login in the current code.)
- Every admin change is written to the audit log: `services/auditService.js`, `models/AuditLog.js`.
- Business logic: `adminOrderService`, `adminProductService`, `adminCouponService`, `dashboardService`, `analyticsService`. Read `docs/ROADMAP.md` for what each section does (see also the README "The sections").

---

## 12. Scale, security and operations

| Topic | File | The point |
|---|---|---|
| Rate limiting | `middleware/rateLimit.js`, `rateLimitStore.js` | per-IP limits; with Redis they are shared across copies |
| Redis (optional) | `providers/redis.js`, `services/cacheSync.js` | shared limits, cache clearing |
| Catalogue cache | `utils/memo.js` | short in-memory cache, cleared by model hooks |
| CDN caching | `middleware/publicCache.js` | signed-out pages cacheable for ~60 s in production |
| Origin check | `middleware/originCheck.js` | blocks cross-site API writes |
| Errors | `middleware/errorHandler.js`, `utils/http.js` | one place turns `HttpError` into JSON/HTML |
| Request IDs and logs | `middleware/requestId.js`, `utils/logger.js` | trace one request everywhere |
| Image storage | `providers/storage/{local,cloudinary}.js` | swap by `STORAGE_DRIVER` |
| Email | `providers/mail/{smtp,brevo}.js`, `services/mailService.js` | swap by `MAIL_DRIVER` |
| Payments | `services/razorpayService.js`, `paymentService.js`, `controllers/paymentController.js` | webhook verifies signature on raw body |
| Load test | `scripts/loadTest.js` (`npm run load:test`) | measure it |
| Docs | `docs/SCALING.md`, `DEPLOY.md`, `HOSTING-SETUP.md` | read all three |

The "provider" pattern (`providers/`) is a good design to remember: the app calls one interface and a setting chooses the implementation.

---

## 13. 3D and motion (do this last)

- Engine: `public/js/3d/` (`gl.js` WebGL setup, `math.js` vectors/matrices, `shapes.js` geometry, `scene.js` rendering, `interaction.js` mouse/touch, `boot.js` start). Loaded as ES modules, no library.
- Uses: `home3d.js`, `showroom3d.js`, `auth3d.js`, `fx/cartfx.js`, `fx/confetti3d.js`.
- Learn WebGL basics first (shader, buffer, uniform, draw call), then read `gl.js`, then `shapes.js`.
- All animation subscribes to the one loop in `motion/ticker.js` so the page runs a single `requestAnimationFrame`.

---

## 14. Tests: how to learn from them

`npm test` runs everything in `tests/`. Start here:
1. `tests/helpers.js`: shared setup.
2. `tests/cart.test.js`, `unit.test.js`: pure functions, easiest.
3. `tests/orders.test.js`, `payments.test.js`, `wallet.test.js`: the money paths.
4. `tests/jobs.test.js`, `scaling.test.js`: the infrastructure.

Method: pick a test, read its name, **guess the code**, then open the service to compare. Break a rule in the code on purpose and watch which test fails.

---

## 15. Practice exercises (do them, in order)

1. Change `MAX_PER_PRODUCT` to 4. Run `npm test`. Fix the failing tests and explain why each failed.
2. Add `GET /api/cart/total` returning only `summary.grandTotal`. Touch route, controller, service. Add a test.
3. Add a field `isFeatured` to `Product`. Show a badge in `views/partials/product-card.ejs`.
4. Add a new event listener that logs "order placed" on `order.placed`. Place an order and find the job in MongoDB.
5. Change free delivery from ₹499 to ₹599 in `config/store.js`. Find every place that changes.
6. Put a `console.log` in `attachUser` and watch what happens when the access token expires and is renewed.
7. Draw the whole checkout as a diagram on paper from memory. Compare with section 8.

---

## 16. Interview-ready one-minute explanation

> "Nexthlon is an Express and MongoDB store with server-rendered EJS pages and a JSON API. It follows route, controller, service, model layering. Money is integer paise, prices are always recomputed on the server. Login uses a short-lived JWT plus a revocable refresh token in narrow-path HttpOnly cookies, with separate admin sessions. Stock is taken with an atomic conditional update inside a transaction so the last item can't be oversold. Side effects like emails are events turned into retryable jobs stored in MongoDB. It scales with one process per core, optional Redis for shared limits, CDN-cacheable guest pages, graceful shutdown, and it has a test suite."

---

## 17. Files not covered line by line

This guide read and explained: `server.js`, `app.js`, `config/env.js`, `middleware/auth.js`, `middleware/guestCart.js`, `routes/cartRoutes.js`, `routes/pageRoutes.js`, `controllers/cartController.js`, `services/cartService.js` (first 120 lines), `services/checkoutService.js`, `services/stockService.js`, `services/tokenService.js` (first 90 lines), `utils/http.js`, `utils/pricing.js`, `models/Product.js`, `events/index.js`, `jobs/queue.js`, `views/pages/cart.ejs`, `views/partials/scripts.ejs`, `public/js/app.js`, `tests/cart.test.js`.

Everything else (the other ~80 services, models, controllers, views and scripts) follows the same patterns. For each one: read its top comment, find its route, follow the chain from section 6, then read its test. Ask me to write a deeper "code by code" chapter for any file or area and I will.
