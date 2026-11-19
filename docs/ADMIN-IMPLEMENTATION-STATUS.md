# Admin implementation status

Updated: 19 November 2026. This is a progress record, not a completion certificate.

## Implemented, awaiting integration and visual verification

- Step 1: shared filter toolbar and chips on Products, Customers, Returns,
  Transactions, Refunds, Coupons, Deals and Categories. Inventory also uses the
  toolbar. Orders uses the shared chips partial. Clear/apply controls preserve
  page size; changing a filter resets the page. Return status clearing explicitly
  selects all returns instead of silently falling back to waiting returns.
- Step 2 (partial): `utils/listQuery.js` validates scalar inputs against a trusted
  schema, builds database predicates, whitelists sorts, adds a stable ordering,
  applies paging and creates chip/pagination metadata. Products, Customers,
  Categories, Coupons and Deals use its database runner. Orders, Returns,
  Inventory, Transactions and Refunds use it with their domain-specific query or
  aggregation logic. Shared sortable headers expose `aria-sort`. Column choosers
  and row-height controls were removed at the user's request; all columns remain
  visible at the standard row height.
  The wider page kit and shared bulk-action component remain pending.
- Step 3 (partial): inventory shows all five existing statuses and sorts, category
  filtering, stock value, waiting stock-alert counts, last product update time,
  Add/Remove/Set controls, reason and note fields, and recent manual adjustment
  history. The history endpoint requires the existing admin guard and queries a
  dedicated audit target/action/time index. Reason values are server-validated
  and audit-logged. Legacy stock API callers without a reason retain compatibility
  with an inferred reason. History covers recorded inventory adjustments, not a
  complete sales/returns stock ledger.
- Step 3 restocking: selected simple products can be restocked in bulk; CSV
  restocking supports individual size/colour option IDs. Imports are capped at
  100 rows / 10 KB, show previews and row errors, and offer a downloadable error
  report. A preview belongs to its preparing admin and expires for confirmation
  after 15 minutes. A durable batch claim prevents duplicate confirmation;
  uncertain writes require manual review rather than automatic replay. Each
  applied adjustment uses the existing validated/audited stock path. Exported
  inventory includes product/option IDs, and a restock CSV template is available.

## Remaining

- Finish Step 2 secondary/detail-list migrations, wider UI kit and bulk-action
  component before treating the foundation as complete.
- Finish Step 3: reorder levels, days of cover, suppliers, purchase orders and
  complete stock history. Large imports still need background jobs; current
  restock batches are deliberately bounded and run in the request.
- Steps 4-9: staff/RBAC, bulk product and order tools, customer/support/review
  tools, finance/system tools, saved views/drawers/inline undo/density/shortcuts,
  accessibility and responsive verification, and the remaining section extras.

## Verification and blockers

- Focused template rendering, query-engine matrix, validation and design-token
  tests pass. ESLint, Stylelint, Prettier and `git diff --check` pass.
- Added migration tests for every newly migrated primary list and stock-import
  tests for CSV parsing, previews, actor scoping, expiry, repeated/concurrent
  confirmation and partial failures. These use controlled model doubles and do
  not replace integration tests against MongoDB.
- Full `npm test` was invoked with
  `TEST_MONGODB_URI=mongodb://127.0.0.1:27017/nexthlon_test`. Database-dependent
  suites cannot connect in this execution environment. A direct Node TCP check
  of `127.0.0.1:27017` returns `EACCES`. These failures are not classified as the
  four documented baseline failures, and integration correctness remains unproven.
- `scripts/screenshots.js` was attempted; Chrome did not start. Test-account
  screenshot credentials are also absent. Phone/desktop visual checks remain open.
- The user explicitly requested a local commit of all implemented admin features,
  including removal of Columns and Row height controls. Integration and visual
  verification remain open as described above. No push was requested.
