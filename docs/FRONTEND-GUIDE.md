# Nexthlon frontend guide, word by word

Everything the browser receives: EJS templates (HTML made on the server), plain JavaScript (no React,
no jQuery), and plain CSS. Explained from the current code. Animation has its own guide:
`docs/ANIMATION-GUIDE.md`.

---

## 0. The big picture: how one page reaches the screen

```
1. Browser asks:          GET /products/running-shoe
2. routes/pageRoutes.js   → controllers/pageController.js
3. Controller             gets data from a service, then res.render("pages/product", { title, product, ... })
4. EJS                    views/pages/product.ejs + partials (head, header, footer, scripts) → one HTML page
5. Browser shows HTML     → loads ONE CSS bundle and the JS files (all "defer")
6. JavaScript             finds data-* attributes and adds behaviour (add to cart, zoom, filters)
7. Clicks                 → Nx.api("/api/...") → JSON → the page updates without reloading
```

Two key ideas:

- **Server-rendered first.** The full page arrives as HTML, so it shows fast and works even if JavaScript fails. JavaScript only _adds_ behaviour. This is called **progressive enhancement**.
- **`data-*` attributes are the glue.** EJS writes `data-cart-add="<id>"`; JavaScript finds `[data-cart-add]` and listens for clicks. The security policy forbids inline `<script>` and `onclick=""`, so all behaviour lives in `.js` files.

### Folder map

| Folder                                 | What                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `views/pages/`                         | 23 whole pages: home, products, product, cart, checkout, orders, wallet, auth, policies, 404… |
| `views/partials/`                      | Reused pieces: `head`, `header`, `footer`, `scripts`, `product-card`, `pagination`, `stock`…  |
| `views/account/`                       | My Account sections                                                                           |
| `views/admin/`                         | Admin console sections                                                                        |
| `public/js/`                           | Browser scripts (one per job)                                                                 |
| `public/js/3d/`, `fx/`, `motion/`      | WebGL engine, effects, animation loop                                                         |
| `public/css/`                          | Styles: tokens → components → style → page files → motion → mobile                            |
| `public/fonts/`, `public/img/`         | Self-hosted fonts, icons sprite (`icons.svg`), favicon                                        |
| `public/sw.js`, `manifest.webmanifest` | Installable app (PWA)                                                                         |

---

## 1. EJS: the four tags you must know

EJS is HTML with JavaScript inside special tags. It runs **on the server**; the browser never sees EJS.

| Tag           | Meaning                                                          | Example from the project             |
| ------------- | ---------------------------------------------------------------- | ------------------------------------ |
| `<%= x %>`    | Print `x`, **escaped** (`<` becomes `&lt;`). Safe for user data. | `<%= p.name %>`                      |
| `<%- x %>`    | Print `x` **raw** (as HTML). Only for trusted HTML.              | `<%- icon('cart') %>`                |
| `<% code %>`  | Run JavaScript, print nothing.                                   | `<% if (p.stock > 0) { %> … <% } %>` |
| `<%# note %>` | A comment, never sent to the browser.                            | `<%# Quick add (store.js) … %>`      |

`<%- include('partial', { data }) %>` inserts another template, e.g. `<%- include('stock', { stock: p.stock }) %>`.

**Why escaping matters (security):** if a product name were `<script>alert(1)</script>`, `<%= %>` prints it as harmless text. Using `<%- %>` there would run it — an **XSS** attack. That is why user data always uses `<%= %>`.

---

## 2. Every page's skeleton

A page file (example `views/pages/cart.ejs`) starts and ends the same way:

```ejs
<%- include('../partials/head') %>      ← <html>, <head>, CSS, meta tags, opens <body>
<%- include('../partials/header') %>    ← logo, menu, search, cart icon
<main id="main" class="container page"> … this page's content … </main>
<%- include('../partials/footer') %>
<%- include('../partials/scripts') %>   ← toasts box, dialogs, all <script> tags, closes </body></html>
```

### 2.1 `views/partials/head.ejs`, line by line

| Line  | Code                                                                            | Meaning                                                                                                |
| ----- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1-2   | `<!doctype html>` `<html lang="en">`                                            | Modern HTML; language English (screen readers and Google use it).                                      |
| 4     | `<meta charset="utf-8">`                                                        | Text encoding, so ₹ and all letters show correctly.                                                    |
| 5     | `<meta name="viewport" content="width=device-width, initial-scale=1">`          | **Makes the site responsive on phones**: the page width = the phone's width.                           |
| 6     | `<title><%= title %></title>`                                                   | Tab title; each controller passes `title`.                                                             |
| 7-8   | `pageDescription` … `<meta name="description">`                                 | The text Google shows under the link. A default is built from store settings.                          |
| 9-11  | `noindex` / `canonical`                                                         | Private pages say "don't index me"; public pages give their one true address.                          |
| 13-26 | `og:*`, `product:price:*`, `twitter:card`                                       | **Link previews**: the photo, title and price you see when a link is pasted in WhatsApp, Instagram, X. |
| 27    | `application/ld+json`                                                           | Structured data so Google can show price and rating stars.                                             |
| 28-29 | `color-scheme`, `theme-color`                                                   | Dark theme; the phone's address bar turns obsidian.                                                    |
| 30    | `favicon.svg`                                                                   | The tab icon.                                                                                          |
| 32-36 | `manifest`, `apple-touch-icon`, `mobile-web-app-capable`                        | **Installable app** (PWA): add to home screen, opens full screen.                                      |
| 38-39 | `preconnect`                                                                    | Opens a connection to the photo server early, so photos arrive sooner.                                 |
| 41    | `<script src=theme.js>` (not deferred)                                          | Must run **before the first paint**: sets dark theme and the `js` class so nothing jumps.              |
| 43    | `page-reveal.js` (not deferred)                                                 | Page transitions need to run before the first frame.                                                   |
| 45-46 | `<link rel="preload" … font>`                                                   | The two fonts the first screen needs start downloading immediately.                                    |
| 51-56 | `sheets = ['tokens','components','style'] … ['mobile']` + `styleBundle(sheets)` | **All CSS in ONE request**, in cascade order. `mobile` is last so phone fixes win.                     |
| 58    | `<body class=…>` `data-admin-path`                                              | Admin pages carry their private path; `app.js` uses it to know which session to renew.                 |

### 2.2 `views/partials/scripts.ejs`, line by line

| Line  | Code                                                  | Meaning                                                                                                               |
| ----- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | `<div class="toasts" id="toasts" aria-live="polite">` | Where pop-up messages appear. `aria-live` makes screen readers read them aloud.                                       |
| 3-13  | `<dialog class="confirm-dialog">`                     | One shared "Are you sure?" box, used by `Nx.confirm()`. `<form method="dialog">` closes it with the button's `value`. |
| 16-29 | consent banner                                        | Cookie choice, **only** if the owner set up analytics.                                                                |
| 31    | Razorpay `checkout.js`                                | Only on pages that take payment.                                                                                      |
| 33    | `ticker.js`                                           | The animation loop, first, because everything else uses it.                                                           |
| 34-36 | `app.js`, `header.js`, `store.js`                     | Loaded on **every** page: shared helpers, header, add-to-cart.                                                        |
| 37    | `consent.js`                                          | Analytics, only after consent.                                                                                        |
| 39    | `pwa.js`                                              | Service worker and "Get the app".                                                                                     |
| 41    | `motion.js`                                           | Scroll reveals and tilt (My Account turns it off for calm).                                                           |
| 42-44 | `scripts.forEach(...)`                                | **Page-specific scripts**: the controller passes e.g. `scripts: ['cart']`.                                            |
| 46-48 | `modules.forEach(...)` `type="module"`                | ES modules (the 3D scenes).                                                                                           |
| all   | `defer`                                               | Download in parallel, run **after** the HTML is parsed, in order. Never blocks the page.                              |
| all   | `asset('/js/app.js')`                                 | Adds `?v=<hash>`: cached for a year, a new version gets a new URL.                                                    |

### 2.3 Where template helpers come from: `middleware/viewLocals.js`

Everything in `res.locals` can be used in every template without passing it:

| Helper                                   | What it does                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `currentUser`                            | The signed-in user (or null) — set by `attachUser`.                            |
| `formatPrice(paise)`                     | `12345600` → `₹1,23,456`.                                                      |
| `formatDate`, `firstName`                | Readable date; first word of a name.                                           |
| `srcsetFor`, `sizedUrl`, `cardSizes`     | Responsive photo sizes (small phones download small photos).                   |
| `asset(path)`, `styleBundle(list)`       | Versioned JS/CSS URLs.                                                         |
| `icon(name, class)`                      | `<svg><use href="/img/icons.svg#cart">` — one icon sprite file for every icon. |
| `store`, `navCategories`, `whatsappChat` | Store details, menu categories, WhatsApp link.                                 |

---

## 3. A component, word by word: `views/partials/product-card.ejs`

```ejs
<article class="product-card" data-reveal data-tilt>
```

`<article>` = a self-contained item (good HTML meaning). `data-reveal` → `motion.js` fades it in on scroll. `data-tilt` → it tilts toward the mouse.

```ejs
<% const set = srcsetFor(p.image); %>
<img src="<%= p.image %>" srcset="<%= set %>" sizes="<%= cardSizes %>" alt="" loading="lazy" decoding="async" width="400" height="400">
```

- `srcset` + `sizes`: the browser **picks the right photo size** for the screen (400, 800 or 1600 px wide).
- `alt=""`: decorative, because the name is written below (screen readers skip it).
- `loading="lazy"`: only downloads when near the screen. The first cards use `eager` / `fetchpriority="high"` instead.
- `width`/`height`: reserve space so the layout doesn't jump.

```ejs
<% if ((!currentUser || currentUser.role === 'customer') && p.stock > 0) { %>
  <button type="button" class="card-add" data-cart-add="<%= p._id %>"> … <span class="sr-only">Add <%= p.name %> to cart</span></button>
<% } %>
```

Quick-add button only for shoppers (not admins) and in-stock products. `data-cart-add` holds the product id for `store.js`. `sr-only` text is invisible but read by screen readers, because the button only shows an icon.

```ejs
<button type="button" class="wish-btn" data-wish-id="<%= p._id %>" aria-pressed="false" hidden>
```

Wishlist heart. `hidden` until JavaScript shows it (no broken button without JS). `aria-pressed` = on/off state for screen readers.

```ejs
<h3 class="product-name"><a href="/products/<%= p.slug %>"><%= p.name %></a></h3>
```

A **real link** — works without JavaScript, and Google can follow it. `slug` = readable URL name.

```ejs
<% if (p.ratingCount > 0) { %> … <%= p.ratingAverage.toFixed(1) %> …
```

Rating only if someone rated it; `toFixed(1)` → `4.3`.

```ejs
<span class="price"><%= formatPrice(p.price) %></span>
<% if (p.mrp > p.price) { %> <s><%= formatPrice(p.mrp) %></s> <span class="off"><%= p.discountPercent %>% off</span> <% } %>
```

Price from paise; the crossed-out MRP and "% off" only when there is a discount. `<s>` = struck-through.

```ejs
<%- include('stock', { stock: p.stock }) %>
<% if (p.price >= store.freeDeliveryMin && p.stock > 0) { %><span>Free delivery</span><% } %>
```

Stock label partial ("Only 3 left"), and "Free delivery" if the price is over ₹499.

---

## 4. `public/js/app.js` — the shared toolbox (717 lines)

Loaded on every page. It creates one global object, **`window.Nx`**, so other files call `Nx.api()`, `Nx.toast()` and so on.

```js
(function () {
  "use strict";
  const Nx = (window.Nx = window.Nx || {});
```

- `(function () { … })();` — an **IIFE** (runs at once). Keeps variables private, not global.
- `"use strict"` — stricter JavaScript that catches mistakes.
- `window.Nx = window.Nx || {}` — reuse `Nx` if another file made it first, else create it.

### 4.1 Money formatting

```js
const wholeRupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
Nx.formatPrice = function formatPrice(paise) {
  const value = Math.round(Number(paise) || 0);
  return value % 100 === 0
    ? wholeRupees.format(value / 100)
    : exactRupees.format(value / 100);
};
```

- `Intl.NumberFormat("en-IN")` — the browser's built-in formatter, with **Indian grouping**: 1,23,456.
- `Number(paise) || 0` — bad input becomes 0.
- `value % 100 === 0` — whole rupees? Show `₹2,999`; otherwise `₹2,999.50`.

### 4.2 `Nx.photoSized(url, width)`

Picks a smaller copy of a photo: our uploads exist as `-200/-400/-800/-1600.webp`; Unsplash photos take `w=` in the URL. Smaller photos = faster phones.

### 4.3 `send()` — one request (lines 62-89)

```js
async function send(url, {method = 'GET', body} = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = {Accept: 'application/json'};
  if (body !== undefined && !isForm)
    headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined || isForm ? body : JSON.stringify(body),
    });
  } catch {
    const offline = new Error(
      "We couldn't reach Nexthlon. Check your connection and try again.",
    );
    offline.status = 0;
    throw offline;
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return {response, data};
}
```

| Word / line                     | Meaning                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `async` / `await`               | Wait for the network without freezing the page.                                       |
| `{ method = "GET", body } = {}` | Destructuring with defaults: GET unless told otherwise.                               |
| `FormData`                      | File uploads (photos) — the browser sets their content type itself.                   |
| `Accept: application/json`      | "Please answer in JSON."                                                              |
| `fetch(url, …)`                 | The browser's built-in HTTP request.                                                  |
| `credentials: "same-origin"`    | **Send our cookies** (the login JWT) automatically. JavaScript never reads the token. |
| `JSON.stringify(body)`          | Object → JSON text.                                                                   |
| `catch` → `offline`             | `fetch` only throws when the network is down → a friendly message.                    |
| `response.json()`               | Parse the reply; if it isn't JSON, use `{}`.                                          |
| returns `{ response, data }`    | Never throws for 400/500 — the caller decides.                                        |

### 4.4 `renewSession()` — one shared renewal (lines 94-103)

```js
let renewal = null;
function renewSession() {
  if (!renewal) {
    renewal = send(REFRESH_URL, {
      method: 'POST',
      body: {scope: isAdminPage() ? 'admin' : 'customer'},
    })
      .then(({response}) => response.ok)
      .catch(() => false)
      .finally(() => {
        renewal = null;
      });
  }
  return renewal;
}
```

If five requests all get "expired" (401) at once, they **share one** renewal promise. Two renewals would rotate the refresh token twice and look like theft. `finally` clears it for next time.

### 4.5 `Nx.api()` — what every script uses (lines 109-133)

```js
Nx.api = async function api(url, options = {}) {
  const path = new URL(url, window.location.href).pathname;
  const canRenew = !LOGIN_CALLS.includes(path) && path !== REFRESH_URL;
  let { response, data } = await send(url, options);
  if (response.status === 401 && canRenew && await renewSession()) {
    ({ response, data } = await send(url, options));
  }
  if (!response.ok) {
    …
    const error = new Error(data.message || "Something went wrong. Please try again.");
    error.status = response.status;
    error.fieldErrors = data.errors || {};
    error.code = typeof data.code === "string" ? data.code : "";
    throw error;
  }
  return data;
};
```

1. `new URL(url, location).pathname` — the path part, e.g. `/api/cart`.
2. `canRenew` — a wrong password on the login form is also 401, but must **not** trigger renewal.
3. 401 → renew the JWT → **send the same request again**. The visitor never notices the 15-minute expiry.
4. Still not OK → if 401/blocked, go to the sign-in page with `?next=` (come back after).
5. Build an `Error` with the server's message, field errors (`{ email: "…" }`) and a short `code`, then `throw` — so callers use `try/catch`.
6. OK → return the JSON data.

### 4.6 Toasts — `Nx.toast(message, type, options)`

Creates a small message box in `#toasts`: icon, text (set with `textContent`, **never** `innerHTML`, so a message can't inject HTML), an optional link (only if it starts with `/`, so it can't send you to another site), a close button and a timer bar. Errors get `role="alert"` so screen readers interrupt.

### 4.7 Forms

| Function                       | Word-by-word                                                                                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Nx.formValues(form)`          | Loops `form.elements`; skips nameless or disabled; checkbox → `checked`; radio → only the chosen one; others → `value`. Returns `{ name: value }`.              |
| `Nx.clearErrors(form)`         | Empties every `[data-error-for]` message and removes `aria-invalid`.                                                                                            |
| `Nx.showErrors(form, errors)`  | For each `name → message`: writes the message under the field, marks the input `aria-invalid="true"` (red, and announced), and **focuses the first bad field**. |
| `Nx.busy(button, true)`        | Saves the label in a `WeakMap`, shows a spinner + "Please wait…", disables the button (no double submit), `aria-busy`. `false` puts it back.                    |
| `Nx.submitForm(form, { url })` | clearErrors → busy → `Nx.api(url, formValues)` → on error showErrors + message → `finally` un-busy. Every form on the site uses this one function.              |

### 4.8 `Nx.setCartCount(count)`

Finds every `[data-cart-count]` badge, hides it at 0, rolls the number, and restarts the "bump" animation (`void badge.offsetWidth` forces the browser to notice the class was removed before adding it again).

### 4.9 `Nx.confirm({ title, message })`

Fills the shared `<dialog>`, calls `showModal()` (browser traps focus, Escape closes), **focuses Cancel first** for dangerous actions (so Enter never deletes by accident), and returns a **Promise** that resolves `true` only if the "ok" button closed it. Usage: `if (await Nx.confirm({...})) remove();`

### 4.10 The rest of app.js

Menus (`[data-menu]`), the header tucking away on phones, sign out, show/hide password, coming back after an expired page, footer accordions on phones, and the page transition where the product photo flows into the product page.

---

## 5. A complete interaction, word by word: the cart page (`public/js/cart.js`)

The page arrives already rendered by `views/pages/cart.ejs`; each row has `data-cart-item="<id>"`, `+`/`−` buttons with `data-cart-step="1"`/`"-1"`, and a remove button.

```js
page.addEventListener("click", async event => {
  const step = event.target.closest("[data-cart-step]");
  const remove = event.target.closest("[data-cart-remove]");
  const row = event.target.closest("[data-cart-item]");
  if (!row || (!step && !remove && !save)) return;
  const id = encodeURIComponent(row.dataset.cartItem);
```

- **Event delegation:** ONE listener on the whole page instead of one per button. Works for rows added later too.
- `closest(selector)` — walks up from what was clicked to the nearest matching element.
- `row.dataset.cartItem` — reads `data-cart-item`. `encodeURIComponent` — safe in a URL.

```js
if (step) {
  const shown = row.querySelector('[data-cart-qty]');
  const quantity =
    Number(shown.dataset.value || shown.textContent) +
    Number(step.dataset.cartStep);
  await change(row, () =>
    Nx.api(`/api/cart/items/${id}`, {method: 'PATCH', body: {quantity}}),
  );
  return;
}
```

New quantity = current + 1 or − 1, sent with **PATCH** (= update part of something). Only the quantity is sent — **never a price**.

```js
const confirmed = await Nx.confirm({
  title: 'Remove this item?',
  message: `${row.dataset.name} will be taken out of your cart.`,
  confirmLabel: 'Remove',
});
if (confirmed)
  await change(row, () => Nx.api(`/api/cart/items/${id}`, {method: 'DELETE'}));
```

Ask first, then **DELETE**.

```js
async function change(row, request) {
  row.classList.add("is-busy");
  row.setAttribute("aria-busy", "true");
  row.querySelectorAll("button").forEach(button => { button.disabled = true; });
  try {
    const result = await request();
    render(result.cart);
    Nx.toast(result.message);
  } catch (error) {
    Nx.toast(error.message, "error");
    render((await Nx.api("/api/cart")).cart);
  } finally {
    if (row.isConnected) { row.classList.remove("is-busy"); … }
  }
}
```

1. Mark the row busy and disable its buttons (no double clicks).
2. Run the request; `render()` redraws totals **from the server's reply**; toast "Updated".
3. Error → show it, then reload the real cart so the screen matches the server.
4. `finally` → un-busy, but only if the row still exists (`isConnected`) — it may have been removed.

`render(cart)` updates each row's quantity, the subtotal, savings, delivery fee, "₹X more for free delivery", the total, the empty state, and calls `Nx.setCartCount()`.

---

## 6. Every browser script and its job

| File                                                      | Lines | What it does                                                                                                                                                                |
| --------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `theme.js`                                                | 27    | Before paint: `data-theme="dark"`, adds `js` and `will-3d` classes so nothing jumps.                                                                                        |
| `page-reveal.js`                                          | 44    | Page transitions (arriving side).                                                                                                                                           |
| `motion/ticker.js`                                        | 92    | The one animation loop.                                                                                                                                                     |
| `app.js`                                                  | 717   | `Nx` toolbox: API, renewal, money, toasts, forms, dialogs, menus, header.                                                                                                   |
| `header.js`                                               | 475   | Search panel (ideas, live suggestions) and the phone menu drawer (`<dialog>`).                                                                                              |
| `store.js`                                                | 695   | `Nx.addToCart` for every button, fly-to-cart, wishlist hearts, guest cart badge.                                                                                            |
| `motion.js`                                               | 216   | Scroll reveal, tilt, glass header, counters, image fade-in.                                                                                                                 |
| `catalog.js`                                              | 757   | Filters with **one state object** read from and written to the URL (refresh/back/share give the same page); phone filter sheet; gallery. Without JS it's a normal GET form. |
| `product.js`                                              | 979   | Photo zoom (hover magnifier + full-screen viewer), delivery date by PIN code, sizes, sharing.                                                                               |
| `cart.js`                                                 | 351   | Product page quantity stepper; cart page +/−, remove, save for later, live totals.                                                                                          |
| `checkout.js`                                             | 604   | Three steps on one page (address, summary, payment), coupon, wallet. Sends only choices; shows the server's totals.                                                         |
| `payment.js`                                              | 341   | Razorpay in our own overlay: opening → verifying → success (confetti) / failed. Card details only inside Razorpay's window.                                                 |
| `auth.js`                                                 | 471   | Login/signup: 3D card flip, live checks, password strength, email typo hints, Caps Lock warning. Server re-checks everything.                                               |
| `account.js`                                              | 587   | My Account sections as modules with `init/destroy`; listeners removed with one `AbortSignal` (no leaks).                                                                    |
| `section-nav.js`                                          | 244   | Switch account/admin sections without reload: fetch with `X-Partial: 1`, swap content, update URL, Back works.                                                              |
| `profile.js`                                              | 224   | Profile page: account details, password change, address book.                                                                                                               |
| `home.js`                                                 | 81    | Deals countdown (flip digits) and deal flip cards.                                                                                                                          |
| `home3d.js`, `showroom3d.js`, `auth3d.js`, `3d/*`, `fx/*` | —     | 3D and effects (see ANIMATION-GUIDE.md).                                                                                                                                    |
| `confetti.js`                                             | 98    | 2D confetti fallback.                                                                                                                                                       |
| `consent.js`                                              | 147   | Cookie banner; analytics loads only after "Allow"; respects Global Privacy Control.                                                                                         |
| `pwa.js`                                                  | 105   | Registers the service worker; "Get the app" install button (iPhone gets instructions).                                                                                      |
| `contact.js`                                              | 38    | Contact form.                                                                                                                                                               |
| `image-editor.js`                                         | 493   | Admin photo editor: crop, rotate, flip, or swap the file. Loaded on the first "Edit" click.                                                                                 |
| `admin*.js`                                               | —     | Admin shell (sidebar, Ctrl+K palette, search), dashboard charts, products, orders, coupons, inventory, wallet tools.                                                        |

---

## 7. CSS: how the styles are organised

| File                                                                                             | Lines | Role                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tokens.css`                                                                                     | 352   | **Design tokens**: self-hosted fonts (`@font-face`), colours (`--brand` volt, obsidian backgrounds), spacing, radius, shadows, timing. Change a token, the whole site follows. |
| `components.css`                                                                                 | 734   | Reusable pieces: buttons, inputs, cards, badges, dialogs, toasts.                                                                                                              |
| `style.css`                                                                                      | 1692  | Layout and the store pages (header, footer, grids, product cards, cart).                                                                                                       |
| `home.css`, `product.css`, `checkout.css`, `filters.css`, `auth.css`, `account.css`, `admin.css` | —     | One file per area, loaded only on those pages.                                                                                                                                 |
| `motion.css`                                                                                     | 313   | All animation, inside `prefers-reduced-motion: no-preference`.                                                                                                                 |
| `mobile.css`                                                                                     | 164   | Phone fixes, loaded **last** so they win.                                                                                                                                      |

Important CSS ideas used:

- **Custom properties** (`--brand: …; color: var(--brand)`): one value, used everywhere.
- **Cascade order**: later files win, so the bundle order in `head.ejs` matters.
- **Media queries** (`@media (max-width: …)`): different layout per screen size — responsive design.
- **Self-hosted fonts with `unicode-range`**: the browser downloads only the font file it needs; the ₹ sign has its own 1.2 KB file instead of an 84 KB one.
- **`font-display: swap`**: text shows immediately in a fallback font, then swaps.
- **Colour rules** (top of tokens.css): volt for buttons/highlights, ember only for deals, text on colour always uses a matching `--on-*` token for readable contrast.

---

## 8. Accessibility (say these in the exam)

| Technique                                                                        | Where                         |
| -------------------------------------------------------------------------------- | ----------------------------- |
| Real HTML: `<main>`, `<nav>`, `<article>`, `<button>`, `<dialog>`, `<h1>`–`<h3>` | All templates                 |
| `sr-only` text for icon-only buttons                                             | product card, cart            |
| `aria-live` regions for toasts and counts                                        | `scripts.ejs`, cart heading   |
| `aria-invalid` + focus the first bad field                                       | `Nx.showErrors`               |
| `aria-busy`, `aria-pressed`, `aria-current`                                      | buttons, wishlist, breadcrumb |
| Cancel focused first on dangerous confirms                                       | `Nx.confirm`                  |
| Keyboard: arrow keys, Escape, Tab order                                          | ring, dialogs, menus          |
| `prefers-reduced-motion`                                                         | motion.css, every 3D scene    |

## 9. Performance (say these too)

- Server-rendered HTML → fast first paint, works without JS.
- **One** CSS request (`styleBundle`), all JS `defer`, versioned URLs cached for a year.
- Fonts preloaded and self-hosted; ₹ split out.
- Responsive images (`srcset`), `loading="lazy"`, fixed `width/height` (no layout jump).
- 3D and effects load lazily, only when needed.
- Guest pages identical for everyone → a CDN can cache them; the cart badge is filled in after load.

## 10. Security in the frontend

- `<%= %>` escapes all user data (stops XSS).
- Content Security Policy forbids inline scripts → all JS in files, data passed through `data-*`.
- The JWT is in an HttpOnly cookie: `Nx.api` never sees it.
- Toast links must start with `/`; messages use `textContent`, not `innerHTML`.
- The browser **never sends prices** — only ids, quantities and choices.

## 11. One-minute exam answer

> "The frontend is server-rendered with EJS: a controller passes data to a page template that includes shared partials for the head, header, footer and scripts. That gives fast, SEO-friendly HTML that works without JavaScript. Plain JavaScript files then add behaviour through data attributes. Every script uses one toolbox, `Nx` in app.js: `Nx.api` sends requests with the login cookie, renews an expired JWT once and retries, and turns errors into messages; `Nx.submitForm` shows field errors and busy buttons. The browser never sends prices; it shows the totals the server returns. CSS is organised from design tokens to components to pages to mobile, bundled into one request. It is accessible — real HTML, ARIA, keyboard support, reduced motion — and fast: deferred scripts, responsive images, self-hosted fonts."
