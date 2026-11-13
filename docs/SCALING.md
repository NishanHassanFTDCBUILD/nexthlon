# Scaling Nexthlon to 50,000 people at once

The goal: the store stays fast with **50,000 visitors on it at the same moment** (a festival sale, an
influencer post). This page explains how the code is built for that, what was measured, and the hosting
steps only you can do. Do them in order, when traffic grows; none is needed for the first launch.

## The idea in one paragraph

50,000 people must not all reach your server and database. Most visitors browse **signed out**, and a
signed-out page is now the same for everyone, so a CDN (Cloudflare) can hand out a copy kept for a
minute without asking your server. Signed-in pages, carts, checkout and payments always reach the
server, which runs **one copy per CPU core** and **several servers** side by side. What those copies must
share (rate limits, cache clearing) goes through **Redis**. The database only sees what the caches
cannot answer.

## What the code already does

| Piece | Where | What it does |
|---|---|---|
| CDN-ready pages | `middleware/publicCache.js` | Signed-out store pages say `public, s-maxage=60`: a CDN may keep them a minute, browsers never. Anyone with a session cookie gets `private, no-store`. Errors are never cacheable. |
| Same page for every guest | `middleware/cartCount.js`, `public/js/store.js` | A guest's cart badge is filled in after the page loads (`GET /api/cart/count`), so the page itself has nothing personal in it. |
| All CPU cores | `server.js` | `WEB_CONCURRENCY=auto`: a small supervisor runs the migrations once, starts one copy per core, restarts a copy that crashes, and passes a shutdown on. Background jobs run in copy 0 only. |
| Catalogue cache | `utils/memo.js` | Home page and related products kept 30–60 s in each copy, one database load at a time, cleared on any product change. |
| Shared clearing | `services/cacheSync.js` | With Redis, a product change clears the cache on every copy of every server at once. |
| Shared rate limits | `middleware/rateLimitStore.js` | With Redis, sign-in, cart and order limits count across all copies; without it, per copy. Redis failing never blocks the store. |
| Order rush limit | `orderLimiter` in `middleware/rateLimit.js` | 20 order or payment starts per 10 minutes per customer. Payment verification is never limited. |
| Database connections | `MONGODB_MAX_POOL` | A cap per copy, with a start-up warning before Atlas's free-tier limit of 500. |
| Indexes | `npm run db:indexes` | Adds any missing index; never deletes. Run it after each deploy that adds a model or index. |
| Load test | `npm run load:test` | `--ramp 10,25,50,100` finds how much one server handles while 95% of answers stay under half a second. |

## What was measured (13 November 2026, on the development laptop)

- Home page with the catalogue cache: 63 → 171 requests a second (same code, cache off vs on).
- 1 copy vs 4 copies on the same laptop: home 80 → 172, product page 124 → 223 requests a second
  (about 2×; the laptop was busy with other programs, so a dedicated server should do better).
- A tiny endpoint answered 17,000 requests a second, so the network path is not the limit.

These are laptop numbers. Measure your real server after deploying (step 6).

## How many servers 50,000 people need (an estimate to check, not a promise)

Assumptions: a visitor opens a page about every 20 seconds and each page makes one or two small API
calls; about 80% browse signed out.

- 50,000 people → about **2,500 page views a second** at the peak, plus about **3,000–5,000 small API calls**.
- With Cloudflare keeping signed-out pages, about 2,000 of those page views never reach your server;
  roughly **500 page views a second** do (signed-in visitors, carts, checkout, first views of a page).
- A 2-CPU server running 2 copies should serve a few hundred page views a second (measure it: step 6).
  So expect **2–4 web servers** at the peak, and a **paid Atlas cluster (M20–M30)** for the database.

## Your steps

### 1. Cloudflare in front of your domain (free)

1. Add your domain to Cloudflare (free plan) and change the nameservers where you bought the domain.
2. **Caching > Cache Rules > Create rule**, named "Signed-out store pages":
   - When: *Custom filter expression*, using the expression editor:
     ```
     (http.request.method eq "GET")
     and (http.request.uri.path eq "/" or starts_with(http.request.uri.path, "/products") or http.request.uri.path in {"/about" "/contact" "/privacy" "/terms" "/refund-policy" "/shipping-policy"})
     and not (http.cookie contains "nx_sid=")
     and not (http.cookie contains "nx_token=")
     ```
   - Then: **Eligible for cache**, Edge TTL: **Use cache-control header if present** (the server says 60 s).
   - Do **not** add any rule that caches `/api`, `/cart`, `/checkout`, `/account`, `/login` or the admin path.
3. Check it: open the home page in a private window twice. The `cf-cache-status` response header should
   say `HIT` the second time. Signed in, it must say `DYNAMIC` or `BYPASS`, never `HIT`.

Why "only when there is no session cookie" instead of a "bypass if signed in" rule: a cookie bypass rule has
been reported to be unreliable, and without a match Cloudflare does not cache pages at all. The server
also sends `private, no-store` to anyone signed in, so a signed-in page can never be stored either way.

### 2. Redis (free to start), once you run more than one server

Any Redis works. Easiest: **Render > New > Key Value** (in the same region as the web service), or Upstash.
Copy its internal address (`redis://...` inside Render, or the `rediss://...` address from Upstash) into
`REDIS_URL` on the web service. The log then shows `redis.connected` and `cache_sync.started`.
Without Redis everything still works; limits are just counted per copy.

### 3. More servers on Render

1. Move the web service off the free plan (free instances sleep).
2. **Settings > Scaling**: start with 2 instances; add more when step 6 says so.
3. Keep `WEB_CONCURRENCY=auto` and `MONGODB_MAX_POOL=10` (already in `render.yaml`).

### 4. Atlas, when traffic comes

The free tier (M0) is fine for launch. Upgrade when the Atlas dashboard shows connections near 500 or
operations being throttled, before a planned sale. After upgrading you can raise `MONGODB_MAX_POOL` to 20.

### 5. Photos

Photos come from Cloudinary or your bucket's CDN, never through the app, so they do not load the server.

### 6. Measure your real server

Point the load test at a staging copy (never someone else's site):
```
npm run load:test -- https://staging.your-domain --ramp 10,25,50,100,200 --path /products
```
It prints how many requests a second one server handles. Divide the step above (about 500 page views a
second at the peak) by that number to get how many servers to run, and add one spare.
