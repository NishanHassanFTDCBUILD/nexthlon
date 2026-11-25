# Admin audit fixes

The admin audit findings were addressed in the page guards, stock services,
product editor, dashboard, history screens and recovery controls.

## Behavior

- HTML pages enforce the same narrow permissions as their API counterparts.
  Invalid stored staff roles no longer inherit owner access. Legacy accounts
  with an empty or missing adminRole retain their existing owner behavior.
- Inventory counts compare the quantity seen by the editor and the quantity
  at the atomic write. Product forms compare their original stock/options and
  modification timestamp, with an additional database guard during saving.
- Inventory and dashboard restocks use permanent request receipts. Stock,
  the receipt and the stock audit entry commit in one MongoDB transaction.
  Retrying the same request returns its saved result; changing the payload
  under the same reference is rejected.
- Inventory updates refresh totals, stock value, sales cover, reorder warning
  and the modification date. Failed multi-option edits keep unsaved quantities.
- Product forms warn before discarding changes and lock controls while saving.
  Product and Inventory import handlers are scoped to their own interfaces.
  Product video and spin-frame fields are included in the form submission.
- Dashboard dispatch counts use the dispatch queue's payment-ready predicate.
  The low-stock action count matches the low-stock list it opens.
- Activity history is available to authorized staff. Failed general audit writes
  are queued with an idempotent audit ID; stock audit writes are transactional.
- Background work shows bounded task summaries and permits explicit retries of
  failed tasks. Payloads and raw provider errors are not rendered.
- Restock recovery saves each row's outcome. Interrupted new imports can resume
  after their five-minute lease using the same per-row request references.
  Legacy imports without receipts require manual stock-history reconciliation.

## Runtime requirements

Use MongoDB Atlas or a replica set for safe admin stock adjustments. A standalone
server receives an explicit 503 before stock is changed. Existing transaction
fallbacks for other store workflows are unchanged.

Run `npm run db:indexes` against the intended database when deploying; this adds
missing indexes without dropping existing ones. Keep `npm run worker` running for
queued audit delivery and background-task retries. Restart the app/worker when
deploying the new job handler.

PATCH `/api/admin/inventory/:id` now requires `requestId`, and exact counts also
require `expectedStock`. Dashboard restocks require `requestId` as well. The
updated browser scripts provide these fields. Refresh an old open admin tab
after deploying.

General audit fallback cannot save an entry when both the audit collection and
the job queue are unavailable; that failure remains visible in application logs.
No success claim is made for live database transactions, payment providers or
worker delivery without verifying the deployed environment.

## Verification

Regression coverage includes stale counts, checkout races, duplicate adjustments,
uncertain commit responses, transactional audit/receipt coupling, stale product
forms, invalid staff roles, restricted HTML pages and interrupted import recovery.
Fixture browser checks exercise real templates and controller responses at 390px
and 1440px, unsaved-form navigation, duplicate stock submission and live totals.
These checks use isolated fixtures and do not change customer records.
