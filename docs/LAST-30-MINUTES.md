# Nexthlon: the last 30 minutes

One sheet for the whole project: **backend, frontend and animation, file by file**.
Read it top to bottom (about 25 minutes), then read section 6 out loud twice.

| Minutes | Read |
|---|---|
| 0–3 | Section 1: the big picture |
| 3–13 | Section 2: backend, file by file |
| 13–20 | Section 3: frontend, file by file |
| 20–26 | Section 4: animation, file by file |
| 26–30 | Sections 5 and 6: flows and the exam answer |

---

## 1. The big picture (3 min)

**Nexthlon** = a sports-gear online store. **Node.js + Express + MongoDB**, pages made on the server with **EJS**, a **JSON API** for the browser, **plain JavaScript** (no framework), **hand-written WebGL** for 3D.

```
Browser ─► app.js (middleware) ─► routes/ ─► controllers/ ─► services/ ─► models/ ─► MongoDB
                                                              │
                                     utils/ (maths) ◄─────────┤
                                     events/ + jobs/ ◄────────┤  (emails in the background)
                                     providers/ ◄─────────────┘  (mail, photos, WhatsApp, SMS)
views/ (EJS pages) ◄── controllers render them        public/js ──► calls /api/... with fetch
```

**Four rules:** money in **paise** · server **recalculates every price** · **owner in every query** · animation is **decoration only**.

---

## 2. Backend, file by file (10 min)

### Start-up
| File | What it does |
|---|---|
| `server.js` | Checks settings, starts **one copy per CPU core** (cluster), restarts crashed copies, only copy 0 runs jobs, **graceful shutdown**. |
| `app.js` | The **pipeline**: requestId → health → helmet (CSP) → compression → static files → no-cache → webhooks (raw body) → json (20 KB) → cookies → viewLocals → **attachUser** → seo → **originCheck** → `/api` routes → admin pages → **adminExit** → store pages → notFound → **errorHandler**. |
| `config/env.js` + `schema.js` | Read `.env`; check every value; stop with **all** problems listed. |
| `config/db.js` | Connect MongoDB. |
| `config/store.js`, `catalog.js`, `adminNav.js` | Fixed lists: store details, categories, admin menu. |

### Middleware (runs on requests)
| File | What it does |
|---|---|
| `auth.js` | **attachUser**: reads the JWT cookie → `req.user`; guards `requireAuth`, `customerPage`, `adminPage` (404 for strangers). |
| `originCheck.js` | **CSRF** protection: API writes must come from our own site. |
| `rateLimit.js` + `rateLimitStore.js` | Limits per IP (Redis-shared if set). |
| `guestCart.js` | Guest cart owner; stores only a **SHA-256 hash** of the cookie. |
| `errorHandler.js` | One place turns errors into JSON or an error page; never leaks details. |
| `noCache.js`, `publicCache.js` | Private pages never cached; signed-out pages cacheable by a CDN. |
| `upload.js` | Photos checked in memory (real type) before saving. |
| `viewLocals.js` | Helpers for EJS: `formatPrice`, `icon`, `asset`, `sizedUrl`. |
| `requestId.js`, `seo.js`, `shell.js`, `cartCount.js` | Request IDs; SEO defaults; calm admin/account; header badges. |
| `adminExit.js` | Opening any store page **ends the admin session**. |

### Routes → Controllers (HTTP layer)
| Route file | URLs |
|---|---|
| `authRoutes` | signup, login, admin login, refresh, logout, password reset, verify email |
| `productRoutes` | products, search, suggestions, reviews, questions, delivery estimate |
| `cartRoutes` | cart, add, change, remove, save for later |
| `orderRoutes` | quote, buy now, COD code, place order, my orders, cancel, return |
| `paymentRoutes` | Razorpay order, verify, failed, retry, status (+ webhook in app.js) |
| `walletRoutes`, `addressRoutes`, `profileRoutes`, `accountRoutes`, `wishlistRoutes`, `listRoutes`, `supportRoutes` | the customer's own data |
| `adminRoutes` (~60) | dashboard, orders, products, coupons, inventory, customers, refunds, exports, PDFs |
| `pageRoutes`, `adminPageRoutes` | EJS pages |
| `seoRoutes`, `healthRoutes` | sitemap, robots; `/healthz`, `/readyz` |

Controllers: read `req` → validate (`utils/validators.js`) → call a service → `res.json()` or `res.render()`.

### Services (the rules) — the important ones
| File | What it does |
|---|---|
| `authService` | bcrypt passwords; **dummy hash** so a wrong email takes as long as a wrong password. |
| `tokenService` | Signs/checks the **JWT** (15 min, HS256, issuer, audience); sets **HttpOnly** cookies. |
| `refreshTokenService` | Refresh token = 32 random bytes, **hash stored**, **rotates** each use, reuse → whole sign-in revoked. |
| `cartService` | Max 5 per product, never above stock, prices live from Product, totals. |
| `checkoutService` | `buildQuote` recalculates all; `placeOrder` for COD/wallet. |
| `stockService` | **Atomic** `$gte` + `$inc` stock take inside a **transaction**. |
| `paymentService` + `razorpayService` | Razorpay order; **HMAC-SHA256** signature check with `timingSafeEqual`; idempotent "mark paid". |
| `walletService` | Credit/debit in one atomic update; never below 0; a `key` stops double credit. |
| `orderService`, `refundService` | Cancel, return, refunds (intent saved before money moves). |
| `couponService` + `utils/pricing.js` | Coupons; best offer, round half up, free delivery from ₹499. |
| `gstService` + `utils/gst.js` | GST inside the price; CGST+SGST or IGST; invoice numbers. |
| `invoiceService` | Invoice PDF (pdfkit). |
| `imageService` | Photos → WebP in 200/400/800/1600/full (sharp). |
| `productService` | Listing, filters, **search with typo fixing**. |
| `dashboardService`, `analyticsService` | Admin numbers with MongoDB aggregations. |
| `mailService`, `messageService`, `pushService` | Email, WhatsApp/SMS, push. |
| `adminOrderService` | Status only moves **forward**; bulk updates; shipments. |

### Models (33) — the important ones
`User` (passwordHash, role, **tokenVersion**, isBlocked) · `Product` (price computed on save, variants, text index) · `Cart`/`GuestCart` (no prices) · `Order` (**snapshots**, item statuses, version) · `RefreshToken` (hash only) · `Wallet`/`WalletTransaction` · `Coupon` · `Job` · `Counter` (`NX-2026-000123`) · `AuditLog`.

### Background work and providers
| File | What it does |
|---|---|
| `events/index.js` | `emit("order.placed")` → each listener becomes a **job in MongoDB**; never throws; a `key` stops duplicates. |
| `jobs/queue.js`, `worker.js` | Atomic claim, 5-minute lease, **retries** 30 s → 2 h. |
| `providers/mail`, `storage`, `messaging`, `redis.js` | Swappable outside services, chosen by a setting. |

---

## 3. Frontend, file by file (7 min)

### Templates (`views/`)
| File | What it does |
|---|---|
| `partials/head.ejs` | `<head>`: viewport, SEO, link previews, PWA, fonts, **one CSS bundle**, `theme.js` + `page-reveal.js` early. |
| `partials/header.ejs`, `footer.ejs` | Logo, menu, search, cart; footer links. |
| `partials/scripts.ejs` | Toasts box, confirm dialog, every `<script defer>` in order. |
| `partials/product-card.ejs` | One product card: `srcset`, lazy photo, quick add, price, MRP, stock. |
| `pages/*.ejs` (23) | home, products, product, cart, checkout, orders, auth, policies, 404… |
| `account/`, `admin/` | My Account and admin sections. |

EJS tags: `<%= %>` safe print · `<%- %>` raw HTML · `<% %>` code · `<%# %>` comment.

### Browser JavaScript (`public/js/`)
| File | What it does |
|---|---|
| `theme.js` | Before paint: `js` and `will-3d` classes → no layout jump. |
| `app.js` | **`window.Nx`**: `Nx.api` (renews expired JWT and retries), toasts, forms, busy buttons, confirm dialog, header, sign out. |
| `header.js` | Live search (debounce + AbortController), recent/trending searches, phone menu. |
| `store.js` | **`Nx.addToCart`**, fly to cart, wishlist hearts, product cards, recently viewed. |
| `catalog.js` | Filters: **one state ↔ URL**; price slider; phone filter drawer; gallery. |
| `product.js` | Zoom, full-screen viewer, delivery date by PIN, Buy now, reviews, Q&A, share. |
| `cart.js` | Size picker; cart +/−/remove using **server totals**. |
| `checkout.js` | 3 steps, quote from server, coupon, wallet, COD code, fix buttons on errors. |
| `payment.js` | Razorpay overlay: opening → verifying → success/failed. |
| `auth.js` | Login/signup flip, live checks, password strength, email typo fix. |
| `account.js`, `section-nav.js` | My Account sections; switch sections **without reload** (`X-Partial`). |
| `admin*.js` | Admin shell, Ctrl+K palette, **SVG charts**, orders, products, coupons, inventory. |
| `image-editor.js` | **Crop/rotate/flip** on canvas → WebP under 2 MB. |
| `consent.js`, `pwa.js`, `sw.js` | Cookie consent; installable app; offline page; push. |

### CSS (`public/css/`)
`tokens.css` (colours, fonts, timing) → `components.css` → `style.css` → page files → `motion.css` → `mobile.css` (last, so phone fixes win). All sent as **one bundle**.

---

## 4. Animation, file by file (6 min)

| File | What it does |
|---|---|
| `motion/ticker.js` | **One loop** for everything; `dt` capped at 0.05; reads before writes; sleeps when idle or hidden. |
| `motion.js` | Scroll **reveal** (IntersectionObserver, 80 ms stagger), **tilt + glare** (mouse only), glass header, counters, image fade-in. |
| `css/motion.css` | All keyframes inside `prefers-reduced-motion: no-preference`; success tick drawn with `stroke-dashoffset`; page transitions. |
| `page-reveal.js` + `app.js` | **Page transitions**: product photo flows into the product page and back. |
| `3d/gl.js` | WebGL basics: shaders, buffers, textures. |
| `3d/math.js` | Matrices; `lerp`, `smoothstep`, **`damp`** (same feel at any frame rate). |
| `3d/shapes.js` | **Drawing → particles** (read the pixels of a hidden canvas). |
| `3d/scene.js` | Camera, meshes, render loop (pauses off screen). |
| `3d/interaction.js` | Device tier, Data Saver, mouse/gyro, drag with inertia, scroll progress. |
| `3d/boot.js` | Starts 3D only near the screen and when idle; any error → CSS fallback. |
| `home3d.js` | **9,000 dots: sphere → logo → athlete** by scroll, morph on the **GPU**; sport ring (CSS 3D); showcase light. |
| `showroom3d.js` | Zero-gravity product room + WebGL dust. |
| `auth3d.js` | Sign-in dots that swirl from the mouse; admin globe. |
| `store.js` (flight) | **Fly to cart** on a **Bézier curve**: `x = 2(1−p)p·cx + p²·dx`, with 3D tilt. |
| `fx/cartfx.js` | Spark particles (fixed pool, drag + gravity). |
| `fx/confetti3d.js` + `confetti.js` | WebGL confetti; 2D fallback. |

**Rules:** one loop · only `transform` + `opacity` · GPU morph · lazy loading · reduced motion → still or none · no WebGL → CSS version.

---

## 5. Three flows to tell as a story (3 min)

**Add to cart:** click → `store.js Nx.addToCart` → photo starts flying **and** `POST /api/cart/items` at the same time → `cartRoutes` → `cartController` (validate) → `cartService` (max 5, stock, live price) → `Cart` model → JSON → badge updates, sparks burst, toast.

**Login:** `POST /api/login` → bcrypt check → JWT (15 min) + refresh token (hash stored) in HttpOnly cookies → every request `attachUser` checks the JWT and `tokenVersion` → expired → `Nx.api` calls `/api/auth/refresh` once and retries.

**Order (COD):** checkout → `buildQuote` recalculates → `placeOrder` → atomic stock in a transaction → coupon + wallet + order with snapshots → cart cleared → `emit("order.placed")` → email job.

---

## 6. Say this (read twice, out loud)

> "Nexthlon is an Express and MongoDB store with server-rendered EJS pages and a JSON API, organised as routes, controllers, services and models. Money is integer paise and every price is recalculated on the server. Login is a short JWT plus a rotating refresh token in HttpOnly cookies, stored only as a hash. Stock is taken with an atomic conditional update inside a transaction, so the last item can't be sold twice. Razorpay payments are checked with an HMAC signature and a webhook. Emails run as retryable background jobs. The frontend is plain JavaScript with one shared helper, `Nx.api`. All animation runs on one shared loop, the 3D is hand-written WebGL with the particle morph on the GPU, and everything respects reduced motion and works without JavaScript."

**Stuck on a question?** "It follows the route → controller → service → model pattern; the rule lives in the service."
**Don't say:** two-factor login (not in the code) · that it's live (hosting is next).
