# models/

Each file here describes **one kind of stored data** (an entity) and nothing else:

- its fields and their limits;
- its indexes;
- hooks that keep a single document valid when it is saved (for example `Product` works out its
  price from the base price and offers, and `Category` keeps a lower-case `nameKey`).

Everything else lives outside this folder:

| What | Where |
|---|---|
| Business rules and anything that changes several documents (sync a category's offer onto its products, next order number) | `services/` (e.g. `categoryService.syncProducts`, `counterService.nextNumber`) |
| One-time upgrades of data saved by older versions | `services/migrationService.js` |
| Sums and pure helpers (prices, the price update pipeline) | `utils/` (e.g. `utils/pricing.js` `PRICE_PIPELINE`) |
| Query filters used in many places ("only listed products") | `utils/queryFilters.js` |
| What a user looks like to the browser | `utils/publicUser.js` |
| Fixed lists shared by models, validation and pages (ticket topics, categories, states) | `config/` |

So a model never exports helper functions, static methods or constants.
