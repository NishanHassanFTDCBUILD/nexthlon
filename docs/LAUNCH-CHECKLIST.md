# Nexthlon: what is left before going live

This list is for anyone on the team. Each item says **what**, **why**, and **who** does it.
Code work is finished and committed. What remains is mostly accounts, secrets, business details,
and content, plus a few small website items.

Legend: **[You]** = the owner must do it (needs an account, card, or legal detail).
**[Dev]** = a developer task in the code.

---

## 1. Accounts to create

| #   | Service                                           | Why                                                  | Who              | Where the settings go                                                   |
| --- | ------------------------------------------------- | ---------------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| 1   | **MongoDB Atlas** (database)                      | Holds all products, orders and customers             | [You]            | `MONGODB_URI`                                                           |
| 2   | **Cloudinary** (photo storage)                    | Product and review photos                            | [You]            | `STORAGE_DRIVER`, `CLOUDINARY_*`                                        |
| 3   | **Hosting platform** (Render, Railway or similar) | Runs the website                                     | [You]            | `SITE_URL`, `TRUST_PROXY`                                               |
| 4   | **Domain name** and HTTPS                         | Your address on the web                              | [You]            | `SITE_URL`                                                              |
| 5   | **Razorpay** (payments) live account and KYC      | Takes card, UPI and netbanking money                 | [You]            | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`     |
| 6   | **Email sender** (Brevo, or any SMTP service)     | Order, password and offer emails                     | [You]            | `MAIL_DRIVER`, `BREVO_API_KEY` or `SMTP_*`, `MAIL_FROM`                 |
| 7   | **Shiprocket** (courier aggregator)               | One-click shipping, tracking, PIN checks             | [You]            | `SHIPROCKET_*`, `SHIPPING_PICKUP_PINCODE`                               |
| 8   | **WhatsApp Business** (Meta Cloud API)            | WhatsApp order updates                               | [You]            | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_SUPPORT_NUMBER` |
| 9   | **MSG91** (SMS)                                   | One-time codes for Cash on Delivery                  | [You]            | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`                               |
| 10  | **Sentry** (error alerts)                         | Tells you when something breaks                      | [You] (optional) | `SENTRY_DSN`                                                            |
| 11  | **Google Analytics 4 or Plausible**               | Visitor counts, after consent                        | [You] (optional) | `ANALYTICS_PROVIDER`, `ANALYTICS_ID`                                    |
| 12  | **Meta Business** (Pixel, ads)                    | Ads tracking, after consent                          | [You] (optional) | `META_PIXEL_ID`                                                         |
| 13  | **Redis**                                         | Shared rate limits when running more than one server | [You] (optional) | `REDIS_URL`                                                             |
| 14  | **Amazon, Flipkart, Myntra seller accounts**      | Selling on marketplaces                              | [You] (optional) | Feed download; `MARKETPLACE_TOKEN` for stock sync                       |

Each account needs your own identity documents. Only you should enter passwords and card details.

## 2. Secrets to generate (keep them private)

Use a password manager. Never paste these in chat, email, or a public repository.

- `JWT_SECRET`: a long random string (at least 40 characters).
- Push notification keys: run `npm run push:keys`. Keep the output. Changing it later breaks saved devices.
- `MARKETPLACE_TOKEN`: random, at least 24 characters.
- `SHIPROCKET_WEBHOOK_TOKEN`: random, at least 16 characters.
- Database user password (from Atlas).
- An admin password, and `ADMIN_PATH`: a private address for the admin console (for example `/nx-console-7f3k`).

## 3. Business details (appear on invoices and policy pages)

Set these with the `STORE_*` values. The startup check warns about any placeholder left in production.

- Legal business name and registered address.
- GSTIN, and the GST state (`STORE_STATE`) and scheme (`STORE_GST_SCHEME`: regular or composition).
- Support email, phone, and support hours.
- Grievance officer name (required by Indian e-commerce rules).
- Trademark check for the name "Nexthlon" (the user said it may be close to "Decathlon"). Ask a lawyer before launch.

## 4. Content you must write or replace

- **Policy pages** (terms, privacy, refunds, shipping). They are templates with `[square brackets]`. Replace every bracket. Have a lawyer or CA check them.
- **Products**: real photos, descriptions, sizes and colours, SKU codes, HSN code and GST rate, country of origin, net quantity, manufacturer or importer name and address. Current products are sample data (Unsplash stock photos). Replace them.
- **Guides** for `/guides` (sport tips and stories). Created through the admin API for now (see section 6).
- **Bundles** ("Complete the kit"). Created through the admin API for now.
- **Offers and coupons** you want to run at launch.
- **Shipping rules**: confirm delivery times and the free-delivery threshold match your courier.

## 5. Hosting steps (in order)

1. **Create the MongoDB cluster** and user. Copy the connection string, add the database name `nexthlon`.
2. **Create the Cloudinary account** and copy its cloud name, API key and API secret.
3. **Create the hosting service**, connect it to the code repository, and set the build command to `npm install` and the start command to `npm start`.
4. **Enter every setting** from `.env.example` on the host (not in a file you upload).
5. **Point your domain** at the host and turn on HTTPS. Set `SITE_URL` to the final address with `https://`.
6. **Run the checks** from the host's shell (or your computer, pointed at the live database):
   - `npm run setup:check`
   - `npm run db:check`
7. **Create the first admin**: `npm run seed:admin`. Sign in at your private admin address.
8. **Load products and categories** through the admin (or `npm run seed:products` for samples, then replace them).
9. **Test a real order end to end**: sign up, add to cart, pay with a small real amount, check the email, the WhatsApp message (if set), the invoice PDF, and the tracking page.
10. **Test each refund path** once: cancel an item, return an item, refund to the wallet and to the original payment.
11. **Test on a phone**: sign up, checkout, notifications, install the app.
12. **Set backups**: `npm run db:backup` on a schedule, and check you can restore (`npm run db:restore`) on a copy.
13. **Turn on monitoring**: Sentry alerts, and the job status page (`npm run jobs:status`).
14. **Submit your sitemap** to Google Search Console (the address is `/sitemap.xml`).
15. **Announce launch**: only after steps 9 to 13 pass.

## 6. Website items still missing

These are small, but they are not finished:

- **Admin screens for bundles and guides.** Right now they are created through the admin API. A simple screen would make content work easier for non-developers.
- **Roadmap file**: `docs/ROADMAP.md` still shows some steps as not started. It needs updating.
- **Push notifications, WhatsApp and SMS**: code is done, but they only work once the accounts and keys in sections 1 and 2 exist.
- **Marketplace connection**: the feed and stock sync work, but there is no direct link to Amazon, Flipkart or Myntra. That needs their seller accounts and API access.

## 7. Legal and business (outside the code)

- GST registration (and composition scheme if you use it).
- Company registration and bank account.
- Consumer grievance officer, and a published grievance process.
- Payment gateway KYC (Razorpay will ask for documents).
- Courier contracts (through Shiprocket or direct).
- Insurance for goods in transit, if you want it.

## 8. Ongoing after launch

- Check the admin dashboard and the job queue each day.
- Replace product photos and descriptions as stock changes.
- Watch refused-parcel (RTO) rates and COD refusals.
- Renew domain, hosting, database plan (move from M0 to M10 when orders grow), and SSL.
- Review reviews and questions weekly (admin Questions page).

---

## Quick status summary

| Area                                            | State                                             |
| ----------------------------------------------- | ------------------------------------------------- |
| Shop, cart, checkout, orders, invoices (GST)    | Done                                              |
| Payments (Razorpay)                             | Code done. Needs live keys and KYC                |
| Shipping (Shiprocket, tracking, returns)        | Code done. Needs account                          |
| Emails, WhatsApp, SMS, push                     | Code done. Needs accounts and keys                |
| Privacy, consent, data download                 | Done                                              |
| Reviews with photos, product questions          | Done                                              |
| Search (typos, synonyms, suggestions)           | Done                                              |
| Bundles, guides, marketplace feed               | Code done. Content and admin screens still needed |
| Photos, database, hosting                       | Need your accounts                                |
| Policy pages, product content, business details | Need your text and details                        |
