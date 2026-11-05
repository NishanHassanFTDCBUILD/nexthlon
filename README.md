# Nexthlon

A sports gear store: Express, EJS, MongoDB, JWT and Razorpay, with plain CSS and vanilla JavaScript (no frontend libraries).

## Admin console

The admin console lives at a private address set by `ADMIN_PATH` in `.env` (for example `/nx-console-7f3k`; it falls back to `/admin` if empty).

- Sign in at `<ADMIN_PATH>/login`. Pages: `<ADMIN_PATH>/dashboard`, `/customers`, `/products`, `/tickets`, `/settings`. Sections still being built show a short "coming soon" notice.
- The console has a grouped sidebar (collapsible, remembered per browser), a top bar with global search (orders, products, customers), a Ctrl+K command palette (`/` focuses search), a notification bell and the theme switch.
- Sections switch without a page reload (`public/js/section-nav.js`, shared with My Account): with the `X-Partial: 1` header the server sends only the section content.
- Admin APIs are under `/api/admin/*`.
- Customers never see a link to the console. Any admin page opened by a guest or a customer is an ordinary 404, and so is `/admin` when another path is set.
- Admins have their own session: the `nx_admin` cookie (JWT audience `nexthlon-admin`, 8 hours, HttpOnly, SameSite=Strict). The store uses `nx_token`, and neither cookie works in the other area.
- Admin pages send `noindex, nofollow`, and `robots.txt` never mentions the console.

## Environment variables

Names only; copy `.env.example` to `.env` and fill them in:
`NODE_ENV`, `PORT`, `MONGODB_URI`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_PATH`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `LOG_LEVEL`.
