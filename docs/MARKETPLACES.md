# Marketplace listings (E8)

The store makes a feed that Amazon, Flipkart and Myntra seller tools can import, and it accepts stock
updates from a marketplace. It does not post to the marketplaces itself: that needs your seller
accounts and their API keys, which only you can create.

## Feed

- `GET /api/admin/marketplace/feed.csv`: one row per product, or per size and colour, with SKU, title,
  price, MRP, stock, image link, HSN and GST rate. Spreadsheet formulas are neutralised.
- `GET /api/admin/marketplace/feed.json`: the same rows as JSON.

Download either from the admin (signed in as an admin) and upload it in the seller tool.

## Stock from a marketplace

When a marketplace sells something, it sends the new stock count for that SKU:

    POST /api/webhooks/marketplace-stock
    x-api-key: <MARKETPLACE_TOKEN>
    { "sku": "TF2-BLK-8", "stock": 4 }

Set `MARKETPLACE_TOKEN` to a random string of 24 or more characters. Without it, the endpoint refuses
everything. Use a different value for each marketplace if you can.

## What you need to do

1. Create seller accounts on Amazon, Flipkart and Myntra (business documents: GSTIN, PAN, bank).
2. Make sure every product has a SKU (Products > edit) and a correct HSN and GST rate.
3. Import the feed into each marketplace, or ask their support for an API integration.
4. Point each marketplace's order notifications to `/api/webhooks/marketplace-stock` if they can call
   webhooks, or update stock by hand from the feed.
