# Deploy Nexthlon on Render (about 20 minutes)

You need: the GitHub repo (already connected), the MongoDB Atlas database, a Cloudinary account, and (for email) Brevo.

1. **Atlas:** Network Access > Add IP Address > `0.0.0.0/0` (Render's addresses change). Keep a strong database password.
   To run `npm run db:check` or the seed scripts from your computer, also add your own IP (Add Current IP Address).
   If `db:check` says "Nothing answered within 10 seconds", this list is the reason.
2. **Push the code:** `git push` (the repo is https://github.com/NishanHassanFTDCBUILD/nexthlon).
3. **Render:** sign up at https://render.com with GitHub > **New > Blueprint** > pick the repo. Render reads `render.yaml`.
4. **Fill the blanks** Render asks for (copy from your local `.env`, same values):
   `MONGODB_URI`, `ADMIN_PATH`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RAZORPAY_*`, `CLOUDINARY_*`, `BREVO_API_KEY`, `MAIL_FROM`.
   `SITE_URL`: the address Render shows (https://nexthlon-xxxx.onrender.com) until you have your own domain.
   `JWT_SECRET` is generated for you.
   `STORE_LEGAL_NAME`, `STORE_ADDRESS`, `STORE_GSTIN`, `STORE_SUPPORT_EMAIL`, `STORE_SUPPORT_PHONE`, `STORE_GRIEVANCE_OFFICER`:
   your business details for the footer, policy pages, invoices and emails. India's e-commerce rules and Razorpay need the
   real ones; until they are set the site shows a [placeholder] and the startup log warns about each one.
   `STORE_STATE` (your GST state, default Kerala) and `STORE_GST_SCHEME` (`regular` or `composition`) decide how GST
   invoices are split; the startup check warns when the GSTIN's first two digits do not match the state.
5. **Deploy.** When it is live, open `<site>/healthz` (should say ok) and `<site>/readyz` (database reachable).
6. **First admin and products** (once, from your computer, pointing at the same Atlas database):
   `npm run seed:admin` then `npm run seed:products`, and `npm run images:migrate` for existing photos.
7. **Razorpay webhook:** Razorpay dashboard > Webhooks > `<site>/api/payments/razorpay/webhook`, events
   `payment.captured`, `payment.failed`, `refund.processed`, secret = your `RAZORPAY_WEBHOOK_SECRET`.
8. **Your domain:** Render > Settings > Custom Domains, follow the DNS steps, then change `SITE_URL` and `MAIL_FROM` to it.
9. **Test everything:** sign up, reset password, order (cash on delivery), admin login.
10. **On a real phone** (iPhone Safari and an Android phone): see "What to check on a real phone" in `docs/mobile-audit-checklist.md`.

11. **Optional: Continue with Google.** In Google Cloud Console create a web OAuth client. Add the authorised redirect URI
    `<site>/api/auth/google/callback` (your SITE_URL plus that path, exactly). Then type `GOOGLE_CLIENT_ID` and
    `GOOGLE_CLIENT_SECRET` into Render. The button appears on the sign-in page once all three settings are present.
12. **Optional: sign in with a code to your phone.** It sends codes through MSG91 (SMS) or WhatsApp. Without a provider
    the code is written to the server log, which is fine for testing but not for customers. Set up the provider the same
    way you set up COD confirmation codes.
13. **After deploy, check the new pages:** `/track` (order ID and phone), `/find-my-size`, `/sign-in/phone`, and the Hindi switch in the header (`/lang/hi`, then `/lang/en`).
    A product with a video or a 360 spin needs its links set in the admin product form first.

The blueprint uses the **free** plan (good for a demo): it sleeps after 15 minutes idle, the first visit then takes about 50 seconds, and emails and background jobs pause while it sleeps. For a real shop, change `plan: free` to `plan: starter` in `render.yaml` (about $7 a month).
