# Nexthlon

A sports gear store: Express, EJS, MongoDB, JWT and Razorpay, with plain CSS and vanilla JavaScript (no frontend libraries).

## Admin console

The admin console lives at a private address set by `ADMIN_PATH` in `.env` (for example `/nx-console-7f3k`; it falls back to `/admin` if empty).

- Sign in at `<ADMIN_PATH>/login`. Pages: `<ADMIN_PATH>/dashboard`, `/customers`, `/products`, `/tickets`, `/settings`. Sections still being built show a short "coming soon" notice.
- The console has a grouped sidebar (collapsible, remembered per browser), a top bar with global search (orders, products, customers), a Ctrl+K command palette (`/` focuses search), a notification bell and the theme switch.
- Sections switch without a page reload (`public/js/section-nav.js`, shared with My Account): with the `X-Partial: 1` header the server sends only the section content.
- Admin APIs are under `/api/admin/*`.
- Customers never see a link to the console. Any admin page opened by a guest or a customer is an ordinary 404, and so is `/admin` when another path is set.
- Admins have their own session: the `nx_admin` access cookie (JWT audience `nexthlon-admin`, 15 minutes) renewed by the `nx_admin_refresh` cookie (1 day). Both are HttpOnly and SameSite=Strict. The store uses `nx_token` and `nx_refresh`, and neither pair works in the other area.
- Admin pages send `noindex, nofollow`, and `robots.txt` never mentions the console.

### Admin dashboard

`<ADMIN_PATH>/dashboard` has a date range picker (Today, 7 days, 30 days, This month, This year, Custom; India time) that updates everything. It shows:

- 8 KPIs, each with the % change against the period before and a sparkline.
- Hand-drawn SVG charts: revenue and orders over time, orders by status, payment methods, new vs returning customers, sales by category, top 10 products (by revenue or units), top cities and states, and an hourly heatmap. Each chart has a hover and keyboard tooltip and a data-table alternative.
- Panels: recent orders, what needs attention, quick restock, recent customers, latest reviews, and stock health.
- "Export sales" downloads a CSV of the range's orders (`/api/admin/reports/sales.csv`, with spreadsheet formulas neutralised).

### Sales: orders, returns, money

- `<ADMIN_PATH>/orders` lists orders with status tabs, filters (method, payment, dates, amount, city), search (order number, name, email, phone), sorting, show/hide columns, bulk status changes and CSV/Excel export.
- `<ADMIN_PATH>/orders/:orderId` shows one order. Status only moves forward. You can also cancel items, add a shipment, write internal notes, issue a manual refund (never more than was paid), and download the invoice and packing slip PDFs.
- `<ADMIN_PATH>/returns` lists return requests. Approving restocks the items and refunds them (wallet or original payment); rejecting sends your note to the customer.
- `<ADMIN_PATH>/transactions` is the money ledger:
  - It is built live from the orders and the wallet: online payments, cash on delivery, wallet payments, refunds, coupons and wallet credits.
  - It shows money in, money out and net totals, a detail page for each entry, and CSV/Excel export.
  - `/transactions/reconciliation` compares orders marked paid with the Razorpay payments recorded, day by day, and lists mismatches.
- `<ADMIN_PATH>/refunds` lists refunds as pending, processed or failed.
- `<ADMIN_PATH>/abandoned-carts` lists carts idle for 24 hours or more, with a reminder email (at most one a day, and only to customers who accept offer emails) and the recovery rate.
- Emails use nodemailer with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Without SMTP they are printed to the console in development; in production sending fails with a clear message.
- Every admin change is written to the audit log. Refunds, return decisions and reminders are rate limited.

## Login: access token + refresh token

Two tokens, each with one job.

- **Access token** — a JWT, 15 minutes, in the `nx_token` cookie (`nx_admin` for the console). It is
  sent on every request and proves who you are. It is stateless, so it cannot be withdrawn once
  issued; that is exactly why it is short.
- **Refresh token** — 32 random bytes, 7 days for customers and 1 day for admins, in the
  `nx_refresh` cookie (`nx_admin_refresh`). Its cookie path is `/api/auth/refresh`, so the browser
  sends it nowhere else. Only its SHA-256 hash is stored (`models/RefreshToken.js`), which means it
  **can** be revoked at any time.
- A third cookie, `nx_sid`, holds the session's family id. It is a label, not a key: it only lets
  the account page say which row in "Logged-in devices" is this browser.

`POST /api/auth/refresh` renews the session and **rotates**: the token sent in is revoked and a new
one from the same family takes its place, so each token works exactly once. If an already-used
token comes back, two copies exist, so the whole family is revoked at once — stolen-token
detection (`services/refreshTokenService.js`).

In the browser, `Nx.api` (`public/js/app.js`) sees a 401, calls the renewal once, and sends the
same request again; only if that fails does the visitor go to sign in.

Every refresh token is revoked when the password changes, when an admin blocks the customer, on
"Log out of all devices", and when the account is deleted. Signing out revokes just that device.
`tokenVersion` on the user is kept as well, so old access tokens die at the same moment.

## Environment variables

Names only; copy `.env.example` to `.env` and fill them in:
`NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`, `ADMIN_REFRESH_TOKEN_EXPIRES_IN`, `ADMIN_PATH`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `LOG_LEVEL`.
