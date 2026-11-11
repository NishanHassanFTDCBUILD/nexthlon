# Deploy Nexthlon on Render (about 20 minutes)

You need: the GitHub repo (already connected), the MongoDB Atlas database, a Cloudinary account, and (for email) Brevo.

1. **Atlas:** Network Access > Add IP Address > `0.0.0.0/0` (Render's addresses change). Keep a strong database password.
2. **Push the code:** `git push` (the repo is https://github.com/NishanHassanFTDCBUILD/nexthlon).
3. **Render:** sign up at https://render.com with GitHub > **New > Blueprint** > pick the repo. Render reads `render.yaml`.
4. **Fill the blanks** Render asks for (copy from your local `.env`, same values):
   `MONGODB_URI`, `ADMIN_PATH`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `RAZORPAY_*`, `CLOUDINARY_*`, `BREVO_API_KEY`, `MAIL_FROM`.
   `SITE_URL`: the address Render shows (https://nexthlon-xxxx.onrender.com) until you have your own domain.
   `JWT_SECRET` is generated for you.
5. **Deploy.** When it is live, open `<site>/healthz` (should say ok) and `<site>/readyz` (database reachable).
6. **First admin and products** (once, from your computer, pointing at the same Atlas database):
   `npm run seed:admin` then `npm run seed:products`, and `npm run images:migrate` for existing photos.
7. **Razorpay webhook:** Razorpay dashboard > Webhooks > `<site>/api/payments/razorpay/webhook`, events
   `payment.captured`, `payment.failed`, `refund.processed`, secret = your `RAZORPAY_WEBHOOK_SECRET`.
8. **Your domain:** Render > Settings > Custom Domains, follow the DNS steps, then change `SITE_URL` and `MAIL_FROM` to it.
9. **Test everything:** sign up, reset password, order (cash on delivery), admin login.

Free Render plans sleep after inactivity, which also pauses emails and background jobs: use the paid `starter` plan for a real shop.
