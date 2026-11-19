# Nexthlon browser JavaScript, explained

Every file in `public/js/`: **what it does, why it exists, and the important code in it**.
At the end there is a **dictionary of every JavaScript word** used in these files.

No framework is used (no React, no jQuery). Each file is plain JavaScript that runs in the browser.

---

## 0. How the files are organised

### Two kinds of file

| Kind | Looks like | Loaded with | Why |
|---|---|---|---|
| **Classic script** | `(function () { "use strict"; ... })();` | `<script src defer>` | Old, simple, works everywhere. Shares things through `window.Nx`. |
| **ES module** | `import ... from "./3d/scene.js"` / `export function` | `<script type="module">` | Can import other files. Used for the 3D engine and effects. `package.json` with `"type": "module"` in `3d/` and `fx/` tells Node (for tests) that these are modules. |

### Load order (from `views/partials/scripts.ejs`)

```
In <head> (not deferred, run before the page paints):
  theme.js         → adds classes so nothing jumps
  page-reveal.js   → page-to-page transitions

At the end of <body> (all "defer"):
  motion/ticker.js → the one animation loop        ← first, because others use it
  app.js           → window.Nx toolbox              ← every page needs it
  header.js        → search + phone menu
  store.js         → add to cart, wishlist, cards
  consent.js       → cookies/analytics (only if set up)
  pwa.js           → installable app + push
  motion.js        → reveals, tilt (not on My Account / admin)
  page scripts     → e.g. cart.js, checkout.js (the controller lists them)
  modules          → e.g. home3d.js (3D)
```

### Three ideas every file follows

1. **Progressive enhancement** — the server sends complete HTML. JavaScript only *adds* behaviour. If a script fails, the page still works.
2. **`data-*` attributes are the hooks** — EJS writes `data-cart-add="id"`, JS finds `[data-cart-add]`. The security policy (CSP) forbids inline scripts, so behaviour lives in files.
3. **The server is the truth** — the browser never sends a price; it shows what the server returns.

---

## 1. Start-up files

### `theme.js` (27 lines) — *why: avoid layout jumps*
Runs in `<head>` **before the first paint**.
- `classList.add("js")` → CSS knows JavaScript is on (the phone filter sheet uses it).
- `classList.add("will-3d")` → only if motion is allowed and the visitor isn't saving data; the home hero is drawn at its final tall height straight away.
- Sets `data-theme="dark"` and removes the old `nx-theme` from `localStorage` (left over from a removed theme switch; nothing reads `data-theme` any more).
- `try { } catch { }` around everything: a blocked `localStorage` must never break the page.

### `page-reveal.js` (54 lines) — *why: smooth page transitions*
- `quiet(transition)` catches the promises of a cancelled View Transition, for both `pageswap` (leaving) and `pagereveal` (arriving), so no "Uncaught (in promise)" errors.
- On **Back/Forward** (`navigation.activation.navigationType === "traverse"`) it adds the type `"back"` or `"forward"` so CSS plays the animation the right way.
- Coming back from a product page: gives the matching card photo `viewTransitionName = "product-photo"`, so the big photo flows back into its card.

### `motion/ticker.js` (92 lines) — *why: one animation loop for the whole page*
- A **UMD wrapper**: in the browser it becomes `window.NxTicker`; in Node (`module.exports`) tests can load it.
- `add(fn)` subscribes an animation and **returns a stop function**.
- `tick(now)`: `dt` = seconds since last frame, **capped at 0.05** (no teleporting after a stall); runs queued **reads**, then all subscribers, then **writes** (avoids layout thrashing); calls `schedule()`.
- `schedule()` asks `requestAnimationFrame` **only if something is subscribed and the tab is visible**. An idle page uses no CPU.
- `visibilitychange`: hidden tab → `pause()`.
- `run()` wraps each call in `try/catch`: one broken animation never stops the others.

---

## 2. `app.js` (727 lines) — the shared toolbox, `window.Nx`

*Why: every page needs the same helpers. Writing them once avoids copies that drift apart.*

| Part | What it does | Why |
|---|---|---|
| `Nx.formatPrice(paise)` | `Intl.NumberFormat("en-IN")` → `₹1,23,456`; drops `.00` | Money is stored in paise; Indian digit grouping |
| `Nx.photoSized`, `Nx.photoSrcset` | Picks the `-200/-400/-800/-1600.webp` copy, or rewrites Unsplash `w=` | Phones download small photos |
| `send()` | One `fetch` with JSON headers, `credentials: "same-origin"`; returns `{response, data}`; throws only when offline | Cookies (the JWT) go automatically; JS never reads the token |
| `renewSession()` | One shared promise for `POST /api/auth/refresh` | Five 401s at once must not rotate the refresh token five times |
| **`Nx.api(url, options)`** | Sends; on **401** renews once and **retries the same request**; still failing → sign-in page with `?next=`; builds an `Error` with `status`, `fieldErrors`, `code`, `headers` | The 15-minute JWT expiry is invisible to the shopper |
| `Nx.toast()` | A message box; `textContent` (never HTML); errors get `role="alert"`; pauses while hovered/focused | Feedback that is safe and accessible |
| `Nx.flash()` | Stores a message in `sessionStorage` to show after a reload | "Saved" message survives a page reload |
| `Nx.formValues`, `clearErrors`, `formAlert`, `showErrors` | Read a form; show errors under fields with `aria-invalid`; focus the first bad field | Every form behaves the same |
| `Nx.busy(button, on)` | Spinner + "Please wait…", disables the button, saves the label in a `WeakMap` | Stops double submits |
| **`Nx.submitForm(form, {url})`** | clearErrors → busy → `Nx.api` → show errors → un-busy (`finally`) | One line to submit any form |
| `Nx.motionMs`, `Nx.motionEase` | Read `--duration-*`/`--ease-*` from CSS | JS animations use the same timing as CSS |
| `Nx.markSaved`, `Nx.countUp`, `Nx.rollNumber` | "Just saved" tick; numbers counting; a number rolling up/down | Small, calm feedback |
| `Nx.setCartCount` | Updates every cart badge, rolls the number, restarts the bump | Header always matches the cart |
| `Nx.confirm({...})` | The shared `<dialog>`, **Cancel focused first** for dangerous actions; returns a Promise of true/false | `if (await Nx.confirm(...))` reads naturally |
| Dialog helpers | `[data-dialog-open]`, `[data-dialog-close]`, click on backdrop closes | Modals without extra code per page |
| `setupMenus` | Account/category menus: arrow keys, Escape, click outside | Keyboard accessible menus |
| `setupHeader` | Phone header **tucks away** scrolling down; `Nx.showHeader(ms)` holds it on screen (fly-to-cart) | More screen on phones |
| `setupLogout` | `[data-logout]` buttons **and links**: POST sign-out, then `location.replace` | Back can't return to a signed-in page; "View store" signs the admin out |
| `pagehide`/`pageshow` | A page restored from the back/forward cache is hidden, then **reloaded** | The server re-checks the login; no stale private screens |
| `renewAfterBounce` | On `/login?reason=expired` tries one renewal and continues to `next` | A plain page load can't renew itself |
| `setupPageTransitions` | On `pageswap` gives the clicked card photo the name `product-photo` | Photo flows into the product page |

---

## 3. Shopping pages

### `header.js` (475 lines) — *search and phone menu*
- Phone **drawer** is a `<dialog>` (`showModal()`): the browser traps focus and handles Escape.
- **Live search**: typing ≥2 letters → wait 250 ms (**debounce**) → `fetch("/api/products/search")`. An `AbortController` cancels the previous request so old answers never overwrite new ones.
- Results highlighted safely (text nodes + `<mark>`, never `innerHTML` with user text).
- **Start panel** before typing: recent searches (in `localStorage`, max 6), trending searches, sports, popular products (`/api/search/start`, fetched once and cached).
- Keyboard: ↑/↓ move, Enter opens, Delete removes a recent search, Escape closes. ARIA `role="option"`, `aria-activedescendant`.
- On phones the search becomes a full-screen sheet; on desktop a scrim dims the page.

### `store.js` (695 lines) — *add to cart, wishlist, cards*
- **`Nx.addToCart({productId, quantity, variantId, source, button})`** — every add button on the site goes here. Guest → sign in first. Starts the **fly-to-cart** flight and the `POST /api/cart/items` request at the same time; waits for landing; updates badge; toast "View cart"; analytics event. Errors: flies the card back; `cart_limit` → calm "info" toast.
- **`Nx.startFlight`** — the flying photo: quadratic Bézier curve, 3D tilt, sheen, eased with the CSS `--ease-in-out` curve (solved by binary search in `easing()`); WebGL sparks from `fx/cartfx.js` (loaded lazily when idle).
- A `WeakSet` (`inFlight`) stops double clicks on the same button.
- **Event delegation**: one `document` click listener handles every `[data-cart-add]` and `[data-wish-id]`, including cards added later.
- `Nx.productCard(p)` builds a product card in the browser with the same markup as `product-card.ejs` (used by catalog filters and "Recently viewed").
- **Wishlist** saved on the server; hearts start correct from `data-wish-ids` on the header; old `localStorage` wishlists are moved to the account once.
- **Recently viewed**: last 5 ids in `localStorage`, prices fetched fresh (`/api/products/lookup`), skeleton cards while loading.
- Rails (scroll buttons), ARIA **tabs** (arrow/Home/End keys), footer **newsletter** form.

### `catalog.js` (757 lines) — *filters and gallery*
- **One state object** is the single source of truth: read from the URL (`readState`), changed by `apply(patch)`, written back with `history.pushState`. Refresh, Back and shared links all give the same page.
- `whole()`/`oneOf()` reject nonsense values from a hand-typed URL; the server checks again.
- Results come from `/api/products` as JSON; an `AbortController` cancels the old request.
- Chips, pagination, view toggle are real links (work without JS); JS reads their `href` back into state.
- Price **range slider** (two range inputs), quick price buttons, brand search, phone **filter drawer** with a focus trap.
- **Gallery**: thumbnails, arrows, swipe, a 3D page-turn when the photo changes, colour filter (`nx:colour` event from `cart.js`).

### `product.js` (979 lines) — *product page*
- **Hover magnifier** (Amazon-style lens + side panel) and a **full-screen viewer** with real zoom: wheel, double-click/double-tap, pinch (two pointers tracked in a `Map`), drag to pan (`clampPan` keeps it covering the frame).
- **Delivery date by PIN**: `/api/delivery/estimate`, "Order within 2 hrs 14 mins" countdown (`setInterval` every 30 s), last PIN remembered in `localStorage`.
- Title words rise, price counts up (on `NxTicker`), **magnetic buttons**, tilting feature cards.
- **Sticky buy dock** appears when the buy panel scrolls away (`IntersectionObserver`).
- **Buy now** → `/api/buy-now` → checkout of only this product; guests come back with `?buy=now`.
- **Reviews**: post (JSON or `FormData` with photos), delete own, "Show more", summary bars. **Q&A**: ask, answer, load more. **Back-in-stock** alerts. **Share** (`navigator.share` or copy link). Bundle "add all" button.

### `cart.js` (351 lines) — *quantity, sizes, cart page*
- Product page: quantity stepper (`clamp` to 1…max), **size/colour picker** (sold-out options crossed out; hidden `variantId`; "Only 3 left in size 9"; asks with a shake if no size chosen).
- Cart page: **one click listener** for +, −, remove, save for later; `change(row, request)` marks the row busy, calls the API, `render(cart)` from the **server's** totals, and reloads the real cart if anything fails.
- A removed row **folds away in 3D**; rows below glide up (FLIP: measure before/after, animate the difference).

### `checkout.js` (604 lines) — *three steps*
- Steps: address → summary → payment (`open(n)` shows one step, moves focus to its heading).
- `refresh()` asks `/api/checkout/quote` for **all totals**; a `ticket` number ignores late answers.
- Payment cards: online (Razorpay), wallet (+ how to pay the rest), COD (disabled above the limit).
- Coupon apply/remove; numbers **count** to their new value.
- `showFailure(error)` shows the message plus **fix buttons** by `error.code` (e.g. "Pay online instead", "Remove the coupon").
- **COD OTP** dialog when the server answers `cod_code_needed`.
- Success: `location.replace(redirect)` so Back can't place the order twice.
- Phones: sticky pay bar and a price-details bottom sheet with a focus trap.

### `payment.js` (341 lines) — *Razorpay*
- Our own overlay with states: opening → waiting → verifying → success / failed.
- Creates `new Razorpay({ key, order_id, amount, ... })` with values **only from our server**; card/UPI details are typed only inside Razorpay's window.
- `handler` → `verify()` posts the ids + signature to our server. Network trouble → `checkStatus()` asks up to 6 times.
- Closed window / failed payment → reported to the server; "Retry payment" or "Choose another method".
- Focus trapped inside the overlay; Escape triggers the safe action.

### Smaller store scripts

| File | What and why |
|---|---|
| `home.js` (81) | Deals countdown with flip digits (counts to an **end time**, because a CDN copy may be a minute old); deal flip cards (hover, focus, tap). |
| `confetti.js` (98) | `Nx.confetti(canvas)` 2D fallback; on the success page fires the WebGL confetti if possible, else 2D; also adds the delivery date. |
| `contact.js` (38) | Contact form via `Nx.submitForm`, live character count, "send another". |
| `profile.js` (224) | Profile page: details, password change, address book, **PIN code fills town and state** (only if empty or auto-filled before). |
| `auth.js` (471) | Login/signup: card flip (URL follows with `pushState`), live field checks, password strength meter, email typo fix ("gmial.com" → "gmail.com" using edit distance), Caps Lock warning, rate-limit "attempts left", celebration on signup. |
| `consent.js` (147) | Cookie banner; GA4/Plausible/Meta Pixel load **only after "Allow"**; Global Privacy Control respected; `Nx.track()` does nothing before consent. |
| `pwa.js` (105) | Registers `sw.js`; "Get the app" install button (`beforeinstallprompt`; iPhone instructions); push notification switch (`PushManager.subscribe`). |

---

## 4. My Account and admin

### `section-nav.js` (244 lines) — *switch sections without reloading*
- `NxPages.define(name, setup)`: each section is a module with `init(root)` / `destroy()`. Listeners use an **`AbortController` signal**, so `destroy()` removes them all at once (no duplicates, no leaks).
- Clicks inside the area → `fetch(url, { headers: { "X-Partial": "1" } })` → server returns only the section → `DOMParser` → swap. URL, title, active link, focus and scroll follow; Back/Forward work (`popstate`).
- Anything unexpected → a normal page load (never stuck).

### `account.js` (587 lines) — *My Account*
Calm on purpose (no motion). Sections: orders filter, one order (cancel order/item, return with photos), wishlist & lists (rename, delete, share, move, **drag and drop**), recent, addresses, login & security (profile, email, password strength, log out all devices / one device, delete account), notifications switches, help tickets. Shared delegated actions: copy a code, share an invite (`navigator.share` or clipboard).

### Admin scripts

| File | What and why |
|---|---|
| `admin.js` (411) | Admin shell: collapsible sidebar groups (remembered in `localStorage`), phone menu, global **search** (debounced, cached in a `Map`), **Ctrl+K command palette**, notification bell (refreshes every 2 min), customers block/unblock, Q&A answers, settings forms, keyboard access for scrolling tables (WCAG). |
| `admin-dashboard.js` (585) | **Hand-drawn SVG charts** (no library): revenue line + orders bars, stacked bars, donuts, horizontal bars, heatmap, sparklines; tooltips by mouse and arrow keys; KPI count-up; redraw on resize (`ResizeObserver`); quick restock. |
| `admin-orders.js` (221) | Orders list (column picker, bulk status), one order (status, cancel items, shipments, Shiprocket, RTO, notes, refunds with a stable `requestKey`, return decisions), refunds lookup, abandoned-cart reminders. |
| `admin-products.js` (376) | Product list (list/unlist), add/edit form: discount preview, **photo manager** (max 4, main photo, colour per photo), sizes & colours table, sends `FormData`. |
| `image-editor.js` (493) | Crop, rotate, flip on a `<canvas>`; exports WebP under 2 MB (see the crop explanation). Loaded only when needed. |
| `admin-catalog.js` (64) | Inventory: type exact stock, Save sends only changed fields. |
| `admin-coupons.js` (143) | Coupons enable/disable/delete, create/edit form (code forced to capitals). |
| `admin-wallet.js` (35) | Wallet adjustment with a stable `requestId` so a retry can't double-credit. |

---

## 5. 3D and effects (ES modules)

| File | What and why |
|---|---|
| `3d/gl.js` | WebGL basics: context, compile shaders, buffers, uniforms, textures, resize. |
| `3d/math.js` | Vectors and 4×4 matrices; `clamp`, `lerp`, `smoothstep`, `damp` (frame-rate independent easing). |
| `3d/shapes.js` | Turn a drawing (logo, athlete, football, dumbbell) into particle positions; fog shader; dot shader. |
| `3d/scene.js` | `Camera`, `geometry`, `Mesh`, `Scene` render loop that pauses off screen / hidden tab. |
| `3d/interaction.js` | Device tier, Data Saver, reduced motion, mouse/gyro parallax, drag with inertia, scroll progress. |
| `3d/boot.js` | Starts a scene safely: near the screen, when idle, falls back to CSS on any error. |
| `home3d.js` | Hero particles (sphere → logo → athlete by scroll), sport ring, showcase light. |
| `showroom3d.js` | Zero-gravity product room with WebGL dust. |
| `auth3d.js` | Sign-in particles that swirl from the mouse; admin globe. |
| `fx/cartfx.js` | Spark particles for fly-to-cart (fixed `ParticlePool`). |
| `fx/confetti3d.js` | WebGL confetti on order success. |

Full detail: `docs/ANIMATION-GUIDE.md`.

---

## 6. Patterns you can name in the exam

| Pattern | Where | Why |
|---|---|---|
| IIFE `(function(){ ... })()` | almost every classic script | Keeps variables private |
| Namespace object `window.Nx` | app.js and others | One shared global instead of many |
| Event delegation | store.js, cart.js, account.js | One listener for many (and future) elements |
| Debounce | header.js, admin.js | Don't call the server on every key press |
| AbortController | header.js, catalog.js, section-nav.js | Cancel old requests / remove listeners |
| Single source of truth | catalog.js state | URL ↔ state ↔ screen always agree |
| Optimistic UI | fly-to-cart starts before the server answers | Feels instant |
| Server is the truth | cart.js, checkout.js | Never trust browser prices |
| Lazy loading | `import()`, cartfx, image-editor | Faster first load |
| Progressive enhancement | everywhere | Works without JS |
| Feature detection | `if ("IntersectionObserver" in window)` | Old browsers still work |
| Idempotency keys | refunds, wallet adjust | A retry never pays twice |
| Accessibility (ARIA, focus) | dialogs, tabs, menus | Keyboard and screen readers |

---

## 7. Dictionary of JavaScript words

### Language basics

| Word | Meaning | Example from the code |
|---|---|---|
| `const` | A name that can't be pointed at something else | `const MAX_IMAGES = 4;` |
| `let` | A name that can change | `let active = -1;` |
| `var` | Old way to declare (function-scoped); used once in theme.js | `var connection = ...` |
| `function` | A reusable block of code | `function render(cart) {...}` |
| Arrow function `=>` | Short function | `items.map(item => item.id)` |
| `return` | Give back a value and stop the function | `return data;` |
| `if / else` | Do something only when a condition is true | `if (!form) return;` |
| `switch / case` | Choose between many values | `switch (field.name) { case "brand": ... }` |
| `for`, `for...of` | Loops | `for (const file of files)` |
| `while` | Loop while true | `while (i < this.count)` |
| `break` / `continue` | Leave a loop / skip to the next round | `if (...) continue;` |
| Ternary `a ? b : c` | Short if/else in one expression | `ok ? "Saved" : "Error"` |
| `===` / `!==` | Equal / not equal (no type conversion) | `if (tone === "danger")` |
| `&&` / `\|\|` / `!` | And / or / not | `if (!row \|\| !step) return;` |
| `\|\|=` | Assign only if empty | `form.dataset.refundRequestKey \|\|= crypto.randomUUID()` |
| `?.` | Optional chaining: stop if null | `header?.dataset` |
| Template literal `` `...${x}` `` | String with values inside | `` `/api/orders/${id}` `` |
| Destructuring | Take parts out of an object/array | `const { items, summary } = cart;` |
| Default parameters | Value used if none given | `function toast(message, type = "success")` |
| Spread `...` | Copy/expand an array or object | `{ ...state, ...patch }` |
| Rest `...args` | Collect remaining arguments | `function run(fn, ...args)` |
| `"use strict"` | Stricter mode that catches mistakes | top of every file |
| `typeof` | The type of a value | `typeof value === "number"` |
| `instanceof` | Is it made from this class? | `body instanceof FormData` |
| `in` | Does this property exist? | `"IntersectionObserver" in window` |
| `void x` | Evaluate and ignore; used to force a reflow | `void badge.offsetWidth;` |
| `class`, `constructor`, `this`, `get` | Blueprint for objects | `class ParticlePool { constructor(capacity) {...} }` |
| `new` | Create an object from a class | `new IntersectionObserver(...)` |
| `import` / `export` | Share code between module files | `import { clamp } from "./3d/math.js";` |
| `import()` | Load a module later, on demand | `import("./showroom3d.js")` |
| IIFE | Function that runs immediately | `(function () { ... })();` |
| Closure | Inner function remembers outer variables | `let renewal = null; function renewSession() {...}` |
| `NaN` / `Infinity` | "Not a number" / endless number | `Number(x) \|\| 0` turns NaN into 0 |

### Async (waiting without freezing)

| Word | Meaning | Example |
|---|---|---|
| `Promise` | A value that arrives later | `new Promise(resolve => ...)` |
| `async` | A function that returns a Promise | `async function refresh()` |
| `await` | Wait for a Promise inside async code | `await Nx.api(...)` |
| `.then()` / `.catch()` / `.finally()` | Run code when a Promise succeeds / fails / either | `.catch(() => false)` |
| `try / catch / finally` | Handle errors; `finally` always runs | `finally { Nx.busy(button, false); }` |
| `throw` | Raise an error | `throw error;` |
| `Error` | An error object (`message`, extra fields added) | `error.status = response.status` |
| `Promise.all` | Wait for several Promises | `Promise.all(leaving).then(showEmpty)` |
| `Promise.race` | First one to finish wins | flight `landed` vs a timeout |
| `setTimeout` / `clearTimeout` | Run once later / cancel | debounce timers |
| `setInterval` / `clearInterval` | Run repeatedly | countdowns, bell refresh |
| `requestAnimationFrame` | Run just before the next screen paint | the ticker |
| `requestIdleCallback` | Run when the browser is not busy | load 3D/sparks later |

### Arrays, objects and built-ins

| Word | Meaning | Example |
|---|---|---|
| `Array.map` | New array from each item | `items.map(i => i.id)` |
| `filter` | Keep items that pass a test | `.filter(Boolean)` |
| `find` / `findIndex` | First match / its position | `options.find(o => o.id === wanted)` |
| `forEach` | Do something for each item | `tabs.forEach(...)` |
| `reduce` | Combine into one value | sum of stock |
| `some` / `every` | Is any / are all true? | `entries.some(e => e.isIntersecting)` |
| `includes` / `indexOf` | Contains? / where? | `TYPES.includes(file.type)` |
| `push`, `slice`, `splice` | Add / copy part / remove | `items.splice(index, 1)` |
| `join`, `split` | Array ↔ string | `ids.join(",")` |
| `Array.from`, `[...x]` | Make a real array | `[...document.querySelectorAll(...)]` |
| `Object.entries/keys/assign/fromEntries` | Work with object properties | `Object.assign(state, {...})` |
| `JSON.parse` / `JSON.stringify` | Text ↔ object | storage, API bodies |
| `Map` | Key → value store | search `cache` |
| `Set` | List of unique values | ticker `subscribers` |
| `WeakMap` / `WeakSet` | Like Map/Set, but don't keep elements alive | saved button labels, `inFlight` |
| `Math.min/max/round/floor/abs/hypot/sin/cos/exp/random` | Maths | clamping, curves, physics |
| `Number`, `parseFloat`, `Number.isFinite`, `Number.isInteger` | Convert / check numbers | form values |
| `String`, `.trim()`, `.toLowerCase()`, `.padStart()`, `.replace()` | Text helpers | `pad = n => String(n).padStart(2, "0")` |
| RegExp `/.../` and `.test()` / `.exec()` | Pattern matching | `/^[1-9][0-9]{5}$/.test(pin)` (PIN code) |
| `Date`, `Date.now()`, `toLocaleDateString` | Time and dates | countdowns, review dates |
| `Intl.NumberFormat` | Format numbers/money by country | `₹1,23,456` |
| `Float32Array`, `Uint8Array` | Fast number arrays (for WebGL) | particle positions |

### The browser (DOM and Web APIs)

| Word | Meaning | Example |
|---|---|---|
| `window` | The browser tab's global object | `window.Nx` |
| `document` | The page | `document.querySelector(...)` |
| DOM | The page as a tree of objects | — |
| `querySelector` / `querySelectorAll` | Find elements by CSS selector | `[data-cart]` |
| `closest(selector)` | Nearest matching parent | `event.target.closest("[data-cart-item]")` |
| `createElement`, `append`, `prepend`, `replaceWith`, `replaceChildren`, `remove` | Build and change the page | toasts, cards |
| `textContent` | Set text safely (no HTML) | user names, messages |
| `innerHTML` | Set HTML (used only with our own fixed markup) | icon SVGs |
| `classList.add/remove/toggle/contains` | Change CSS classes | `is-open` |
| `dataset` | Read/write `data-*` attributes | `row.dataset.cartItem` |
| `setAttribute` / `removeAttribute` / `hasAttribute` | Change attributes | `aria-expanded` |
| `style.setProperty("--x", v)` | Set a CSS variable from JS | tilt, crop box |
| `getBoundingClientRect()` | Element's size and position on screen | flight start/end |
| `getComputedStyle` | The final CSS values | read tokens |
| `offsetWidth` / `scrollWidth` / `clientWidth` | Sizes | overflow checks |
| `addEventListener(type, fn, options)` | Run code when something happens | clicks, input |
| `{ passive: true }`, `{ once: true }`, `{ signal }`, `{ capture: true }` | Listener options: won't block scrolling / run once / removable / run early | scroll listeners |
| `event.preventDefault()` | Stop the browser's default action | stop a form reloading the page |
| `event.stopPropagation()` | Stop the event bubbling to parents | drag vs click |
| `event.target` / `currentTarget` | Element clicked / element with the listener | delegation |
| Events: `click`, `input`, `change`, `submit`, `keydown`, `pointerdown/move/up/enter/leave/cancel`, `scroll`, `resize`, `load`, `focus/blur`, `focusin/focusout`, `wheel`, `popstate`, `visibilitychange`, `pagehide/pageshow`, `pageswap/pagereveal`, `toggle`, `dragstart/dragover/drop` | What the user or browser did | — |
| `CustomEvent` / `dispatchEvent` | Our own events between files | `nx:colour`, `nx:cart-added`, `nx:section` |
| `fetch` | HTTP request | `Nx.api` |
| `Response.json()` / `.text()` | Read the reply | — |
| `FormData` | Form fields + files for upload | product photos |
| `URL` / `URLSearchParams` | Build and read web addresses | filters, `next=` |
| `AbortController` / `signal` | Cancel a fetch or remove listeners | search, sections |
| `history.pushState` / `replaceState` | Change the URL without reloading | filters, auth flip |
| `location.assign` / `replace` / `reload` | Go to a page / without history entry / reload | after checkout |
| `localStorage` / `sessionStorage` | Save small data in this browser (forever / this tab) | recent searches / flash |
| `document.cookie` | Read readable cookies | consent, `nx_has_cart` |
| `<dialog>` `showModal()` / `close()` | Built-in modal with focus trap and Escape | confirm, drawers |
| `IntersectionObserver` | Tells when an element enters the screen | reveal, lazy 3D, sticky dock |
| `ResizeObserver` | Tells when an element changes size | charts, header |
| `MutationObserver` | Tells when the page changes | admin tables, photo switch |
| `matchMedia` | Check a CSS media query in JS | reduced motion, phone width |
| `navigator.clipboard` / `navigator.share` | Copy text / phone share sheet | share links |
| `navigator.serviceWorker`, `PushManager`, `Notification` | Installable app and push | pwa.js |
| `DOMParser` | Turn HTML text into a document | section-nav.js |
| `crypto.randomUUID()` | A random unique id | refund/wallet request keys |
| `FileReader` / `createImageBitmap` / `URL.createObjectURL` | Read files and images | photo previews, editor |
| `Image`, `<canvas>`, `getContext("2d")`, `toBlob` | Draw and export images | crop editor, 2D confetti |
| `element.animate(keyframes, options)` | Web Animations API | row fold, gallery turn |
| `performance.now()` | Precise time in ms | animations |
| `scrollIntoView`, `scrollTo`, `scrollBy` | Scroll the page/element | focus, rails |
| `focus({ preventScroll })` | Move keyboard focus | dialogs, errors |
| `setPointerCapture` | Keep receiving a pointer while dragging | ring, crop box |
| `WebGLRenderingContext` (`gl`) | GPU drawing (shaders, buffers) | 3D |
| `view-transition` APIs (`viewTransitionName`, `pageswap`) | Animate between pages | page transitions |

### Accessibility words

| Word | Meaning |
|---|---|
| ARIA | Attributes that tell screen readers what something is |
| `aria-label` | A name read aloud (icon buttons) |
| `aria-expanded` | Is this menu/panel open? |
| `aria-pressed` / `aria-selected` / `aria-current` | Toggle state / chosen tab or option / current page |
| `aria-invalid` | This field has an error |
| `aria-busy` | Loading |
| `aria-live`, `role="alert"`, `role="status"` | Read changes aloud (politely / urgently) |
| `aria-activedescendant` | Which list option is highlighted while focus stays in the input |
| `role="dialog"`, `aria-modal` | This is a modal window |
| `inert` | Can't be clicked or focused |
| `tabIndex` | Order / ability to receive keyboard focus |
| Focus trap | Tab stays inside an open dialog |
| `prefers-reduced-motion` | The visitor asked for less animation |

---

## 8. One-minute exam answer

> "The browser code is plain JavaScript, no framework. Classic scripts are wrapped in IIFEs and share one global, `window.Nx`, from app.js: `Nx.api` sends requests with the login cookie and renews an expired JWT automatically, and `Nx.submitForm`, `Nx.toast` and `Nx.confirm` give every page the same behaviour. Pages are server-rendered, and JavaScript adds behaviour through data attributes using event delegation. The catalogue keeps one filter state synced with the URL; the cart and checkout always show totals from the server. Search is debounced and cancels old requests with AbortController. My Account and the admin switch sections without reloading using fetch and an X-Partial header. The 3D is ES modules on WebGL, all animations share one requestAnimationFrame loop, and everything respects reduced motion and works without JavaScript."
