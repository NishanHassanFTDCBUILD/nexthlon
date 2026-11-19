# Nexthlon backend guide, complete and detailed

Everything that runs on the server, explained from the current code. Node.js + Express 4 + MongoDB
(Mongoose). Line-by-line walkthroughs of `server.js`, `app.js`, the cart and checkout are also in
`docs/STUDY-GUIDE.md`; this guide covers the whole backend, area by area.

---

## 0. The shape of the backend

```
server.js ─► app.js (middleware pipeline)
                │
                ├─► routes/        URL + method + guards  → controller
                ├─► controllers/   read req, validate, call service, send res
                ├─► services/      business rules (no HTTP)
                ├─► models/        MongoDB schemas (Mongoose)
                ├─► utils/         pure helpers (pricing, money, validators, GST)
                ├─► middleware/    runs on every request (auth, limits, errors)
                ├─► events/ + jobs/  background work (emails, WhatsApp, push)
                ├─► providers/     swappable outside services (mail, storage, SMS, Redis)
                └─► config/        settings from .env, checked at start-up
```

| Folder             | Files | Job                                                                                                                                                                                                   |
| ------------------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/`          | 7     | `env.js` reads `.env`; `schema.js` checks every value and stops the server listing **all** problems; `db.js` connects MongoDB; `store.js`, `catalog.js`, `adminNav.js`, `support.js` are fixed lists. |
| `routes/`          | 21    | URL map (section 3).                                                                                                                                                                                  |
| `controllers/`     | ~25   | HTTP in/out.                                                                                                                                                                                          |
| `services/`        | ~65   | All business logic (section 5).                                                                                                                                                                       |
| `models/`          | 33    | One schema per collection (section 4).                                                                                                                                                                |
| `middleware/`      | 14    | Per-request steps (section 2).                                                                                                                                                                        |
| `utils/`           | 30    | Pure helpers.                                                                                                                                                                                         |
| `events/`, `jobs/` | 8     | Background work.                                                                                                                                                                                      |
| `providers/`       | 8     | Mail, storage, WhatsApp, SMS, Redis.                                                                                                                                                                  |
| `scripts/`         | —     | `npm run` tools: seed, backup, checks, load test.                                                                                                                                                     |
| `tests/`           | —     | `npm test` (Node's built-in runner).                                                                                                                                                                  |

**Three rules that run through every file:**

1. **Money is integer paise** (₹1 = 100). `utils/money.js` converts at the edges (forms and URLs use rupees).
2. **The server never trusts the browser.** Prices, totals, coupons, stock: all recalculated on the server.
3. **Every customer lookup includes the owner** (`{ _id, user: userId }`), so nobody can see or change someone else's order, address, list or ticket.

---

## 1. Start-up

### `server.js`

1. `require("./config/env")` → checks every setting; any error → print all → exit.
2. `WEB_CONCURRENCY > 1` → **cluster**: a supervisor starts one copy per CPU core, runs **migrations once**, restarts crashed copies (max 5 a minute).
3. Each copy: connect MongoDB → migrations (unless done) → `app.listen(port, "0.0.0.0")`.
4. **Only copy 0 runs background jobs** (no duplicate emails).
5. **Graceful shutdown** on SIGTERM: stop new visitors (`/readyz` → 503), finish running requests, stop jobs, close Redis and MongoDB, exit (10 s safety timer).
6. `keepAliveTimeout 65 s` > load balancer's 60 s, so a closed connection is never reused.

### `services/migrationService.js`

Upgrades old data at every start. Each step only touches documents that still need it, so running it twice changes nothing (**idempotent**).

---

## 2. Middleware: what runs on every request (`app.js` order)

| Order | Middleware                 | What it does                                                                                                                         |
| ----- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | `requestId.js`             | Gives each request an ID (keeps a valid `X-Request-Id`). `utils/requestContext.js` (AsyncLocalStorage) lets every log line carry it. |
| 2     | `healthRoutes`             | `/healthz` (alive?) and `/readyz` (database up and not shutting down?) for the host.                                                 |
| 3     | `helmet`                   | Security headers + Content Security Policy (only our scripts, Razorpay, photo hosts).                                                |
| 4     | `compression`              | gzip, ~70% smaller.                                                                                                                  |
| 5     | static files               | `public/` with year-long caching for `?v=hash` files.                                                                                |
| 6     | `noCache.js`               | Pages and API replies are never cached by the browser (Back after sign-out can't show private data).                                 |
| 7     | webhooks                   | Razorpay (raw body for the signature), courier and marketplace — before JSON parsing and the origin check.                           |
| 8     | `express.json` 20 KB       | Parse bodies; giant payloads refused.                                                                                                |
| 9     | `cookieParser`             | Fill `req.cookies`.                                                                                                                  |
| 10    | `viewLocals.js`            | Helpers for EJS (`formatPrice`, `icon`, `asset`…).                                                                                   |
| 11    | `auth.js` → `attachUser`   | Reads the JWT → `req.user` (section 6).                                                                                              |
| 12    | `cartCount.js`             | Header cart/wishlist badge numbers.                                                                                                  |
| 13    | `navCategories`            | Menu categories (cached).                                                                                                            |
| 14    | `seo.js`                   | Canonical URL, noindex on private pages, link-preview defaults.                                                                      |
| 15    | `originCheck.js` on `/api` | **CSRF protection**: a write request with a login cookie must come from our own origin (`Origin` or `Referer` header), else 403.     |
| 16    | routers                    | `/api/...`, admin pages at `ADMIN_PATH`, SEO, store pages.                                                                           |
| 17    | `notFound`, `errorHandler` | Last: turn every error into JSON or an error page.                                                                                   |

Other middleware used by specific routes:

| File                                 | Job                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rateLimit.js` + `rateLimitStore.js` | Per-IP limits (15-minute windows) on login, signup, password reset, cart, search, contact… With Redis the counts are shared by every server copy. |
| `guestCart.js`                       | Who owns the cart: user id, or a guest token (only its **SHA-256 hash** is stored).                                                               |
| `upload.js`                          | Photo uploads held in memory first so the **real file type** is checked before saving.                                                            |
| `publicCache.js`                     | Lets a CDN keep signed-out pages ~60 s (`s-maxage`), browsers still re-ask.                                                                       |
| `shell.js`                           | My Account and admin: no motion layer (calm, fast).                                                                                               |

### `middleware/errorHandler.js`, line by line

```js
let status = err.status || err.statusCode || 500;
if (err.name === 'ValidationError' || err.name === 'CastError') status = 400; // bad data / bad id
if (err.code === 11000) status = 409; // duplicate key
if (err.name === 'VersionError') status = 409; // edited by someone else meanwhile
```

- 5xx we raised on purpose (`HttpError`) → show its message. Unexpected 5xx → **never** show details ("Something went wrong on our side").
- 4xx `HttpError` → show its message.
- Every 5xx is logged (with request ID, stack, path **without** the query string, which may hold tokens) and sent to Sentry.
- 5xx/429 → `Cache-Control: no-store` so a CDN never keeps an error.
- `/api/...` → JSON `{ message, errors, code }`; pages → a friendly error page with a reference ID.

### `utils/http.js`

`HttpError(status, message, fieldErrors, code)` — an error that carries its HTTP status. `asyncHandler(fn)` — catches errors from `async` controllers and passes them to `next()`, so controllers can just `throw`.

---

## 3. Every API endpoint

All under `/api`. 🔒 = needs a signed-in customer; 🛡 = admin.

| Area                                     | Endpoints                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth** (`authRoutes`)                  | `POST /signup`, `/login`, `/admin/login`, `/password/forgot`, `/password/reset`, `/email/verify`, `/auth/refresh`, `/logout`, `/admin/logout`; `GET /me`                                                                                                                                                                                                                                                                                                  |
| **Products** (`productRoutes`)           | `GET /products`, `/products/:id`, `/products/search`, `/products/suggest`, `/products/lookup`, `/search/start`, `/categories`, `/products/:id/reviews` (+POST), `/products/:id/questions` (+POST), `POST /products/:id/stock-alerts`, `POST /questions/:id/answers`, `GET /delivery/estimate`, `/delivery/pincode/:pincode`                                                                                                                               |
| **Cart** (`cartRoutes`, rate-limited)    | `GET /cart`, `/cart/count`; `POST /cart/items`; `PATCH /cart/items/:productId`; `DELETE /cart/items/:productId`, `DELETE /cart`; `POST /cart/items/:id/save-for-later` 🔒                                                                                                                                                                                                                                                                                 |
| **Checkout & orders** (`orderRoutes`) 🔒 | `POST /checkout/quote`, `/buy-now`, `/checkout/cod-code`, `/orders`; `GET /orders`, `/orders/:orderId`; `POST /orders/:id/cancel`, `/orders/:id/items/:itemId/cancel`, `/orders/:id/return`                                                                                                                                                                                                                                                               |
| **Wallet & coupons** (`walletRoutes`) 🔒 | `GET /wallet`, `/coupons`; `POST /checkout/coupon`; `DELETE /checkout/coupon`                                                                                                                                                                                                                                                                                                                                                                             |
| **Payments** (`paymentRoutes`) 🔒        | `POST /payments/razorpay/order`, `/razorpay/retry/:orderId`, `/razorpay/verify`, `/razorpay/failed`; `GET /razorpay/status/:id`; + webhook `POST /payments/razorpay/webhook`                                                                                                                                                                                                                                                                              |
| **Profile** 🔒                           | `GET/PATCH /profile`, `PATCH /profile/password`                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Addresses** 🔒                         | `GET/POST /addresses`, `PATCH /addresses/:id`, `PATCH /addresses/:id/default`, `DELETE /addresses/:id`                                                                                                                                                                                                                                                                                                                                                    |
| **Account** 🔒                           | email change, `logout-all`, `sessions` (list/revoke a device), preferences, recently viewed, `export` (download my data), `delete`, my reviews                                                                                                                                                                                                                                                                                                            |
| **Wishlist & lists** 🔒                  | `/wishlist` (add, remove, move to cart); `/lists` (create, rename, share, add/remove items, move to cart)                                                                                                                                                                                                                                                                                                                                                 |
| **Support** 🔒                           | `GET/POST /support/tickets`, `POST /support/tickets/:id/messages`                                                                                                                                                                                                                                                                                                                                                                                         |
| **Other**                                | `/bundles/for/:productId`, `/bundles/:slug/add`; `/contact`, `/newsletter`; `/push/key`, `/push/subscribe`; `/guides`                                                                                                                                                                                                                                                                                                                                     |
| **Admin** 🛡 (`adminRoutes`, ~60)         | dashboard, search, notifications, analytics + CSV; customers (wallet adjust, block); settings (referral, COD, prepaid, COD-OTP); products (CRUD, listing, stock); orders (list, export CSV/XLSX, bulk status, status, cancel, shipments, ship, RTO, notes, refunds, invoice/credit-note/packing-slip PDFs); returns; transactions + reconciliation; refunds; abandoned carts + reminders; inventory; coupons; questions; marketplace feeds; system status |
| **Pages** (`pageRoutes`, EJS)            | `/`, `/products`, `/products/:slug`, `/cart`, `/checkout`, `/orders/:id`, `/orders/:id/success`, invoices, `/login`, `/signup`, password and email pages, every `/account/...` section, policies                                                                                                                                                                                                                                                          |

---

## 4. The data: 33 models

| Model                                                     | What it stores                    | Key points                                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `User`                                                    | customers and admins              | `passwordHash` (bcrypt), `role`, `tokenVersion` (bump = log out everywhere), `isBlocked`, `isDeleted`, email confirmed date, referral code                                                             |
| `RefreshToken`                                            | one row per signed-in device      | only the **SHA-256 hash** of the token; family id; revoked/replaced dates                                                                                                                              |
| `AuthToken`                                               | one-time email links              | hash only; expires                                                                                                                                                                                     |
| `LoginActivity`                                           | sign-in history                   | last 10, masked IP                                                                                                                                                                                     |
| `Product`                                                 | one product                       | `basePrice`, `mrp`, offers → computed `price` on every save; variants (sizes/colours) each with SKU and stock; product stock = sum of variants; text index for search; hooks clear the catalogue cache |
| `Category`                                                | sport groups                      | `offerPercent`; unlisted category hides its products                                                                                                                                                   |
| `Cart` / `GuestCart`                                      | product + quantity only           | **never prices** — always live from Product                                                                                                                                                            |
| `BuyNow`                                                  | one product checked out alone     | auto-deleted (TTL)                                                                                                                                                                                     |
| `Order`                                                   | the order                         | **snapshots** of items (name, image, price, MRP) and address; per-item status; payment status; GST; invoice number; shipments; refunds; version for conflict checks                                    |
| `Counter`                                                 | running numbers                   | `order-2026 → 123` = `NX-2026-000123`                                                                                                                                                                  |
| `Coupon` / `CouponRedemption`                             | codes and their uses              | flat (paise) or percent; `maxDiscount`; usage limits                                                                                                                                                   |
| `Wallet` / `WalletTransaction`                            | balance and history               | balance changes only in `walletService`; unique `key` stops double credits                                                                                                                             |
| `Address`                                                 | delivery addresses                | max per user (config)                                                                                                                                                                                  |
| `Wishlist`, `ShoppingList`                                | saved products                    | lists shareable by a random id                                                                                                                                                                         |
| `Review`, `Question`                                      | reviews and Q&A                   | verified buyer flag; hidden answers kept                                                                                                                                                               |
| `StockAlert`                                              | "email me when back"              | one email per restock                                                                                                                                                                                  |
| `SupportTicket`, `ContactMessage`, `NewsletterSubscriber` | help and contact                  |                                                                                                                                                                                                        |
| `Bundle`, `Guide`                                         | kits and articles                 |                                                                                                                                                                                                        |
| `Job`                                                     | background work                   | type, payload, runAt, attempts, lease, `dedupeKey`, `deleteAt`                                                                                                                                         |
| `EmailLog`                                                | sent emails                       | key stops the same email twice                                                                                                                                                                         |
| `PhoneCode`                                               | COD OTP codes                     | hash only, 10-minute TTL, 5 tries                                                                                                                                                                      |
| `PushSubscription`                                        | browsers for push                 |                                                                                                                                                                                                        |
| `AuditLog`                                                | admin changes                     | who, what, before/after (no secrets), masked IP                                                                                                                                                        |
| `Setting`, `SearchLog`                                    | admin settings; trending searches | search log never stores who searched                                                                                                                                                                   |

**Indexes** make lookups fast (e.g. Product compound indexes for filters/sorting; unique indexes for emails, keys, slugs). **TTL indexes** let MongoDB delete expired rows by itself (BuyNow, PhoneCode).

---

## 5. The services, by area

### 5.1 Accounts and login

| Service                                                       | What it does                                                                                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `authService`                                                 | Sign up (bcrypt hash, referral code), `authenticate()`. A **dummy hash** is compared when the email doesn't exist, so a wrong email takes as long as a wrong password (no account guessing by timing). |
| `tokenService`                                                | Signs/verifies the access JWT, sets cookies (section 6).                                                                                                                                               |
| `refreshTokenService`                                         | Refresh tokens: create, **rotate**, revoke, detect theft.                                                                                                                                              |
| `passwordResetService`, `authTokenService`, `authMailService` | "Forgot password" one-time links (random 256-bit, hash stored), emails.                                                                                                                                |
| `emailVerificationService`                                    | "Confirm your email" link.                                                                                                                                                                             |
| `profileService`                                              | Update profile; **password change bumps `tokenVersion` and revokes refresh tokens** (every other device is logged out).                                                                                |
| `accountService`                                              | Sessions/devices, preferences, recently viewed (last 5), delete account.                                                                                                                               |
| `privacyService`                                              | "Download my data" JSON (no secrets).                                                                                                                                                                  |
| `adminService`                                                | Block customers (only customers — an admin can't lock out another admin).                                                                                                                              |

### 5.2 Catalogue

| Service                                              | What it does                                                                                                                                                                           |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `productService`                                     | Listing with filters, sort, pagination; **search** with text index + `utils/fuzzy.js` spelling help ("shoees" → shoes) + `utils/synonyms.js`; escapes regex characters in search text. |
| `categoryService`                                    | Listed categories, cached in memory.                                                                                                                                                   |
| `homeService`                                        | Home page sections, deals ending at midnight IST.                                                                                                                                      |
| `recommendationService`                              | "Frequently bought together" from the last 180 days of real orders.                                                                                                                    |
| `reviewService`, `questionService`                   | Reviews (verified buyer), Q&A.                                                                                                                                                         |
| `searchInsightService`                               | Trending searches.                                                                                                                                                                     |
| `deliveryService`, `pincodeService`                  | Delivery date estimate by PIN; city/state lookup.                                                                                                                                      |
| `bundleService`, `guideService`, `stockAlertService` | Kits, articles, back-in-stock emails.                                                                                                                                                  |

### 5.3 Cart, checkout, orders

| Service                              | What it does                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cartService`                        | Max 5 per product, never above stock, unavailable lines shown but not counted, totals from live prices, guest vs customer = which model. Atomic upsert for the first add. |
| `buyNowService`                      | One product checked out alone, without touching the cart.                                                                                                                 |
| `couponService` + `utils/pricing.js` | Check a code, apply it, count uses.                                                                                                                                       |
| `checkoutService`                    | `buildQuote()` recomputes everything; `placeOrder()` for COD/wallet (section 7).                                                                                          |
| `codConfirmService`                  | COD confirmation code by SMS/WhatsApp (fewer fake orders).                                                                                                                |
| `stockService`                       | **Atomic** stock take/return, in a transaction.                                                                                                                           |
| `counterService`                     | Order numbers with atomic `$inc`.                                                                                                                                         |
| `orderService`                       | Customer's orders, cancel items (stock back, refund), returns.                                                                                                            |
| `utils/orderRules.js`                | The lifecycle (section 7.3).                                                                                                                                              |
| `gstService` + `utils/gst.js`        | GST per item, CGST+SGST or IGST, invoice numbers, credit notes.                                                                                                           |
| `invoiceService`                     | Invoice PDF with pdfkit (Noto Sans font for ₹).                                                                                                                           |

### 5.4 Money

| Service                                                         | What it does                                                                                                                                       |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paymentService` + `razorpayService`                            | Online payment (section 8).                                                                                                                        |
| `walletService`                                                 | Credit/debit with one atomic update each (section 9).                                                                                              |
| `refundService`, `settlementService`, `commerceRecoveryService` | Refunds: intent saved **before** money moves; every side effect has a stable key so a retry finishes safely; unfinished work resumed every minute. |
| `ledgerService`                                                 | Every money movement in one list, built live from orders and wallet (can't drift).                                                                 |
| `referralService`                                               | Both people get wallet credit once the new customer's first order is delivered.                                                                    |
| `adminWalletService`                                            | Admin wallet adjustments, receipt in the same atomic update.                                                                                       |

### 5.5 Admin

`dashboardService` (KPIs and charts with MongoDB **aggregations** in India time), `analyticsService`, `adminOrderService` (forward-only status changes, bulk, shipments, refunds, returns), `adminProductService` (photos, variants, GST), `adminCouponService`, `inventoryService`, `cartRecoveryService` (abandoned carts + reminder email), `auditService` (log every admin change without secrets), `settingsService` (referral reward, COD limit…), `systemService` (health page, never shows secrets), `marketplaceService` (CSV/JSON feeds for Amazon/Flipkart/Myntra).

### 5.6 Messages and files

`mailService` (+ `orderMailService` templates via `utils/emailLayout.js`), `messageService` (WhatsApp/SMS), `pushService` (web push with VAPID keys), `imageService` (resize to WebP sizes 200/400/800/1600, upload to storage), `shippingService` + `shipping/shiprocket.js` (book parcels, tracking webhook).

---

## 6. Login in depth (JWT + refresh token)

### Sign in

1. `POST /api/login` → validator → `authService.authenticate()` → `bcrypt.compare(password, user.passwordHash)` (dummy hash if no user).
2. Blocked? deleted? wrong role? → refused.
3. `tokenService.signToken(user)` → **access JWT** (payload: `role`, `ver` = tokenVersion; `sub` = user id; `iss` nexthlon; `aud` nexthlon-web or nexthlon-admin; HS256; ~15 min).
4. `refreshTokenService` → **refresh token**: 32 random bytes (64 hex chars), **only its SHA-256 hash stored** in `RefreshToken`.
5. Cookies: `nx_token` (JWT, path `/`), `nx_refresh` (path **only** `/api/auth/refresh`), `nx_sid` (device label). All **HttpOnly** (JavaScript can't read them), **Secure** in production, **SameSite** lax (admin: strict).

### Every request: `attachUser`

Reads its own scope's cookie (admin pages only admin cookies) → `verifyToken` (signature, issuer, audience, expiry, HS256 only) → load user → check role, not deleted, **`ver === tokenVersion`**, not blocked → `req.user`. A bad access cookie is cleared; the refresh cookie is kept.

### Guards

`requireAuth` (401 JSON), `requireRole("customer")` (403), `customerPage` (redirect to `/login?next=`), `adminPage` (**plain 404** for non-admins — the console's existence isn't revealed), `guestOnly`. `utils/http.js safeNextPath()` blocks open redirects (`next=//evil.com`).

### Renewal and theft detection (`refreshTokenService`)

- Access JWT expired → browser calls `POST /api/auth/refresh` → server looks up the hash → issues a **new** refresh token and **revokes the old one** (**rotation**: each token works once).
- An already-used token comes back → two copies exist → one was stolen → **the whole family (that sign-in) is revoked**.
- **Grace window** (20 s): two tabs renewing at the same moment is the same browser, not a thief → the late one gets only a new access token.
- "Sign out everywhere" / password change → revoke all families + bump `tokenVersion`.

Why two tokens? A JWT can't be cancelled, so it lives 15 minutes; the refresh token is in the database, so it can be revoked.

---

## 7. Checkout and orders in depth

### 7.1 `checkoutService.buildQuote(userId, { useWallet, source })`

Loads the cart (or the Buy-now product), live prices, the chosen coupon (re-checked), the wallet balance, the COD limit → `utils/pricing.js orderTotals`. `publicQuote` returns only what the browser may see. The browser only sends **choices** (address id, method, coupon code, use wallet).

### 7.2 `placeOrder()` (COD or wallet)

1. Method must be `cod` or `wallet` (online → paymentService).
2. Address must belong to this user.
3. `buildQuote` + `assertOrderable` (not empty, nothing unavailable, coupon still valid).
4. Wallet covers all → "wallet" order. COD above the limit → refused. COD with OTP on → code must be confirmed.
5. `nextOrderId()` → `NX-2026-000123` (atomic counter).
6. `stockService.withStock(lines, work)`:
   - per product `updateOne({ _id, listed: true, stock: { $gte: qty } }, { $inc: { stock: -qty } })` → 0 modified = someone bought it first → **409 "just sold out"**;
   - inside a **MongoDB transaction** (replica set/Atlas); on a single server, **undo callbacks** (`utils/transaction.js`);
   - `work`: redeem coupon, debit wallet, create Order with **snapshots**, clear the cart. All or nothing.
7. After saving: `events.emit("order.placed", { orderId }, { key: orderId })` → emails, WhatsApp, push as jobs.

### 7.3 Order lifecycle (`utils/orderRules.js`)

```
placed → confirmed → shipped → out_for_delivery → delivered
   └──── cancelled (only while placed/confirmed)        └── return_requested → returned
```

- Statuses **only move forward** (admin can't move an order backwards).
- Each **item** has its own status; the order's status is worked out from its items.
- Payment statuses: `pending, paid, failed, refunded, partially_refunded`.
- COD allowed up to ₹5,000 by default (admin setting; 0 turns it off).
- Fixed reason lists for cancel and return.
- Order saves use a **version** (optimistic concurrency): two admins changing the same order → the second gets 409 instead of double-changing stock or money.

---

## 8. Online payment (Razorpay) in depth

From the top of `services/paymentService.js`:

1. **`createPaymentOrder`**: our order saved as `pending` from the **server's own prices**, then a Razorpay order created for the same amount (paise) with our order id as the receipt. The browser gets only `key_id`, Razorpay order id, amount, currency — **never the secret**.
2. Browser pays inside **Razorpay's own window** (card/UPI details never touch our site), then sends back `razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`.
3. **`verifyPayment`**: `razorpayService.verifyPaymentSignature` checks the signature = **HMAC-SHA256** of `` `${razorpayOrderId}|${razorpayPaymentId}` `` with the key secret, compared using `crypto.timingSafeEqual` (comparison time reveals nothing). Then: mark paid, take stock, clear the cart.
4. **Webhook** (`/api/payments/razorpay/webhook`): if the browser never comes back (closed tab), Razorpay tells the server directly; its signature is checked on the **raw body** (that's why it's mounted before `express.json`).
5. **Idempotent**: "mark paid only if not paid yet" and "take stock only if not taken yet" are atomic updates, so the verify call and the webhook arriving together change things once.
6. Failure → `/razorpay/failed`, retry with `/razorpay/retry/:orderId`; `status/:id` asks where a payment stands after a dropped connection.

---

## 9. Wallet in depth (`services/walletService.js`)

- **Credit**: `$inc balance +amount`. **Debit**: `$inc balance −amount` **only if `balance >= amount`** — can never go below 0.
- Every change writes a `WalletTransaction` with the balance after it.
- `assertAmount`: must be whole paise above 0.
- With a `key` (e.g. "refund for item X"), the credit can happen **only once**: a second create hits the unique index (`11000`) and is answered from the first row; a mismatching amount → 409.
- Runs inside the caller's transaction (`session`) or registers an `undo` on a single server.

---

## 10. Events and background jobs

```js
events.on('order.placed', 'email', handler); // once, at start-up (listeners/)
events.emit('order.placed', {orderId}, {key: orderId}); // where it happens
```

| File                                                                       | Job                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events/index.js`                                                          | `emit` turns each listener into a **job saved in MongoDB**. Never throws (a broken email can't fail a saved order). `key` → `dedupeKey`: the same event is queued once.                                                                       |
| `events/listeners/orderEmails.js`, `orderWhatsApp.js`, `questionEmails.js` | Emails, WhatsApp, push for order events; Q&A answer emails.                                                                                                                                                                                   |
| `jobs/queue.js`                                                            | `enqueue()`; `claim()` takes the next due job in **one atomic `findOneAndUpdate`** (two workers never run the same job); a job held past its 5-minute **lease** (worker died) becomes claimable again.                                        |
| `jobs/worker.js`                                                           | Runs jobs, **retries with exponential backoff** (30 s, 2 min, 8 min, 32 min, 2 h, ±20% jitter); `error.permanent` stops retrying; repeating schedules (e.g. cart reminders, commerce recovery each minute). Done jobs kept 7 days, failed 30. |
| `jobs/registry.js`, `handlers.js`                                          | Which function handles which job type.                                                                                                                                                                                                        |
| `models/EmailLog.js`                                                       | A retried job never sends the same email twice.                                                                                                                                                                                               |

Tools: `npm run jobs:status`, `npm run jobs:retry`, `npm run worker` (a separate worker process).

---

## 11. Providers: swappable outside services

The app calls one interface; a setting picks the implementation (**provider pattern**).

| Provider  | Choices                                          | Setting                |
| --------- | ------------------------------------------------ | ---------------------- |
| Mail      | `smtp.js` (nodemailer), `brevo.js` (HTTPS API)   | `MAIL_DRIVER`          |
| Storage   | `local.js` (disk), `cloudinary.js` (CDN)         | `STORAGE_DRIVER`       |
| Messaging | `whatsapp.js` (Meta Cloud API), `sms.js` (MSG91) | keys present → on      |
| Shipping  | Shiprocket                                       | `SHIPPING_PROVIDER`    |
| Redis     | `providers/redis.js`                             | `REDIS_URL` (optional) |

Without a provider configured, development writes emails/messages to the console, so everything still works.

---

## 12. Security checklist (backend)

| Protection                                                        | Where                                       |
| ----------------------------------------------------------------- | ------------------------------------------- |
| Config checked at start                                           | `config/schema.js`                          |
| bcrypt password hashes; dummy-hash timing guard                   | `authService`                               |
| Short JWT + rotating, revocable refresh token; theft detection    | `tokenService`, `refreshTokenService`       |
| HttpOnly / Secure / SameSite cookies; narrow refresh path         | `tokenService`                              |
| Separate admin session; hidden admin path → 404                   | `auth.js`, `tokenService`                   |
| CSRF origin check                                                 | `originCheck.js`                            |
| Rate limits (Redis-shared)                                        | `rateLimit.js`                              |
| Helmet + CSP                                                      | `app.js`                                    |
| Input validation for every form                                   | `utils/validators.js` (731 lines)           |
| Owner in every query                                              | services                                    |
| Hashes only for tokens (refresh, guest cart, email links, OTP)    | models                                      |
| Razorpay HMAC + timingSafeEqual; raw-body webhook                 | `razorpayService`                           |
| Upload type checked in memory                                     | `upload.js`                                 |
| No secrets in logs, audit, exports; CSV formula injection blocked | `logger.js`, `auditService`, `utils/csv.js` |
| Errors never leak internals                                       | `errorHandler.js`                           |

## 13. Scale and operations

- **Cluster**: one process per core; **Redis** shares rate limits and cache clearing (`services/cacheSync.js`).
- **Caching**: `utils/memo.js` in-memory cache (one load shared by waiting requests); CDN for signed-out pages.
- **Transactions** with undo fallback; **idempotency keys** everywhere money or emails are involved.
- **Health**: `/healthz`, `/readyz`; request IDs; `utils/logger.js` levels; Sentry (`utils/monitor.js`).
- **Backups**: `npm run db:backup` / `db:restore`. **Load test**: `npm run load:test`. Docs: `docs/SCALING.md`, `DEPLOY.md`, `HOSTING-SETUP.md`.

## 14. Tests

`npm test` runs `tests/*.test.js` with Node's built-in runner. Pure-function tests (cart rules, pricing, GST, order rules, fuzzy search) need no database; database suites run when `TEST_MONGODB_URI` is set; fault-injection tests prove refunds, payments and stock recover after failures.

## 15. One-minute exam answer

> "The backend is Node.js and Express with MongoDB through Mongoose, organised as routes, controllers, services and models. A start-up check validates every setting; the server runs one process per CPU core and shuts down gracefully. Every request goes through a middleware pipeline: request ID, Helmet security headers, compression, body limits, cookie parsing, attachUser for the JWT, a CSRF origin check, rate limits, then the routes and one central error handler. Login uses a 15-minute JWT and a rotating refresh token stored only as a hash, with theft detection. Money is integer paise and always recalculated on the server. Orders take stock with an atomic conditional update inside a transaction, keep snapshots of prices and addresses, and follow a forward-only lifecycle. Razorpay payments are verified with an HMAC signature and a webhook, and marking paid is idempotent. Side effects like emails run as retryable MongoDB jobs, and outside services sit behind swappable providers."
