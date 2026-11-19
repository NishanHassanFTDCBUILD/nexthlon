# Nexthlon Admin: the complete plan (marketplace-grade console)

Scope update (2026-11-19): the user removed the Columns chooser and Row height
controls. Omit B4 and B9 from implementation; keep every column visible and use
the standard row height. Sorting and filtering remain in scope.

Goal: an admin panel at the level of a big marketplace's seller console. Every list is fast and
filterable, every record has a full page and a history, bulk work takes one click, staff have
roles, and every number can be exported. Built on the stack we already have (Express, EJS,
MongoDB, vanilla JS, Obsidian & Volt tokens). No rewrite: we grow the modular monolith.

Legend: **Have** = already built · **Fix** = built but needs work · **New** = to build.
Size: S = under an hour of work, M = a few hours, L = a day or more.

---

## Progress (updated 2026-11-19)

- Step 1 (filter panel and chips): done on Orders and the shared toolbar pages (commit 4759e56, d90765c).
- Step 2 (list engine, shared toolbar, sortable headers): done in utils/listQuery.js and partials (4759e56).
- Step 3 (Inventory): filters, stock table and CSV import done (4759e56). Stock history, reasons and bulk restock still to do.
- Step 4 (roles, staff, history): done in 3aa553e. Roles in utils/permissions.js; staff at Settings > Staff; audit at System > Audit log; per-record history via ?target=. Not done: invite by email (staff get a temporary password shown once), two-step sign-in.
- Audit gaps: product create/edit/unlist and customer block are now logged (856abf1).
- Step 5: done. Product CSV export and import with preview (commit d998f6b); order late flag, pick list, cash-on-delivery risk score, order labels, batch print of packing sheets (print from the browser, or save as PDF).
- Inventory reorder levels and days of cover: done (8b55507).
- Suppliers and purchase orders: not started.
- Step 6: done (commit 4ead86c).
- Step 7: done (webhook log with re-run for payment events, job queue monitor with retry, GST report CSV).
- Steps 8 to 9: not started.

## Part A · Architecture (the foundation everything else stands on)

| #   | What                                                                                                                                                                                                                                                                                                                                                 | Status                         | Size |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ---- |
| A1  | **Admin modules.** Each section is one folder-like unit: route → controller → service → view → script → test, registered in one list (`config/adminNav.js` grows into `config/adminModules.js`: key, label, icon, group, permission). Adding a section = adding one entry.                                                                           | New                            | M    |
| A2  | **One list-query engine** (`utils/listQuery.js`): reads `q`, filters, `sort`, `page`, `limit` from the URL against a per-list schema; builds the Mongo filter, sort and paging; returns `{rows, filters, chips, pagination, sorts}`. Every admin list uses it, so filters, chips, sorting and paging behave the same everywhere and are tested once. | New                            | L    |
| A3  | **UI kit partials**: page header, toolbar, filter panel, filter chips, data table (sortable headers, column chooser, row select, bulk bar), side drawer, modal, empty state, skeleton, stat strip, pager. Pages stop hand-writing markup.                                                                                                            | Fix (pieces exist)             | L    |
| A4  | **Roles and permissions (RBAC).** Roles: Owner, Manager, Catalogue, Orders/Packing, Support, Finance (read-only money). Permission keys per action (`orders.refund`, `products.edit` …). One middleware `can('orders.refund')` on every admin API; the sidebar and buttons hide what a role cannot do.                                               | New                            | L    |
| A5  | **Staff accounts**: invite by email, set role, deactivate, see last sign-in; admin 2-step sign-in (email or app code); list and end sessions.                                                                                                                                                                                                        | New                            | L    |
| A6  | **Audit everywhere + activity feed.** Every write already goes to the audit log for most sections; finish the gaps, add `before/after` diffs, and a per-record "History" tab.                                                                                                                                                                        | Fix                            | M    |
| A7  | **Domain events and jobs** for slow work (exports, imports, emails, label printing) with progress shown in a "Tasks" tray.                                                                                                                                                                                                                           | Have (events, jobs) → Fix (UI) | M    |
| A8  | **Validation schemas** per module (one place per form), shared by the API and the form hints.                                                                                                                                                                                                                                                        | Fix                            | M    |
| A9  | **Idempotency keys** on every money action (refund, wallet, payout), not only some.                                                                                                                                                                                                                                                                  | Fix                            | S    |
| A10 | **Indexes and query budget**: an index for every list filter and sort; a test that fails if a list query scans a whole collection.                                                                                                                                                                                                                   | Fix                            | M    |
| A11 | **Admin API versioning** (`/api/admin/v1`) and a short API reference page generated from the routes.                                                                                                                                                                                                                                                 | New                            | M    |
| A12 | **Tests per module**: API tests, a filter-matrix test (every filter × sort × page size), and screenshot checks at phone and desktop.                                                                                                                                                                                                                 | Fix                            | M    |

---

## Part B · UI/UX system (how every page looks and feels)

| #   | What                                                                                                                                                                                              | Status                | Size |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---- |
| B1  | **Filter panel redesign**: labels above full-width fields, 2-column grid (1 on phones), date shortcuts, footer with **Clear** and **Apply filters**, closes on Esc or outside click, count badge. | Fix (your screenshot) | S    |
| B2  | **Filter chips** above every table, each removable, plus "Clear all".                                                                                                                             | Fix (Orders only)     | S    |
| B3  | **Sortable column headers** on every table, with arrows and `aria-sort`.                                                                                                                          | New                   | M    |
| B4  | **Column chooser** on every table, remembered per admin.                                                                                                                                          | Fix (Orders only)     | S    |
| B5  | **Saved views**: save the current filters as a named tab ("COD to ship", "Low stock running"), per admin, shareable with the team.                                                                | New                   | M    |
| B6  | **Side drawers** for quick looks (order, customer, product) without leaving the list.                                                                                                             | New                   | M    |
| B7  | **Inline edit** for quick fields (price, stock, offer, listing) with undo toast.                                                                                                                  | New                   | M    |
| B8  | **Bulk action bar** on every list (select page / select all matching).                                                                                                                            | Fix (Orders only)     | M    |
| B9  | **Density switch** (comfortable / compact) and remembered rows per page.                                                                                                                          | New                   | S    |
| B10 | **Keyboard**: `/` search, `g o` Orders, `g p` Products, `j/k` move between rows, `Enter` open, `?` shortcut sheet. Ctrl+K palette already exists.                                                 | Fix                   | S    |
| B11 | **Skeletons** while a section loads; optimistic updates with rollback on error.                                                                                                                   | Fix                   | S    |
| B12 | **Empty states with a next step** on every page; error states with "Try again".                                                                                                                   | Have → polish         | S    |
| B13 | **Phone layout** for every page: cards, sticky actions, bottom sheet filters.                                                                                                                     | Fix                   | M    |
| B14 | **Accessibility pass**: WCAG 2.2 AA, focus order, labels, live regions for toasts and counts.                                                                                                     | Fix                   | M    |

---

## Part C · Features by section

### C1 Dashboard and Analytics

- Have: KPIs with comparisons, charts, heatmap, top products and cities, to-dos, CSV export.
- New: **goal tracking** (monthly revenue target with progress), **alerts** (revenue drop, payment failures spike), **per-category and per-state reports**, **scheduled email report** (daily/weekly PDF to the owner), **compare two custom periods**.

### C2 Orders

- Have: list, tabs, filters, bulk status, CSV/Excel, invoice and packing slip PDFs, shipments, notes, refunds, cancel items, RTO.
- New: **dispatch deadline timers** (SLA: "ship by 6 pm", red when late), **pick list** and **batch print** (labels, invoices for selected orders), **order tags** (gift, priority, fraud check), **COD risk score** (new customer, high value, past RTO), **exchange flow**, **customer message from the order**, **order timeline with every event**, **split shipment**.

### C3 Returns and Refunds

- Have: return decisions, refunds to wallet or source, reconciliation.
- New: **return reasons report**, **inspection checklist with photos**, **auto-approve rules** (e.g. under ₹500 within 7 days), **refund approval for large amounts** (Finance role).

### C4 Products

- Have: create/edit, photos, sizes/colours, GST, listing toggle, offers.
- New: **bulk import/export (CSV/Excel)** with preview and error report, **bulk edit** (price, offer, category, listing for selected), **duplicate product**, **draft / scheduled publish**, **SEO fields** (title, description, URL), **related and frequently-bought products**, **price history**, **product health score** (missing photos, short description, no reviews).

### C5 Categories

- Have: list, form, category page, bulk move, offers, visibility.
- New: **sub-categories**, **drag-to-reorder**, **scheduled category sale**, **home "Shop by sport" picker**, **banner and SEO per category**.

### C6 Inventory

- Have: list, search, set stock, sizes, CSV export, low/out tabs.
- Fix: show the **category filter, all 5 status tabs and 5 sorts** the server already supports.
- New: **table layout** with stock value and "shoppers waiting", **Add / Remove / Set count with a reason**, **stock history drawer**, **bulk restock**, **CSV import with preview**, **reorder level per product**, **days of cover** (stock ÷ average daily sales), **suppliers and purchase orders** (receive stock against a PO).

### C7 Deals, Coupons, Marketing

- Have: coupons, deals (multi-product, run again), announcement bar, home sections.
- New: **deal stock limit and results**, **coupon usage report and per-customer coupons**, **home banner/hero manager (CMS)**, **push and email campaigns to segments**, **referral report**.

### C8 Customers

- Have: list, block, wallet, questions.
- New: **customer 360 page** (orders, spend, returns, wallet, addresses, notes, tags), **segments** (new, loyal, at risk, high value) usable by campaigns, **export**, **merge duplicates**, **GDPR-style data export and delete**.

### C9 Reviews and Q&A

- Have: Q&A answers and hiding.
- New: **reviews moderation** (approve, hide, reply as team, report abuse), **rating breakdown per product**.

### C10 Support

- Have: tickets API (customer side).
- New: **admin ticket inbox** (assign, status, reply templates, link to order), **canned replies**.

### C11 Finance and tax

- Have: transactions, refunds, reconciliation.
- New: **GST report (GSTR-1 style export)**, **payout report from Razorpay**, **inventory valuation report**, **invoice series settings**.

### C12 Settings and System

- Have: payments, business details, delivery, returns, catalogue limits, shopper features, home sections, system status.
- New: **staff and roles** (A4/A5), **webhook log viewer** (every Razorpay/Shiprocket webhook, its signature check and result, with re-run), **job queue monitor** (failed jobs, retry), **email log**, **maintenance mode**, **backups page**, **audit log page** with filters.

---

## Part D · Order of work (each step ends in a commit with tests and screenshots)

| Step | Contents                                                                                 | Why first                                                                |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1    | B1, B2 (filter panel + chips on every list)                                              | Fixes the bug you saw                                                    |
| 2    | A2, A3, B3, B4, B8 (list engine, UI kit, sorting, columns, bulk bar)                     | Every later page reuses it                                               |
| 3    | C6 Inventory (all of it) + A12 filter-matrix test                                        | Your request; proves the engine                                          |
| 4    | A4, A5, A6 (roles, staff, history)                                                       | Needed before more people use the console                                |
| 5    | C4 Products bulk import/edit + C2 Orders SLA, pick list, tags                            | Biggest daily time savers                                                |
| 6    | C8 Customer 360 + segments, C9 reviews, C10 support inbox                                | Customer side                                                            |
| 7    | C11 finance/GST, C12 webhook log + job monitor + audit page                              | Owner and accountant tools; webhook log covers the mentor's webhook task |
| 8    | B5, B6, B7, B9, B10, B13, B14 (saved views, drawers, inline edit, keyboard, phone, a11y) | Final polish pass                                                        |
| 9    | C1, C3, C5, C7 remaining extras                                                          | Nice to have                                                             |

Each step is planned in detail before it starts, then built in small commits; nothing is pushed
until you say so.

## Part E · Quality bar for every step

- Every list: server-side filters, sort and paging, an index for each, chips, empty state.
- Every write: validated on the server, permission-checked, audit-logged, idempotent if money.
- Every page: works from 320px to 2560px, keyboard only, screen reader labels, no sideways scroll.
- Every step: lint, Stylelint, Prettier and all tests green (except the 4 known old failures),
  phone and desktop screenshots reviewed.
