# Nexthlon

A sports gear store: Express, EJS, MongoDB, JWT and Razorpay, with plain CSS and vanilla JavaScript (no frontend libraries).

## Admin console

The admin console lives at a private address set by `ADMIN_PATH` in `.env` (for example `/nx-console-7f3k`; it falls back to `/admin` if empty).

- Sign in at `<ADMIN_PATH>/login`. Every section in the sidebar is built; there are no placeholder pages.
- The console has a grouped sidebar (collapsible, remembered per browser), a top bar with global search (orders, products, customers), a Ctrl+K command palette (`/` focuses search), a notification bell and the theme switch.
- Sections switch without a page reload (`public/js/section-nav.js`, shared with My Account): with the `X-Partial: 1` header the server sends only the section content.
- Admin APIs are under `/api/admin/*`.
- Customers never see a link to the console. Any admin page opened by a guest or a customer is an ordinary 404, and so is `/admin` when another path is set.
- Admins have their own session: the `nx_admin` access cookie (JWT audience `nexthlon-admin`, 15 minutes) renewed by the `nx_admin_refresh` cookie (1 day). Both are HttpOnly and SameSite=Strict. The store uses `nx_token` and `nx_refresh`, and neither pair works in the other area.
- Admin pages send `noindex, nofollow`, and `robots.txt` never mentions the console.

### The sections

The sidebar is the whole console: there are no placeholder pages, so any other admin URL is an
ordinary 404.

**Overview**

- **Dashboard** — a date range (Today, 7 days, 30 days, This month, This year, Custom; India time),
  8 KPIs with the change against the period before, hand-drawn SVG charts, recent orders, what
  needs attention, quick restock and stock health.
- **Analytics** — revenue and orders over time with a grouping you choose (day, week or month),
  top-selling products by revenue and by units, top categories, average order value, new vs
  returning customers, the payment split (Razorpay / wallet / COD) and conversion from carts to
  orders. Every chart has a table under it, and "Export CSV" downloads the lot.

**Sales**

- **Orders** — status tabs, filters, search, sorting, bulk status changes, CSV/Excel export, and a
  page per order (status, cancellations, shipments, notes, manual refunds, invoice and packing slip).
- **Returns** — return requests, with approve (restock and refund) or reject with your note.
- **Transactions** — every Razorpay and wallet movement: status, amount, payment id, a link to the
  order, search, filters and a CSV/Excel export, plus a daily reconciliation.
- **Refunds** — refunds to the wallet or back to the card/UPI, with status, amount and the order.
- **Abandoned carts** — carts untouched for 24 hours or more: customer, items, value, last
  activity, filter by age, sort by value, and a reminder email.
- **Coupons** — see below.

**Catalog**

- **Products** — add, edit, photos (up to 4, checked by their real bytes), list/unlist, stock.
- **Inventory** — the stock view: bands (out, low, well stocked, unlisted), filters, sorting, the
  stock value of the shelf, a correction per row (add, remove, or set the counted number) and a CSV.

**Customers**

- **Customers** — search and filter, block and unblock (a blocked customer is signed out at once
  and cannot renew their session).

**System**

- **Settings** — the referral reward, plus the delivery, returns and checkout rules the store runs on.
- **System status** — whether the database answers and how fast, uptime and memory, how much data
  there is, what is switched on (Razorpay, SMTP, secure cookies, production mode) and the session
  lifetimes. Read-only, and it never prints a key.

### Coupons

`<ADMIN_PATH>/coupons` lists every coupon with its code, type (percent or flat ₹), value, minimum
order, cap, start and expiry dates, both usage limits, how many times it has been used and one word
for its status: running now, starts later, expired, fully used or disabled. You can search, filter
by status and sort.

Creating and editing use one form, and everything on it is checked again on the server
(`utils/validators.js` → `validateCoupon`): the code is 3–20 capitals and must be unique, a percent
is 1–90, a cap only applies to a percent coupon, an expiry must be after the start, and a flat
discount cannot be larger than its own minimum order. A coupon can be disabled (reversible) or
deleted — a soft delete, so the code can never be used again while the orders that used it keep
their history. The detail page shows who used it, on which order, the discount each time and the
total given. Every create, edit, enable, disable and delete is written to the audit log.

On the store side nothing changed, because the rules were always applied on the server: a code is
judged when the customer applies it, again whenever the totals are worked out, and once more as the
order is saved (`services/couponService.js` with `utils/pricing.js` → `couponProblem`). Checkout also
lists the coupons that customer could use. The total-uses count is claimed with one atomic update,
so a limit can never be exceeded, and a cancelled or unpaid order releases the use again.

### Removed from the console

Categories, brands, segments, offers, flash sales, email campaigns, gift cards, loyalty, the home
page CMS, banners, the sales report, exports, delivery zones, admin roles, the audit-log viewer and
the support-ticket screen were taken out of the admin UI, along with `views/admin/soon.ejs` and the
"Soon" badge. The store side is untouched: categories and coupons work exactly as before, and
customers can still raise support tickets from My Account (the `/api/admin/tickets` API is still
there to answer them).

Reviews and Questions & answers were also removed from the console. Q&A is gone from the store
too: the product page has no Q&A section and the `/api/products/:id/questions` and
`/api/questions/*` APIs no longer exist. Product reviews stay on the store exactly as before: only
customers whose order was delivered can review, once per product, and they can edit or delete their
own review from My Account → Reviews. There is no admin screen to hide or delete reviews.

### Admin dashboard

`<ADMIN_PATH>/dashboard` has a date range picker (Today, 7 days, 30 days, This month, This year, Custom; India time) that updates everything. It shows:

- 8 KPIs, each with the % change against the period before and a sparkline.
- Hand-drawn SVG charts: revenue and orders over time, orders by status, payment methods, new vs returning customers, sales by category, top 10 products (by revenue or units), top cities and states, and an hourly heatmap. Each chart has a hover and keyboard tooltip and a data-table alternative.
- Panels: recent orders, what needs attention, quick restock, recent customers and stock health.
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
- Emails go through a provider chosen by `MAIL_DRIVER`: `smtp` (nodemailer) or `brevo` (HTTPS API, `BREVO_API_KEY`). Order emails (confirmed, shipped with tracking, out for delivery, delivered, cancelled, refunded, returns) are sent by background jobs: events saved in MongoDB, retried with growing waits, sent exactly once (`EmailLog`). Run `npm run emails:preview` to see them, `npm run jobs:status` / `jobs:retry` to inspect the queue, `npm run worker` for a stand-alone worker (`JOBS_ENABLED=false` on the web copies). SMTP uses `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. Without SMTP they are printed to the console in development; in production sending fails with a clear message.
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

**Two tabs, one renewal.** Several tabs (or a phone waking up) often renew at the same instant. The
claim on the old token is atomic, so exactly one renewal wins and issues the new token. A slower request
arriving with the just-replaced token within 20 seconds (`REUSE_GRACE_MS`) is the same browser, not a
thief: it gets a fresh access token only, never a new refresh token, and nothing is revoked. Replayed
after the 20 seconds, or after a sign-out, a block or a password change, it still revokes the whole
family.

**CSRF.** Any request that changes data must carry this site's `Origin` (or `Referer`). One with neither
is refused whenever it carries any session cookie (store or admin console, access or refresh); API
tools with no cookie, or with a `Bearer` token, are not affected (`middleware/originCheck.js`).

In the browser, `Nx.api` (`public/js/app.js`) sees a 401, calls the renewal once, and sends the
same request again; only if that fails does the visitor go to sign in.

Every refresh token is revoked when the password changes, when an admin blocks the customer, on
"Log out of all devices", and when the account is deleted. Signing out revokes just that device.
`tokenVersion` on the user is kept as well, so old access tokens die at the same moment.

## Environment variables

Names only; copy `.env.example` to `.env` and fill them in:
`NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN`, `ADMIN_REFRESH_TOKEN_EXPIRES_IN`, `ADMIN_PATH`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `MAIL_DRIVER`, `BREVO_API_KEY`, `JOBS_ENABLED`, `JOBS_CONCURRENCY`, `CART_RECOVERY_AUTO`, `SITE_URL`, `TRUST_PROXY`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `APP_RELEASE`, `MONGODB_MAX_POOL`, `STORAGE_DRIVER`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `LOG_LEVEL`, `LOG_FORMAT`.

Every variable is checked when the server starts (`config/schema.js`). A bad or missing value stops
the server with **all** the problems listed at once; settings that work but look wrong for production
(the default `/admin` path, no email, Razorpay test keys, no error alerts) are printed as warnings.

## Deploying

The app is one Node process plus MongoDB. It needs **Node 20.19 or newer** and a MongoDB database
(MongoDB Atlas is the easy choice; use its `mongodb+srv://` connection string).

### Settings for production

Set these as environment variables on the host (never commit a `.env`):

| Variable                          | Value                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`                        | `production`                                                                                   |
| `MONGODB_URI`                     | your Atlas connection string                                                                   |
| `JWT_SECRET`                      | 32+ random characters (see `.env.example`)                                                     |
| `SITE_URL`                        | `https://www.your-domain.in`                                                                   |
| `ADMIN_PATH`                      | a private path such as `/nx-console-7f3k`                                                      |
| `TRUST_PROXY`                     | number of proxies in front of the app: `1` on a hosting platform, `2` with Cloudflare in front |
| `STORAGE_DRIVER` + `CLOUDINARY_*` | `cloudinary`, so uploaded photos survive deploys                                               |
| `RAZORPAY_*`, `SMTP_*`            | your live payment keys and email service                                                       |
| `SENTRY_DSN`                      | optional, switches on error alerts                                                             |

`TRUST_PROXY` matters. Behind a host's load balancer, the app sees the **balancer's** address unless it
is told how many proxies to trust, so every visitor would share one rate limit. Set it to the real number.

### Docker

```bash
docker build -t nexthlon .
docker run --rm -p 3000:3000 --env-file .env nexthlon
```

The image runs as a normal user, holds no secrets, and has a health check. With `STORAGE_DRIVER=cloudinary` photos go
to Cloudinary and the container needs no volume. With the default `local` they are written to
`/app/public/uploads`: mount a volume there, or they disappear on every deploy.

### Health checks

| URL        | Meaning                                              | Use it for                         |
| ---------- | ---------------------------------------------------- | ---------------------------------- |
| `/healthz` | the process is alive (never touches the database)    | restart checks, `docker ps`        |
| `/readyz`  | MongoDB answers, and the server is not shutting down | load balancers and uptime monitors |

### Logs, request IDs and alerts

- Every request gets an ID, sent back as `X-Request-Id`. It appears in every log line (`req=...`), in
  error alerts, and as the **Reference** on the error page, so a customer's problem can be found.
- `LOG_FORMAT=json` writes one JSON object per line for log tools; `LOG_LEVEL` sets how much.
- Each request writes one `http.request` line (method, path, status, time). Query strings are never
  logged, because they can hold tokens.
- With `SENTRY_DSN` set, server errors are sent to Sentry with the request ID. Cookies, headers, request
  bodies and visitors' details are removed first.

### Stopping and restarting

On `SIGTERM` (every deploy) the server stops taking new visitors, `/readyz` answers 503 so the load
balancer moves traffic away, requests in progress finish, the database closes, and it exits. If that takes
longer than 10 seconds it exits anyway.

### Tests and CI

`npm test` runs the unit tests. Set `TEST_MONGODB_URI` (a database whose name contains `test`) to run the
database tests too. GitHub Actions (`.github/workflows/test.yml`) runs all of them on Node 22 and 24, builds
the Docker image, and audits the dependencies on every push and pull request.

### Database and photos

**Step by step, with every setting: [docs/HOSTING-SETUP.md](docs/HOSTING-SETUP.md)** (MongoDB Atlas and Cloudinary).

- `npm run db:check` connects with `MONGODB_URI`, tests that the user can read **and** write, lists what is in the
  database, and explains what to fix when it fails. It never prints the address or the password.
- Every product photo is saved as a full WebP (up to 2000px) plus 200, 400, 800 and 1600px copies, under random
  names, through a storage provider (`providers/storage`): the server's disk, or Cloudinary. Pages
  load the smallest sharp copy (`srcset`); the full one is for zoom. The files are uploaded with a one-year
  `immutable` cache header, because a photo's address never changes.
- `npm run images:migrate` (add `-- --dry-run` to preview) gives photos uploaded before this existed their small
  copies, and moves photos from the server's disk to Cloudinary after you switch `STORAGE_DRIVER` to `cloudinary`. It
  rewrites the addresses in products, categories, orders and return photos, and leaves the old files in place.

## Forgotten passwords and email confirmation

**Forgot password** (`/forgot-password`). A one-time link by email, valid 30 minutes, newest link only
(`models/AuthToken.js` keeps only a hash). The reply is identical for every address and does not wait for the
email, so nobody can find out who has an account; at most 3 emails per account per hour and 5 requests per
visitor address per 15 minutes. Choosing a new password signs out every device, confirms the email address
(the link proved the inbox), and emails the owner a notice. Admin passwords are not reset on the public site:
use `npm run seed:admin` with the new password in `.env`.

**Confirm your email.** Sign-up and an email change send a link (48 hours). Opening the page confirms nothing:
a button does, so mail scanners that open links cannot confirm for you. Nothing is blocked until it is
confirmed; My Account and checkout show a reminder with "Send it again" (4 emails per hour).

Emails are built in `utils/emailLayout.js` (a table layout with a plain-text twin) and sent in the background.
In development without SMTP they are printed to the console, so you can copy the link from there.
