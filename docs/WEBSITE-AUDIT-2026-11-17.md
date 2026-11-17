# Nexthlon website and code audit

Date: 17 November 2026. Target: the current local working tree and the running website at http://localhost:3000/.

> Follow-up: fixes were implemented after this audit. See `docs/FIXES-2026-11-17.md` for the changes and current validation limits. The findings below describe the original audited state.

## Verdict

The website runs and its database answers readiness checks. The public shopping experience works in the paths exercised, but the app is **not ready to be signed off for real customer payments**. Fix the shared stylesheet, refund consistency, payment recovery, and unfinished public content first.

This was an audit. Application source, business records, and existing working-tree edits were not changed. The only project addition is this report. No real order, payment, refund, email, SMS, or support message was submitted.

## Evidence and coverage

| Check | Result | Meaning |
|---|---|---|
| JavaScript syntax | 320 files passed `node --check` | Includes application, browser, scripts, and test JavaScript; does not prove runtime correctness. |
| EJS syntax | 85 templates compiled | Does not prove every template receives the right data at runtime. |
| `npm test` | 235 reported entries: 204 passed, 5 failed, 26 skipped | Skipped entries include entire database suites, so this is not 204 passing end-to-end journeys. |
| Browser `/healthz` | `status: ok` | Running process responds. |
| Browser `/readyz` | `status: ready`, `database: up` | The running app can reach its database. |
| Dependency audit | Blocked | npm registry DNS lookup failed with `ENOTFOUND`; no claim that dependencies are vulnerability-free. |
| Terminal HTTP/database requests | Blocked | Local socket connection attempts returned `EACCES`, including localhost. Browser access worked. |
| Payment/refund failure simulations | Two defects reproduced | Used isolated in-memory substitutes, without a database or payment gateway. |

Browser checks covered the home page, search for football, football category results, descending-price sorting, a football detail page, guest add-to-cart redirect, empty-login validation, phone navigation, phone catalogue layout, About, Contact, Privacy, Terms, Refund Policy, Shipping Policy, Guides, Signup, Forgot Password, Offline, health/readiness, and guest protection on cart, checkout, account, orders, wallet, and wishlist routes.

The phone catalogue was examined at 390 x 844. The browser viewport override was reset afterward. On the sampled category page no broken loaded images or horizontal document overflow was observed. This is a sample, not an image audit of every product.

Successful authenticated customer and admin workflows were not executed. No new account was created. Database suites could not be exercised from the restricted terminal environment, and `TEST_MONGODB_URI` was not configured. Real payment capture, refunds, shipping, messages, uploads, push delivery, backup restore, production hosting, and sustained-load behavior remain unverified. Existing screenshots were not treated as proof of current behavior.

## Priority findings

### 1. High — missing CSS brace breaks shared styles and the phone filter drawer

Evidence: `public/css/components.css:11` opens `html {` without closing it before `body {`.

Because `utils/assets.js` concatenates the stylesheets, the unclosed rule also captures rules from later files. In the browser CSSOM, the `html` rule contained nested body and later stylesheet rules. Selectors such as `html.js .catalog .fx` consequently fail to apply as intended.

At phone width, the observed filter panel had `position: static` and the Filters button had `display: none`, although the document had the `js` class and the catalogue had `is-enhanced`. The full filter panel filled the first phone screen above the products. This is a functional regression, not just a preferred layout change.

Fix: close the `html` rule. If the intended sticky-header anchor behavior is retained, the line can be:

```css
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; scroll-padding-top: calc(var(--header-h) + var(--space-2)); }
```

Then recheck catalogue filters, sticky controls, reduced-motion rules, and other selectors starting with `html`. The working-tree diff confirms the brace disappeared from a local edit; that edit was preserved during this audit.

### 2. High — wallet refunds can be credited twice after an order-write failure

Evidence: `services/refundService.js:11`, `:45`, `:54`, and `:58`.

`issueRefund` credits the wallet before persisting the refund on the order. The wallet call does not supply the deduplication `key` already supported by `walletService.credit`. If the order update fails after the credit, a retry can credit the same refund again.

Reproduction: an isolated simulation requested 10,000 paise, let the wallet credit succeed, and failed the order update. Retrying produced 20,000 paise credited while the order still recorded zero refunded. No real wallet was used.

Fix: create a durable refund operation with a unique identifier and use that identifier for wallet-credit deduplication. Commit related local database changes transactionally where supported. Make retries resume the existing operation. Add failure-injection tests for each boundary.

### 3. High — payment completion cannot reliably resume after a partial failure

Evidence: `services/paymentService.js:105–152`.

`markPaid` first changes the order from pending/failed to paid. If later stock, cart, invoice, or event processing is interrupted, another call sees the paid state and returns at line 114. It does not resume the remaining work. The stock flag is also claimed before the stock operation actually completes.

Reproduction: a simulated invoice failure occurred after the paid-state and stock changes. A second `markPaid` call returned the paid order; invoice processing had been attempted only once, and zero `order.placed` events were emitted. This can leave confirmation and downstream processing incomplete despite a successful payment.

Fix: persist separate payment-received and fulfillment-processing states. Use durable, retryable work for stock, invoice, and confirmation processing. A repeated callback should complete unfinished steps. Test interruption after every stage, including a restart after claiming stock.

### 4. High — cancellation and return processing can leave stock, status, and refunds inconsistent

Evidence: `services/orderService.js:74–97`; `services/adminOrderService.js:306–323`.

Cancellation returns stock before saving the cancelled order, then refunds after saving it. These operations are not committed as one resumable operation. A failed save can leave stock returned for an active order. A failed refund can leave a cancelled order that the regular cancellation endpoint will refuse to cancel again.

The return approval transaction saves the returned status before the external refund call. If refund processing fails afterward, the normal decision path no longer finds return-requested items.

Concurrent customer/admin cancellation requests also read their own order snapshots before making side effects. Without an atomic cancellation claim, they can both act on the same items. Mongoose version behavior does not make the already-executed stock or wallet side effects safe.

These are code-backed failure/concurrency risks; a real database concurrency test was not run.

Fix: atomically claim the operation, transactionally record local status/inventory changes, and record a durable refund intent. Retry the same intent until completion. Test concurrent cancellation, a save failure after stock restoration, and refund failure after cancellation/return approval.

### 5. High — published refund promises disagree with implementation

Evidence: `views/pages/refund-policy.ejs:7` and `:25`, `services/refundService.js:45`, and `services/orderService.js:74`.

The visible policy says refunds return to the original payment method and its draft COD clause mentions bank/UPI refunds. The implementation defaults refunds to the Nexthlon wallet, routes COD refunds there, and falls back to the wallet when a gateway refund throws. A gateway response lost after acceptance also needs reconciliation before issuing an alternative credit.

Fix: choose the intended business behavior, update the interface and policy to match it, and explicitly explain any customer choice. Reconcile uncertain gateway outcomes before issuing replacement wallet credit. This finding concerns consistency; no legal compliance certification was performed.

### 6. Medium — public business and product content is still a draft

Observed on the running site:

- Footer and Contact show `[support@your-domain.in]` and `[+91 00000 00000]`.
- About contains `[year]` and `[Add a few lines about how you choose your products.]`.
- Policy pages contain unresolved courier, business, and other bracketed values.
- Product specifications show placeholder manufacturer/seller details.
- A product named “Nishan Hassan”, with a repeated-`n` brand and an unrelated image, is promoted in the spotlight and product rails.
- Guides loads successfully but has no guides.

Evidence: `config/store.js`, `views/pages/about.ejs:4` and `:13`, the policy templates, and current browser content. Some placeholders require environment settings; others are literal text in templates.

Fix: remove or unlist test products, enter real support/business settings, replace literal draft copy, and review every advertised product claim. Publish guides or remove the prominent route until content is ready.

### 7. Medium — default test command has broken setup and environment leakage

Failures from the current run:

| Failure | Classification | Explanation |
|---|---|---|
| `tests/jobs.test.js` | Test setup defect | Line 14 constructs `new URL(process.env.TEST_MONGODB_URI)` when that variable is absent. It fails before tests can skip. |
| `tests/order-emails.test.js` | Test setup defect | Line 17 has the same missing-variable problem. |
| `tests/ops.test.js:288` | Environment-dependent test | Child processes read local `.env`; the production-default proxy assertion received 0 instead of 1. The explicitly configured override is not evidence of a runtime proxy bug. |
| `tests/ops.test.js:298` | Environment-blocked | The CSP subprocess requires localhost HTTP access and produced no header under the socket restriction. This does not prove the running browser CSP is wrong. |
| `tests/upload-fields.test.js:8` | Environment-blocked | Its localhost fetch failed with `EACCES`. It does not establish that uploads are broken. |

Fix: make optional database suites skip before parsing the URL, consistently isolate test settings from `.env`, and run the database suites against disposable test databases in an environment that permits local networking. The CI workflow is configured to provision MongoDB and run tests; its current remote result was not inspected.

### 8. Low — duplicate product specifications and inconsistent cart architecture

The football detail page repeats Brand and Country of Origin in its specifications. Merge standard metadata with custom specifications without duplicate display labels.

There is guest-cart infrastructure, but `public/js/store.js:312` redirects guests to sign in, and `/cart` also requires a customer session. Browser behavior matches the current product-page instruction. This is a product/maintenance decision rather than a confirmed defect: document the sign-in-first policy and remove unused paths, or finish connecting the guest cart consistently. Current frontend behavior alone does not prove backend guest-cart behavior.

## What is working well

- Search for football returned the two relevant products.
- Football category filtering and descending-price sorting worked.
- The sampled product detail page displayed price, availability, quantity, description, delivery information, and related products.
- Guest add-to-cart sent the visitor to sign in with the product URL preserved in `next`.
- Empty sign-in submission displayed field errors and remained on the form.
- Phone navigation opened a dialog with category/account/help links.
- Public information and recovery entry pages rendered, and protected customer pages redirected guests to sign in.
- The code separates routes, controllers, services, models, and validation. Password hashing, role guards, owner-scoped order lookup, server-side quote calculation, raw signed webhook handling, atomic stock decrement, upload guards, health/readiness checks, and background jobs are present.
- Versioned assets, CSS bundling, compression, local fonts, and responsive images provide useful performance foundations. No Lighthouse, Core Web Vitals, accessibility certification, or load benchmark was completed.

## Recommended fix order and acceptance checks

1. Close the CSS rule and verify phone filters at 320, 390, 768, and desktop widths. Products should appear without scrolling through the entire filter form; the filter sheet should open, close, scroll, and support Escape/focus handling.
2. Make refund operations idempotent and payment completion resumable. Repeated callbacks and process interruptions must not duplicate money movement or leave a paid order unfinished.
3. Make cancellation/return operations recoverable and safe under concurrent requests.
4. Align policy and checkout/order messaging with actual refund and COD behavior.
5. Replace draft content and remove test catalogue entries.
6. Repair test setup and rerun all database suites. Add targeted concurrency and failure-injection coverage for the findings above.
7. Exercise authenticated customer and admin journeys in an isolated staging environment: signup/login/refresh, addresses, cart/variants, coupons, COD and online checkout, cancellation, returns, wallet/original refunds, invoices, uploads, inventory, support, and notifications.
8. Complete gateway sandbox tests, courier/email/storage verification, dependency audit, accessibility/performance checks, and backup/restore verification before production sign-off.

**Decision:** suitable to continue development and demonstrate public browsing; not yet verified for real commerce. The strongest blockers are the confirmed shared-CSS regression and reproduced payment/refund recovery defects.
