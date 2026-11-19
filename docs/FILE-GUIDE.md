# Nexthlon: every file explained

Generated from the current code. For each file: **what it does** (taken from the file's own header comment), its **functions**, what it **exports**, and which project files it **uses** (requires). That last list is how the files connect.

## How everything connects

```
Browser ─► app.js (middleware pipeline) ─► routes/ ─► controllers/ ─► services/ ─► models/ ─► MongoDB
                                                          │
                                                          ├─► utils/ (pricing, money, validation)
                                                          ├─► events/ ─► jobs/ (emails, WhatsApp, in background)
                                                          └─► providers/ (mail, storage, payments, shipping, SMS)
views/ (EJS) ◄── controllers render pages     public/js ──► calls /api/... with fetch (Nx.api)
```

Key rules to say in an exam: money is stored as integer **paise**; prices are always recomputed on the server; stock is taken with an atomic `$inc` that checks `stock >= qty`; login = short JWT + revocable refresh token in HttpOnly cookies; side effects (emails) are events turned into retryable jobs.

## Contents

- [(root)](#root) (2 files)
- [config](#config) (7 files)
- [routes](#routes) (21 files)
- [controllers](#controllers) (27 files)
- [services](#services) (67 files)
- [models](#models) (33 files)
- [middleware](#middleware) (14 files)
- [utils](#utils) (30 files)
- [events](#events) (4 files)
- [jobs](#jobs) (4 files)
- [providers](#providers) (8 files)
- [scripts](#scripts) (14 files)
- [views](#views) (86 files)
- [public](#public) (53 files)
- [tests](#tests) (57 files)

---

## (root)

Start-up files. `server.js` starts the process (one copy per CPU core, graceful shutdown); `app.js` is the request pipeline every request walks through, top to bottom.

### ./

**`app.js`** (158 lines)

- What: . It sets various HTTP security headers to help protect our website against common browser-based attacks.
- Exports: `app`
- Uses: `./config/env`, `./middleware/viewLocals`, `./middleware/auth`, `./middleware/cartCount`, `./middleware/originCheck`, `./middleware/noCache`, `./middleware/errorHandler`, `./middleware/requestId`, `./jobs/handlers`, `./services/cacheSync`, `./routes/healthRoutes`, `./utils/analytics`, `./utils/assets`, `./controllers/paymentController`, `./controllers/marketplaceController`, `./controllers/shippingController`, `./middleware/seo`, `./routes/authRoutes`, `./routes/productRoutes`, `./routes/profileRoutes`, `./routes/pushRoutes`, `./routes/bundleRoutes`, `./routes/guideRoutes`, `./routes/addressRoutes`, `./routes/cartRoutes`, `./routes/wishlistRoutes`, `./routes/accountRoutes`, `./routes/listRoutes`, `./routes/supportRoutes`, `./routes/orderRoutes`, `./routes/walletRoutes`, `./routes/paymentRoutes`, `./routes/contactRoutes`, `./routes/adminRoutes`, `./routes/adminPageRoutes`, `./routes/seoRoutes`, `./routes/pageRoutes`

**`server.js`** (174 lines)

- What: no header comment; read the file.
- Functions: `startSupervisor`, `startServer`
- Uses: `./config/env`, `./utils/logger`, `./utils/monitor`, `./utils/lifecycle`, `./config/db`, `./services/migrationService`, `./app`, `./jobs/worker`, `./providers/redis`

---

## config

Settings. `env.js` reads `.env`, `schema.js` checks every value at start-up and stops the server with all problems listed. Other files are fixed lists shared by models, validation and pages.

**`config/adminNav.js`** (37 lines)

- What: The admin console's sections, in sidebar order. Used by the sidebar and the Ctrl+K palette. Every section listed here is built: there are no "coming soon" placeholders any more, so a URL that is not one of these is a plain 404 like any other unknown page. key the section id (also the URL: <ADMIN_PATH>/<key>) label what the sidebar and the palette show icon a name from public/img/icons.svg
- Exports: `ADMIN_NAV`, `ALL_ITEMS`

**`config/catalog.js`** (21 lines)

- What: Fixed lists shared by the models, validation and the pages.
- Exports: `CATEGORIES`, `LOW_STOCK_LIMIT`, `MAX_ADDRESSES`, `INDIAN_STATES`

**`config/db.js`** (20 lines)

- What: no header comment; read the file.
- Functions: `connectDB`
- Exports: `connectDB`
- Uses: `./env`, `../utils/logger`

**`config/env.js`** (187 lines)

- What: no header comment; read the file.
- Functions: `readConfig`, `readStorage`, `readMail`, `readAdminPath`, `readMessaging`, `readShipping`, `readRazorpay`
- Exports: `readConfig`
- Uses: `./schema`, `../utils/analytics`, `../package.json`

**`config/schema.js`** (256 lines)

- What: Checks every environment variable the app reads, once, at start-up. errors a setting is missing or wrong, so the server must not start. They are all collected, so one run shows every problem instead of one at a time. warnings the server can run, but something is probably not what you want in production (the default admin path, no email, test payment keys...). It is a pure function of the environment, so tests can feed it any combination.
- Functions: `checkEnv`, `durationToMs`, `text`
- Exports: `checkEnv`, `DURATIONS`, `RESERVED_PATHS`, `durationToMs`, `DURATION`
- Uses: `../utils/gst`, `../utils/analytics`

**`config/store.js`** (51 lines)

- What: Store details shown on the policy pages, the footer, the contact page, invoices and emails. The business details come from settings (STORE_* in .env or the host's dashboard), so going live needs no code change. Anything still in [square brackets] is a placeholder: India's e-commerce rules and Razorpay both need the real ones, and the startup check warns about them in production (config/schema.js). Amounts are in paise (₹1 = 100 paise).
- Functions: `setting`
- Exports: `STORE`, `CONTACT_TOPICS`, `PRICE_BANDS`

**`config/support.js`** (8 lines)

- What: Fixed lists for help requests, shared by the model, validation and the pages.
- Exports: `TICKET_STATUSES`, `TICKET_TOPICS`

---

## routes

URL map. Each file says: this URL + HTTP method → these guards (login, role, rate limit) → this controller function. Mounted in `app.js`.

**`routes/accountRoutes.js`** (23 lines)

- What: Mounted at /api/account. Signed-in customers only.
- Exports: `router`
- Uses: `../controllers/accountController`, `../middleware/auth`, `../controllers/recoveryController`, `../middleware/rateLimit`

**`routes/addressRoutes.js`** (20 lines)

- What: no header comment; read the file.
- Exports: `router`
- Uses: `../controllers/profileController`, `../middleware/auth`

**`routes/adminPageRoutes.js`** (76 lines)

- What: The admin console's pages, mounted at the private ADMIN_PATH (config.adminPath). Only the exact login URL answers visitors; every other page is a plain 404 unless an admin is signed in, so the console's existence is never revealed. The admin APIs live under /api/admin. The console has exactly the sections in config/adminNav.js, and every one of them is built: there are no placeholder pages, so an unknown URL here is an ordinary 404. Support tickets no longer have an admin screen; their JSON API stays so the customer side (My Account > Help) keeps working.
- Functions: `adminLocals`
- Exports: `router`
- Uses: `../config/env`, `../controllers/pageController`, `../controllers/adminSalesPageController`, `../controllers/adminCatalogPageController`, `../config/adminNav`, `../middleware/auth`, `../middleware/shell`, `../controllers/adminWalletController`

**`routes/adminRoutes.js`** (125 lines)

- What: Mounted at /api/admin. Admin login lives in authRoutes, so it is reached before this guard.
- Exports: `router`
- Uses: `../services/questionService`, `../services/auditService`, `../controllers/adminController`, `../controllers/adminProductController`, `../controllers/adminReportController`, `../controllers/adminOrderController`, `../controllers/adminCatalogController`, `../controllers/adminCouponController`, `../middleware/rateLimit`, `../middleware/auth`, `../middleware/upload`, `../controllers/adminWalletController`, `../services/marketplaceService`

**`routes/authRoutes.js`** (23 lines)

- What: Mounted at /api
- Exports: `router`
- Uses: `../controllers/authController`, `../controllers/recoveryController`, `../middleware/auth`, `../middleware/rateLimit`

**`routes/bundleRoutes.js`** (11 lines)

- What: Complete-the-kit bundles (E6). Mounted at /api.
- Exports: `router`
- Uses: `../controllers/bundleController`, `../middleware/auth`, `../middleware/rateLimit`

**`routes/cartRoutes.js`** (25 lines)

- What: Mounted at /api/cart. Only signed-in customers can put anything in a cart: every change needs a sign-in first (the store sends a signed-out visitor to sign in and back to the same page). Reading stays open, so a signed-out page can still ask for its badge count (an empty cart). Carts that guests filled before this rule move into the account at their next sign-in (cartService.mergeGuestCart).
- Exports: `router`
- Uses: `../controllers/cartController`, `../controllers/wishlistController`, `../middleware/auth`, `../middleware/guestCart`, `../middleware/rateLimit`

**`routes/contactRoutes.js`** (10 lines)

- What: Mounted at /api. Open to everyone; originCheck (in app.js) still blocks other websites.
- Exports: `router`
- Uses: `../controllers/contactController`, `../middleware/rateLimit`

**`routes/guideRoutes.js`** (10 lines)

- What: The content hub (E7): reader pages (public, cacheable) and the team's API (mounted in admin routes).
- Exports: `router`
- Uses: `../controllers/guidePageController`, `../middleware/publicCache`

**`routes/healthRoutes.js`** (44 lines)

- What: Two checks for hosting platforms, load balancers and uptime monitors. Neither needs a login, and neither says anything about the app beyond "up" or "down". GET /healthz "Is the process alive?" Always 200 while the server runs. Never touches the database, so a database outage does not make the platform restart a healthy app. GET /readyz "Can it take visitors?" 200 when MongoDB answers, 503 when it does not or the server is shutting down, so the platform stops sending traffic to this copy.
- Functions: `databaseUp`
- Exports: `router`
- Uses: `../utils/lifecycle`

**`routes/listRoutes.js`** (19 lines)

- What: Mounted at /api/lists. Signed-in customers only. ":listId" is a list id, or "default" for the main wishlist.
- Exports: `router`
- Uses: `../controllers/accountController`, `../middleware/auth`

**`routes/orderRoutes.js`** (22 lines)

- What: Mounted at /api. Checkout and orders are for signed-in customers only.
- Exports: `router`
- Uses: `../controllers/orderController`, `../middleware/auth`, `../middleware/upload`, `../middleware/rateLimit`

**`routes/pageRoutes.js`** (62 lines)

- What: My Account pages: signed-in customers only, without the store's motion layer.
- Exports: `router`
- Uses: `../controllers/pageController`, `../controllers/accountPageController`, `../middleware/auth`, `../middleware/shell`, `../middleware/publicCache`, `../controllers/recoveryController`

**`routes/paymentRoutes.js`** (17 lines)

- What: Mounted at /api/payments. The webhook is NOT here: it needs the raw body and is mounted in app.js before the JSON parser and the origin check.
- Exports: `router`
- Uses: `../controllers/paymentController`, `../middleware/auth`, `../middleware/rateLimit`

**`routes/productRoutes.js`** (31 lines)

- What: Mounted at /api. Public: no sign-in needed to browse. "/products/search" and "/products/lookup" must come before "/products/:id", or they would be read as ids.
- Exports: `router`
- Uses: `../controllers/productController`, `../middleware/auth`, `../middleware/rateLimit`, `../middleware/publicCache`, `../middleware/upload`

**`routes/profileRoutes.js`** (13 lines)

- What: Mounted at /api/profile. Every route here needs a signed-in customer.
- Exports: `router`
- Uses: `../controllers/profileController`, `../middleware/auth`, `../middleware/rateLimit`

**`routes/pushRoutes.js`** (27 lines)

- What: Push notifications (E5). Mounted at /api/push. GET /key the public VAPID key (or 404 when notifications are not set up) POST /subscribe { endpoint, keys: { p256dh, auth } } signed-in customers DELETE /subscribe { endpoint }
- Exports: `router`
- Uses: `../config/env`, `../services/pushService`, `../middleware/auth`, `../middleware/rateLimit`, `../utils/http`

**`routes/seoRoutes.js`** (81 lines)

- What: /robots.txt and /sitemap.xml (D1). The sitemap lists every page worth finding: home, the catalogue, each listed category and product (with its photo), and the policy pages. It is the same for everyone, so it is built at most every 30 minutes and may be kept by a CDN for an hour.
- Functions: `sitemapEntries`, `escapeXml`, `day`
- Exports: `router`
- Uses: `../models/Product`, `../services/categoryService`, `../utils/memo`, `../utils/queryFilters`, `../utils/seo`, `../utils/http`, `../utils/images`, `../models/Guide`

**`routes/supportRoutes.js`** (13 lines)

- What: Mounted at /api/support. Signed-in customers only.
- Exports: `router`
- Uses: `../controllers/accountController`, `../middleware/auth`, `../middleware/rateLimit`

**`routes/walletRoutes.js`** (14 lines)

- What: Mounted at /api. The wallet and coupons are for signed-in customers only.
- Exports: `router`
- Uses: `../controllers/walletController`, `../controllers/couponController`, `../middleware/auth`

**`routes/wishlistRoutes.js`** (13 lines)

- What: Mounted at /api/wishlist. Only signed-in customers have a wishlist.
- Exports: `router`
- Uses: `../controllers/wishlistController`, `../middleware/auth`

---

## controllers

HTTP layer. Read `req`, validate input, call a service, send JSON (`res.json`) or a page (`res.render`). No business rules here.

**`controllers/accountController.js`** (182 lines)

- What: My Account JSON API: sign-in email, sign out everywhere, preferences, recently viewed, deleting the account, the customer's reviews, shopping lists and help requests. Thin handlers: the rules live in the services. Every route is for a signed-in customer (see routes/accountRoutes.js).
- Functions: `checked`, `changeEmail`, `logoutAll`, `listSessions`, `endDeviceSession`, `updatePreferences`, `clearRecent`, `exportData`, `deleteAccount`, `updateReview`, `deleteReview`, `getLists`, `createList`, `renameList`, `deleteList`, `addListItem`, `removeListItem`, `moveListItem`, `listItemToCart`, `shareList`, `createTicket`, `listTickets`, `replyTicket`
- Exports: `changeEmail`, `logoutAll`, `listSessions`, `endDeviceSession`, `updatePreferences`, `clearRecent`, `deleteAccount`, `exportData`, `updateReview`, `deleteReview`, `getLists`, `createList`, `renameList`, `deleteList`, `addListItem`, `removeListItem`, `moveListItem`, `listItemToCart`, `shareList`, `createTicket`, `listTickets`, `replyTicket`
- Uses: `../services/accountService`, `../services/privacyService`, `../services/reviewService`, `../services/listService`, `../services/supportService`, `../services/auditService`, `../services/tokenService`, `../services/emailVerificationService`, `../utils/emailLayout`, `../utils/validators`, `../utils/http`, `../config/support`, `../utils/publicUser`

**`controllers/accountPageController.js`** (122 lines)

- What: My Account pages (server-rendered, customer only), the public page for a shared list, and the admin's support-ticket pages. The rules live in the services; these only pick the data to show.
- Functions: `notifications`, `baseUrl`, `overview`, `buyAgain`, `coupons`, `lists`, `recent`, `security`, `referral`, `help`, `ticket`, `sharedList`, `adminTickets`, `adminTicket`
- Exports: `overview`, `buyAgain`, `coupons`, `lists`, `recent`, `security`, `notifications`, `referral`, `help`, `ticket`, `sharedList`, `adminTickets`, `adminTicket`
- Uses: `../config/env`, `../services/accountService`, `../services/listService`, `../services/reviewService`, `../services/supportService`, `../models/Order`, `../utils/orderRules`, `../services/tokenService`, `../utils/http`, `../utils/queryString`, `../config/support`

**`controllers/adminCatalogController.js`** (98 lines)

- What: The admin API for the Catalog group: inventory corrections, plus the System status check. Every change is written to the audit log, so there is always a record of who changed what.
- Functions: `checked`, `applyChange`, `rupees`, `listInventory`, `describe`, `adjustStock`, `exportInventory`, `systemStatus`
- Exports: `listInventory`, `adjustStock`, `exportInventory`, `systemStatus`
- Uses: `../services/inventoryService`, `../services/systemService`, `../services/auditService`, `../services/stockAlertService`, `../utils/validators`, `../utils/csv`, `../utils/options`, `../utils/http`

**`controllers/adminCatalogPageController.js`** (41 lines)

- What: Admin pages for the Catalog group (inventory) and for System status. Thin handlers: every number comes from a service, and these only choose what the page shows.
- Functions: `base`, `without`, `inventory`, `questions`, `system`
- Exports: `questions`, `inventory`, `system`
- Uses: `../config/env`, `../services/inventoryService`, `../services/questionService`, `../services/systemService`, `../utils/queryString`, `../utils/http`

**`controllers/adminController.js`** (128 lines)

- What: GET /api/admin/dashboard?range=today|7d|30d|month|year|custom&from=&to= The store counts (stats) plus KPIs, chart series and panels for the date range.
- Functions: `dashboard`, `analytics`, `listCustomers`, `setCustomerBlocked`, `getSettings`, `updateReferral`, `updateCod`, `updatePrepaid`, `updateCodOtp`, `listTickets`, `replyTicket`, `search`, `notifications`
- Exports: `dashboard`, `analytics`, `search`, `notifications`, `listCustomers`, `setCustomerBlocked`, `getSettings`, `updateReferral`, `updateCod`, `updatePrepaid`, `updateCodOtp`, `listTickets`, `replyTicket`
- Uses: `../services/supportService`, `../services/auditService`, `../services/adminService`, `../services/dashboardService`, `../services/analyticsService`, `../services/settingsService`, `../services/messageService`, `../utils/validators`, `../utils/http`, `../utils/money`, `../config/support`

**`controllers/adminCouponController.js`** (74 lines)

- What: The admin coupon API. Every change is written to the audit log, because a coupon is money.
- Functions: `checked`, `snapshot`, `listCoupons`, `getCoupon`, `createCoupon`, `updateCoupon`, `setActive`, `deleteCoupon`
- Exports: `listCoupons`, `getCoupon`, `createCoupon`, `updateCoupon`, `setActive`, `deleteCoupon`
- Uses: `../services/adminCouponService`, `../services/auditService`, `../utils/validators`, `../utils/http`

**`controllers/adminOrderController.js`** (249 lines)

- What: Admin APIs for orders, returns, the money ledger, refunds and abandoned carts. Thin: validate, call the service, write the audit log, reply. Every change made here is audit-logged.
- Functions: `checked`, `sendTable`, `audit`, `stamp`, `listOrders`, `exportOrders`, `getOrder`, `setStatus`, `bulkStatus`, `cancelItems`, `addShipment`, `shipNow`, `markRto`, `addNote`, `refund`, `invoicePdf`, `creditNotePdf`, `packingSlipPdf`, `listReturns`, `decideReturn`, `listTransactions`, `exportTransactions`, `getTransaction`, `reconciliation`, `listRefunds` …
- Exports: `listOrders`, `exportOrders`, `getOrder`, `setStatus`, `bulkStatus`, `cancelItems`, `addShipment`, `shipNow`, `markRto`, `addNote`, `refund`, `invoicePdf`, `creditNotePdf`, `packingSlipPdf`, `listReturns`, `decideReturn`, `listTransactions`, `exportTransactions`, `getTransaction`, `reconciliation`, `listRefunds`, `listAbandoned`, `remindCart`
- Uses: `../services/adminOrderService`, `../services/ledgerService`, `../services/cartRecoveryService`, `../services/auditService`, `../services/invoiceService`, `../services/shippingService`, `../utils/excel`, `../utils/csv`, `../utils/orderRules`, `../utils/validators`, `../utils/http`

**`controllers/adminProductController.js`** (60 lines)

- What: The form fields are checked here; the service adds photo checks and reports every problem together.
- Functions: `readForm`, `listProducts`, `getProduct`, `createProduct`, `updateProduct`, `setListed`, `restock`
- Exports: `listProducts`, `getProduct`, `createProduct`, `updateProduct`, `setListed`, `restock`
- Uses: `../services/adminProductService`, `../services/auditService`, `../services/stockAlertService`, `../utils/validators`, `../utils/http`

**`controllers/adminReportController.js`** (102 lines)

- What: Admin exports. Read-only; the data is streamed row by row, so a large export never sits in memory.
- Functions: `rupees`, `salesCsv`, `analyticsCsv`
- Exports: `salesCsv`, `analyticsCsv`
- Uses: `../models/Order`, `../services/dashboardService`, `../services/analyticsService`, `../utils/csv`, `../utils/http`

**`controllers/adminSalesPageController.js`** (123 lines)

- What: Admin pages for the Sales group: orders, one order, returns, transactions (and one entry, and the daily reconciliation), refunds and abandoned carts. The data comes from the services.
- Functions: `base`, `without`, `orders`, `order`, `returns`, `transactions`, `transaction`, `reconciliation`, `refunds`, `abandonedCarts`, `coupons`, `couponNew`, `couponEdit`, `coupon`
- Exports: `orders`, `order`, `returns`, `transactions`, `transaction`, `reconciliation`, `refunds`, `abandonedCarts`, `coupons`, `couponNew`, `couponEdit`, `coupon`
- Uses: `../config/env`, `../services/adminOrderService`, `../services/ledgerService`, `../services/cartRecoveryService`, `../services/adminCouponService`, `../utils/orderRules`, `../utils/queryString`, `../utils/http`

**`controllers/adminWalletController.js`** (18 lines)

- What: no header comment; read the file.
- Functions: `get`, `adjust`, `page`
- Exports: `get`, `adjust`, `page`
- Uses: `../services/adminWalletService`, `../services/auditService`, `../utils/http`, `../config/env`

**`controllers/authController.js`** (160 lines)

- What: Adds the sign-in to the account's login activity (browser and masked IP). Never blocks signing in.
- Functions: `noteLogin`, `bringGuestCart`, `scopeFrom`, `sendSignedIn`, `me`, `signOut`, `signup`, `login`, `adminLogin`, `refresh`, `logout`, `adminLogout`
- Exports: `signup`, `login`, `adminLogin`, `refresh`, `me`, `logout`, `adminLogout`
- Uses: `../services/authService`, `../services/refreshTokenService`, `../services/tokenService`, `../services/emailVerificationService`, `../utils/emailLayout`, `../utils/validators`, `../utils/http`, `../utils/money`, `../services/accountService`, `../utils/logger`, `../utils/publicUser`, `../services/cartService`, `../middleware/guestCart`

**`controllers/bundleController.js`** (12 lines)

- What: no header comment; read the file.
- Functions: `forProduct`, `addAll`
- Exports: `forProduct`, `addAll`
- Uses: `../services/bundleService`, `../utils/http`

**`controllers/cartController.js`** (49 lines)

- What: no header comment; read the file.
- Functions: `checked`, `getCart`, `countItems`, `addItem`, `updateItem`, `removeItem`, `clearCart`
- Exports: `getCart`, `countItems`, `addItem`, `updateItem`, `removeItem`, `clearCart`
- Uses: `../services/cartService`, `../utils/validators`, `../utils/http`, `../utils/options`

**`controllers/contactController.js`** (26 lines)

- What: no header comment; read the file.
- Functions: `checked`, `sendMessage`, `subscribe`
- Exports: `sendMessage`, `subscribe`
- Uses: `../services/contactService`, `../utils/validators`, `../utils/http`

**`controllers/couponController.js`** (50 lines)

- What: The items a coupon is measured against: the cart, or the Buy now product (?source=buynow or body.source). Each keeps its own coupon, so a Buy now coupon never changes the cart's.
- Functions: `itemsFor`, `sourceOf`, `listAvailable`, `apply`, `remove`
- Exports: `listAvailable`, `apply`, `remove`
- Uses: `../services/couponService`, `../services/cartService`, `../services/buyNowService`, `../utils/http`, `../utils/pricing`

**`controllers/guidePageController.js`** (14 lines)

- What: no header comment; read the file.
- Functions: `hub`, `guide`
- Exports: `hub`, `guide`
- Uses: `../services/guideService`, `../utils/http`

**`controllers/marketplaceController.js`** (12 lines)

- What: Stock sync from a marketplace (E8). POST /api/webhooks/marketplace-stock { sku, stock } with x-api-key.
- Functions: `stockSync`
- Exports: `stockSync`
- Uses: `../services/marketplaceService`, `../utils/http`

**`controllers/orderController.js`** (119 lines)

- What: no header comment; read the file.
- Functions: `checked`, `toPublicOrder`, `quote`, `buyNow`, `placeOrder`, `sendCodCode`, `listOrders`, `getOrder`, `cancelOrder`, `cancelItem`, `requestReturn`
- Exports: `sendCodCode`, `toPublicOrder`, `quote`, `buyNow`, `placeOrder`, `listOrders`, `getOrder`, `cancelOrder`, `cancelItem`, `requestReturn`
- Uses: `../services/checkoutService`, `../services/codConfirmService`, `../services/orderService`, `../services/buyNowService`, `../utils/validators`, `../utils/http`, `../utils/orderRules`, `../services/imageService`

**`controllers/pageController.js`** (447 lines)

- What: ---------- Store pages ----------
- Functions: `infoPage`, `authPage`, `adminLogin`, `home`, `rupeeText`, `products`, `productDetail`, `wallet`, `profile`, `cart`, `checkout`, `orders`, `orderDetail`, `stopStockAlert`, `orderSuccess`, `orderInvoice`, `orderCreditNote`, `adminDashboard`, `adminAnalytics`, `adminSettings`, `adminUsers`, `adminProducts`, `adminProductNew`, `adminProductEdit`
- Exports: `home`, `infoPage`, `products`, `productDetail`, `login`, `signup`, `profile`, `cart`, `checkout`, `orders`, `wallet`, `orderDetail`, `orderSuccess`, `stopStockAlert`, `orderInvoice`, `orderCreditNote`, `adminLogin`, `adminDashboard`, `adminAnalytics`, `adminUsers`, `adminSettings`, `adminProducts`, `adminProductNew`, `adminProductEdit`
- Uses: `../config/env`, `../services/dashboardService`, `../services/analyticsService`, `../services/productService`, `../services/profileService`, `../services/adminService`, `../services/adminProductService`, `../services/cartService`, `../services/homeService`, `../services/checkoutService`, `../services/orderService`, `../services/invoiceService`, `../services/razorpayService`, `../services/walletService`, `../services/referralService`, `../services/settingsService`, `../services/accountService`, `../services/reviewService`, `../services/recommendationService`, `../services/searchInsightService`, `../utils/orderRules`, `../models/Category`, `../models/Address`, `../middleware/guestCart`, `../config/store`, `../config/catalog`, `../utils/http`, `../utils/queryString`, `../utils/seo`, `../utils/analyticsEvents`, `../services/shippingService`, `../services/stockAlertService`, `../services/questionService`, `../utils/images`, `../services/deliveryService`

**`controllers/paymentController.js`** (85 lines)

- What: no header comment; read the file.
- Functions: `readIds`, `createOrder`, `retry`, `verify`, `failed`, `status`, `webhook`
- Exports: `createOrder`, `retry`, `verify`, `failed`, `status`, `webhook`
- Uses: `../services/paymentService`, `../utils/validators`, `../utils/http`

**`controllers/productController.js`** (128 lines)

- What: GET /api/products?q=&category=&brand=&min=&max=&discount=&rating=&inStock=1&sort=&page= Prices are in paise; min and max in the query are whole rupees.
- Functions: `listProducts`, `searchProducts`, `searchStart`, `lookupProducts`, `getProduct`, `listCategories`, `listReviews`, `addReview`, `deliveryEstimate`, `pincodeLookup`, `addStockAlert`, `listQuestions`, `askQuestion`, `answerQuestion`, `suggest`
- Exports: `suggest`, `listQuestions`, `askQuestion`, `answerQuestion`, `addStockAlert`, `listProducts`, `searchProducts`, `searchStart`, `lookupProducts`, `getProduct`, `listCategories`, `listReviews`, `addReview`, `deliveryEstimate`, `pincodeLookup`
- Uses: `../services/productService`, `../services/reviewService`, `../services/shippingService`, `../services/stockAlertService`, `../services/imageService`, `../services/questionService`, `../services/pincodeService`, `../utils/http`, `../utils/validators`, `../services/searchInsightService`, `../utils/queryFilters`, `../models/Product`

**`controllers/profileController.js`** (83 lines)

- What: no header comment; read the file.
- Functions: `checked`, `getProfile`, `updateProfile`, `changePassword`, `listAddresses`, `addAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`
- Exports: `getProfile`, `updateProfile`, `changePassword`, `listAddresses`, `addAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`
- Uses: `../services/profileService`, `../services/refreshTokenService`, `../services/tokenService`, `../utils/validators`, `../utils/http`, `../services/auditService`, `../services/authMailService`, `../utils/background`, `../utils/emailLayout`, `../utils/publicUser`

**`controllers/recoveryController.js`** (74 lines)

- What: Forgot password, reset password, and confirming an email address: the API, and the three pages the emailed links open. The services hold the rules (services/passwordResetService.js, services/emailVerificationService.js); this file only reads the request and shapes the reply.
- Functions: `checked`, `recoveryPage`, `forgotPassword`, `resetPassword`, `verifyEmail`, `resendVerification`
- Exports: `forgotPassword`, `resetPassword`, `verifyEmail`, `resendVerification`, `forgotPage`, `resetPage`, `verifyPage`
- Uses: `../services/passwordResetService`, `../services/emailVerificationService`, `../services/tokenService`, `../utils/validators`, `../utils/emailLayout`, `../utils/http`, `../utils/publicUser`

**`controllers/shippingController.js`** (23 lines)

- What: Courier tracking webhook (B5). Shiprocket posts every status change here with our token in the x-api-key header. Mounted in app.js before the origin check (couriers send no Origin header); the token is the proof the update is real. Unknown parcels still get 200, so Shiprocket stops retrying.
- Functions: `courierWebhook`
- Exports: `courierWebhook`
- Uses: `../services/shippingService`, `../utils/logger`

**`controllers/walletController.js`** (15 lines)

- What: GET /api/wallet?type=all|credit|debit&page= Balance, history (paise) and the referral code.
- Functions: `getWallet`
- Exports: `getWallet`
- Uses: `../services/walletService`, `../services/referralService`, `../utils/http`

**`controllers/wishlistController.js`** (37 lines)

- What: GET /api/wishlist
- Functions: `getWishlist`, `addProduct`, `removeProduct`, `moveToCart`, `saveForLater`
- Exports: `getWishlist`, `addProduct`, `removeProduct`, `moveToCart`, `saveForLater`
- Uses: `../services/wishlistService`, `../utils/validators`, `../utils/http`

---

## services

Business logic. Prices, stock, orders, coupons, wallet, emails. Know nothing about HTTP, so they are easy to test.

### services/

**`services/accountService.js`** (281 lines)

- What: My Account > Recently viewed shows the last 5 products.
- Functions: `recordLogin`, `loginActivity`, `recordView`, `recentlyViewed`, `clearRecent`, `updatePreferences`, `checkPassword`, `changeEmail`, `logoutEverywhere`, `sessions`, `endSession`, `deleteAccount`, `lastOrder`, `recommendations`, `overview`, `buyAgain`, `coupons`, `referral`, `toId`
- Exports: `RECENT_LIMIT`, `LOGIN_HISTORY`, `OPEN_STATUSES`, `browserName`, `recordLogin`, `loginActivity`, `recordView`, `recentlyViewed`, `clearRecent`, `updatePreferences`, `checkPassword`, `changeEmail`, `logoutEverywhere`, `sessions`, `endSession`, `deleteAccount`, `overview`, `recommendations`, `buyAgain`, `coupons`, `referral`
- Uses: `../models/User`, `../models/Order`, `../models/StockAlert`, `../models/Product`, `../models/Review`, `../models/Coupon`, `../models/CouponRedemption`, `../models/LoginActivity`, `../models/WalletTransaction`, `./walletService`, `./wishlistService`, `./couponService`, `./referralService`, `./auditService`, `./refreshTokenService`, `../utils/device`, `../utils/http`, `../utils/queryFilters`

**`services/adminCouponService.js`** (238 lines)

- What: Coupons, from the admin's side: the list, creating and editing, the enable/disable toggle, the soft delete, and who used each one. The rules a coupon is judged by live in utils/pricing.js (couponProblem) and are applied at checkout by services/couponService.js. Nothing here duplicates them: the store always decides on the server, so an admin screen can never make a coupon behave differently from checkout.
- Functions: `statusOf`, `toAdminCoupon`, `readFilters`, `statusFilter`, `listCoupons`, `findCoupon`, `getCoupon`, `getCouponDetail`, `createCoupon`, `updateCoupon`, `setActive`, `deleteCoupon`
- Exports: `PAGE_SIZE`, `STATUSES`, `STATUS_LABELS`, `SORTS`, `statusOf`, `toAdminCoupon`, `readFilters`, `statusFilter`, `listCoupons`, `getCoupon`, `getCouponDetail`, `createCoupon`, `updateCoupon`, `setActive`, `deleteCoupon`
- Uses: `../models/Coupon`, `../models/CouponRedemption`, `../models/Order`, `../utils/http`, `./productService`, `./couponService`

**`services/adminOrderService.js`** (366 lines)

- What: Admin: orders and returns. Lists with filters and search, forward-only status changes (one or in bulk), item cancellation, shipments, internal notes, manual refunds and return decisions. The order rules live in utils/orderRules.js and orderService; money moves through refundService.
- Functions: `istDay`, `readOrderFilters`, `matchingUserIds`, `buildOrderFilter`, `toListRow`, `listOrders`, `exportOrders`, `findOrder`, `getOrder`, `updateStatus`, `bulkStatus`, `cancelItems`, `addShipment`, `addNote`, `manualRefund`, `readReturnFilters`, `listReturns`, `settle`, `decideReturn`, `rupeesToPaise`, `cleanText`, `snapshot`
- Exports: `PAGE_SIZE`, `ORDER_SORTS`, `METHODS`, `RETURN_FILTERS`, `readOrderFilters`, `listOrders`, `exportOrders`, `findOrder`, `getOrder`, `updateStatus`, `bulkStatus`, `cancelItems`, `addShipment`, `addNote`, `manualRefund`, `readReturnFilters`, `listReturns`, `decideReturn`
- Uses: `../events`, `../models/Order`, `../models/User`, `./orderService`, `./refundService`, `../utils/orderRules`, `../utils/http`, `./productService`, `./settlementService`

**`services/adminProductService.js`** (348 lines)

- What: no header comment; read the file.
- Functions: `statusOf`, `imagesOf`, `toAdminProduct`, `readAdminFilters`, `listAdminProducts`, `findProduct`, `checkCategory`, `getAdminProduct`, `readJsonList`, `planImages`, `readPhotoColours`, `colourPhotosFor`, `orderImages`, `uniqueSlug`, `checkUploads`, `persist`, `createProduct`, `updateProduct`, `setListed`, `restock`
- Exports: `restock`, `PAGE_SIZE`, `ADMIN_SORTS`, `STATUSES`, `readAdminFilters`, `listAdminProducts`, `getAdminProduct`, `planImages`, `orderImages`, `readPhotoColours`, `colourPhotosFor`, `uniqueSlug`, `createProduct`, `updateProduct`, `setListed`, `toAdminProduct`
- Uses: `../models/Product`, `../models/Category`, `../config/catalog`, `../utils/money`, `../utils/http`, `../utils/slug`, `../utils/gst`, `./productService`, `./imageService`

**`services/adminService.js`** (139 lines)

- What: no header comment; read the file.
- Functions: `getDashboardStats`, `publicCustomer`, `listCustomers`, `customersWithWallets`, `setCustomerBlocked`, `globalSearch`, `notifications`
- Exports: `getDashboardStats`, `listCustomers`, `setCustomerBlocked`, `globalSearch`, `notifications`
- Uses: `../models/User`, `../models/Wallet`, `../models/Product`, `../models/Order`, `../config/catalog`, `../utils/http`, `./productService`, `./refreshTokenService`, `../utils/queryFilters`

**`services/adminWalletService.js`** (77 lines)

- What: no header comment; read the file.
- Functions: `validateAdjustment`, `customer`, `details`, `adjust`
- Exports: `validateAdjustment`, `customer`, `details`, `adjust`
- Uses: `../models/User`, `../models/Wallet`, `../models/WalletTransaction`, `./walletService`, `./auditService`, `../utils/http`, `../utils/money`, `../utils/exclusive`

**`services/analyticsService.js`** (254 lines)

- What: Analytics: the numbers behind the admin's Analytics section. It reuses the dashboard's date handling (services/dashboardService.js) so a "day" is an Indian calendar day there and here. On top of the range it adds a grouping the admin can choose: by day, by week or by month. Money is in paise. What it answers: revenue & orders over time timeline top-selling products topProducts (by revenue and by units) top categories topCategories average order value summary.aov, and aov per bucket in the timeline new vs returning customers newReturning
- Functions: `readGroup`, `startsFor`, `timeline`, `newReturning`, `topProducts`, `topCategories`, `payments`, `funnel`, `summary`, `analytics`, `inRange`, `truncate`, `liveItems`, `weekLabel`, `labelFor`
- Exports: `GROUPS`, `GROUP_LABELS`, `readGroup`, `startsFor`, `timeline`, `newReturning`, `topProducts`, `topCategories`, `payments`, `funnel`, `summary`, `analytics`
- Uses: `../models/Order`, `../models/Cart`, `../models/User`, `../utils/orderRules`, `./dashboardService`

**`services/auditService.js`** (60 lines)

- What: Field names that must never be written to the audit log.
- Functions: `clean`, `maskIp`, `fromRequest`, `record`, `list`
- Exports: `clean`, `maskIp`, `fromRequest`, `record`, `list`, `SECRET_FIELD`
- Uses: `../models/AuditLog`, `../utils/logger`

**`services/authMailService.js`** (53 lines)

- What: The emails about signing in: reset your password, confirm your email, and "your password was changed". Each is a short, plain message with one action (utils/emailLayout.js).
- Functions: `send`, `sendPasswordReset`, `sendEmailVerification`, `sendPasswordChanged`, `firstName`
- Exports: `sendPasswordReset`, `sendEmailVerification`, `sendPasswordChanged`
- Uses: `./mailService`, `../utils/emailLayout`, `../config/store`

**`services/authService.js`** (74 lines)

- What: no header comment; read the file.
- Functions: `registerCustomer`, `authenticate`, `touchLogin`, `hashPassword`
- Exports: `registerCustomer`, `authenticate`, `touchLogin`, `hashPassword`, `BCRYPT_ROUNDS`
- Uses: `../models/User`, `./referralService`, `../utils/http`, `../utils/logger`

**`services/authTokenService.js`** (65 lines)

- What: One-time email links (password reset, email confirmation). See models/AuthToken.js.
- Functions: `issue`, `consume`, `isUsable`, `countRecent`, `invalidateAll`, `newToken`, `hashToken`
- Exports: `issue`, `consume`, `isUsable`, `countRecent`, `invalidateAll`, `hashToken`, `newToken`, `TOKEN`, `LIFETIME_MS`
- Uses: `../models/AuthToken`

**`services/bundleService.js`** (65 lines)

- What: Complete-the-kit bundles (E6). forProduct(productId) active bundles that include this product, with their listed products addAll(user, slug) adds every item of the bundle to the signed-in customer's cart create(value) admin: a new bundle (2 to 6 listed products, up to 30% off the set) The discount shown is the bundle's own; the cart and checkout still price every line on the server.
- Functions: `listedProducts`, `shape`, `forProduct`, `addAll`, `slugify`
- Exports: `forProduct`, `addAll`, `shape`, `slugify`
- Uses: `../models/Bundle`, `../models/Product`, `./cartService`, `../utils/queryFilters`, `../utils/http`

**`services/buyNowService.js`** (57 lines)

- What: How long a Buy now checkout stays open before it has to be started again.
- Functions: `readSource`, `start`, `getView`, `setCoupon`, `clear`
- Exports: `TTL_MS`, `SOURCES`, `EXPIRED_MESSAGE`, `readSource`, `start`, `getView`, `setCoupon`, `clear`
- Uses: `../models/BuyNow`, `../models/Product`, `./cartService`, `../utils/http`, `../utils/queryFilters`, `../utils/options`

**`services/cacheSync.js`** (40 lines)

- What: Keeps the catalogue cache (utils/memo.js) in step across every copy of the store. Each copy keeps its own cache (fast, nothing to send over the network), and when one copy clears a group (a product was edited, stock went down with an order) it tells the others through Redis, so they clear it too, straight away. Without Redis this does nothing, and other copies catch up when their copy runs out (30 seconds at most).
- Functions: `handleMessage`, `start`
- Exports: `start`, `handleMessage`, `CHANNEL`, `self`
- Uses: `../utils/memo`, `../providers/redis`, `../utils/logger`

**`services/cartRecoveryService.js`** (172 lines)

- What: Abandoned carts: carts with items that nobody has touched for 24 hours or more, their value at today's prices, a reminder email (at most one a day, only to customers who accept offer emails) and the recovery rate (reminded carts whose customer ordered afterwards).
- Functions: `abandonedPipeline`, `readFilters`, `canRemind`, `stats`, `listAbandoned`, `remind`, `sendReminder`, `queueDueReminders`
- Exports: `PAGE_SIZE`, `IDLE_HOURS`, `SORTS`, `readFilters`, `listAbandoned`, `stats`, `remind`, `sendReminder`, `queueDueReminders`, `canRemind`
- Uses: `../models/Cart`, `../models/User`, `../models/Product`, `../models/Order`, `./mailService`, `../jobs/queue`, `../utils/emailLayout`, `../utils/images`, `../utils/http`, `./productService`, `../utils/money`

**`services/cartService.js`** (302 lines)

- What: no header comment; read the file.
- Functions: `isSold`, `stockFor`, `isAvailable`, `limitFor`, `quantityProblem`, `reasonFor`, `buildCartView`, `toObjectId`, `storeFor`, `findOrCreateCart`, `getCart`, `countItems`, `quantityInCart`, `addItem`, `updateQuantity`, `removeItem`, `clearCart`, `mergeGuestCart`, `sameLine`
- Exports: `MAX_PER_PRODUCT`, `deliveryFeeFor`, `isSold`, `isAvailable`, `limitFor`, `stockFor`, `quantityProblem`, `buildCartView`, `getCart`, `countItems`, `quantityInCart`, `mergeGuestCart`, `addItem`, `updateQuantity`, `removeItem`, `clearCart`
- Uses: `../models/Cart`, `../models/GuestCart`, `../models/Product`, `../utils/http`, `../config/store`, `../utils/pricing`, `../utils/options`

**`services/categoryService.js`** (112 lines)

- What: The listed categories are read on every page (header, menus), so they are kept in memory for a short time. Any admin change clears this straight away.
- Functions: `invalidate`, `listedCategories`, `findListedBySlug`, `uniqueCategorySlug`, `ensureCategory`, `migrateProductCategories`, `getCategory`, `syncProducts`
- Exports: `syncProducts`, `invalidate`, `listedCategories`, `findListedBySlug`, `uniqueCategorySlug`, `ensureCategory`, `migrateProductCategories`, `getCategory`
- Uses: `../models/Category`, `../models/Product`, `../utils/pricing`, `../config/catalog`, `../utils/slug`, `../utils/http`, `../utils/queryFilters`, `../utils/memo`

**`services/checkoutService.js`** (283 lines)

- What: Placed here at once. Online payment (razorpay) goes through paymentService. "wallet" is used when the wallet covers the whole amount.
- Functions: `nextOrderId`, `findAddress`, `addressSnapshot`, `itemsFor`, `buildQuote`, `publicQuote`, `itemSnapshots`, `assertOrderable`, `orderMoney`, `saveOrder`, `placeOrder`
- Exports: `PAYMENT_METHODS`, `MAX_OPEN_COD`, `nextOrderId`, `findAddress`, `addressSnapshot`, `buildQuote`, `publicQuote`, `itemSnapshots`, `assertOrderable`, `orderMoney`, `saveOrder`, `placeOrder`
- Uses: `../events`, `../models/Address`, `../models/Cart`, `../models/Order`, `./cartService`, `./buyNowService`, `./couponService`, `./walletService`, `./stockService`, `../utils/http`, `../utils/pricing`, `./settingsService`, `./codConfirmService`, `../utils/money`, `../services/counterService`, `./gstService`

**`services/codConfirmService.js`** (79 lines)

- What: Cash on Delivery confirmation by code (E2). Fake or careless COD orders come back as refused parcels and cost two courier trips; a code sent to the delivery phone proves someone real is waiting for it. isNeeded(user, phone) the admin turned it on (Settings), a provider can send codes, and this phone was not confirmed by this customer in the last 90 days send(user, address) a 6-digit code to the address's phone (SMS, else WhatsApp); 30 s between sends, 5 sends per code verify(user, phone, c) 5 tries; a right code marks the phone as confirmed
- Functions: `isNeeded`, `send`, `verify`, `hash`, `maskPhone`
- Exports: `isNeeded`, `send`, `verify`, `maskPhone`, `TRUST_MS`
- Uses: `../config/env`, `../models/PhoneCode`, `../models/User`, `./settingsService`, `./messageService`, `../utils/logger`, `../utils/http`

**`services/commerceRecoveryService.js`** (26 lines)

- What: no header comment; read the file.
- Functions: `sweep`
- Exports: `sweep`
- Uses: `../models/Order`, `../utils/logger`, `./refundService`, `./settlementService`, `./paymentService`

**`services/contactService.js`** (19 lines)

- What: Saves a contact form message. Messages caught by the hidden trap field are dropped quietly, so a bot gets the normal reply and learns nothing.
- Functions: `saveContactMessage`, `subscribe`
- Exports: `saveContactMessage`, `subscribe`
- Uses: `../models/ContactMessage`, `../models/NewsletterSubscriber`

**`services/counterService.js`** (30 lines)

- What: Named running numbers, e.g. "order-2026" → 123 for order NX-2026-000123. $inc on one document is atomic, so two callers can never get the same number.
- Functions: `nextNumber`, `numberFor`
- Exports: `nextNumber`, `numberFor`
- Uses: `../models/Counter`

**`services/couponService.js`** (125 lines)

- What: Coupons: checking a code, keeping the chosen one on the cart, listing the ones a customer can use, and counting each use. The discount itself is worked out in utils/pricing.js. usedCount on the coupon the total-uses limit, claimed with ONE atomic update CouponRedemption rows the per-customer limit, one row per order that used it
- Functions: `normaliseCode`, `describe`, `toPublicCoupon`, `usedBy`, `check`, `applyToCart`, `removeFromCart`, `listAvailable`, `redeem`, `release`
- Exports: `CODE`, `normaliseCode`, `describe`, `toPublicCoupon`, `usedBy`, `check`, `applyToCart`, `removeFromCart`, `listAvailable`, `redeem`, `release`
- Uses: `../models/Cart`, `../models/Coupon`, `../models/CouponRedemption`, `../utils/http`, `../utils/money`, `../utils/pricing`

**`services/dashboardService.js`** (358 lines)

- What: The admin dashboard: KPIs for a date range (with the change against the previous period), the series behind every chart, and the "needs attention" panels. Everything is computed with MongoDB aggregations in India time (Asia/Kolkata), so a "day" is an Indian calendar day. Money is in paise.
- Functions: `parseDay`, `readRange`, `bucketStarts`, `bucketLabel`, `kpiFigures`, `conversion`, `totalsFrom`, `change`, `customerIdSet`, `kpis`, `charts`, `panels`, `dashboard`, `istParts`, `istDate`, `istDayStart`, `isoDay`, `inRange`, `truncate`
- Exports: `RANGES`, `RANGE_LABELS`, `KPI_META`, `readRange`, `bucketStarts`, `bucketLabel`, `change`, `dashboard`, `kpis`, `charts`, `panels`
- Uses: `../models/Order`, `../models/User`, `../models/Product`, `../models/WalletTransaction`, `../models/LoginActivity`, `../config/catalog`, `../utils/orderRules`, `../utils/queryFilters`

**`services/deliveryService.js`** (80 lines)

- What: Delivery date estimates by PIN code. There is no courier API yet, so this uses simple, honest rules: big metro areas are fastest, the north-east, Jammu & Kashmir, Ladakh and the islands are slowest, and everywhere else is in between. Orders after the cut-off ship the next day, and nothing is delivered on a Sunday.
- Functions: `zoneFor`, `addDeliveryDays`, `isServiceable`, `estimateDelivery`
- Exports: `PINCODE`, `ZONES`, `zoneFor`, `isServiceable`, `estimateDelivery`, `addDeliveryDays`

**`services/emailVerificationService.js`** (59 lines)

- What: "Confirm your email": a link sent to the address on the account. Opening it proves the address is real and belongs to this person, so order emails and password resets reach the right inbox. Nothing is blocked until it is confirmed; the shop only reminds (a banner with a "send again" button).
- Functions: `sendInBackground`, `sendNow`, `resend`, `verify`, `isLinkUsable`
- Exports: `sendInBackground`, `sendNow`, `resend`, `verify`, `isLinkUsable`, `MAX_PER_HOUR`, `BAD_LINK`
- Uses: `../models/User`, `./authTokenService`, `./authMailService`, `./auditService`, `../utils/http`, `../utils/background`, `../utils/exclusive`

**`services/gstService.js`** (134 lines)

- What: GST on orders (B4): the tax worked out when an order is saved, the invoice number when the order is confirmed, and credit notes when invoiced items are cancelled or returned. The rules themselves are in utils/gst.js; this file applies them to orders and keeps the numbering safe. Numbering: GST needs one unbroken series per financial year. Numbers come from an atomic counter, and an order (or credit note) first CLAIMS its slot with a conditional update, so a retry or a second caller never takes a number that then goes unused.
- Functions: `taxForOrder`, `issueInvoice`, `syncCreditNotes`
- Exports: `taxForOrder`, `issueInvoice`, `syncCreditNotes`, `INVOICE_PREFIX`, `CREDIT_PREFIX`
- Uses: `../models/Order`, `../models/Product`, `./counterService`, `../config/store`, `../utils/gst`

**`services/guideService.js`** (29 lines)

- What: The content hub (E7): published guides for readers, and create/publish for the team.
- Functions: `list`, `bySlug`, `blocks`
- Exports: `PAGE_SIZE`, `list`, `bySlug`, `blocks`
- Uses: `../models/Guide`, `../utils/http`

**`services/homeService.js`** (155 lines)

- What: no header comment; read the file.
- Functions: `dealEndsAt`, `portraitImage`, `buildSportRing`, `findGearImages`, `buildFeatured`, `buildHomeSections`, `getHomePage`
- Exports: `dealEndsAt`, `buildSportRing`, `portraitImage`, `buildFeatured`, `getHomePage`
- Uses: `./productService`, `../models/Product`, `../utils/queryFilters`, `../utils/memo`

**`services/imageMigrationService.js`** (135 lines)

- What: Moves photos uploaded earlier to the current storage, in the current format ("npm run images:migrate"). Two situations need it: 1. Photos uploaded before small copies existed ("/uploads/products/<id>.jpg"): they get a full WebP and 200/400/800/1600 copies, so product cards stop downloading the big file. 2. Switching STORAGE_DRIVER from local to cloudinary: every photo still on this server's disk is uploaded to Cloudinary, so the site no longer depends on the server's disk. Every place that stores a photo address is updated: products (image, gallery), categories, order lines (the photo at the time of the order) and return photos. Old files on disk are never deleted, so the
- Functions: `savedAddresses`, `planMoves`, `rewriteAddresses`, `migrateImages`, `flat`
- Exports: `migrateImages`, `savedAddresses`
- Uses: `../models/Product`, `../models/Category`, `../models/Order`, `../providers/storage`, `./imageService`

**`services/imageService.js`** (135 lines)

- What: no header comment; read the file.
- Functions: `detectImageType`, `findFakeImages`, `renderImage`, `saveImages`, `isUploadedImage`, `keysFor`, `deleteImages`
- Exports: `renderImage`, `MAX_IMAGES`, `MAX_RETURN_PHOTOS`, `MAX_IMAGE_BYTES`, `ALLOWED_TYPES`, `FOLDERS`, `FULL_SIDE`, `detectImageType`, `findFakeImages`, `saveImages`, `deleteImages`, `isUploadedImage`, `keysFor`
- Uses: `../providers/storage`, `../utils/images`, `../utils/http`, `../utils/logger`

**`services/inventoryService.js`** (226 lines)

- What: Inventory: the stock view of the catalogue. Products is where a product is written; this is where its stock is watched and corrected. Money is in paise. Stock is changed with one atomic update ($inc for "add" and "remove", $set for "count"), so a correction can never race with a checkout that is taking the same units.
- Functions: `stateOf`, `readFilters`, `filterFrom`, `toRow`, `totals`, `listInventory`, `adjustOptionStock`, `adjustStock`, `cursorFor`
- Exports: `PAGE_SIZE`, `MAX_STOCK`, `STATUSES`, `STATUS_LABELS`, `SORTS`, `stateOf`, `readFilters`, `totals`, `listInventory`, `adjustStock`, `cursorFor`
- Uses: `../models/Product`, `../models/Category`, `../config/catalog`, `../utils/http`, `./productService`, `../utils/options`

**`services/invoiceService.js`** (401 lines)

- What: Draws an order's tax invoice as a PDF with pdfkit. Uses Noto Sans (assets/fonts) because the built-in PDF fonts cannot print the rupee sign.
- Functions: `invoiceNumber`, `writeInvoice`, `assertInvoiceReady`, `findCreditNote`, `writeCreditNote`, `writeSimpleInvoice`, `writeGstDocument`, `writePackingSlip`, `dateText`, `itemName`, `hasGstInvoice`, `fileNameFor`
- Exports: `writeInvoice`, `writeCreditNote`, `findCreditNote`, `assertInvoiceReady`, `writePackingSlip`, `invoiceNumber`, `hasGstInvoice`, `fileNameFor`
- Uses: `../config/store`, `../utils/money`, `../utils/orderRules`, `../utils/gst`, `../utils/http`

**`services/ledgerService.js`** (249 lines)

- What: The money ledger: every money movement in one list, built live from the orders and the wallet (so nothing has to be written twice and it can never drift out of step). payment an online (Razorpay) payment: captured, failed or pending money in cod cash collected on delivery money in wallet_payment wallet money spent at checkout (internal, not new money) - refund money given back (to the wallet or to the card/UPI) money out coupon a coupon discount (money not taken, shown for the record) - wallet_credit referral rewards and credits added by admins money out
- Functions: `istDay`, `branches`, `unionPipeline`, `readFilters`, `matchStage`, `listTransactions`, `exportTransactions`, `getTransaction`, `listRefunds`, `reconciliation`, `isoDay`, `str`, `common`
- Exports: `PAGE_SIZE`, `TYPES`, `TYPE_LABELS`, `STATUSES`, `METHODS`, `readFilters`, `listTransactions`, `exportTransactions`, `getTransaction`, `listRefunds`, `reconciliation`
- Uses: `../models/Order`, `../models/User`, `../models/WalletTransaction`, `../utils/orderRules`, `../utils/http`, `./productService`

**`services/listService.js`** (163 lines)

- What: no header comment; read the file.
- Functions: `productObjectId`, `findOwnedList`, `summary`, `getLists`, `getList`, `createList`, `ensureUniqueName`, `renameList`, `deleteList`, `addItem`, `removeItem`, `moveItem`, `setSharing`, `getShared`, `moveToCart`
- Exports: `MAX_LISTS`, `MAX_ITEMS`, `DEFAULT`, `getLists`, `getList`, `createList`, `renameList`, `deleteList`, `addItem`, `removeItem`, `moveItem`, `setSharing`, `getShared`, `moveToCart`
- Uses: `../models/ShoppingList`, `../models/Product`, `./wishlistService`, `./cartService`, `../utils/http`, `../utils/queryFilters`

**`services/mailService.js`** (68 lines)

- What: Sends email through a provider chosen by MAIL_DRIVER (providers/mail): smtp (default) or brevo. Without any provider set up: - in development and tests the email is written to the console (and kept for tests), so nothing crashes and you can see what would have gone out; - in production sending fails with a clear message, because a silently lost email is worse. Callers that must not wait or fail (order emails, resets) run this from a job or the background; a failure there is retried. An error with permanent = true (the address does not exist) is not retried. Passwords and message bodies never go into the logs (only the recipient, masked, and subject).
- Functions: `getProvider`, `useTestOutbox`, `useProviderForTests`, `isConfigured`, `send`, `maskEmail`
- Exports: `send`, `isConfigured`, `useTestOutbox`, `useProviderForTests`, `maskEmail`
- Uses: `../config/env`, `../utils/logger`, `../utils/http`, `../providers/mail/smtp`, `../providers/mail/brevo`

**`services/marketplaceService.js`** (76 lines)

- What: Marketplace listings (E8): one feed of the store's products for Amazon, Flipkart and Myntra (their seller tools import CSV or JSON), and a sync endpoint so a marketplace order can take stock off our shelf. Nothing here calls a marketplace. Their seller accounts and API keys are needed for that step, and are set up by the store owner (see docs/MARKETPLACES.md).
- Functions: `rowsFor`, `feed`, `toCsv`, `authorised`, `syncStock`, `cell`, `rupees`
- Exports: `feed`, `rowsFor`, `toCsv`, `authorised`, `syncStock`, `COLUMNS`, `cell`
- Uses: `../config/env`, `../models/Product`, `./inventoryService`, `../utils/queryFilters`, `../utils/emailLayout`, `../utils/images`, `../utils/http`

**`services/messageService.js`** (113 lines)

- What: WhatsApp order updates (E1) and one-time codes by SMS or WhatsApp (E2). Like email: without a provider set up, development and tests write the message to the console (and to a test outbox), production skips WhatsApp updates quietly (email still goes) and refuses to send codes. Each update is sent once, whatever retries happen: the key is recorded in EmailLog ("wa:order:..."). WhatsApp updates go only to customers who switched them on (My Account > Notifications), to the phone on the order's delivery address.
- Functions: `useTestOutbox`, `useProvidersForTests`, `toIndianMobile`, `deliverWhatsApp`, `sendOtp`, `sendOrderUpdate`, `supportLink`, `getWhatsApp`, `getSms`, `masked`, `canMessage`, `canSendCodes`
- Exports: `toIndianMobile`, `sendOtp`, `sendOrderUpdate`, `supportLink`, `canMessage`, `canSendCodes`, `useTestOutbox`, `useProvidersForTests`, `TEMPLATES`
- Uses: `../config/env`, `../utils/logger`, `../models/Order`, `../models/User`, `../models/EmailLog`, `../providers/messaging/whatsapp`, `../providers/messaging/sms`, `../utils/money`

**`services/migrationService.js`** (63 lines)

- What: Upgrades data saved by older versions of Nexthlon. Runs at every start; each step only touches documents that still need it, so running it again changes nothing.
- Functions: `runMigrations`, `migrateListedFlag`, `migrateToPaise`, `allowSeveralReviews`
- Exports: `runMigrations`, `migrateListedFlag`, `migrateToPaise`
- Uses: `../models/Product`, `../models/Cart`, `../models/RefreshToken`, `../models/Review`, `./categoryService`, `./referralService`, `../utils/pricing`

**`services/orderMailService.js`** (291 lines)

- What: The emails about an order: confirmed, shipped (with tracking), out for delivery, delivered, cancelled, refunded, and the return request and its answer. Called by the listeners in events/listeners/orderEmails.js, which run as background jobs, so each function loads the order as it is NOW and may be retried safely. Exactly once: every email has a key ("order:NX-2026-000123:status:shipped") recorded in EmailLog when it is sent. A retried job, a duplicate event or a restart in the middle finds the key and sends nothing more. Who gets what: the receipt, cancellations, refunds and return decisions always go (they are about money and
- Functions: `itemsSection`, `moneySection`, `addressSection`, `trackingLines`, `sendOnce`, `sendOrderEmail`, `firstName`, `orderUrl`
- Exports: `sendOrderEmail`, `sendOnce`, `BUILDERS`, `PROGRESS_KINDS`
- Uses: `../models/Order`, `../models/User`, `../models/EmailLog`, `./mailService`, `./deliveryService`, `../utils/emailLayout`, `../utils/images`, `../utils/money`, `../config/store`, `../utils/logger`

**`services/orderService.js`** (207 lines)

- What: no header comment; read the file.
- Functions: `setRefundHandler`, `readListFilters`, `listOrders`, `getOwnedOrder`, `settleStatus`, `cancelItems`, `cancelOrder`, `cancelItem`, `requestReturn`, `advanceStatus`, `timelineFor`
- Exports: `PAGE_SIZE`, `LIST_FILTERS`, `PERIODS`, `setRefundHandler`, `readListFilters`, `listOrders`, `getOwnedOrder`, `cancelItems`, `cancelOrder`, `cancelItem`, `requestReturn`, `advanceStatus`, `timelineFor`
- Uses: `../events`, `../models/Order`, `../utils/http`, `./productService`, `../config/store`, `../utils/orderRules`, `./referralService`, `../utils/logger`, `./settlementService`

**`services/passwordResetService.js`** (68 lines)

- What: "I forgot my password": a one-time link by email, then a new password. What it protects against: - Guessing which emails have accounts. The request answers the same way (and as fast) for any address: the lookup and the email happen in the background (utils/background.js). - A flood of emails to one inbox: at most MAX_PER_HOUR reset emails per account per hour. - A link that is read twice, is old, or was replaced by a newer one: it works once, for 30 minutes, and only the newest link works (services/authTokenService.js). - A thief who got in and changes nothing but wants to stay: a reset signs out every device
- Functions: `requestReset`, `resetPassword`, `isLinkUsable`
- Exports: `requestReset`, `resetPassword`, `isLinkUsable`, `MAX_PER_HOUR`, `BAD_LINK`
- Uses: `../models/User`, `./authTokenService`, `./authMailService`, `./authService`, `./refreshTokenService`, `./auditService`, `../utils/http`, `../utils/background`, `../utils/exclusive`

**`services/paymentService.js`** (235 lines)

- What: Online payment with Razorpay (test mode). 1. createPaymentOrder: our order is saved as "pending" from the server's own prices, then a Razorpay order is created for the same amount (paise) with our order id as the receipt. 2. The browser pays in Razorpay Checkout and sends back the ids and signature. 3. verifyPayment checks the signature, then marks the order paid, takes the stock and clears the cart. The webhook does the same if the browser never comes back. Marking paid is IDEMPOTENT: an atomic "only if not paid yet" update and an atomic "only if stock not taken yet" claim mean a second call (or the webhook) changes nothing.
- Functions: `checkoutPayload`, `attachRazorpayOrder`, `discardUnpaidOrder`, `createPaymentOrder`, `retryPayment`, `markPaid`, `getStatus`, `verifyPayment`, `markFailed`, `handleWebhook`
- Exports: `createPaymentOrder`, `retryPayment`, `markPaid`, `getStatus`, `verifyPayment`, `markFailed`, `handleWebhook`, `isEnabled`
- Uses: `../models/Order`, `../events`, `../models/Cart`, `./buyNowService`, `../models/Product`, `../config/env`, `./checkoutService`, `./stockService`, `./orderService`, `./couponService`, `./refundService`, `./gstService`, `./walletService`, `./razorpayService`, `../utils/http`, `../utils/transaction`, `../utils/queryFilters`, `../utils/exclusive`, `./settlementService`

**`services/pincodeService.js`** (91 lines)

- What: Fills the city and state for a PIN code, so a shopper types six digits instead of two fields. India Post's public PIN code directory gives the district (city) and state. If it is slow or down, the state still comes from the PIN code itself: its first digits are the postal circle. The answer is only a suggestion: the shopper can change both fields, and addresses are validated as usual.
- Functions: `stateFromPrefix`, `knownState`, `tidy`, `fromIndiaPost`, `lookupPincode`
- Exports: `lookupPincode`, `stateFromPrefix`, `knownState`
- Uses: `../config/catalog`, `../utils/logger`

**`services/privacyService.js`** (72 lines)

- What: "Download my data" (D2): everything the store keeps about one customer, as one JSON file. Secrets never leave: no password hash, token versions, two-step secrets or refresh tokens. Money is in paise, as stored, and the file says so.
- Functions: `clean`, `exportData`
- Exports: `exportData`, `clean`
- Uses: `../models/User`, `../models/Address`, `../models/Order`, `../models/Review`, `../models/Wishlist`, `../models/ShoppingList`, `../models/SupportTicket`, `../models/Wallet`, `../models/WalletTransaction`, `../models/LoginActivity`, `../models/NewsletterSubscriber`, `../models/StockAlert`, `./auditService`, `../utils/http`

**`services/productService.js`** (383 lines)

- What: no header comment; read the file.
- Functions: `escapeRegex`, `toPositiveInt`, `toRupees`, `readList`, `readFilters`, `sizeOrder`, `searchVocabulary`, `searchClause`, `toProductQuery`, `listProducts`, `optionFacet`, `getFacets`, `getCategorySummaries`, `getProduct`, `getRelatedProducts`, `getSimilarProducts`, `getHomeSections`, `getProductsByIds`, `offerLabel`, `toPublicProduct`
- Exports: `PAGE_SIZE`, `SORTS`, `DISCOUNT_STEPS`, `RATING_STEPS`, `escapeRegex`, `toPositiveInt`, `readFilters`, `sizeOrder`, `toProductQuery`, `toProductQuery`, `listProducts`, `getFacets`, `getCategorySummaries`, `searchVocabulary`, `getProduct`, `getRelatedProducts`, `getSimilarProducts`, `getHomeSections`, `getProductsByIds`, `offerLabel`, `toPublicProduct`
- Uses: `../models/Product`, `./categoryService`, `../utils/http`, `../utils/pricing`, `../utils/queryFilters`, `../utils/memo`, `../utils/fuzzy`, `../utils/synonyms`

**`services/profileService.js`** (104 lines)

- What: no header comment; read the file.
- Functions: `updateProfile`, `changePassword`, `listAddresses`, `findOwnedAddress`, `clearDefault`, `addAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`
- Exports: `updateProfile`, `changePassword`, `listAddresses`, `addAddress`, `updateAddress`, `setDefaultAddress`, `deleteAddress`
- Uses: `../models/User`, `../models/Address`, `./authService`, `./refreshTokenService`, `../config/catalog`, `../utils/http`

**`services/pushService.js`** (92 lines)

- What: Push notifications (E5): order updates and back-in-stock alerts on the phone or computer, even with the store closed. Needs VAPID keys (npm run push:keys prints a pair); without them the store simply offers no notifications. Only same-site links are ever opened from a notification (public/sw.js).
- Functions: `useTestOutbox`, `useSenderForTests`, `getSender`, `subscribe`, `unsubscribe`, `sendToUser`, `sendOrderPush`, `enabled`
- Exports: `enabled`, `subscribe`, `unsubscribe`, `sendToUser`, `sendOrderPush`, `useTestOutbox`, `useSenderForTests`, `ORDER_PUSH`
- Uses: `../config/env`, `../utils/logger`, `../models/PushSubscription`, `../models/User`, `../utils/http`, `../models/Order`

**`services/questionService.js`** (110 lines)

- What: Product questions and answers (E3). list(productId, page) answered questions first, then the newest; hidden ones never ask(user, productId, body) signed-in customers, at most 5 unanswered questions per product answer(user, questionId, body) customers who received the product, or the store's team (isStaff) adminList / hide the admin's "Questions" page The asker is emailed when an answer arrives (a background job, events/listeners/questionEmails.js).
- Functions: `publicQuestion`, `list`, `ask`, `answer`, `adminList`, `setHidden`, `readBody`
- Exports: `PAGE_SIZE`, `list`, `ask`, `answer`, `adminList`, `setHidden`, `publicQuestion`
- Uses: `../models/Question`, `../models/Product`, `../events`, `./reviewService`, `../utils/queryFilters`, `../utils/http`

**`services/razorpayService.js`** (76 lines)

- What: The only place that talks to Razorpay. The key secret and webhook secret stay on the server; the browser only ever gets the public key id. Signatures are checked with HMAC-SHA256 and compared with crypto.timingSafeEqual, so the comparison time gives nothing away.
- Functions: `isEnabled`, `getClient`, `setClient`, `hmac`, `safeEqual`, `verifyPaymentSignature`, `verifyWebhookSignature`, `createOrder`, `refundPayment`, `findRefund`, `logEvent`
- Exports: `isEnabled`, `setClient`, `verifyPaymentSignature`, `verifyWebhookSignature`, `createOrder`, `refundPayment`, `findRefund`, `logEvent`, `hmac`
- Uses: `../config/env`, `../utils/http`

**`services/recommendationService.js`** (59 lines)

- What: "Frequently bought together": the products that most often share an order with this one, from the last 180 days of real orders (cancelled and returned orders left out). Only listed, in-stock products are suggested. The answer is the same for every visitor, so it is kept for 10 minutes (utils/memo.js; any product change clears it). With no orders to learn from, the list is empty and the page simply shows its usual "More from this sport" row.
- Functions: `boughtTogether`, `forCart`
- Exports: `boughtTogether`, `forCart`, `WINDOW_DAYS`
- Uses: `../models/Order`, `../models/Product`, `../utils/memo`, `../utils/queryFilters`

**`services/referralService.js`** (109 lines)

- What: Referrals. Every customer has a code. A NEW customer who signs up with someone's code gets wallet credit, and so does the friend who invited them, once the new customer's first order is delivered. The amount is a store setting the admin can change. It happens once per new customer: both credits carry a unique key.
- Functions: `makeCode`, `normaliseCode`, `ensureCode`, `findReferrer`, `rewardSignup`, `rewardOnDelivery`, `getReferral`, `migrateCodes`
- Exports: `CODE`, `makeCode`, `normaliseCode`, `ensureCode`, `findReferrer`, `rewardSignup`, `rewardOnDelivery`, `getReferral`, `migrateCodes`
- Uses: `../models/User`, `./walletService`, `./settingsService`, `../utils/http`, `../utils/logger`

**`services/refreshTokenService.js`** (247 lines)

- What: Refresh tokens: the long-lived half of the login. A refresh token is a random string, not a JWT. It carries no information at all, so there is nothing to read inside it; its only job is to point at one row in the refreshtokens collection. That row is what makes it revocable, which a JWT can never be. Rotation: every renewal issues a NEW token and revokes the old one. So a token is valid exactly once. If an already-used token turns up again, two copies exist, which means one was stolen — so the whole family (every token from that sign-in) is revoked at once. One exception, the grace window: two tabs (or a phone waking up) often renew at the same moment,
- Functions: `newToken`, `hashToken`, `lifetimeMs`, `deviceFrom`, `issue`, `revokeRecord`, `revokeToken`, `revokeFamily`, `revokeAllForUser`, `concurrentRenewalUser`, `rotate`, `listSessions`, `revokeSession`
- Exports: `REUSE_GRACE_MS`, `newToken`, `hashToken`, `lifetimeMs`, `deviceFrom`, `issue`, `rotate`, `revokeToken`, `revokeFamily`, `revokeAllForUser`, `listSessions`, `revokeSession`
- Uses: `../models/RefreshToken`, `../config/env`, `./auditService`, `../utils/logger`, `../utils/device`

**`services/refundService.js`** (107 lines)

- What: Persist refund intent before moving money. Wallet receipts make retries safe; uncertain gateway responses are reconciled instead of falling back to another payment.
- Functions: `setWalletCredit`, `paymentStatusAfter`, `execute`, `issueRefund`, `resume`, `pendingError`
- Exports: `setWalletCredit`, `issueRefund`, `paymentStatusAfter`, `resume`
- Uses: `../models/Order`, `../events`, `./razorpayService`, `./walletService`, `../utils/orderRules`, `../utils/http`, `../utils/exclusive`

**`services/reviewService.js`** (174 lines)

- What: no header comment; read the file.
- Functions: `hasReceived`, `reviewStatus`, `publicReview`, `shortName`, `ratingBreakdown`, `listReviews`, `featuredReview`, `refreshProductRating`, `addReview`, `listMine`, `waitingForReview`, `findOwnedReview`, `updateMine`, `deleteMine`
- Exports: `PAGE_SIZE`, `MAX_PER_PRODUCT`, `hasReceived`, `reviewStatus`, `listReviews`, `featuredReview`, `ratingBreakdown`, `refreshProductRating`, `addReview`, `shortName`, `publicReview`, `listMine`, `waitingForReview`, `updateMine`, `deleteMine`
- Uses: `../models/Review`, `../models/Product`, `../utils/http`, `../utils/queryFilters`

**`services/searchInsightService.js`** (83 lines)

- What: What the search panel shows before anything is typed (the header search box, public/js/header.js), and the search log behind its "Trending searches". record(q, results) counts a search for today (from the results page, never from typing suggestions) trending() the most searched words of the last 7 days that found products startPanel() trending searches (once there are some), sports to jump to, popular products Trending only ever shows words the store itself uses (product names, brands, categories), so random or rude text typed by visitors can never appear there. Everything is the same for every visitor, so it is
- Functions: `normalizeTerm`, `record`, `trending`, `startPanel`
- Exports: `normalizeTerm`, `record`, `trending`, `startPanel`, `startOfDay`
- Uses: `../models/SearchLog`, `./productService`, `../utils/memo`, `../utils/logger`

**`services/settingsService.js`** (55 lines)

- What: Store settings the admin can change. Each has a default, so the store works before anything is saved.
- Functions: `get`, `getAll`, `set`, `codAllowedFor`
- Exports: `DEFAULTS`, `LIMITS`, `get`, `getAll`, `set`, `codAllowedFor`
- Uses: `../models/Setting`, `../utils/orderRules`, `../utils/http`

**`services/settlementService.js`** (42 lines)

- What: Stock, refund and notification work is written on the order with its status change. Every side effect has a stable key, so retries can finish safely.
- Functions: `setRefundHandler`, `resume`, `assertSettled`
- Exports: `resume`, `assertSettled`, `setRefundHandler`
- Uses: `../models/Order`, `./stockService`, `./refundService`, `./couponService`, `./gstService`, `../events`, `../utils/exclusive`, `../utils/http`

**`services/shippingService.js`** (226 lines)

- What: Shipping (B5): where we deliver, booking parcels, and following them to the door. checkPincode(pin) the delivery estimate (services/deliveryService.js rules), confirmed by the courier platform when Shiprocket is set up: can it deliver, and is COD there? shipOrder(orderId) one click in the admin: book with Shiprocket, take the AWB, mark as shipped handleTrackingUpdate(body) the courier's scans -> the order moves along (shipped, out for delivery, delivered), each step sending its usual email (events/listeners/orderEmails.js) markRto(orderId, stage) the parcel was refused or could not be delivered: "initiated" while it comes
- Functions: `courierCheck`, `checkPincode`, `findOrder`, `shipOrder`, `mapCourierStatus`, `webhookAuthorised`, `handleTrackingUpdate`, `markRto`, `trackingFor`, `usesShiprocket`, `parseAt`, `sentence`
- Exports: `sentence`, `checkPincode`, `shipOrder`, `handleTrackingUpdate`, `markRto`, `mapCourierStatus`, `webhookAuthorised`, `trackingFor`, `parseAt`, `usesShiprocket`, `_pinCache`
- Uses: `../config/env`, `../models/Order`, `../models/Product`, `../models/User`, `./shipping/shiprocket`, `./deliveryService`, `./orderService`, `../events`, `../utils/orderRules`, `../utils/logger`, `../utils/http`

**`services/stockAlertService.js`** (143 lines)

- What: Back-in-stock alerts (E3). A shopper asks to be emailed when a sold-out product (or one size or colour of it) is back; when stock returns, each of them gets one email. subscribe(productId, { email, variantId, user }) saves the wish (asking twice is fine) sweep() finds waiting alerts whose product is back, and queues one email job for each. Runs every 10 minutes (jobs/handlers.js) and straight after an admin restocks (kick()). notify(id) the email job: claims the alert first, so two workers never send the same email stop(id, sig) the "stop this alert" link in the email; signed, so nobody can stop someone else's
- Functions: `inStock`, `subscribe`, `sweep`, `kick`, `notify`, `stop`, `waitingFor`, `signature`, `stopUrl`
- Exports: `subscribe`, `sweep`, `kick`, `notify`, `stop`, `waitingFor`, `signature`, `stopUrl`, `inStock`, `MAX_WAITING_PER_EMAIL`
- Uses: `../config/env`, `../models/StockAlert`, `../models/Product`, `./mailService`, `../jobs/queue`, `../utils/emailLayout`, `../utils/images`, `../utils/money`, `../utils/options`, `../utils/queryFilters`, `../utils/http`, `./pushService`

**`services/stockService.js`** (98 lines)

- What: Taking stock is ATOMIC per product: "$inc stock by -qty, but only if stock >= qty" is one database operation, so two shoppers can never both buy the last item and stock never goes below 0. Several products are taken inside a MongoDB transaction when the server supports it (a replica set); on a single server, the ones already taken are put back if a later one fails.
- Functions: `takeStock`, `returnStock`, `withStock`, `receiptFor`, `moveOnce`, `takeStockOnce`, `returnStockOnce`
- Exports: `supportsTransactions`, `takeStock`, `returnStock`, `withStock`, `takeStockOnce`, `returnStockOnce`
- Uses: `../models/Product`, `../utils/http`, `../utils/transaction`, `../utils/queryFilters`

**`services/supportService.js`** (120 lines)

- What: no header comment; read the file.
- Functions: `nextTicketId`, `toTicket`, `createTicket`, `findOwnedTicket`, `listMine`, `getMine`, `replyAsCustomer`, `listAll`, `getForAdmin`, `replyAsAdmin`
- Exports: `PAGE_SIZE`, `TICKET_ID`, `toTicket`, `createTicket`, `listMine`, `getMine`, `replyAsCustomer`, `listAll`, `getForAdmin`, `replyAsAdmin`
- Uses: `../models/SupportTicket`, `../models/Order`, `./auditService`, `../utils/http`, `../config/support`, `../services/counterService`

**`services/systemService.js`** (137 lines)

- What: System status: one page that answers "is the store healthy, and what is switched on?". Everything here is read-only and safe to show. Secrets are never included: for each optional service the page says only whether it is configured, never the keys themselves.
- Functions: `duration`, `database`, `counts`, `features`, `session`, `status`
- Exports: `duration`, `database`, `counts`, `features`, `session`, `status`
- Uses: `../config/env`, `./razorpayService`, `./mailService`, `../models/Order`, `../models/Product`, `../models/User`, `../models/Cart`, `../models/Coupon`, `../models/RefreshToken`, `../package.json`

**`services/tokenService.js`** (152 lines)

- What: no header comment; read the file.
- Functions: `signToken`, `verifyToken`, `cookieOptions`, `setAuthCookie`, `clearAuthCookie`, `setRefreshCookie`, `clearRefreshCookie`, `readRefreshCookie`, `setSessionCookie`, `clearSessionCookie`, `readSessionCookie`, `startSession`, `endSession`, `kindOf`
- Exports: `COOKIE_NAME`, `ADMIN_COOKIE_NAME`, `REFRESH_PATH`, `KINDS`, `signToken`, `verifyToken`, `setAuthCookie`, `clearAuthCookie`, `setRefreshCookie`, `readRefreshCookie`, `readSessionCookie`, `startSession`, `endSession`
- Uses: `../config/env`

**`services/walletService.js`** (113 lines)

- What: The customer wallet. Money is in paise. The balance only changes here, with ONE atomic update each time: credit $inc balance by +amount debit $inc balance by -amount, only if balance >= amount (so it can never go below 0) Every change also writes a WalletTransaction with the balance right after it. Pass a session to run inside the caller's MongoDB transaction; on a single server pass the caller's undo() instead, so a failed order puts the money back.
- Functions: `assertAmount`, `getBalance`, `credit`, `debit`, `toPublicTransaction`, `getWallet`
- Exports: `PAGE_SIZE`, `getBalance`, `credit`, `debit`, `getWallet`, `toPublicTransaction`
- Uses: `../models/Wallet`, `../models/WalletTransaction`, `../utils/http`, `./productService`, `../utils/logger`

**`services/wishlistService.js`** (102 lines)

- What: no header comment; read the file.
- Functions: `toObjectId`, `toWishItem`, `getWishlist`, `productIds`, `countItems`, `addProduct`, `removeProduct`, `moveToCart`, `saveForLater`
- Exports: `MAX_ITEMS`, `toWishItem`, `getWishlist`, `productIds`, `countItems`, `addProduct`, `removeProduct`, `moveToCart`, `saveForLater`
- Uses: `../models/Wishlist`, `../models/Product`, `./cartService`, `../utils/http`, `../utils/queryFilters`, `../utils/options`

### services/shipping/

**`services/shipping/shiprocket.js`** (162 lines)

- What: Shiprocket (B5): one account books parcels with many couriers (Delhivery, Blue Dart, Ekart ...). Used only when SHIPPING_PROVIDER=shiprocket and its login and pickup location are set (config/env.js). What it does for the store: serviceability(pin) which couriers deliver to a PIN code, if Cash on Delivery works there, and how fast book(order) create the order on Shiprocket, take the AWB (tracking number), ask for a pickup, and fetch the shipping label to print Tracking updates come the other way, as a webhook (services/shippingService.js handleTrackingUpdate). The login token lasts 10 days; it is kept in memory and renewed a day early, or at once if Shiprocket
- Functions: `setTransport`, `request`, `login`, `istStamp`, `serviceability`, `parcelFor`, `book`, `settings`, `rupees`, `pad`
- Exports: `serviceability`, `book`, `parcelFor`, `setTransport`, `login`, `istStamp`
- Uses: `../../config/env`, `../../utils/logger`, `../../utils/http`

---

## models

Mongoose schemas: the shape of each MongoDB collection, its indexes and hooks.

**`models/Address.js`** (18 lines)

- What: no header comment; read the file.
- Exports: `mongoose`

**`models/AuditLog.js`** (21 lines)

- What: A permanent record of important changes: who did what, to what, from where, and when. before/after hold only the changed, non-secret fields (never passwords or tokens).
- Exports: `mongoose`

**`models/AuthToken.js`** (33 lines)

- What: One-time links sent by email: "reset your password" and "confirm your email". The link carries a random token that is shown once, in the email. Only its SHA-256 hash is stored, so someone reading this collection cannot use a link. A token works once (usedAt), only until expiresAt, and issuing a new one for the same person and purpose replaces the older one (supersededAt), so only the newest email's link works. Rows stay for a while after they stop working (deleteAt, then MongoDB removes them by itself), so "how many reset emails did this person ask for in the last hour" can be answered.
- Exports: `mongoose`

**`models/Bundle.js`** (18 lines)

- What: "Complete the kit" (E6): a set of products sold together with a percent off the set. The shopper adds all of them to the cart in one click; prices are still worked out on the server, so the bundle only says WHICH products go together and how much the set saves.
- Exports: `mongoose`

**`models/BuyNow.js`** (21 lines)

- What: "Buy now": one product the customer wants to check out on its own, kept apart from the cart (Amazon-style), so buying it never changes what is in the cart. One per customer; a new Buy now replaces it. MongoDB deletes it by itself once expiresAt has passed. Prices are never stored here; they always come live from the product.
- Exports: `mongoose`

**`models/Cart.js`** (26 lines)

- What: One cart per customer: just products and quantities. Prices are never stored here; they always come live from the product.
- Exports: `mongoose`

**`models/Category.js`** (24 lines)

- What: A sport or product group. Unlisted categories, and every product in them, are hidden from shoppers (utils/queryFilters.js LISTED_CATEGORY). offerPercent is the category offer; a product gets the higher of its own offer and this one.
- Exports: `mongoose`

**`models/ContactMessage.js`** (18 lines)

- What: A message sent from the contact page. "user" is set when a signed-in shopper sends it.
- Exports: `mongoose`
- Uses: `../config/store`

**`models/Counter.js`** (12 lines)

- What: Named running numbers, e.g. { _id: "order-2026", seq: 123 } for order NX-2026-000123. Read and increment them through services/counterService.js.
- Exports: `mongoose`

**`models/Coupon.js`** (34 lines)

- What: A discount code. Amounts are in paise; "value" is paise for a flat coupon and a whole percent for a percent coupon. 0 for maxDiscount or usageLimit means "no limit".
- Exports: `mongoose`

**`models/CouponRedemption.js`** (16 lines)

- What: One row each time a coupon is used on an order. Counting a customer's rows enforces the per-customer limit; the row is removed again if that order is cancelled or never paid.
- Exports: `mongoose`

**`models/EmailLog.js`** (22 lines)

- What: Which emails have been sent, so a retried job (or a restart in the middle of one) never sends the same email twice. The key says what the email is about: "order:NX-2026-000123:status:shipped".
- Exports: `mongoose`

**`models/GuestCart.js`** (24 lines)

- What: A cart for someone who has not signed in yet (Amazon-style: browse, add, and only sign in at checkout). The browser holds a random token in an httpOnly cookie (middleware/guestCart.js); only its SHA-256 hash is stored here, so a copy of the database cannot be used to take over anyone's cart. At sign-in or sign-up the items move into the account's cart (cartService.mergeGuestCart) and this document is deleted. Prices are never stored: they always come live from the product.
- Exports: `mongoose`

**`models/Guide.js`** (19 lines)

- What: A sport guide or story for the content hub (E7). Written by the team; only published guides are shown.
- Exports: `mongoose`

**`models/Job.js`** (34 lines)

- What: One unit of background work: "send this email", "remind this cart". Kept in MongoDB (no extra service to run), so a job survives a restart and a deploy. See jobs/queue.js and jobs/worker.js. queued waiting for runAt running a worker holds it until lockedUntil; if that worker dies, the lease runs out and another takes over done finished (kept 7 days, then MongoDB removes it) failed gave up after maxAttempts, or failed in a way that cannot get better (kept 30 days for a look)
- Exports: `mongoose`

**`models/LoginActivity.js`** (15 lines)

- What: One row per successful sign-in: when, which browser, and a masked IP address. Only the last 10 are kept per customer (loginActivityService prunes older rows).
- Exports: `mongoose`

**`models/NewsletterSubscriber.js`** (9 lines)

- What: One row per email address that signed up from the footer newsletter box.
- Exports: `mongoose`

**`models/Order.js`** (224 lines)

- What: An order keeps a SNAPSHOT of every item (name, image, price, M.R.P.) and of the address at the moment it was placed, so later product or address changes never rewrite it. Money is in paise.
- Exports: `mongoose`
- Uses: `../utils/orderRules`

**`models/PhoneCode.js`** (20 lines)

- What: A one-time code sent to a phone (E2: confirming a Cash on Delivery order). Only a hash of the code is kept, it lasts 10 minutes (TTL index), and 5 wrong tries end it.
- Exports: `mongoose`

**`models/Product.js`** (123 lines)

- What: One product, one price. It may have options (sizes, colours), each with its own SKU and stock; then the product's stock is the sum of its options, kept in step on every save and every stock change (services/stockService.js), so lists, filters and reports keep reading one number. Without options a product is one item with one stock count, as before. All money is in paise. "price" is what the shopper pays: basePrice after the better of the product offer and the category offer. It is worked out on save (the hook below), never taken from a form. utils/pricing.js PRICE_PIPELINE does the same sums as a database update, for many at once.
- Functions: `forgetCatalog`
- Exports: `mongoose`
- Uses: `../utils/pricing`, `../utils/memo`

**`models/PushSubscription.js`** (17 lines)

- What: One browser or phone that agreed to notifications (E5). The endpoint is the address the browser's push service gave us; it stops working when the person turns notifications off, and is then removed.
- Exports: `mongoose`

**`models/Question.js`** (31 lines)

- What: Product questions and answers (E3). Any signed-in customer may ask; customers who received the product and the store's team may answer. Hidden ones (by an admin) stay for the record but are never shown.
- Exports: `mongoose`

**`models/RefreshToken.js`** (39 lines)

- What: One row per refresh token, which means one row per signed-in device. The raw token is sent to the browser once and NEVER stored here: we keep only its SHA-256 hash. So even someone reading this collection cannot sign in as anybody. familyId groups every token that came from one sign-in. Each refresh replaces the token with a new one in the same family (rotation). If an already-used token comes back, the whole family is revoked, because the only way that happens is that someone copied the token (stolen-token detection). Rows are kept after being revoked so that reuse can still be spotted; MongoDB
- Exports: `mongoose`

**`models/Review.js`** (32 lines)

- What: Up to 5 reviews per customer per product. Any signed-in customer can write them; reviews from customers who received the product are marked verified (set in services/reviewService.js). The product keeps the average, so lists can sort by it.
- Exports: `mongoose`

**`models/SearchLog.js`** (19 lines)

- What: What shoppers search for, counted per day: the words (cleaned up), how many times, and how many products the last search found. Never who searched (no user, no IP, no cookie). It powers the "Trending searches" in the search panel (searchInsightService), and shows which searches find nothing. Old days are removed by MongoDB itself after 60 days.
- Exports: `mongoose`

**`models/Setting.js`** (10 lines)

- What: Store settings the admin can change, one document per key (for example "referralReward").
- Exports: `mongoose`

**`models/ShoppingList.js`** (18 lines)

- What: A customer's own named list ("Gym kit", "Running"). The default wishlist stays in Wishlist. A list can be shared read-only through a random id; the public page never shows who owns it.
- Exports: `mongoose`

**`models/StockAlert.js`** (21 lines)

- What: "Email me when it's back" (E3): one row per email, product and option (null = any of the product). The row stays after the email goes out (notifiedAt), so the same person is not emailed twice for one restock; asking again after that starts a new wait.
- Exports: `mongoose`

**`models/SupportTicket.js`** (28 lines)

- What: no header comment; read the file.
- Exports: `mongoose`
- Uses: `../config/support`

**`models/User.js`** (44 lines)

- What: no header comment; read the file.
- Exports: `mongoose`

**`models/Wallet.js`** (15 lines)

- What: One wallet per customer. The balance is in paise and only ever changes through services/walletService.js, which writes a WalletTransaction for every change.
- Exports: `mongoose`

**`models/WalletTransaction.js`** (25 lines)

- What: no header comment; read the file.
- Exports: `mongoose`

**`models/Wishlist.js`** (10 lines)

- What: One wishlist per customer: the products they saved, newest first.
- Exports: `mongoose`

---

## middleware

Functions `(req, res, next)` that run before routes: login (`auth.js`), security, rate limits, caching, errors.

**`middleware/auth.js`** (133 lines)

- What: Which session a request belongs to: the admin console (its pages under ADMIN_PATH and the /api/admin APIs) or the store (everything else). Each reads only its own cookie.
- Functions: `scopeOf`, `readToken`, `attachUser`, `requireAuth`, `requireRole`, `loginReason`, `redirectToLogin`, `customerPage`, `adminPage`, `guestOnly`, `adminGuestOnly`
- Exports: `scopeOf`, `attachUser`, `requireAuth`, `requireRole`, `customerPage`, `adminPage`, `guestOnly`, `adminGuestOnly`
- Uses: `../models/User`, `../config/env`, `../services/tokenService`, `../utils/http`, `../utils/publicUser`

**`middleware/cartCount.js`** (27 lines)

- What: Puts the number of items in the cart and wishlist on every page, for the header badges. Customers: their account's cart and wishlist. Guests: filled in after the page loads (see below). API calls skip this; they return the full cart or wishlist whenever it changes.
- Functions: `cartCount`
- Exports: `cartCount`
- Uses: `../services/cartService`, `../services/wishlistService`

**`middleware/errorHandler.js`** (68 lines)

- What: no header comment; read the file.
- Functions: `isApiRequest`, `notFound`, `errorHandler`
- Exports: `notFound`, `errorHandler`
- Uses: `../utils/http`, `../utils/logger`, `../utils/monitor`

**`middleware/guestCart.js`** (62 lines)

- What: The guest cart cookie: a random token in an httpOnly cookie. The server keeps only its SHA-256 hash (models/GuestCart.js). It is made the first time a guest adds something, never just for browsing.
- Functions: `readGuestCart`, `ensureGuestCart`, `clearGuestCart`, `cartOwner`, `hashOf`, `cookieOptions`
- Exports: `COOKIE`, `HINT_COOKIE`, `readGuestCart`, `ensureGuestCart`, `clearGuestCart`, `cartOwner`, `hashOf`
- Uses: `../config/env`, `../utils/http`

**`middleware/noCache.js`** (13 lines)

- What: Pages and API replies can show signed-in data, so the browser must never keep a copy. Without this, pressing Back after signing out shows the cached dashboard or profile.
- Functions: `noCache`
- Exports: `noCache`

**`middleware/originCheck.js`** (39 lines)

- What: no header comment; read the file.
- Functions: `originCheck`
- Exports: `originCheck`
- Uses: `../services/tokenService`, `../utils/http`

**`middleware/publicCache.js`** (36 lines)

- What: Lets a CDN (Cloudflare) keep a page for signed-out visitors for a short time, so a rush of visitors is served from the CDN instead of this server. Browsers still ask every time (max-age=0); only shared caches keep it (s-maxage), and may serve a slightly old copy while fetching a new one. Only for requests that carry no sign-in at all: no session cookie of either kind and no Bearer token. Every other reply keeps "private, no-store" (middleware/noCache.js), so a page with someone's name on it can never be stored. A signed-out page is the same for everyone (the guest cart badge is filled in by store.js after the page loads), so a stored copy is right for every other signed-out visitor.
- Functions: `isSignedOut`, `publicCache`
- Exports: `publicCache`, `isSignedOut`, `SIGNED_IN_COOKIES`
- Uses: `../config/env`, `../services/tokenService`

**`middleware/rateLimit.js`** (180 lines)

- What: Every limiter has a fixed name. With Redis (REDIS_URL) its counts are shared by every copy of the store (middleware/rateLimitStore.js), so a visitor cannot get more tries by landing on another server. Without Redis each copy counts on its own, as before.
- Functions: `limiter`, `accountKey`
- Exports: `stockAlertLimiter`, `accountLoginLimiter`, `searchLimiter`, `orderLimiter`, `cartLimiter`, `pincodeLimiter`, `forgotLimiter`, `linkLimiter`, `authLimiter`, `adminLoginLimiter`, `refreshLimiter`, `formLimiter`, `reviewLimiter`, `sensitiveLimiter`, `adminWriteLimiter`, `adminMoneyLimiter`
- Uses: `../providers/redis`, `./rateLimitStore`

**`middleware/rateLimitStore.js`** (81 lines)

- What: Where a rate limiter keeps its counts. With Redis (REDIS_URL) the counts are shared by every copy of the store, so a visitor cannot get more tries by landing on another server. Without Redis, or while Redis cannot be reached, the counts stay in this process (the library's own memory store), so the limit still holds per copy and nothing breaks.
- Exports: `SharedStore`, `HIT`
- Uses: `../providers/redis`

**`middleware/requestId.js`** (36 lines)

- What: Gives every request an ID, so one customer's problem can be followed through the logs, the error alerts and the "reference" shown on the error page. - A valid X-Request-Id sent by the proxy (or a monitoring tool) is kept, so the ID is the same in the load balancer's logs and ours. Anything else is replaced by a new random one. - The ID goes back in the X-Request-Id response header. - When the request finishes, one access-log line is written (see below).
- Functions: `requestId`
- Exports: `requestId`, `VALID_ID`
- Uses: `../utils/requestContext`, `../utils/logger`

**`middleware/seo.js`** (26 lines)

- What: Per-request defaults for search engines and link previews (D1). Pages can override any of them: canonical the one address Google should index for this page (no query string by default) noindex keep the page out of search results (private pages, searches, errors) ogImage, ogType, ogTitle, ogDescription the link preview on WhatsApp, Instagram, X... jsonLd a list of schema.org objects (utils/seo.js)
- Functions: `seoDefaults`
- Exports: `seoDefaults`
- Uses: `../utils/seo`

**`middleware/shell.js`** (16 lines)

- What: My Account and the admin console are calm, fast work areas: - the store's motion layer (motion.css, motion.js, the footer wave and any page transitions) is not loaded on them at all (res.locals.motion = false); - with the "X-Partial: 1" header (sent by section-nav.js) only the section's content is rendered, without the header, sidebar and footer, so sections switch without a reload. Direct links and refresh send no header and get the full page.
- Functions: `workArea`
- Exports: `accountShell`, `adminShell`

**`middleware/upload.js`** (72 lines)

- What: Files are held in memory first, so their real type can be checked before anything touches the disk.
- Functions: `productImages`, `returnPhotos`, `reviewPhotos`
- Exports: `productImages`, `returnPhotos`, `reviewPhotos`
- Uses: `../utils/http`, `../services/imageService`

**`middleware/viewLocals.js`** (64 lines)

- What: no header comment; read the file.
- Functions: `viewLocals`, `navCategories`
- Exports: `viewLocals`, `navCategories`
- Uses: `../config/store`, `../services/categoryService`, `../utils/money`, `../utils/images`, `../config/env`, `../utils/assets`

---

## utils

Small pure helpers used by every layer: money, pricing maths, validation, HTTP errors, images.

**`utils/analytics.js`** (56 lines)

- What: Visitor analytics (D2). Optional, and off unless the store owner sets it up: ANALYTICS_PROVIDER=ga4 ANALYTICS_ID=G-XXXXXXXXXX ANALYTICS_PROVIDER=plausible ANALYTICS_ID=nexthlon.in (PLAUSIBLE_HOST for a self-hosted copy) Even when set up, nothing is loaded until the visitor says yes in the cookie banner (public/js/consent.js). The Content Security Policy only lets in the hosts the chosen provider needs.
- Functions: `readAnalytics`, `analyticsProblems`, `cspHosts`, `readMetaPixel`
- Exports: `readAnalytics`, `analyticsProblems`, `cspHosts`, `PROVIDERS`

**`utils/analyticsEvents.js`** (52 lines)

- What: Shopping events for analytics (D2), in GA4's ecommerce shape (Plausible takes the flat parts). Pages pass them as `trackEvents`; public/js/consent.js sends them only after the shopper agreed. No names, emails, addresses or phone numbers ever go in here: products and amounts only. Amounts leave as rupees (GA4 wants major units); the store keeps paise.
- Functions: `viewItem`, `beginCheckout`, `purchase`, `rupees`, `item`
- Exports: `viewItem`, `beginCheckout`, `purchase`, `rupees`

**`utils/assets.js`** (92 lines)

- What: Versioned URLs for the site's own CSS and JS: "/css/style.css" becomes "/css/style.css?v=3f9a1c02be". The version is a short hash of the file's contents, so it only changes when the file does. Browsers can then keep these files for a year (app.js marks them immutable) and still get every update the moment it ships, because the page asks for a new URL.
- Functions: `assetUrl`, `minifyCss`, `readBundle`, `styleBundleUrl`, `serveStyleBundle`
- Exports: `assetUrl`, `styleBundleUrl`, `serveStyleBundle`

**`utils/background.js`** (26 lines)

- What: Runs work after the reply has gone out, for things the visitor should not wait for or learn anything from (sending an email). A failure is logged, never thrown into the request. It also keeps the answer to "do we reply faster when the account does not exist?" the same for both: the forgot-password request does its lookups and email in here, so the reply takes the same time whether or not the address has an account.
- Functions: `background`, `idle`
- Exports: `background`, `idle`
- Uses: `./logger`

**`utils/csv.js`** (16 lines)

- What: CSV without a library. Every cell is quoted, and text that a spreadsheet would treat as a formula (starting with =, +, -, @, a tab or a carriage return) gets a leading apostrophe, so an exported customer name like "=HYPERLINK(...)" can never run in Excel or Sheets.
- Functions: `cell`, `row`
- Exports: `cell`, `row`

**`utils/device.js`** (21 lines)

- What: A short, readable device name from a User-Agent header. Used by the sign-in history and by the "Logged-in devices" list, so both describe a device the same way. Nothing else from the header is kept: we store "Chrome on Windows", never the full string.
- Functions: `browserName`
- Exports: `browserName`

**`utils/emailLayout.js`** (136 lines)

- What: The look of every email Nexthlon sends: a dark brand bar, one clear message, optional blocks (items, facts, a highlighted note), one big button, and the link printed underneath for mail apps that hide buttons. Table layout and inline styles, because email apps ignore stylesheets. Returns { html, text }, so each email also has a plain-text version. renderEmail({ preheader, heading, paragraphs: ["...", "..."], sections: [ { type: "items", items: [{ name, detail, image, price }] }, { type: "facts", title, rows: [["Subtotal", "₹1,499"], ["Total", "₹1,499", { strong: true }]] }, { type: "text", title: "Delivering to", lines: ["Asha Nair", "12 MG Road", ...] },
- Functions: `renderEmail`, `siteUrlFor`, `siteUrl`, `absoluteUrl`, `escapeHtml`, `heading3`
- Exports: `renderEmail`, `escapeHtml`, `siteUrlFor`, `siteUrl`, `absoluteUrl`
- Uses: `../config/env`, `../config/store`

**`utils/excel.js`** (40 lines)

- What: Excel (.xlsx) exports with exceljs, streamed to the response. columns: [{ header, key, width, type: "money" | "date" | "number" | "text" }] Money arrives in paise and is written as rupees with a ₹ number format. Text that a spreadsheet would treat as a formula gets a leading apostrophe (as in the CSV).
- Functions: `sendWorkbook`
- Exports: `sendWorkbook`

**`utils/exclusive.js`** (17 lines)

- What: Runs jobs that share a key one after another, so "count what was sent, then send" cannot be done by several requests at once (which would each see the same count and all send). Within one copy of the app this is exact; with several copies behind a load balancer the per-address rate limits and the per-account caps together still keep an inbox from being flooded, only a few more could slip through.
- Functions: `runExclusive`
- Exports: `runExclusive`

**`utils/fuzzy.js`** (73 lines)

- What: Spelling help for search: "shoees" finds shoes, "raket" finds rackets, "addidas" finds Adidas. Plain functions with no database, so they are easy to test. productService gives them the store's own words (product names, brands, categories), so a correction is always a word the store really uses.
- Functions: `editDistance`, `vocabularyFrom`, `correctQuery`, `allowedFor`
- Exports: `editDistance`, `correctQuery`, `vocabularyFrom`

**`utils/gst.js`** (172 lines)

- What: GST (India) for invoices: rates, the split into CGST + SGST or IGST, and the invoice wording. Pure functions, no database, so every rule here is unit-tested (tests/gst.test.js). Money is in paise. How it works: - Store prices INCLUDE GST. For each line, the taxable value is the price without tax: taxable = amount × 100 / (100 + rate), tax = amount − taxable. - A coupon lowers what was paid, so it is shared out across the lines (by their value) BEFORE the tax is worked out. The wallet is a way of paying, not a discount, so it changes nothing here. - Delivery is taxed at the highest rate among the items in the order.
- Functions: `suggestTax`, `taxOf`, `rateFor`, `splitInclusive`, `shareOut`, `splitTax`, `orderTax`, `financialYear`, `belowHundred`, `belowThousand`, `wholeInWords`, `amountInWords`
- Exports: `STATE_CODES`, `GST_RATES`, `PIECE_LIMIT`, `suggestTax`, `taxOf`, `rateFor`, `splitInclusive`, `shareOut`, `splitTax`, `orderTax`, `financialYear`, `amountInWords`

**`utils/http.js`** (24 lines)

- What: An error that carries an HTTP status code, optional messages for each form field, and an optional short reason code ("cart_limit") the browser can act on without reading the message text.
- Functions: `safeNextPath`, `asyncHandler`
- Exports: `HttpError`, `asyncHandler`, `safeNextPath`

**`utils/images.js`** (68 lines)

- What: Responsive product photos. Two kinds of photo can show up in the shop: Unsplash (the sample products) serves any width from the same address through its "w" setting. Our own uploads. Each upload is saved as a "full" copy plus smaller WebP copies next to it (services/imageService.js): .../products/<id>-full.webp up to 2000px: the product page zoom and full-screen viewer .../products/<id>-1600.webp large screens, high-density phones .../products/<id>-800.webp product page, home sections .../products/<id>-400.webp product cards .../products/<id>-200.webp thumbnails The stored address is the "-full.webp" one, and every other size is worked out from it by
- Functions: `variantUrl`, `unsplashWidth`, `srcsetFor`, `sizedUrl`, `gallerySource`
- Exports: `srcsetFor`, `sizedUrl`, `gallerySource`, `variantUrl`, `VARIANT_WIDTHS`, `OWN_CARD_WIDTHS`, `CARD_WIDTHS`, `CARD_SIZES`, `OWN_FULL`

**`utils/lifecycle.js`** (11 lines)

- What: Whether the server has been asked to stop (a deploy or restart sends SIGTERM). While it is true, /readyz answers 503, so the load balancer sends new visitors to another copy and the requests already in progress can finish (see server.js).
- Exports: `isShuttingDown`, `// The argument is only for tests`, `which switch it back off.
markShuttingDown`

**`utils/logger.js`** (57 lines)

- What: A small logger with levels. Set LOG_LEVEL to error, warn, info or debug (default info); tests are silent. Detail keys that could hold secrets or card data are never written. Every line carries the request's ID (req=...) while a request is being handled, so one customer's problem can be followed through the logs. LOG_FORMAT=json writes one JSON object per line, which hosting platforms and log tools (Datadog, Better Stack, CloudWatch) can search by field; the default is plain text, which is easier to read in a terminal.
- Functions: `currentLevel`, `useJson`, `value`, `entries`, `clean`, `write`
- Exports: `error`, `details) => write("error"`, `event`, `details)`, `warn`, `details) => write("warn"`, `event`, `details)`, `info`, `details) => write("info"`, `event`, `details)`, `debug`, `details) => write("debug"`, `event`, `details)`, `clean`
- Uses: `./requestContext`

**`utils/memo.js`** (59 lines)

- What: A small in-memory cache for data that is the same for every visitor (the home page sections, related products). It keeps each value for a short time, and while a value is being loaded every other request for it waits for that one load instead of starting its own (no stampede on the database when a value runs out under load). Clearing a group (memo.forget("catalog:")) also stops any load of that group already running from putting an old value back; other groups are left alone. Never cache anything that belongs to one shopper (a cart, an account, an order), and treat cached values as read-only: every request gets the same object.
- Functions: `remember`, `forget`, `onForget`, `trim`, `size`
- Exports: `remember`, `forget`, `onForget`, `size`

**`utils/money.js`** (33 lines)

- What: Money is stored as whole paise (₹1 = 100 paise), so sums never pick up floating-point errors. Forms and URLs use rupees; these helpers convert at the edges.
- Functions: `rupeesToPaise`, `paiseToRupees`, `formatPaise`, `percentOf`
- Exports: `rupeesToPaise`, `paiseToRupees`, `formatPaise`, `percentOf`

**`utils/monitor.js`** (68 lines)

- What: Error alerts through Sentry, switched on only when SENTRY_DSN is set. Without it, every function here does nothing and the SDK is never even loaded. What is sent: the error, the request's method and path, its ID, and the release. What is NOT sent: cookies, headers, request bodies, query strings, IP addresses or signed-in users' details (scrubbed in beforeSend, and sendDefaultPii stays off).
- Functions: `scrub`, `init`, `captureException`, `flush`
- Exports: `init`, `captureException`, `flush`, `isOn`
- Uses: `../config/env`, `./requestContext`, `./logger`

**`utils/options.js`** (46 lines)

- What: Product options (sizes, colours): small helpers shared by the cart, checkout, orders and pages. A product with options keeps them in product.variants (models/Product.js); a cart or order line names the chosen one by its _id. Lines without one belong to products without options.
- Functions: `findOption`, `optionLabel`, `readLineKey`, `optionChoices`, `hasOptions`, `lineKey`, `readOptionId`
- Exports: `hasOptions`, `findOption`, `optionLabel`, `lineKey`, `readLineKey`, `readOptionId`, `optionChoices`

**`utils/orderRules.js`** (129 lines)

- What: The order lifecycle in one place. Pure functions, so every rule can be tested on its own.
- Functions: `canCancelItem`, `deriveOrderStatus`, `canRequestReturn`, `nextStatuses`, `itemsValue`, `refundFor`, `settlementFor`
- Exports: `ORDER_STATUSES`, `FLOW`, `CANCELLABLE`, `PAYMENT_STATUSES`, `COD_LIMIT`, `PAID_STATUSES`, `STATUS_LABELS`, `RETURN_REASONS`, `CANCEL_REASONS`, `canCancelItem`, `deriveOrderStatus`, `canRequestReturn`, `nextStatuses`, `itemsValue`, `refundFor`, `settlementFor`
- Uses: `./money`

**`utils/pricing.js`** (112 lines)

- What: Every price rule in one place. All amounts are in paise. The cart, checkout, online payment and the tests all use these functions, so a total is worked out the same way everywhere. Products basePrice the price the admin sets (never above the M.R.P.) offerPercent the product offer categoryOffer the offer on the product's category The higher of the two offers applies (they never add up), and the discount shown to shoppers is measured against the M.R.P. Orders subtotal (items at their offer prices) − coupon + delivery fee = payable payable − wallet = total, the amount still to pay (cash on delivery or online)
- Functions: `bestOfferFor`, `priceFor`, `deliveryFeeFor`, `couponDiscountFor`, `couponProblem`, `prepaidDiscountFor`, `orderTotals`, `roundHalfUp`, `halfUp`
- Exports: `PRICE_PIPELINE`, `halfUp`, `bestOfferFor`, `priceFor`, `roundHalfUp`, `deliveryFeeFor`, `couponDiscountFor`, `couponProblem`, `orderTotals`, `prepaidDiscountFor`
- Uses: `../config/store`, `./money`

**`utils/publicUser.js`** (17 lines)

- What: The only user fields that are ever sent to the browser (API replies and page locals).
- Functions: `toPublicUser`
- Exports: `toPublicUser`

**`utils/queryFilters.js`** (14 lines)

- What: Query filters the store uses again and again, so "what a shopper may see" is written once. Spread them into a query: Product.find({ ...LISTED_PRODUCT, category }).
- Exports: `LISTED_PRODUCT`, `LISTED_CATEGORY`, `VISIBLE_REVIEW`

**`utils/queryString.js`** (18 lines)

- What: Builds links like "/products?category=running&brand=Strike&brand=Volt&page=2", keeping the current filters and leaving out empty values. A list becomes one parameter per value.
- Functions: `linkBuilder`
- Exports: `linkBuilder`

**`utils/requestContext.js`** (13 lines)

- What: Remembers which request the running code belongs to, so every log line and error report can carry that request's ID without passing it through each function. Uses Node's AsyncLocalStorage.
- Exports: `// Runs next() inside a context that holds the request's ID.
run`, `fn) => storage.run(context`, `fn)`, `get`

**`utils/seo.js`** (111 lines)

- What: Search engines and link previews (D1): absolute addresses, which pages stay out of Google, and the structured data (schema.org JSON-LD) that lets Google show price, stock and stars in results. Pure helpers; middleware/seo.js sets the per-request defaults and the pages add their own.
- Functions: `siteOrigin`, `absoluteUrl`, `isPrivatePage`, `productData`, `breadcrumbData`, `storeData`, `availabilityOf`, `rupees`, `jsonLdText`
- Exports: `siteOrigin`, `absoluteUrl`, `isPrivatePage`, `productData`, `breadcrumbData`, `storeData`, `jsonLdText`, `availabilityOf`
- Uses: `../config/env`, `../config/store`

**`utils/slug.js`** (14 lines)

- What: "TrailFlex 2 — Running Shoes!" becomes "trailflex-2-running-shoes".
- Functions: `slugify`
- Exports: `slugify`

**`utils/synonyms.js`** (32 lines)

- What: Words shoppers use that the store doesn't (E4). A search for a key also finds the value words. Kept short and honest: only common Indian English alternatives for sports gear.
- Functions: `expandQuery`
- Exports: `SYNONYMS`, `expandQuery`

**`utils/transaction.js`** (52 lines)

- What: Runs several database changes as one unit. On a replica set (or Atlas) they run inside a MongoDB transaction: all of them happen, or none. A single local server has no transactions, so each step registers how to undo itself (undo(fn)); if a later step fails, the undo steps run in reverse order.
- Functions: `supportsTransactions`, `inTransaction`
- Exports: `supportsTransactions`, `inTransaction`
- Uses: `./logger`

**`utils/validators.js`** (732 lines)

- What: no header comment; read the file.
- Functions: `text`, `cleanPhone`, `hasErrors`, `checkName`, `checkPassword`, `validateSignup`, `validateLogin`, `validateProfile`, `validateForgot`, `validateToken`, `validatePasswordReset`, `validatePasswordChange`, `validateAddress`, `longText`, `readMoney`, `readPercent`, `validateProduct`, `readProductTax`, `readProductOptions`, `validateReview`, `readQuantity`, `validateCartQuantity`, `validateCartItem`, `validateContact`, `validateNewsletter` …
- Exports: `validateCoupon`, `validatePrepaidSetting`, `validateStockChange`, `validateStatusChange`, `validateBulkStatus`, `validateAdminCancel`, `validateShipment`, `validateOrderNote`, `validateManualRefund`, `validateReturnDecision`, `validateRestock`, `validateAdminSearch`, `hasErrors`, `readFlag`, `validateReferralSetting`, `validateCodSetting`, `validatePlaceOrder`, `validateCancel`, `validateReturn`, `validateContact`, `validateNewsletter`, `readIdList`, `readMoney`, `readPercent`, `validateReview`, `validateSignup`, `validateLogin`, `validateProfile`, `validatePasswordChange`, `validateForgot`, `validateToken`, `validatePasswordReset`, `validateAddress`, `validateProduct`, `readProductOptions`, `validateCartItem`, `validateCartQuantity`, `validateEmailChange`, `validatePreferences`, `validateListName`, `validateTicket`, `validateTicketReply`, `validateDeleteAccount`, `checkPassword`
- Uses: `../config/catalog`, `./money`, `./orderRules`, `../config/store`

---

## events

Event bus. Code announces `events.emit("order.placed")`; listeners react (email, WhatsApp). Each listener becomes a job.

### events/

**`events/index.js`** (48 lines)

- What: "Something happened": an order was placed, shipped, refunded... The code that makes it happen only says so (emit); everything that should follow (an email, later a WhatsApp message, a stock alert) is a listener registered elsewhere. So adding a reaction never means editing the order code, and a reaction that fails can never fail the order. Each listener runs as a job (jobs/queue.js): saved in MongoDB, retried with growing waits, and not lost if the server restarts. Emit AFTER the change is saved, and pass ids, not documents: the listener loads the current data when it runs. events.on("order.placed", "email", async ({ orderId }) => { ... }); // once, at start-up
- Functions: `on`, `emit`, `jobType`, `hasListeners`
- Exports: `on`, `emit`, `hasListeners`, `jobType`
- Uses: `../jobs/queue`, `../jobs/registry`, `../utils/logger`

### events/listeners/

**`events/listeners/orderEmails.js`** (30 lines)

- What: Order events -> customer emails. Registered at start-up (jobs/handlers.js); each runs as a background job. To react to an order event in another way (WhatsApp, a stock alert), add another listener next to this one: nothing in the order code changes.
- Uses: `../index`, `../../services/orderMailService`

**`events/listeners/orderWhatsApp.js`** (14 lines)

- What: Order events -> WhatsApp updates (E1), next to the emails (orderEmails.js). Only for customers who switched WhatsApp updates on; each runs as a background job and is sent once.
- Uses: `../index`, `../../services/messageService`, `../../services/pushService`

**`events/listeners/questionEmails.js`** (28 lines)

- What: Product Q&A (E3): the person who asked is emailed when an answer arrives. Once per answer.
- Uses: `../index`, `../../models/Question`, `../../models/User`, `../../services/mailService`, `../../services/orderMailService`, `../../utils/emailLayout`

---

## jobs

Background job queue stored in MongoDB: claim one job atomically, run it, retry with backoff on failure.

**`jobs/handlers.js`** (29 lines)

- What: Everything the job worker (and the event system) knows how to do, registered in one place. Required once at start-up, by the app and by the stand-alone worker, so a job saved by one can be run by the other.
- Uses: `../config/env`, `./registry`, `../services/cartRecoveryService`, `../events/listeners/orderEmails`, `../events/listeners/orderWhatsApp`, `../events/listeners/questionEmails`, `../services/stockAlertService`, `../services/commerceRecoveryService`

**`jobs/queue.js`** (77 lines)

- What: The job queue, on MongoDB. enqueue() adds work; the worker (jobs/worker.js) claims, runs and settles it.
- Functions: `enqueue`, `claim`, `backoffMs`, `complete`, `fail`, `counts`, `retryFailed`, `shorten`
- Exports: `enqueue`, `claim`, `complete`, `fail`, `counts`, `retryFailed`, `backoffMs`, `workerId`, `LEASE_MS`
- Uses: `../models/Job`, `../utils/logger`

**`jobs/registry.js`** (23 lines)

- What: Which function handles which kind of job, and the repeating jobs ("every hour, do this"). Handlers are registered by jobs/handlers.js (and by events/index.js for event listeners), and the worker looks them up by job type.
- Functions: `register`, `schedule`, `handlerFor`, `allSchedules`
- Exports: `register`, `schedule`, `handlerFor`, `allSchedules`

**`jobs/worker.js`** (98 lines)

- What: Runs jobs: claims one at a time from the queue (jobs/queue.js), calls its handler (jobs/registry.js), and settles it: done, retry later, or failed. Also keeps the repeating jobs (schedules) going. It runs inside the web server by default, so there is nothing extra to deploy. For a busy store it can run on its own too: JOBS_ENABLED=false on the web copies and `npm run worker` somewhere else.
- Functions: `runOne`, `tickSchedules`, `createWorker`
- Exports: `createWorker`, `runOne`, `tickSchedules`
- Uses: `./queue`, `./registry`, `../utils/logger`

---

## providers

Outside services behind one interface (mail, storage, payments, shipping, WhatsApp/SMS, Redis). A setting picks which one.

### providers/

**`providers/redis.js`** (92 lines)

- What: Optional Redis, for what several copies of the store must share (docs/SCALING.md): - rate limits (middleware/rateLimit.js): a visitor cannot dodge a limit by landing on another copy - cache clearing (services/cacheSync.js): a product change clears the catalogue cache on every copy Without REDIS_URL nothing here connects and every caller falls back to this process alone, which is right for one server. If Redis goes down, callers fall back the same way until it is back; the store keeps working.
- Functions: `createClient`, `getClient`, `subscribe`, `publish`, `close`, `enabled`
- Exports: `enabled`, `getClient`, `subscribe`, `publish`, `close`
- Uses: `../config/env`, `../utils/logger`

### providers/mail/

**`providers/mail/brevo.js`** (50 lines)

- What: Email through Brevo's HTTPS API (https://www.brevo.com, formerly Sendinblue): no SMTP port to open, works from any host, and a free plan of 300 emails a day. Settings: MAIL_DRIVER=brevo, BREVO_API_KEY (an "API key" from SMTP & API in the Brevo account) and MAIL_FROM (an address on a domain verified in Brevo).
- Functions: `parseAddress`, `createBrevoProvider`
- Exports: `createBrevoProvider`, `parseAddress`

**`providers/mail/smtp.js`** (30 lines)

- What: Email over SMTP with nodemailer: any provider that gives you a host, user and password (Amazon SES SMTP, Brevo SMTP, Zoho, Gmail for a small test...). Settings: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
- Functions: `createSmtpProvider`
- Exports: `createSmtpProvider`

### providers/messaging/

**`providers/messaging/sms.js`** (23 lines)

- What: SMS one-time codes through MSG91 (E2), India's DLT rules included: the template is registered on MSG91 with a DLT template id and one variable for the code (MSG91_OTP_TEMPLATE_ID).
- Functions: `createSmsProvider`
- Exports: `createSmsProvider`

**`providers/messaging/whatsapp.js`** (37 lines)

- What: WhatsApp Business through Meta's Cloud API (E1). Business-started messages must use templates approved in WhatsApp Manager; each template here has numbered parameters ({{1}}, {{2}} ...) filled in order. Create these templates (category "Utility", language WHATSAPP_TEMPLATE_LANGUAGE) before going live: nx_order_placed {{1}} name, {{2}} order id, {{3}} amount nx_order_shipped {{1}} name, {{2}} order id, {{3}} courier, {{4}} tracking number nx_out_for_delivery {{1}} name, {{2}} order id nx_order_delivered {{1}} name, {{2}} order id nx_cod_otp {{1}} code (category "Authentication", with a copy-code button)
- Functions: `createWhatsAppProvider`
- Exports: `createWhatsAppProvider`

### providers/storage/

**`providers/storage/cloudinary.js`** (96 lines)

- What: Photos in Cloudinary (https://cloudinary.com): no card needed for the free plan, files are served from its CDN. Settings: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (STORAGE_DRIVER=cloudinary). Same rules as the other providers: the app uploads each photo copy under the key it already uses ("products/<id>-full.webp", "-400.webp"...), and the stored address is https://res.cloudinary.com/<cloud>/image/upload/products/<id>-full.webp so utils/images.js works out the other sizes by changing the ending, exactly as on local disk or a bucket. Uploads are signed with the API secret (SHA-1 of the sorted parameters plus the secret); the secret is never
- Functions: `assertKey`, `createCloudinaryStorage`, `publicIdOf`
- Exports: `createCloudinaryStorage`, `publicIdOf`
- Uses: `../../utils/logger`

**`providers/storage/index.js`** (43 lines)

- What: Where uploaded photos live. Two places can hold them at once: current() the provider new uploads go to, chosen by STORAGE_DRIVER (local or cloudinary); local() this server's disk (public/uploads). It always exists, because photos uploaded before the switch to cloud storage are still there, and deleting or migrating them must find them. A stored photo URL says which one holds it: "/uploads/..." is local, Cloudinary's URL is cloud.
- Functions: `local`, `current`, `backendFor`, `useForTests`, `reset`
- Exports: `local`, `current`, `backendFor`, `useForTests`, `reset`
- Uses: `../../config/env`, `./local`, `./cloudinary`

**`providers/storage/local.js`** (50 lines)

- What: Photos on this server's own disk: public/uploads/<key>, served by Express as /uploads/<key>. Good for development. In production a container's disk is wiped on every deploy unless a volume is mounted, so use Cloudinary there.
- Functions: `createLocalStorage`
- Exports: `createLocalStorage`

---

## scripts

Command-line tools run with `npm run ...`: seeding, backups, checks, load tests.

**`scripts/backup.js`** (131 lines)

- What: Database backup and restore without MongoDB's separate tools (D3). Atlas's free M0 plan has no automatic backups, so run a backup at least weekly and keep the folder somewhere safe (not only on this computer). npm run db:backup backs up MONGODB_URI into backups/<date-time>/ npm run db:backup -- --uri "<connection string>" another database npm run db:restore -- --from backups/<folder> --to-db nexthlon_restore_check restores into a NEW database (on the same server) Each collection is one gzipped file of Extended JSON lines (types such as ObjectId and Date survive
- Functions: `args`, `backup`, `restore`, `main`, `stamp`
- Exports: `backup`, `restore`

**`scripts/checkDb.js`** (89 lines)

- What: Checks the database connection from MONGODB_URI (your .env, or the host's environment) and says what to fix when it fails. Prints the cluster, the database and what it found, never the address or password. npm run db:check
- Functions: `describe`, `advice`, `main`
- Uses: `../config/env`

**`scripts/dbIndexes.js`** (49 lines)

- What: Makes sure every index the store needs exists in the database from MONGODB_URI (your .env, or the host's environment): npm run db:indexes Safe to run any time, on a live database: it only ADDS missing indexes and never deletes anything. Indexes the database has that the code no longer asks for are listed, for you to decide on. Prints the database name and the indexes, never the address or password.
- Functions: `nameOf`
- Uses: `../config/env`

**`scripts/jobsStatus.js`** (24 lines)

- What: Shows the job queue: how many jobs are waiting, running, done and failed, and why the failed ones failed. npm run jobs:status list npm run jobs:retry put every failed job back in the queue npm run jobs:retry -- <type> only jobs of one type, e.g. event:order.placed:email
- Functions: `main`
- Uses: `../config/db`, `../jobs/queue`, `../models/Job`

**`scripts/loadTest.js`** (99 lines)

- What: A small load test with no extra packages: hits the store's busiest pages with many requests at once and prints requests per second and response times (median, p95, worst) for each. node scripts/loadTest.js http://localhost:3000, 20 at a time, 10 seconds each node scripts/loadTest.js http://localhost:3200 --concurrency 50 --seconds 15 node scripts/loadTest.js http://localhost:3200 --ramp 10,25,50,100,200 --path / raises the number of visitors at once step by step on one page and reports the most this server handles while 95% of answers stay under half a second (docs/SCALING.md uses that number).
- Functions: `firstProductPath`, `percentile`, `run`, `rampTest`, `option`, `textOption`

**`scripts/migrateImages.js`** (33 lines)

- What: Gives photos uploaded earlier their small copies, and (when STORAGE_DRIVER=cloudinary) moves them to Cloudinary. See services/imageMigrationService.js for exactly what it changes. npm run images:migrate -- --dry-run shows what would happen, changes nothing npm run images:migrate does it
- Functions: `main`
- Uses: `../config/env`, `../services/imageMigrationService`

**`scripts/previewEmails.js`** (41 lines)

- What: Writes every order email as an HTML file with sample data, so you can open them in a browser (and shrink the window to phone width) without placing orders: npm run emails:preview -> tmp/email-preview/index.html
- Uses: `../services/orderMailService`, `../utils/emailLayout`, `../models/Order`

**`scripts/pushKeys.js`** (6 lines)

- What: Prints a new pair of VAPID keys for push notifications (E5). Put them in your host's settings as VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, once. Changing them later makes every saved subscription stop working.

**`scripts/screenshots.js`** (243 lines)

- What: Screenshot set (C4): every page at a phone (390px) and a desktop (1440px) width, plus a gallery page. Drives headless Chrome directly over the DevTools protocol (Node's built-in WebSocket), so it needs no extra packages. Images go to docs/screenshots/ (kept out of git: run this to make them again). node scripts/screenshots.js [--base http://localhost:3200] [--admin-path /nx-console] [--only home,cart] Signed-in pages need test accounts on the store you point it at (never real ones), given as settings: SHOT_CUSTOMER_EMAIL, SHOT_CUSTOMER_PASSWORD My Account, cart, checkout, orders SHOT_ADMIN_EMAIL, SHOT_ADMIN_PASSWORD the admin console (needs --admin-path)
- Functions: `args`, `findChrome`, `openPage`, `go`, `run`, `signIn`, `main`, `sleep`

**`scripts/seedAdmin.js`** (43 lines)

- What: Creates the first administrator from ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD in .env. Run: npm run seed:admin
- Functions: `seedAdmin`
- Uses: `../config/env`, `../models/User`, `../services/authService`

**`scripts/seedCoupons.js`** (40 lines)

- What: Adds a few sample coupons so checkout can be tried before the admin coupon screens exist. Existing codes are left alone, so running it again changes nothing. Run: npm run seed:coupons
- Functions: `samples`, `seedCoupons`
- Exports: `samples`
- Uses: `../config/env`, `../models/Coupon`

**`scripts/seedProducts.js`** (57 lines)

- What: Adds the starter products from data/products.json. Products that already exist are left alone. The file lists prices in rupees and categories by name; they are stored as paise and category records. Run: npm run seed:products
- Functions: `seedProducts`
- Uses: `../config/env`, `../models/Product`, `../data/products.json`, `../services/migrationService`, `../services/categoryService`, `../utils/pricing`

**`scripts/setupCheck.js`** (80 lines)

- What: Tests every outside service from your .env and says, in plain words, what works and what to fix. Never prints a key or password. npm run setup:check database, settings, photo storage npm run setup:check -- --mail also sends one real test email to ADMIN_EMAIL
- Functions: `checkDatabase`, `checkSettings`, `checkStorage`, `checkMail`, `ok`, `bad`, `note`
- Uses: `../config/env`, `../config/schema`, `../providers/storage`, `../services/mailService`

**`scripts/worker.js`** (34 lines)

- What: Runs background jobs (order emails, cart reminders) on their own, without the website. Use it when the web copies run with JOBS_ENABLED=false: npm run worker
- Functions: `stop`
- Uses: `../config/db`, `../config/env`, `../utils/logger`, `../jobs/handlers`, `../jobs/worker`

---

## views

EJS templates rendered on the server. `pages/` are whole pages, `partials/` reused pieces, `admin/` and `account/` their areas. `<%= %>` prints escaped, `<%- %>` raw, `<% %>` runs code.

### views/account/

**`views/account/buy-again.ejs`** (29 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-end`

**`views/account/coupons.ejs`** (63 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-end`

**`views/account/help.ejs`** (66 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-end`

**`views/account/lists.ejs`** (82 lines)

- What: Drop targets: drag a product onto a list to move it there. Each card also has a "Move to" menu.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-end`

**`views/account/notifications.ejs`** (44 lines)

- What: Push notifications on this device (E5): public/js/account.js asks the browser, then saves it.
- Includes: `../partials/account-start`, `../partials/account-end`

**`views/account/overview.ejs`** (79 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-products`, `../partials/account-end`

**`views/account/recent.ejs`** (16 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-products`, `../partials/account-empty`, `../partials/account-end`

**`views/account/referral.ejs`** (36 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-empty`, `../partials/account-end`

**`views/account/security.ejs`** (153 lines)

- What: Logged-in devices: one row per live refresh token, so "signed in" here means "can renew".
- Includes: `../partials/account-start`, `../partials/account-end`

**`views/account/shared-list.ejs`** (26 lines)

- What: no header comment; read the file.
- Includes: `../partials/head`, `../partials/header`, `../partials/empty-art`, `../partials/footer`

**`views/account/ticket.ejs`** (26 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/account-end`

### views/admin/

**`views/admin/abandoned-carts.ejs`** (49 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/analytics.ejs`** (155 lines)

- What: Analytics. Same date range as the dashboard, plus a grouping (day / week / month) the admin chooses. Every chart is hand-drawn SVG from public/js/admin-dashboard.js (no chart library), and every chart has a table under it, so the numbers are readable without the picture.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/coupon-form.ejs`** (130 lines)

- What: One page for creating and for editing a coupon. Amounts are typed in rupees and kept in paise. Everything typed here is checked again on the server (utils/validators.js validateCoupon), so a changed form or a direct API call cannot slip a bad coupon through.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/coupon.ejs`** (89 lines)

- What: One coupon: its rules, how much discount it has given altogether, and every use with the customer and the order it was used on. The uses come from CouponRedemption, one row per order.
- Includes: `../partials/admin-start`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/coupons.ejs`** (98 lines)

- What: Coupons. The status shown here is worked out in exactly the order the store checks a code (services/adminCouponService.js statusOf), so what this list says is what a customer will see. Disabling is reversible; deleting is a soft delete, so past orders keep their history.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/customer-wallet.ejs`** (37 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/admin-end`

**`views/admin/dashboard.ejs`** (242 lines)

- What: ---------- Date range ----------
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/inventory.ejs`** (75 lines)

- What: Inventory: see what is on the shelf and correct it. Type the new stock and press Save; a product with sizes has one field per size. The server checks every change and records it in the audit log. Names, prices and photos are edited in Products. Script: public/js/admin-catalog.js.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/login.ejs`** (56 lines)

- What: The admin "control room": a WebGL wireframe globe with glowing data points, a scanning line and a terminal that types a greeting. One glass card to sign in; no sign-up here.
- Includes: `../partials/head`, `../partials/auth-field`, `../partials/scripts`

**`views/admin/order.ejs`** (223 lines)

- What: ---------- Items ----------
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/orders.ejs`** (130 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/product-form.ejs`** (207 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/products.ejs`** (120 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/empty-art`, `../partials/pagination`, `../partials/admin-end`

**`views/admin/questions.ejs`** (51 lines)

- What: Product questions (E3): answer as the Nexthlon team, or hide one that breaks the rules.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/reconciliation.ejs`** (62 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/refunds.ejs`** (60 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/returns.ejs`** (55 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/settings.ejs`** (120 lines)

- What: Settings: the store numbers an admin may change, and the ones that are fixed in the code. Each form posts to /api/admin/settings/ plus its data-settings-form name, and the server checks the value against services/settingsService.js LIMITS before saving it.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/system.ejs`** (86 lines)

- What: System status: is the store healthy, and what is switched on? Everything here is read-only. No secret is ever printed: for each optional service the page says only whether its keys are present, never what they are.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/transaction.ejs`** (42 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/admin-end`

**`views/admin/transactions.ejs`** (70 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/admin-end`

**`views/admin/users.ejs`** (95 lines)

- What: no header comment; read the file.
- Includes: `../partials/admin-start`, `../partials/empty-art`, `../partials/admin-end`

### views/pages/

**`views/pages/404.ejs`** (28 lines)

- What: no header comment; read the file.
- Includes: `../partials/head`, `../partials/header`, `../partials/footer`

**`views/pages/about.ejs`** (25 lines)

- What: Template text. Tell your own story here.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/auth.ejs`** (118 lines)

- What: ---------- Front: sign in ----------
- Includes: `../partials/head`, `../partials/auth-field`, `../partials/scripts`

**`views/pages/cart.ejs`** (107 lines)

- What: Products often ordered with what is in this cart (recommendationService).
- Includes: `../partials/head`, `../partials/header`, `../partials/empty-art`, `../partials/rail`, `../partials/footer`

**`views/pages/checkout.ejs`** (287 lines)

- What: On phones this column is a sheet that slides up from the pay bar below ("Details").
- Includes: `../partials/head`, `../partials/header`, `../partials/payment-icons`, `../partials/verify-banner`, `../partials/address-dialog`, `../partials/pay-overlay`, `../partials/footer`

**`views/pages/contact.ejs`** (98 lines)

- What: A trap for spam bots: people never see or reach this field.
- Includes: `../partials/info-start`, `../partials/empty-art`, `../partials/info-end`

**`views/pages/error.ejs`** (22 lines)

- What: no header comment; read the file.
- Includes: `../partials/head`, `../partials/header`, `../partials/footer`

**`views/pages/guide.ejs`** (10 lines)

- What: no header comment; read the file.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/guides.ejs`** (26 lines)

- What: no header comment; read the file.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/home.ejs`** (416 lines)

- What: ---------- 1. Hero: a WebGL particle sphere that becomes the logo, then an athlete, as you scroll ----------
- Includes: `../partials/head`, `../partials/header`, `../partials/rail`, `../partials/empty-art`, `../partials/footer`

**`views/pages/offline.ejs`** (49 lines)

- What: Shown by the service worker (public/sw.js) when a page can't load because there is no connection. Stored once, signed out, so it stands alone: inline styles, no scripts, no account details.

**`views/pages/order-success.ejs`** (39 lines)

- What: The moment an order lands: the tick draws itself, then the details arrive one after another (--i sets the order), and confetti follows the tick (confetti.js). All still for reduced motion.
- Includes: `../partials/head`, `../partials/header`, `../partials/footer`

**`views/pages/order.ejs`** (200 lines)

- What: An online order that is not paid yet has no invoice number: the invoice comes with the payment.
- Includes: `../partials/account-start`, `../partials/pay-status`, `../partials/pay-overlay`, `../partials/account-end`

**`views/pages/orders.ejs`** (91 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/pay-status`, `../partials/pagination`, `../partials/empty-art`, `../partials/account-end`

**`views/pages/privacy.ejs`** (53 lines)

- What: Template text. Replace every [bracketed] value, and check the policy with a legal adviser.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/product.ejs`** (462 lines)

- What: ===================== Hero: photo stage + story + buy panel =====================
- Includes: `../partials/head`, `../partials/header`, `../partials/stock-alert`, `../partials/questions`, `../partials/rail`, `../partials/size-guide`, `../partials/footer`

**`views/pages/products.ejs`** (303 lines)

- What: The filter panel. On a desktop it sits beside the results; on a phone the same markup slides up as a bottom sheet (public/js/catalog.js). Every choice is a real radio or checkbox with the same name the server reads, styled as pills, stars or a switch, so it works with the keyboard, with screen readers and, as a plain GET form, without JavaScript.
- Includes: `../partials/head`, `../partials/header`, `../partials/product-card`, `../partials/empty-art`, `../partials/pagination`, `../partials/footer`

**`views/pages/profile.ejs`** (51 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/address-dialog`, `../partials/account-end`

**`views/pages/recovery.ejs`** (146 lines)

- What: Forgotten password, choosing a new one, and confirming an email address. One page, six states (view): forgot ask for the email reset choose a new password (opened from the emailed link) reset-invalid the reset link is old, used or wrong verify confirm the email (opened from the emailed link) verify-invalid the confirmation link is old, used or wrong verify-done the email is already confirmed It uses the sign-in page's look and its script (public/js/auth.js): same scene, same glass card, same fields.
- Includes: `../partials/head`, `../partials/auth-field`, `../partials/scripts`

**`views/pages/refund-policy.ejs`** (31 lines)

- What: Template text. Replace every [bracketed] value and check the time limits match how you really work.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/shipping-policy.ejs`** (29 lines)

- What: Template text. Replace every [bracketed] value and check the times match your courier partners.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/terms.ejs`** (33 lines)

- What: Template text. Replace every [bracketed] value, and check the terms with a legal adviser.
- Includes: `../partials/info-start`, `../partials/info-end`

**`views/pages/wallet.ejs`** (106 lines)

- What: no header comment; read the file.
- Includes: `../partials/account-start`, `../partials/pagination`, `../partials/empty-art`, `../partials/account-end`

### views/partials/

**`views/partials/account-empty.ejs`** (8 lines)

- What: An animated empty state for a My Account section: { art, title, text, href?, cta? }
- Includes: `empty-art`

**`views/partials/account-end.ejs`** (10 lines)

- What: no header comment; read the file.
- Includes: `footer`

**`views/partials/account-products.ejs`** (11 lines)

- What: A row of small product cards (lean product documents): { products }

**`views/partials/account-start.ejs`** (65 lines)

- What: The My Account shell: a sidebar on wide screens, a horizontal tab bar on phones, and the section's content. Usage: include('../partials/account-start', { section: 'orders' }) ... then include('../partials/account-end'). Account pages are calm on purpose: no store motion is loaded (res.locals.motion is false) and the active section has a static volt highlight.
- Includes: `../partials/account-start`, `../partials/account-end`, `head`, `header`, `verify-banner`

**`views/partials/address-dialog.ejs`** (86 lines)

- What: The add/edit address form, shared by the profile page and checkout. Needs "states". public/js/profile.js runs it.

**`views/partials/admin-end.ejs`** (11 lines)

- What: no header comment; read the file.
- Includes: `admin-palette`, `scripts`

**`views/partials/admin-palette.ejs`** (15 lines)

- What: The Ctrl+K command palette: jump to any section in config/adminNav.js, or search orders, products and customers.

**`views/partials/admin-sidebar.ejs`** (33 lines)

- What: The admin sidebar: collapsible groups from config/adminNav.js, a static volt highlight on the active section.

**`views/partials/admin-start.ejs`** (25 lines)

- What: The admin console shell: a grouped sidebar, a top bar (search, Ctrl+K, notifications, theme, admin menu) and the section's content. Usage: include('../partials/admin-start', { section: 'products', page: 'product-form' }) ... include('../partials/admin-end') With the "X-Partial: 1" header (section-nav.js) only the content is rendered.
- Includes: `../partials/admin-start`, `../partials/admin-end`, `head`, `admin-sidebar`, `admin-topbar`

**`views/partials/admin-topbar.ejs`** (47 lines)

- What: The admin top bar: global search, the Ctrl+K palette, notifications and the admin menu.

**`views/partials/auth-field.ejs`** (22 lines)

- What: One sign-in field: an icon, the input, a floating label, an animated underline, a tick when valid, and the error slot. Pass { id, name, label, type, icon, autocomplete, max, value, extra }.

**`views/partials/bundles.ejs`** (22 lines)

- What: Complete the kit (E6): sets this product belongs to. public/js/product.js adds a whole set at once.

**`views/partials/empty-art.ejs`** (79 lines)

- What: Empty-state illustrations, drawn with inline SVG and coloured by the design tokens, so they follow light and dark mode. Pass { art: 'cart' | 'heart' | 'box' | 'package-check' | 'search' | 'wallet' | 'users' | 'check' | 'ticket' | 'star' | 'clock' | 'headset' | 'pin' | 'gift' | 'lock' }. The drawing gently floats (motion.css).

**`views/partials/footer.ejs`** (124 lines)

- What: Shown by public/js/pwa.js only when this browser can install the app (E5).
- Includes: `payment-icons`, `scripts`

**`views/partials/head.ejs`** (59 lines)

- What: Link previews (WhatsApp, Instagram, Facebook, X, LinkedIn) and search data (middleware/seo.js, utils/seo.js).

**`views/partials/header.ejs`** (214 lines)

- What: The top promo strip (free delivery, returns, shipping, help) was removed: the header starts the page. The same links are in the footer.

**`views/partials/info-end.ejs`** (5 lines)

- What: no header comment; read the file.
- Includes: `footer`

**`views/partials/info-start.ejs`** (32 lines)

- What: Opening of every store information page: breadcrumb, side menu and the page heading. Pass: heading, lead (optional), updated (true for policies). Close with info-end.
- Includes: `head`, `header`

**`views/partials/pagination.ejs`** (30 lines)

- What: no header comment; read the file.

**`views/partials/pay-overlay.ejs`** (47 lines)

- What: The full-screen payment overlay: opening Razorpay, verifying, success and failure. public/js/payment.js drives it by setting data-state. No card details are ever entered here: the payment itself happens inside Razorpay's own secure window.

**`views/partials/pay-status.ejs`** (8 lines)

- What: Payment status badge: Paid (green pulse), Pending (amber), Failed (red), Refunded (blue). Pass { status, method }.

**`views/partials/payment-icons.ejs`** (48 lines)

- What: Payment method badges, drawn with inline SVG (no image files, nothing loaded from outside).

**`views/partials/product-card.ejs`** (41 lines)

- What: Quick add (store.js): customers and guests (a guest's cart moves into their account at sign-in), in-stock products only.
- Includes: `stock`

**`views/partials/questions.ejs`** (37 lines)

- What: Product questions and answers (E3). public/js/product.js asks, answers and loads more. Pass: product, questions ({ questions, pagination }), canAnswer (this customer received it), signedIn, backHere.

**`views/partials/rail.ejs`** (9 lines)

- What: A horizontal row of product cards with scroll buttons. Without JavaScript it still scrolls sideways.
- Includes: `product-card`

**`views/partials/scripts.ejs`** (51 lines)

- What: Cookie consent (D2): only when the owner set up analytics, and never on admin pages. public/js/consent.js

**`views/partials/size-guide.ejs`** (87 lines)

- What: The size guide (B3 part 2). Opened by the "Size guide" link beside the size picker on the product page ([data-dialog-open="size-guide"], public/js/app.js). It slides up from the bottom on phones and opens as a side panel on desktops (public/css/product.css .size-guide). Needs: sizes (this product's sizes). Number sizes get the shoe table, letter sizes the clothing table; the rows this product comes in are marked.

**`views/partials/stock-alert.ejs`** (29 lines)

- What: "Email me when it's back" (E3). public/js/product.js sends it to POST /api/products/:id/stock-alerts. Pass: product, soldOptions ([{ id, label }] for sold-out sizes/colours, or [] for the whole product), waiting (what this customer already asked for: "any" or option ids), signedIn (customer with an email).

**`views/partials/stock.ejs`** (8 lines)

- What: no header comment; read the file.

**`views/partials/verify-banner.ejs`** (9 lines)

- What: A reminder for a signed-in customer whose email is not confirmed yet. Shown on My Account and checkout.

---

## public

Everything sent to the browser: plain JavaScript (no framework), CSS, the hand-written WebGL 3D engine.

### public/

**`public/sw.js`** (126 lines)

- What: Nexthlon service worker (E5): makes the store installable and kind when the signal drops. What it keeps, and what it never does: - Pages are always fetched fresh (prices, stock and your cart must be live). With no connection, the offline page is shown instead of the browser's error. - The site's own CSS, JS and fonts with a ?v= version are kept (their URL changes when they do), so repeat visits and the installed app open fast. - Photos are kept too (the newest 120), refreshed in the background. - Never: anything under /api/, anything from another site (payments, analytics), and anything that is not a GET. Signed-in pages are never stored, so a shared phone shows nobody else's data.
- Functions: `trim`, `cacheFirst`, `staleWhileRevalidate`

### public/css/

**`public/css/account.css`** (285 lines)

- What: no header comment; read the file.

**`public/css/admin.css`** (577 lines)

- What: no header comment; read the file.

**`public/css/auth.css`** (314 lines)

- What: no header comment; read the file.

**`public/css/checkout.css`** (163 lines)

- What: Checkout and Buy now: the page's own layer on top of style.css.

**`public/css/components.css`** (735 lines)

- What: no header comment; read the file.

**`public/css/filters.css`** (182 lines)

- What: no header comment; read the file.

**`public/css/home.css`** (424 lines)

- What: Home page only (views/pages/home.ejs loads it through head.ejs "coreStyles", right after

**`public/css/mobile.css`** (165 lines)

- What: no header comment; read the file.

**`public/css/motion.css`** (314 lines)

- What: no header comment; read the file.

**`public/css/product.css`** (523 lines)

- What: no header comment; read the file.

**`public/css/style.css`** (1693 lines)

- What: ---------- Catalogue ----------

**`public/css/tokens.css`** (353 lines)

- What: ---------- Fonts, served from this site (public/fonts) ----------

### public/js/

**`public/js/account.js`** (588 lines)

- What: My Account: the script for every account section. Calm on purpose: no tilt, count-ups, flips, confetti or other movement, just clear actions with toasts. Each section is a module in window.NxPages ("account-wallet", "account-lists", ...) with init(root) and destroy(). Its listeners are attached to the section's root element with an AbortSignal, so destroy() removes every one of them in one go: no duplicates, no leaks, even after the section is swapped many times. A few actions shared by every section (copy a code, add to cart, share an invite) use one delegated listener on the document, attached once.

**`public/js/admin-catalog.js`** (65 lines)

- What: Admin Inventory: type the new stock and press Save. Each changed field is sent as an exact count (PATCH /api/admin/inventory/:id); the server checks it, and the row shows what it saved.

**`public/js/admin-coupons.js`** (144 lines)

- What: Admin Coupons: the list (enable/disable, delete), the create/edit form, and the detail page. The form only makes things pleasant; every rule is checked again on the server (utils/validators.js validateCoupon), so a changed form cannot save a bad coupon.

**`public/js/admin-dashboard.js`** (586 lines)

- What: Admin dashboard: hand-drawn SVG charts (no library), KPI count-up, top-products tabs, quick restock and clickable order rows. Charts take their colours from CSS classes (theme tokens), so they follow light and dark mode. Each chart has a tooltip on hover and with the arrow keys, and a data table under it. Motion is light and happens once: bars and lines draw in, numbers count up. With "reduce motion" everything simply appears. Redrawn (without motion) on resize.

**`public/js/admin-orders.js`** (222 lines)

- What: Admin Sales sections: orders (filters, bulk status, column picker), one order (status, cancel, shipments, notes, refunds, return decisions), returns, transactions, refunds and abandoned carts. Each section is a window.NxPages module, so it keeps working after no-reload section switches.

**`public/js/admin-products.js`** (377 lines)

- What: Admin products: list filters, list/unlist toggle, and the add/edit form with its photo manager.

**`public/js/admin-wallet.js`** (36 lines)

- What: no header comment; read the file.

**`public/js/admin.js`** (412 lines)

- What: Admin console: the shell (collapsible sidebar groups, the phone menu, global search, the Ctrl+K command palette and the notification bell), plus the small sections that need no file of their own (customers, settings, system status). No animation: everything appears and disappears instantly. The bigger sections live in their own files: admin-dashboard.js (dashboard and analytics), admin-products.js, admin-orders.js, admin-catalog.js (inventory) and admin-coupons.js. Section modules use window.NxPages (section-nav.js) with init(root)/destroy(), so they keep working when sections switch without a reload.

**`public/js/app.js`** (718 lines)

- What: Shared browser helpers for every page: API calls, toasts, form errors, menus, sign out.

**`public/js/auth.js`** (472 lines)

- What: Sign in, create account and admin sign in. The server checks everything again; this file only makes the forms pleasant: the 3D card flip between /login and /signup (the URL follows), live checks as you type, a password strength meter, email typo hints, a Caps Lock warning, the show/hide eye, the submit button states and the transition into the store.

**`public/js/auth3d.js`** (263 lines)

- What: Sign-in pages in 3D (ES module, built on public/js/3d): customers glowing particles form a running athlete, then a football, then a dumbbell, in a loop over the obsidian and volt fog. The mouse makes them swirl away and come back. admins a turning wireframe globe with glowing data points, for the "control room". Decoration only: without WebGL the scene shows its CSS fallback, and with reduced motion one still frame is drawn.
- Functions: `weightsAt`, `pointerTracker`, `buildAthletes`, `globeLines`, `buildGlobe`, `isStrip`
- Uses: `./3d/scene.js`, `./3d/boot.js`, `./3d/math.js`, `./3d/shapes.js`

**`public/js/cart.js`** (352 lines)

- What: Add to cart on the product page, and the cart page (+/- quantity, remove, live totals). Prices shown here always come from the server's reply; the browser never sends a price.

**`public/js/catalog.js`** (758 lines)

- What: Product list filters, the phone filter drawer, and the product photo gallery. Architecture: ONE filter state object is the single source of truth. It is read from the URL on load, every change patches it, and it is written straight back to the URL — so a refresh, the Back button and a shared link all give the same page. Render functions only ever read from the state; nothing scrapes values back out of the DOM. Without JavaScript the same markup is an ordinary GET form, so the server-rendered catalogue is the complete fallback.

**`public/js/checkout.js`** (605 lines)

- What: Checkout: three steps (address, summary, payment) on one page, plus the coupon box and the wallet. The server works out every price, the coupon discount and every total; this page only sends the address, the payment method, the coupon code and whether to use the wallet, then shows the totals the server sends back.

**`public/js/confetti.js`** (99 lines)

- What: Confetti drawn on a <canvas> (no library): Nx.confetti(canvas) bursts once and clears itself. Used on the order success page and in the payment overlay. Skipped completely when the visitor prefers reduced motion. The success page also shows the delivery date.

**`public/js/consent.js`** (148 lines)

- What: Cookie consent and analytics (D2). Only on the page when the store owner set up a provider (utils/analytics.js). Nothing from the provider loads until the visitor picks "Allow analytics". The choice is kept for 180 days in the nx_consent cookie ("analytics" or "essential"). Browsers that send Global Privacy Control count as "essential", and the banner is not shown. Shopping events: Nx.track(name, params) from the store's scripts, plus any events a page lists in <script type="application/json" id="nx-events">. Before consent they are simply dropped.

**`public/js/contact.js`** (39 lines)

- What: Contact page: sends the form to /api/contact. Every field is checked again on the server.

**`public/js/header.js`** (476 lines)

- What: Header: the search panel (ideas before typing, live suggestions while typing) and the phone menu drawer. The category mega-menu and the account menu use the shared [data-menu] code in app.js.

**`public/js/home.js`** (82 lines)

- What: Home page (classic script): the flip-digit "Deals of the day" countdown and the deal flip cards. The 3D scenes live in home3d.js. Without this file the countdown shows the time at page load and each deal card shows its offer on hover or focus.

**`public/js/home3d.js`** (626 lines)

- What: Home page 3D (ES module, built on public/js/3d): 1. Hero: thousands of glowing particles form a sphere, then the NEXTHLON logo, then a running athlete as you scroll, over an animated obsidian and volt fog. The mouse moves the camera. This is the page's only WebGL canvas. 2. The zero-gravity showroom lives in its own module, showroom3d.js. 3. Pick your sport: six sport cards on a CSS 3D ring, turned by scroll, drag, tabs, keys and a timer. 4. Showcase: a product on a turning podium, lit by the mouse. Everything is decoration over real links and text: without JavaScript, WebGL or motion, the page shows the same content as flat sections.
- Functions: `morphFor`, `buildHero`, `setUpSportRing`
- Uses: `./3d/scene.js`, `./3d/boot.js`, `./3d/interaction.js`, `./3d/math.js`, `./3d/shapes.js`

**`public/js/image-editor.js`** (494 lines)

- What: Photo editor for the admin product form: crop, rotate, flip, or swap in a different file. admin-products.js loads this file the first time an admin clicks "Edit" on a photo. Everything happens in the browser on a <canvas>. The result is a normal upload, so the server still checks the file and makes every size (400/800/1600/full) from it. const result = await window.NxImageEditor.open({ url, file, label }); result is null (closed, or nothing changed) or { file, src } (src is a data: URL preview).

**`public/js/motion.js`** (217 lines)

- What: Motion layer: scroll reveals, 3D tilt, glass header, counters (and parallax on a .hero, if a page has one). Everything here is decoration. If this file fails, the page is still complete and visible: content is only hidden while <html> has the "js-motion" class, which this file adds last.

**`public/js/page-reveal.js`** (45 lines)

- What: Page transitions, the arriving side (C1). Loaded in <head> without defer, because "pagereveal" fires just before the new page's first frame, which is when its half of a cross-document View Transition is decided. (The leaving side, a card's photo flowing into the product page, is in app.js on "pageswap".) Going BACK (or forward through history): the transition gets the type "back", so motion.css plays it the other way round. And when the page left behind was a product page, the card for that product takes the photo's name here, so the big photo flows back into its card. Browsers without View Transitions or the Navigation API ignore all of this and change page normally.

**`public/js/payment.js`** (342 lines)

- What: Online payment with Razorpay Standard Checkout, wrapped in our own full-screen overlay: opening a short glass screen with a lock, then Razorpay's secure window opens verifying the ids and signature go to our server, which checks them with the secret it never shares checking the connection dropped: ask the server a few times where the payment stands success a checkmark, confetti, the order id and the amount failed a cross, the reason in plain words, Retry payment or Choose another method Card and UPI details are only ever typed inside Razorpay's window, never on this site.

**`public/js/product.js`** (980 lines)

- What: Product page: real photo zoom (hover magnifier and a full-screen viewer), delivery date by PIN code, and sharing.

**`public/js/profile.js`** (225 lines)

- What: Profile page: account details, password change, and the address book.

**`public/js/pwa.js`** (106 lines)

- What: The installable app (E5): registers the service worker (public/sw.js) and runs "Get the app". Browsers that can install (Chrome, Edge, Samsung Internet on Android and desktop) fire "beforeinstallprompt"; the footer button then opens their own install dialog. iPhones cannot be asked from a page, so there the button explains the two taps (Share, then Add to Home Screen). Nothing shows inside the installed app itself.

**`public/js/section-nav.js`** (245 lines)

- What: Section router for the work areas (My Account and the admin console): switch sections without reloading the page, and without any animation. Clicks on area links (the sidebar, the tab bar and links inside a section) and the area's GET forms fetch the URL with the header "X-Partial: 1". The server then sends only the section's content, which replaces the old content instantly. The URL, the page title, the active sidebar item and the focus follow; Back and Forward work. A small spinner shows only after 300ms. Anything unexpected (signed out, an error page, a page that needs extra scripts) falls back to a

**`public/js/showroom3d.js`** (636 lines)

- What: The zero-gravity showroom (ES module, home page). Wide screens: twelve glass product cards float at fixed "random" spots in a CSS 3D room. The mouse turns the camera, scrolling through the pinned section flies it forward, a card faces you on hover, and a click flies to it and unfolds a detail card like a book. Phones: a floating swipe row (tilted by the gyroscope where the browser allows it without asking). Reduced motion: a still grid. Without JavaScript: the same cards as a plain grid of links. Everything moves on the site's one shared ticker (public/js/motion/ticker.js).
- Functions: `buildDustField`, `getTicker`, `seeded`, `overlapArea`, `setUpShowroom`
- Uses: `./3d/interaction.js`, `./3d/math.js`, `./3d/scene.js`, `./3d/gl.js`

**`public/js/store.js`** (696 lines)

- What: Shopper helpers on every store page: wishlist hearts (saved on the server), "recently viewed" (saved in this browser), sideways product rails, tabs, and the footer newsletter form. Prices on cards drawn here always come fresh from the API, never from storage.

**`public/js/theme.js`** (28 lines)

- What: Runs in <head>, before the page paints. Nexthlon has one look, the dark (obsidian) theme: there is no light mode or theme switch any more. tokens.css reads <html data-theme="dark">, so it is set here before anything shows. A choice saved by the old theme switch is cleared.

### public/js/3d/

**`public/js/3d/boot.js`** (74 lines)

- What: Starts a 3D scene safely: only when its section comes near the screen, never without WebGL (the container then shows its CSS 3D fallback), and as one still frame for reduced motion. build(canvas, { reduced, tier }) → { scene, ready? } (ready: a promise for textures etc.)
- Exports: `boot`
- Uses: `./gl.js`, `./interaction.js`

**`public/js/3d/gl.js`** (118 lines)

- What: WebGL basics for the Nexthlon 3D engine: context, shaders, buffers, textures and sizing.
- Functions: `compile`
- Exports: `supportsWebGL`, `createContext`, `createProgram`, `createBuffer`, `bindAttribute`, `setUniform`, `loadTexture`, `resize`

**`public/js/3d/interaction.js`** (124 lines)

- What: Input for the Nexthlon 3D engine: pointer/gyroscope parallax, drag-to-rotate with inertia, scroll progress for scroll-linked scenes, and what the device can handle.
- Exports: `prefersReducedMotion`, `finePointer`, `wantsLessData`, `deviceTier`, `createParallax`, `createDragRotate`, `scrollProgress`
- Uses: `./math.js`

**`public/js/3d/math.js`** (117 lines)

- What: Small vector and matrix maths for the Nexthlon 3D engine. Matrices are column-major Float32Arrays of 16 numbers, the layout WebGL expects.
- Exports: `vec3`, `mat4`, `clamp`, `lerp`, `smoothstep`, `damp`

**`public/js/3d/scene.js`** (305 lines)

- What: Scenes for the Nexthlon 3D engine: a camera, meshes, ready-made geometry and a render loop that pauses when the tab is hidden or the canvas scrolls off screen.
- Exports: `Camera`, `geometry`, `Mesh`, `Scene`
- Uses: `./math.js`, `./gl.js`

**`public/js/3d/shapes.js`** (176 lines)

- What: Shapes and shaders shared by the Nexthlon particle scenes (home hero, sign-in pages). A shape is drawn on a hidden 2D canvas and turned into particle positions.
- Functions: `limbs`
- Exports: `sampleShape`, `spherePoints`, `drawLogo`, `drawAthlete`, `drawFootball`, `drawDumbbell`, `fogShader`, `dotFragment`

### public/js/fx/

**`public/js/fx/cartfx.js`** (307 lines)

- What: WebGL sparks for the fly-to-cart moment (ES module in public/js/fx, built on public/js/3d). store.js flies the product card to the header cart; this layer adds the light around it: trail(x, y, dx, dy, size) volt sparks shed behind the card on every frame of the flight burst(x, y) sparks and an expanding ring where the card lands on the cart puff(x, y) a small grey puff where a card that could not be added fades out One full-screen canvas, one shader, one buffer. It only draws while there are sparks; idle, it shrinks its canvas to one pixel and leaves the shared ticker. store.js loads this file when the page is idle
- Functions: `palette`, `rand`
- Exports: `ParticlePool`, `createCartFx`
- Uses: `../3d/gl.js`, `../3d/interaction.js`

**`public/js/fx/confetti3d.js`** (227 lines)

- What: WebGL confetti for the order-success moment (ES module in public/js/fx, built on public/js/3d). Paper strips in the brand colours fly from two cannons at the bottom corners and pop out of the tick, then flutter down. Each strip spins and flips in 3D: it narrows as it turns edge-on and catches the light as it faces you. One canvas, one shader, one draw call per frame. confetti.js calls window.NxConfetti3d(canvas) and falls back to its 2D confetti when this returns false (low-power device, no WebGL) or is missing. Reduced motion: no confetti at all (confetti.js).
- Functions: `palette`
- Exports: `makePieces`, `stepPieces`, `celebrate`
- Uses: `../3d/gl.js`, `../3d/interaction.js`

### public/js/motion/

**`public/js/motion/ticker.js`** (93 lines)

- What: The one animation loop for the whole site. Every moving thing (WebGL scenes, the footer wave, the showroom, ...) subscribes here instead of running its own requestAnimationFrame loop. const stop = NxTicker.add((time, dt) => { ... }); // time and dt in seconds; dt is capped at 0.05 NxTicker.read(fn) / NxTicker.write(fn) // one-off jobs for the next frame: // all reads run before all writes The loop runs only while something is subscribed (or queued) and the tab is visible. Loaded as a classic script before everything else (window.NxTicker); Node tests require it.
- Exports: `factory`

---

## tests

Automated tests (`npm test`, Node's built-in test runner). Reading a test is the fastest way to learn a rule.

**`tests/account.test.js`** (386 lines)

- What: My Account end-to-end tests: ownership on lists, reviews, tickets and returns; read-only shared lists with no private data; log out of all devices; deleting the account; the audit log. They use their own database (the test database name + "_account"), so they can run alongside api.test.js. Like the other API tests they only run when TEST_MONGODB_URI is set.
- Functions: `call`, `signUp`, `deliveredOrder`
- Uses: `./helpers`, `../app`, `../models/User`, `../models/Product`, `../models/Order`, `../models/Review`, `../models/AuditLog`, `../models/LoginActivity`, `../services/authService`, `../services/categoryService`, `../services/accountService`

**`tests/admin-path.test.js`** (344 lines)

- What: The admin console at a private ADMIN_PATH: hidden from customers and guests, with its own session.
- Functions: `call`, `adminSession`
- Uses: `./helpers`, `../app`, `../models/User`, `../services/authService`, `../models/Product`, `../models/Order`, `../models/AuditLog`, `../models/WalletTransaction`

**`tests/admin-sales.test.js`** (324 lines)

- What: Admin Part 4: orders, returns, the money ledger, refunds and abandoned carts.
- Functions: `call`, `makeOrder`
- Uses: `./helpers`, `../app`, `../models/User`, `../models/Product`, `../models/Order`, `../models/Cart`, `../models/AuditLog`, `../models/WalletTransaction`, `../services/mailService`, `../jobs/worker`, `../jobs/handlers`, `../services/categoryService`, `../services/authService`

**`tests/admin-sections.test.js`** (556 lines)

- What: The trimmed admin console: Analytics, Inventory, the removed Reviews and Q&A sections, Coupons (admin side and the rules the store applies), and System status.
- Functions: `call`, `makeOrder`
- Uses: `./helpers`, `../app`, `../models/User`, `../models/Product`, `../models/Order`, `../models/Coupon`, `../models/CouponRedemption`, `../models/AuditLog`, `../services/categoryService`, `../services/authService`

**`tests/admin-wallet.test.js`** (147 lines)

- What: no header comment; read the file.
- Functions: `database`, `input`
- Uses: `./helpers`, `../models/User`, `../models/Wallet`, `../models/WalletTransaction`, `../services/auditService`, `../services/adminWalletService`, `../utils/money`

**`tests/api.test.js`** (1875 lines)

- What: End-to-end API tests against a real MongoDB test database. They only run when TEST_MONGODB_URI is set, and they refuse any database whose name lacks "test". PowerShell: $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/nexthlon_test"; npm test
- Functions: `categoryId`, `makeProduct`, `call`, `sendForm`, `newCustomer`, `sendWebhook`, `adminCookie`, `emptyCart`, `checkoutSignature`, `balanceOf`
- Uses: `./helpers`, `../app`, `../models/User`, `../models/Product`, `../services/authService`, `../models/Category`, `../services/categoryService`, `../utils/lifecycle`, `../services/imageService`, `../models/Cart`, `../models/ContactMessage`, `../models/NewsletterSubscriber`, `../models/Review`, `../services/migrationService`, `../models/Wishlist`, `../models/Order`, `../models/Address`, `../services/orderService`, `../services/razorpayService`, `../models/Coupon`, `../models/CouponRedemption`, `../models/Wallet`, `../models/WalletTransaction`, `../services/walletService`, `../services/referralService`, `../models/BuyNow`, `../utils/images`

**`tests/cart.test.js`** (91 lines)

- What: no header comment; read the file.
- Uses: `./helpers`, `../services/cartService`, `../utils/validators`

**`tests/cartfx.test.js`** (94 lines)

- What: The WebGL effects in public/js/fx: the fly-to-cart sparks (cartfx.js) and the order-success confetti (confetti3d.js). Their physics run in Node without a browser, and loading the modules without a window must not try to draw anything.
- Functions: `load`, `loadConfetti`

**`tests/catalog.test.js`** (93 lines)

- What: Catalogue rules: money in paise, the best offer, delivery estimates, filters and reviews.
- Uses: `./helpers`, `../utils/money`, `../utils/pricing`, `../services/deliveryService`, `../services/productService`, `../services/reviewService`, `../utils/validators`, `../utils/queryString`

**`tests/checkout-ux.test.js`** (120 lines)

- What: Checkout that converts (C3): arrival dates on the page, the phone pay bar and price sheet markup, and failures that carry a code the page turns into a fix button. Own database ("_checkoutux").
- Functions: `jar`, `call`
- Uses: `./helpers`, `../app`, `../models/Product`, `../services/categoryService`, `../services/settingsService`

**`tests/cloudinary.test.js`** (114 lines)

- What: no header comment; read the file.
- Functions: `fake`
- Uses: `./helpers`, `../providers/storage/cloudinary`, `../config/schema`, `../utils/images`, `../providers/storage`, `../services/imageService`, `../middleware/upload`

**`tests/cod-code.test.js`** (91 lines)

- What: Cash on Delivery confirmation by code (E2). Own database ("_cod_code"); runs only with TEST_MONGODB_URI.
- Functions: `call`
- Uses: `./helpers`, `../app`, `../models/Product`, `../models/Order`, `../models/PhoneCode`, `../services/categoryService`, `../services/settingsService`, `../services/messageService`

**`tests/commerce-database.test.js`** (106 lines)

- What: Real MongoDB checks for the atomic operations used by recovery. Own disposable database only; never points at the store configured in .env.
- Functions: `product`, `order`
- Uses: `./helpers`, `../models/Product`, `../models/Order`, `../models/Wallet`, `../models/WalletTransaction`, `../services/stockService`, `../services/walletService`, `../services/refundService`, `../services/counterService`, `../services/gstService`, `../events`

**`tests/commerce-receipts.test.js`** (57 lines)

- What: no header comment; read the file.
- Uses: `./helpers`, `../models/Wallet`, `../models/WalletTransaction`, `../models/Product`, `../services/walletService`, `../services/stockService`

**`tests/commerce-recovery.test.js`** (242 lines)

- What: Fault-injection tests run the real services with an in-memory order store. The separate database suite verifies MongoDB's atomic receipts and versioning.
- Functions: `fixture`, `copy`
- Uses: `./helpers`, `../models/Order`, `../models/Cart`, `../services/stockService`, `../services/walletService`, `../services/refundService`, `../services/paymentService`, `../services/orderService`, `../services/settlementService`, `../services/gstService`, `../services/razorpayService`, `../events`, `../services/adminOrderService`

**`tests/discovery.test.js`** (181 lines)

- What: Finding products: "frequently bought together" from real orders, search that forgives spelling mistakes, and the short-lived catalogue cache being cleared when a product changes. Own database (the test database name + "_discovery"); runs only when TEST_MONGODB_URI is set.
- Functions: `order`
- Uses: `./helpers`, `../models/Product`, `../models/Order`, `../models/User`, `../services/categoryService`, `../services/productService`, `../services/homeService`, `../services/recommendationService`, `../utils/memo`, `../services/searchInsightService`, `../models/SearchLog`

**`tests/engine.test.js`** (65 lines)

- What: The 3D engine's maths and geometry (public/js/3d). These run in Node without a browser.
- Functions: `load`, `close`

**`tests/fuzzy.test.js`** (32 lines)

- What: Spelling help for search (utils/fuzzy.js).
- Uses: `../utils/fuzzy`

**`tests/gst.test.js`** (245 lines)

- What: GST invoices (B4): the tax split, rounding, coupon sharing, numbering, credit notes and the PDFs. The rules run without a database; the order flow needs TEST_MONGODB_URI (own database "_gst").
- Functions: `jar`, `call`, `order`
- Uses: `./helpers`, `../utils/gst`, `../utils/validators`, `../app`, `../models/Product`, `../models/Order`, `../services/categoryService`, `../services/gstService`, `../config/store`

**`tests/guest-cart.test.js`** (183 lines)

- What: Signed-out visitors and the cart: putting anything in a cart (and Buy now) needs a signed-in account, so a guest's add, change or remove is refused with 401 and makes no cookie; the cart page sends them to sign in and back. Carts that guests filled before this rule (kept by an httpOnly cookie, stored only as a hash) still move into the account at sign-up or sign-in, within the usual limits. Own database (the test database name + "_guestcart"); runs only when TEST_MONGODB_URI is set.
- Functions: `jar`, `call`, `legacyGuestCart`
- Uses: `./helpers`, `../app`, `../models/Product`, `../models/GuestCart`, `../models/Cart`, `../models/User`, `../services/categoryService`, `../middleware/guestCart`

**`tests/helpers.js`** (19 lines)

- What: Safe settings for tests, set before any project file reads them.

**`tests/hub.test.js`** (47 lines)

- What: Complete-the-kit bundles (E6), the content hub (E7) and marketplace listings (E8). Pure rules always run; the database tests use "_hub" and need TEST_MONGODB_URI.
- Uses: `./helpers`, `../services/marketplaceService`, `../services/bundleService`, `../services/guideService`

**`tests/images-migration.test.js`** (202 lines)

- What: "npm run images:migrate": gives older photos their small copies and moves photos to Cloudinary, rewriting every address saved in the database. Needs the test database, like the API tests.
- Functions: `fakeCloudinary`, `setUp`, `image`, `one`
- Uses: `./helpers`, `../models/Product`, `../models/Category`, `../models/Order`, `../providers/storage`, `../providers/storage/local`, `../services/imageMigrationService`

**`tests/jobs.test.js`** (196 lines)

- What: no header comment; read the file.
- Uses: `./helpers`, `../models/Job`, `../jobs/queue`, `../jobs/registry`, `../events`, `../jobs/worker`, `../providers/mail/brevo`, `../providers/mail/smtp`

**`tests/memo.test.js`** (44 lines)

- What: The short-lived catalogue cache (utils/memo.js).
- Uses: `../utils/memo`

**`tests/meta-pixel.test.js`** (28 lines)

- What: Meta Pixel: only a numeric id, loaded only after consent, and its hosts only when set.
- Uses: `./helpers`, `../utils/analytics`

**`tests/micro-interactions.test.js`** (44 lines)

- What: Shopping micro-interactions (C2): the "just saved" address tick, and reduced motion covering every animation. No database needed.
- Functions: `read`
- Uses: `./helpers`

**`tests/motion.test.js`** (82 lines)

- What: The shared animation ticker (public/js/motion/ticker.js), driven by a fake requestAnimationFrame.
- Functions: `fakeEnv`
- Uses: `../public/js/motion/ticker.js`

**`tests/ops.test.js`** (318 lines)

- What: Production-readiness: start-up checks for the environment, request IDs and logging. These need no database.
- Functions: `fakeReq`, `fakeRes`, `capture`, `errorCall`, `run`
- Uses: `./helpers`, `../config/schema`, `../utils/requestContext`, `../utils/logger`, `../middleware/requestId`, `../config/env`, `../middleware/errorHandler`, `../utils/http`, `./config/env`, `./app`

**`tests/options.test.js`** (307 lines)

- What: Sizes and colours (B3): each option has its own stock, the product's stock is their sum, a size must be chosen to buy, two sizes are two cart lines, and orders, cancels and Buy now take and give back stock on the chosen size only, atomically. Own database (the test database name + "_options"); runs only when TEST_MONGODB_URI is set.
- Functions: `jar`, `call`, `size`, `fresh`
- Uses: `./helpers`, `../utils/validators`, `../utils/options`, `../services/productService`, `../services/adminProductService`, `../app`, `../models/Product`, `../models/Order`, `../services/categoryService`, `../services/stockService`, `../services/inventoryService`

**`tests/order-emails.test.js`** (284 lines)

- What: no header comment; read the file.
- Functions: `makeOrder`, `orderMail_placedViaEvents`, `drain`, `subjects`, `send`
- Uses: `./helpers`, `../models/User`, `../models/Order`, `../models/Job`, `../models/EmailLog`, `../services/mailService`, `../services/orderService`, `../services/adminOrderService`, `../services/refundService`, `../services/orderMailService`, `../jobs/worker`, `../jobs/handlers`, `../events`

**`tests/orders.test.js`** (67 lines)

- What: Order rules: status flow, cancelling, returns and how much money goes back.
- Functions: `item`
- Uses: `./helpers`, `../utils/orderRules`, `../utils/validators`

**`tests/page-transitions.test.js`** (54 lines)

- What: Page transitions (C1): wired the way the browser needs them, and all of it stays behind "reduce motion". No database needed.
- Functions: `noPreferenceBlockWith`, `read`
- Uses: `./helpers`

**`tests/payments.test.js`** (32 lines)

- What: Payment signature checks. HMAC-SHA256 with the secret, compared in constant time.
- Functions: `sign`
- Uses: `./helpers`, `../services/razorpayService`

**`tests/pincode.test.js`** (48 lines)

- What: no header comment; read the file.
- Functions: `reply`
- Uses: `./helpers`, `../services/pincodeService`

**`tests/prepaid.test.js`** (145 lines)

- What: Discount for paying online (E2): how much, when it applies, and how it flows into the order, GST and refunds. The sums run always; the order tests have their own database ("_prepaid") and run only when TEST_MONGODB_URI is set. Razorpay is a fake: nothing is sent.
- Functions: `call`, `shopper`
- Uses: `./helpers`, `../utils/pricing`, `../utils/orderRules`, `../utils/validators`, `../app`, `../models/Product`, `../models/Order`, `../services/categoryService`, `../services/settingsService`, `../services/razorpayService`

**`tests/privacy.test.js`** (142 lines)

- What: Privacy (D2): consent before analytics, analytics only from the hosts it needs, shopping events without personal data, and "Download my data". The export test has its own database ("_privacy") and runs only when TEST_MONGODB_URI is set.
- Functions: `call`, `read`
- Uses: `./helpers`, `../utils/analytics`, `../utils/analyticsEvents`, `../app`, `../models/User`, `../models/Order`, `../models/AuditLog`

**`tests/product.test.js`** (128 lines)

- What: no header comment; read the file.
- Uses: `./helpers`, `../utils/validators`, `../utils/slug`, `../services/imageService`, `../services/adminProductService`, `../utils/pricing`

**`tests/push.test.js`** (87 lines)

- What: Push notifications (E5). The push service is a fake: nothing leaves the machine. Own database ("_push").
- Uses: `./helpers`, `../app`, `../models/User`, `../models/Order`, `../models/PushSubscription`, `../services/pushService`

**`tests/pwa.test.js`** (64 lines)

- What: The installable app (E5): a valid manifest with real icons, a service worker that never stores private or live data, and an offline page that stands alone. No database needed.
- Functions: `read`
- Uses: `./helpers`

**`tests/questions.test.js`** (118 lines)

- What: Review photos and product Q&A (E3). Own database ("_questions"); runs only with TEST_MONGODB_URI.
- Functions: `call`, `customer`
- Uses: `./helpers`, `../app`, `../models/Product`, `../models/Order`, `../models/User`, `../models/Question`, `../models/Job`, `../services/categoryService`, `../services/questionService`

**`tests/recovery.test.js`** (406 lines)

- What: Forgot password and email confirmation, end to end against a real MongoDB test database. They only run when TEST_MONGODB_URI is set, and refuse any database whose name lacks "test".
- Functions: `call`, `makeUser`, `cookieOf`, `login`, `adminLogin`, `tokenIn`, `lastMail`
- Uses: `./helpers`, `../app`, `../config/env`, `../models/User`, `../models/AuthToken`, `../models/RefreshToken`, `../models/AuditLog`, `../services/mailService`, `../services/authTokenService`, `../services/passwordResetService`, `../services/authService`, `../utils/background`, `../utils/emailLayout`, `../utils/publicUser`

**`tests/refresh.test.js`** (552 lines)

- What: Access token + refresh token, end to end against a real MongoDB test database. They only run when TEST_MONGODB_URI is set, and refuse any database whose name lacks "test". PowerShell: $env:TEST_MONGODB_URI="mongodb://127.0.0.1:27017/nexthlon_test"; npm test
- Functions: `newJar`, `readCookies`, `cookieHeader`, `call`, `signIn`, `renew`, `refreshValue`, `tokenRow`, `ageRotation`
- Uses: `./helpers`, `../app`, `../models/User`, `../models/RefreshToken`, `../models/AuditLog`, `../services/authService`, `../services/refreshTokenService`

**`tests/scaling.test.js`** (173 lines)

- What: Scaling out (docs/SCALING.md): CDN caching only for signed-out visitors, the shared rate-limit store, cache clearing across copies, the order-rush limit, and the new settings checks. The API part uses its own database (the test database name + "_scaling") and runs only when TEST_MONGODB_URI is set; the rest needs no database.
- Functions: `fakeRedis`, `get`
- Uses: `./helpers`, `../config/schema`, `../middleware/rateLimitStore`, `../services/cacheSync`, `../utils/memo`, `../app`, `../models/Product`, `../services/categoryService`, `../middleware/rateLimit`

**`tests/search-upgrade.test.js`** (59 lines)

- What: Search upgrade (E4): synonyms, and as-you-type suggestions. The synonym rules run always; the suggestion endpoint test needs TEST_MONGODB_URI (own database "_search").
- Uses: `./helpers`, `../utils/synonyms`, `../app`, `../models/Product`, `../services/categoryService`

**`tests/security.test.js`** (172 lines)

- What: Security review (D3): the protections added before going live. Own database ("_security"); runs only when TEST_MONGODB_URI is set (the settings rule runs always).
- Functions: `jar`, `call`, `signUp`, `balanceOf`
- Uses: `./helpers`, `../app`, `../models/Product`, `../models/Order`, `../models/User`, `../models/Wallet`, `../services/categoryService`, `../services/settingsService`, `../services/orderService`, `../services/checkoutService`, `../scripts/backup`

**`tests/seo.test.js`** (161 lines)

- What: Search engines and link previews (D1): sitemap, robots.txt, canonical addresses, noindex on private pages, link-preview tags and Google's product data. Rules first; pages need TEST_MONGODB_URI ("_seo").
- Functions: `get`, `ldBlocks`, `meta`, `canonicalOf`
- Uses: `./helpers`, `../utils/seo`, `../app`, `../models/Product`, `../services/categoryService`, `../utils/memo`

**`tests/server.test.js`** (95 lines)

- What: The real server process: it starts, answers health checks, logs each request with its ID, and shuts down cleanly when asked (what a deploy does). Needs the test database, like the API tests.
- Functions: `freePort`
- Uses: `./helpers`, `./server`

**`tests/shipping.test.js`** (286 lines)

- What: Shipping (B5): Shiprocket booking, PIN code checks, the tracking webhook and refused parcels (RTO). Shiprocket is replaced by a fake, so nothing is ever sent to it. The database tests have their own database ("_shipping") and run only when TEST_MONGODB_URI is set.
- Functions: `fakeShiprocket`, `makeOrder`, `hook`
- Uses: `./helpers`, `../services/shipping/shiprocket`, `../services/shippingService`, `../config/schema`, `../app`, `../models/Product`, `../models/Order`, `../models/User`, `../models/Wallet`, `../services/categoryService`

**`tests/stock-alerts.test.js`** (127 lines)

- What: Back-in-stock alerts (E3): who may ask, one email per restock, and the signed "stop" link. Own database ("_stock_alerts"); runs only when TEST_MONGODB_URI is set (the signature test runs always).
- Functions: `post`
- Uses: `./helpers`, `../services/stockAlertService`, `../app`, `../models/Product`, `../models/StockAlert`, `../models/Job`, `../services/categoryService`, `../services/mailService`

**`tests/storage.test.js`** (281 lines)

- What: Photo storage: the local provider and the image pipeline that makes the small copies, and the rules that turn a stored address into a srcset. No database needed.
- Functions: `tempDir`, `exists`, `photo`
- Uses: `./helpers`, `../providers/storage`, `../providers/storage/local`, `../utils/images`, `../services/imageService`, `../config/schema`

**`tests/storefront.test.js`** (124 lines)

- What: Rules behind the redesigned storefront: deal timer, hero slides, id lists, contact and newsletter checks.
- Uses: `./helpers`, `../services/homeService`, `../utils/validators`, `../config/store`

**`tests/tokens.test.js`** (126 lines)

- What: Design tokens: colours, text sizes, durations and layers come only from public/css/tokens.css. Every other stylesheet uses var(--token). A translucent colour is written rgba(var(--white-rgb), 0.5): the colour is a token, the opacity is the only number. These tests fail on any new one-off value.
- Functions: `declarations`, `report`

**`tests/unit.test.js`** (289 lines)

- What: no header comment; read the file.
- Functions: `runOriginCheck`, `fakeRequest`
- Uses: `./helpers`, `../utils/validators`, `../services/tokenService`, `../middleware/originCheck`, `../utils/http`, `../services/productService`, `../services/refreshTokenService`, `../utils/queryString`, `../services/auditService`, `../services/accountService`, `../services/dashboardService`, `../utils/csv`, `../services/mailService`

**`tests/upload-fields.test.js`** (26 lines)

- What: The admin product form sends about 21 text fields with its photos. The upload must accept that form.
- Uses: `./helpers`, `../middleware/upload`

**`tests/wallet.test.js`** (130 lines)

- What: Phase 6 rules that need no database: coupon maths, order totals with the wallet, what a cancellation settles, referral codes and the logger.
- Functions: `line`
- Uses: `./helpers`, `../utils/pricing`, `../utils/orderRules`, `../services/refundService`, `../services/referralService`, `../services/couponService`, `../utils/logger`, `../utils/validators`, `../services/settingsService`

**`tests/whatsapp.test.js`** (85 lines)

- What: WhatsApp order updates (E1): only to customers who said yes, only to real Indian mobiles, once each, and the Cloud API request is shaped as Meta expects. Own database ("_whatsapp") for the order tests.
- Functions: `orderFor`
- Uses: `./helpers`, `../services/messageService`, `../providers/messaging/whatsapp`, `../models/Order`, `../models/User`
