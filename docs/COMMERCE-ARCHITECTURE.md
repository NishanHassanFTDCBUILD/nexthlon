# Nexthlon commerce architecture

Nexthlon is an Express/EJS application with MongoDB persistence. It uses a modular monolith: controllers validate requests, services perform business operations, and models persist state. This keeps local development and deployment manageable without introducing distributed services prematurely.

## Account and console

- `config/accountNav.js` is the account directory for both the sidebar and account home. Its destinations are existing, implemented pages.
- `services/accountUpdatesService.js` supplies up to four owner-scoped order updates to the profile dashboard. Its read projection excludes address and payment credentials. The service directory supports text search and category filters through `public/js/workspace-directory.js`, including after partial navigation.
- `config/orderWorkQueues.js` defines administrative work queues. Queue conditions are combined with normal filters in `adminOrderService`, and the same conditions apply to list results and exports.
- `config/adminNav.js` supplies the role-filtered console navigation and workspace directory.
- `utils/permissions.js` remains the authority for admin API permissions. Hiding controls improves usability; server checks enforce access.
- The shared account/console styles are in `public/css/commerce.css`, on top of the existing design tokens. All account and admin entry pages load them so partial navigation retains the same styles.
- `public/js/section-nav.js` manages navigation and starts/destroys section modules. Customer order actions live inside `account-order`, with duplicate-submission guards and refresh after successful mutations.
- Storefront previews and missing assets never end an admin session. Admin and customer sessions use separate cookies and token audiences. Product previews open in a separate tab; explicit Sign out still revokes the admin session. Temporary refresh failures leave an unsaved editor open, while invalid or revoked sessions still require sign-in.

## Order state and presentation

Payment, fulfilment, item states, returns, settlements and refunds remain distinct persisted fields. `utils/orderExperience.js` projects those fields into a common read model for the customer order API and both order detail screens. It does not change money or state. Refunds distinguish completed, pending and failed records; pending refunds are never described as completed payouts.

`utils/orderRules.js` owns lifecycle and refund calculations. `services/orderService.js` owns customer order mutations and forward-only status advancement. Unpaid online orders cannot advance fulfilment. Cancelled items cannot become active again through advancement. A return cannot run during a pending settlement or an active size exchange. A new return request clears its previous decision while keeping the event history.

`timelineFor` infers completed milestones from later milestones without inventing timestamps. Recorded timestamps remain visible; inferred steps say "Completed". Existing historical orders do not need rewriting.

## Money, recovery and external systems

Existing `refundService`, `walletService`, `settlementService` and optimistic order concurrency handle money and recovery. `jobs/queue.js` provides durable jobs, deduplication and worker leases. Shipping and payment providers are adapters; controllers and templates must not call them directly to move money. Audit events record privileged operations.

These mechanisms are implemented components, not evidence of proven operational scale. Their deployment settings, workers, provider webhooks and database indexes must be verified in the target environment.

## Verification and boundaries

Local regression coverage includes complete customer order rendering, sparse tracking histories, forward and invalid status changes, ownership, account hub rendering, payment/refund projections and workflow conflicts. Browser fixtures use isolated test data and exercise account navigation, order actions, finance pages and responsive layouts. They do not perform live customer, payment or database mutations.

Production readiness still requires database integration tests, test-mode provider end-to-end checks, worker recovery drills, backup restoration, monitoring and load tests against the intended traffic. Full quantity-level split shipment allocation and multi-warehouse fulfilment are not implemented by this presentation upgrade. The site is not represented as equivalent to Amazon's infrastructure or as guaranteed to win a competition.
