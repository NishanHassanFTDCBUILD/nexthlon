# Nexthlon launch roadmap

From a finished project to a real e-commerce brand you can sell from. Every step has a goal, the
files it touches, how we know it is done, and a **prompt** you can paste to start it.

Tick a step (`[x]`) when it is done. Steps are in order. Inside a stage, steps marked
**(parallel)** can run at the same time as the one before.

---

## How we work (every step)

1. **You paste the step's prompt.**
2. **I plan:** what changes, which files, what it will look like on a phone and a laptop, and the risks. Then I stop.
3. **You say go** (or change the plan).
4. **I build it in small pieces**, with tests for each piece.
5. **I prove it works:**
   - all tests pass, including the database tests;
   - phone (390px and 320px) and desktop (1440px) screenshots;
   - Lighthouse before and after, when the step touches pages.
6. **You review it, then we commit** with a clear message, one step per commit or a few commits.

Sizes: **S** = one short session, **M** = one full session, **L** = two or more sessions.

---

## The Nexthlon bar (every change must meet it)

| Area | The bar |
|---|---|
| **Design** | Colours, type, spacing, radius and shadows come only from `public/css/tokens.css` (Obsidian & Volt). No one-off values. Every screen has a clear hierarchy and plenty of space. |
| **Motion** | Every animation has a job: guide the eye, confirm an action, or show a change. Only `transform` and `opacity` move. Animations last 150–700ms on the shared easing tokens. There is a `prefers-reduced-motion` version, and they run at 60fps on a mid-range phone. |
| **Responsive** | Works from 320px to 2560px and on a phone held sideways. Touch targets are 44px, there's no sideways scroll, viewport heights use `dvh`/`svh`, and touch screens get press states instead of hover. See `docs/mobile-audit-checklist.md`. |
| **Accessibility** | WCAG 2.2 AA: contrast, full keyboard use, visible focus, labelled fields, and announcements for changes. |
| **Speed** | Lighthouse mobile 90+ (desktop 95+). LCP under 2.5s, CLS under 0.1, INP under 200ms. One CSS bundle per page, and 3D or other heavy code loads only when needed. |
| **Architecture** | Routes, controllers, services, models. Outside services (email, storage, shipping, payments, WhatsApp) sit behind **providers** we can swap. Slow work runs as **jobs** with retries. |
| **Security** | Validate all input, rate-limit, keep the CSP strict, keep secrets only in `.env`, and record admin actions in the audit log. |
| **Tests** | New behaviour gets tests. All tests pass before a commit. |

---

## Target architecture

We keep a **modular monolith**: one Express app, organised in clear layers. It's fast, cheap to
host, good for SEO, and easy to grow. We are *not* building a multi-company SaaS platform; we build
the store to **SaaS-grade quality**.

```
Browser ─ EJS pages · one CSS bundle per page · vanilla JS modules · shared motion ticker
   │
Express ─ security (helmet, CSP, origin check) · auth (JWT + refresh) · rate limits
   │
routes → controllers (HTTP only) → services (business rules) → models (MongoDB Atlas)
                                        │
                                   events (order.placed, order.shipped, refund.issued …)
                                        │
                                   jobs (MongoDB-backed queue, retries, schedule)
                                        │
          providers ─ mail · storage · shipping · payments · whatsapp · analytics
```

New folders, added only by the step that first needs them:

| Folder | What lives there | Added in |
|---|---|---|
| `providers/` | One adapter per outside service, picked by config (e.g. `mail/smtp.js`, `mail/ses.js`, `storage/local.js`, `storage/r2.js`). | A3, B2 |
| `events/` | A small event bus plus listeners: "when an order is placed, queue the confirmation email". | B2 |
| `jobs/` | A job queue stored in MongoDB, a worker loop, retries with back-off, and scheduled jobs (cart recovery moves here). | B2 |
| `config/schema.js` | Every environment variable checked at start-up: missing ones stop the server with a clear message. | A2 |

---

## Stage A: Foundation (make what we have safe and deployable)

### [x] A1. Save our work safely · S
- **Goal:** everything from the five UI/UX phases committed, and nothing broken.
- **Files:** `server.js` (put back the "could not connect to MongoDB" message), `README.md` and `.env.example` (restore them; they are deleted in the working tree), all changed files.
- **Done when:** all 224 tests pass, the dev server starts, and git has clean commits grouped by phase.

```text
Step A1 from docs/ROADMAP.md: save our work safely. Restore README.md and .env.example, put back
the MongoDB connection error handling in server.js, run all tests (with the test database), and
commit the five UI/UX phases plus the animation work as clear, separate commits. Plan first, then
wait for my go-ahead.
```

### [x] A2. Production-ready server · M
- **Goal:** the app runs safely behind a host's proxy, with health checks, error alerts and automatic tests.
- **Files:** `app.js` (`trust proxy`, `/healthz`), `config/schema.js`, `utils/logger.js` (request IDs), Sentry, `Dockerfile`, `.github/workflows/test.yml`, `README.md` (deploy guide).
- **Done when:**
  - rate limits see real customer IPs behind a proxy;
  - a missing environment variable stops the server with a clear message;
  - CI runs all tests on every push;
  - `docker build` works.

```text
Step A2 from docs/ROADMAP.md: make the server production-ready. Add trust proxy, a /healthz route,
start-up checks for every environment variable, request IDs in logs, Sentry error reporting
(off when no DSN is set), a Dockerfile, and a GitHub Actions workflow that runs all tests with a
MongoDB service. Follow the Nexthlon bar. Plan first, then wait for my go-ahead.
```

### [ ] A3. Photos in cloud storage, with sizes for every screen · M
- **Goal:** uploads survive redeploys and load fast. Every uploaded photo gets 400, 800 and 1600px WebP copies with `srcset`.
- **Files:** `providers/storage/{local,r2}.js`, `services/imageService.js`, `utils/images.js`, `public/js/store.js`, a migration for existing uploads, and image deletes.
- **Done when:** product cards download a card-sized photo, the `/products` mobile LCP is under 2.5s in Lighthouse, and photo storage can switch between local and R2 (or S3) through config.

```text
Step A3 from docs/ROADMAP.md: move photos to a storage provider (local for development,
Cloudflare R2 or S3 in production) and create 400/800/1600px WebP copies of every upload, with
srcset in cards and the product page. Migrate existing uploads. Re-run Lighthouse mobile on
/products. Plan first, then wait for my go-ahead.
```

---

## Stage B: Core commerce (what a real store must do)

### [ ] B1. Accounts: password reset and email check · M
- **Goal:** customers can reset a forgotten password and confirm their email. Admins can turn on two-step login.
- **Files:**
  - routes and controllers: `routes/authRoutes.js`, `controllers/authController.js`;
  - services and model: `services/authService.js`, a new reset-token model;
  - pages: `views/pages/auth.ejs` and new reset pages;
  - email templates.
- **Design:** the reset flow uses the same flip-card sign-in look, with clear success and error states and motion.
- **Done when:**
  - reset links expire after 30 minutes and work only once;
  - the reset request answers the same way whether the email exists or not (no account guessing);
  - it's rate-limited and fully tested.

```text
Step B1 from docs/ROADMAP.md: add forgot-password and reset-password (single-use links that expire
in 30 minutes, no account guessing, rate-limited), email confirmation for new accounts, and
optional two-step login (TOTP) for admins. Design it in the same style as the sign-in page, on
phone and desktop. Plan first, then wait for my go-ahead.
```

### [ ] B2. Order emails, the event system and background jobs · L
- **Goal:** customers get beautiful emails when an order is confirmed, shipped (with tracking), out for delivery, delivered, refunded, or a return is approved. The system is built to grow.
- **Files:** `events/`, `jobs/` (MongoDB queue with retries), `providers/mail/` (SMTP, plus SES or Brevo), `views/emails/` (shared layout, dark brand style that also works in light mail apps), `services/orderService.js` hooks, and cart recovery moved onto jobs.
- **Done when:**
  - each order status change sends exactly one email, even after a server restart;
  - a failed send retries;
  - emails look right in Gmail on phone and desktop;
  - there's a test for each email.

```text
Step B2 from docs/ROADMAP.md: build the event bus, a MongoDB-backed job queue with retries, and a
mail provider (SMTP and one API provider). Send branded order emails for confirmed, shipped (with
tracking), out for delivery, delivered, refunded and return approved. Move cart recovery onto jobs.
Plan first, then wait for my go-ahead.
```

### [ ] B3. Sizes and colours (product options) · L
- **Goal:** each product has options (size, colour) with their own SKU, stock and photos, plus a size guide.
- **Files:**
  - model: `models/Product.js` (an options list), plus a migration that turns each current product into one option;
  - cart and orders: `services/cartService.js`, `services/orderService.js`, `services/inventoryService.js`, `models/Order.js` (the option on each line);
  - admin: the product form with an options editor;
  - product page: `views/pages/product.ejs` and `public/js/product.js`;
  - cards and filters: product cards and the size and colour filters.
- **Design:**
  - colour swatches that swap the gallery smoothly;
  - size chips with sold-out states;
  - "only 2 left";
  - a size-guide sheet that slides up on phones and opens as a side panel on desktop;
  - the "Add to cart" button stays disabled, with a gentle shake, until a size is picked.
- **Done when:** stock is tracked per option everywhere (cart, checkout, returns, admin, reports), old orders still display, and all tests pass.

```text
Step B3 from docs/ROADMAP.md: add product options (size and colour, each with its own SKU, stock,
price and photos) across the product page, cards, filters, cart, checkout, orders, returns,
inventory and the admin form, with a migration for existing products and a size guide. Make the
size and colour picker award-level on phone and desktop. Plan first, then wait for my go-ahead.
```

### [ ] B4. GST invoice and legally required product details · M (parallel)
- **Goal:** invoices meet Indian GST rules, and listings show what India's e-commerce and packaging rules require.
- **Files:**
  - model: `models/Product.js` (HSN code, GST rate, country of origin, manufacturer or importer, net quantity);
  - invoices: `services/invoiceService.js` (taxable value, CGST + SGST or IGST by place of supply, invoice series);
  - store details: `config/store.js` (real details);
  - pages: product page "Details" and the policy pages.
- **Done when:** a sample invoice for a Kerala-to-Kerala order and one for a Kerala-to-Delhi order both show the correct tax split, and a chartered accountant has checked the format.

```text
Step B4 from docs/ROADMAP.md: make invoices GST-compliant (HSN, GST rate, taxable value,
CGST+SGST or IGST by place of supply, invoice numbering) and add country of origin, manufacturer
and net quantity to products, shown on the product page. Plan first, then wait for my go-ahead.
```

### [ ] B5. Shipping partner · L
- **Goal:** real delivery dates and COD availability by PIN code, automatic shipping labels, and live tracking that updates the order and triggers the B2 emails.
- **Files:** `providers/shipping/{manual,shiprocket}.js`, `services/deliveryService.js`, a tracking webhook route, the admin "Create shipment" button, and a "Track order" timeline with motion.
- **Done when:**
  - an admin creates a shipment in one click;
  - tracking updates arrive by webhook;
  - the customer's order page shows a live, animated timeline;
  - refused-parcel returns (RTO) are handled.

```text
Step B5 from docs/ROADMAP.md: add a shipping provider (keep "manual", add Shiprocket) for PIN-code
serviceability and COD availability, one-click shipments with AWB, tracking webhooks that update
order status and send the B2 emails, and an animated tracking timeline for customers. Plan first,
then wait for my go-ahead.
```

---

## Stage C: Award-level experience

### [ ] C1. Motion system v2: page transitions and scroll-driven CSS · M
- **Goal:** the site feels like one smooth app.
- **Pieces:**
  - **Page transitions:** cross-page View Transitions (`@view-transition`), so a product card's photo flows into the product page photo, and headers stay in place between pages.
  - **Scroll reveals in CSS:** CSS scroll-driven reveals (`animation-timeline: view()`) replace the JavaScript reveals where the browser supports them.
  - **Motion tokens:** one set of tokens for durations and easings.
- **Done when:**
  - navigation feels seamless in Chrome, Edge and Safari 18+, and other browsers still work exactly as now;
  - reduced motion turns everything off;
  - CLS stays 0.

```text
Step C1 from docs/ROADMAP.md: build motion system v2. Add cross-document View Transitions (product
card photo → product page, shared header), CSS scroll-driven reveals with a JS fallback, and
motion tokens for durations and easings. Keep reduced motion and zero layout shift. Show me phone
and desktop recordings or screenshot sequences. Plan first, then wait for my go-ahead.
```

### [ ] C2. Shopping micro-interactions · M
- **Goal:** every key action gives satisfying feedback.
- **Pieces:**
  - **Add to cart:** the photo flies to the cart icon and the count ticks up.
  - **Wishlist:** the heart bursts.
  - **Quantity:** a rolling number counter.
  - **Loading:** skeleton screens instead of spinners.
  - **Saved address:** an animated tick.
  - **Coupon:** a "you saved ₹X" counter.
  - **Order success:** a celebration moment.
- **Done when:** each one works by touch, mouse and keyboard, and each has a reduced-motion version.

```text
Step C2 from docs/ROADMAP.md: add award-level micro-interactions: fly-to-cart, wishlist heart burst,
rolling quantity numbers, skeleton loading, coupon savings counter and a better order-success
moment. Touch, mouse and keyboard; reduced-motion versions. Plan first, then wait for my go-ahead.
```

### [ ] C3. Checkout that converts · M
- **Goal:** the fastest checkout in Indian sports retail.
- **Pieces:**
  - UPI shown first;
  - the PIN code fills in city and state;
  - saved addresses as cards;
  - a progress bar, and the sticky summary on desktop becomes a drawer on phones;
  - clear delivery date and COD rules, and trust badges;
  - errors that explain the fix.
- **Done when:**
  - checkout can be finished with one thumb on a 320px phone;
  - every field has the right phone keyboard (`inputmode`, `autocomplete`);
  - Lighthouse accessibility scores 100.

```text
Step C3 from docs/ROADMAP.md: polish checkout for conversion: UPI first, PIN code fills city and
state, saved address cards, progress steps, phone summary drawer, clear delivery and COD info,
helpful errors, correct mobile keyboards. One-thumb usable at 320px. Plan first, then wait for my
go-ahead.
```

### [ ] C4. Design quality pass across every page · M
- **Goal:** one consistent, premium system everywhere, including the account, order and admin pages, which were not part of the UI/UX phases.
- **Done when:** every page passes `docs/mobile-audit-checklist.md` at all sizes, there are no one-off colours or spacing values, and there's a screenshot set of every page at 390 and 1440 wide.

```text
Step C4 from docs/ROADMAP.md: do a design quality pass on every page (store, account, orders,
admin). Remove one-off colours and spacing, align to tokens, fix anything that fails the mobile
audit checklist, and give me a screenshot set of each page at 390 and 1440 wide. Plan first, then
wait for my go-ahead.
```

---

## Stage D: Launch

### [ ] D1. SEO and social sharing · S
- **Goal:** products show up well on Google and look good when shared.
- **Files:**
  - `/sitemap.xml` and `robots.txt`;
  - Google structured data (JSON-LD) for products (price, stock, rating), breadcrumbs and the organisation;
  - Open Graph and Twitter cards, canonical URLs, and unique titles and descriptions for categories.
- **Done when:** Google's Rich Results Test passes on a product page, and a WhatsApp link preview shows the photo and price.

```text
Step D1 from docs/ROADMAP.md: add sitemap.xml, Product/Breadcrumb/Organization JSON-LD, Open Graph
and Twitter cards, canonical URLs and unique category titles and descriptions. Prove it with
Google's Rich Results Test format and a link preview. Plan first, then wait for my go-ahead.
```

### [ ] D2. Analytics with consent · S
- **Goal:** know what sells and where customers drop off, while respecting privacy (India's DPDP Act).
- **Files:**
  - a cookie consent banner in the brand style;
  - GA4 or Plausible, and the Meta Pixel, loaded only after consent;
  - shopping events (view, add to cart, checkout, purchase);
  - a CSP update;
  - account deletion and data download in My Account.
- **Done when:** nothing loads before consent, events show in the analytics dashboard, and the Lighthouse score doesn't drop.

```text
Step D2 from docs/ROADMAP.md: add a brand-styled consent banner, GA4 (or Plausible) and Meta Pixel
loaded only after consent, e-commerce events, the CSP changes, and "delete my account / download my
data" in My Account. Plan first, then wait for my go-ahead.
```

### [ ] D3. Security review before going live · S
- **Goal:** no known weak spots on launch day.
- **Pieces:** `npm audit` fixes, a CSP review, cookie flags, an admin path and two-step login check, abuse limits on coupons, referrals and COD, and a backup restore drill.
- **Done when:** there are no high-risk findings, and a backup has been restored into a test database successfully.

```text
Step D3 from docs/ROADMAP.md: run a pre-launch security review: dependency audit, CSP, cookies,
admin access and 2FA, abuse limits on coupons/referrals/COD, rate limits, and a backup restore
drill. Fix what is found. Plan first, then wait for my go-ahead.
```

### [ ] D4. Go live · M
- **Goal:** the real store on your domain.
- **Pieces:** hosting and MongoDB Atlas, the domain with HTTPS and Cloudflare, `NODE_ENV=production`, Razorpay live keys and webhook, the email domain's records (SPF, DKIM, DMARC), the shipping provider live, real products and photos, and a soft launch with friends and family.
- **Done when:** a real order is paid, shipped, delivered, invoiced and refunded end to end, and monitoring is green for a week.

```text
Step D4 from docs/ROADMAP.md: help me go live. Walk me through hosting, MongoDB Atlas, domain,
HTTPS, Cloudflare, environment variables, Razorpay live keys and webhook, email domain records and
the shipping provider. Then run an end-to-end real order test with me. Plan first, then wait for my
go-ahead.
```

---

## Stage E: Growth (after launch)

| Step | What | Size |
|---|---|---|
| [ ] E1 | WhatsApp order updates and support chat (WhatsApp Business API provider) | M |
| [ ] E2 | COD confirmation by OTP or WhatsApp, and a discount for paying online, to cut refused parcels | S |
| [ ] E3 | Back-in-stock alerts, reviews with photos, product Q&A | M |
| [ ] E4 | Search upgrade: suggestions as you type, tolerance for typos, synonyms (MongoDB Atlas Search) | M |
| [ ] E5 | Installable app (PWA) with push notifications | M |
| [ ] E6 | "Complete the kit" bundles and recommendations | M |
| [ ] E7 | Content hub: sport guides and athlete stories, for SEO | M |
| [ ] E8 | Amazon, Flipkart and Myntra listings with stock sync | L |
| [ ] E9 | Hindi language | L |

Prompt for any growth step:

```text
Step E<number> from docs/ROADMAP.md: <name of the step>. Plan it to the Nexthlon bar (design,
motion, phone and desktop, speed, tests), then wait for my go-ahead.
```

---

## Your business checklist (run alongside the code)

These are yours to do; the code steps above don't wait for them, except D4.

- [ ] **Trademark:** search "Nexthlon" on IP India (classes 25, 28, 35). It may be seen as close to "Decathlon", so get a lawyer's view before you spend on branding.
- [ ] **Company:** register the business, get a GSTIN with a chartered accountant's advice, and open a current bank account.
- [ ] **Domain, email and social handles:** register the same name everywhere.
- [ ] **Products:** choose one or two sports to start, find a manufacturer or authorised distributors, check quality, and check whether any product needs BIS certification.
- [ ] **Photography:** real photos of every product, on a plain background plus in use.
- [ ] **Cost maths:** for each product, list cost, shipping, payment fee, returns and the refused-parcel rate. The selling price must still leave a profit.
- [ ] **Policies:** have a lawyer review the privacy, terms, refund and shipping pages, and name a grievance officer.
- [ ] **Accounts:** Razorpay business checks (KYC), a shipping partner account, and a Google Merchant Center account.
