# Nexthlon dictionary: JavaScript and animation words

Every word is explained in plain English, with **why it matters** and an **example from your own code**.
Part A is JavaScript, Part B is animation and 3D, Part C is CSS animation, Part D is the maths.

---

# Part A — JavaScript words

## A1. Storing values

**Variable** — a name that holds a value, like a labelled box.
**`const`** — a variable that can't be pointed at something new. Use it by default; it prevents accidental changes.
→ `const MAX_IMAGES = 4;` (admin-products.js)

**`let`** — a variable that can change later.
→ `let active = -1;` (header.js — which suggestion is highlighted)

**`var`** — the old way to make a variable. It ignores `{ }` blocks, which causes bugs, so modern code avoids it. Your only use is in `theme.js`.

**Constant naming (`UPPER_CASE`)** — a convention meaning "this never changes".
→ `const STAGGER_MS = 80;` (motion.js)

**Types** — the kinds of value: `number` (`700`), `string` (`"cart"`), `boolean` (`true/false`), `null` (empty on purpose), `undefined` (never set), `object`, `array`.

**`NaN`** — "Not a Number": the result of bad maths like `Number("abc")`. `Number(x) || 0` turns it into 0.

**`Infinity`** — a number bigger than any other. Used as "no limit".
→ `freeDeliveryMin ... || Infinity` (store.js)

## A2. Functions

**Function** — a reusable block of code that takes inputs and can return an output.
→ `function render(cart) { ... }` (cart.js)

**Parameter / argument** — the input names / the actual values passed in.

**Default parameter** — a value used when none is given.
→ `Nx.toast(message, type = "success")` — a toast is green unless you say otherwise.

**`return`** — gives a value back and stops the function.

**Arrow function `=>`** — a short way to write a function, common in callbacks.
→ `items.map(item => item.id)`

**Callback** — a function you pass to another function, to be called later.
→ `button.addEventListener("click", () => buyNow(button))`

**IIFE (Immediately Invoked Function Expression)** — `(function () { ... })();` a function that runs at once. **Why:** variables inside stay private and don't clash with other files. Almost every classic file in `public/js` starts this way.

**Closure** — an inner function that remembers variables from the outer one, even later.
→ In app.js, `renewSession()` remembers `let renewal`, so five calls share one renewal.

**Scope** — where a variable can be seen. `let`/`const` live only inside their `{ }`.

**`"use strict"`** — turns on stricter rules (e.g. using an undeclared variable is an error). Catches mistakes early.

## A3. Objects, classes, modules

**Object** — a group of named values: `{ name: "Shoe", price: 349900 }`.

**Property / method** — a value on an object / a function on an object.
→ `Nx.api` is a method on the `Nx` object.

**Namespace** — one object that holds many helpers so the global scope stays clean.
→ `window.Nx` (app.js) holds `api`, `toast`, `confirm`, `formatPrice`…

**`class`** — a blueprint for making objects with shared methods.
→ `class ParticlePool` (fx/cartfx.js), `class Scene`, `class Mesh`, `class Camera` (3d/scene.js)

**`constructor`** — the function that runs when an object is made from a class.

**`new`** — makes an object from a class: `new IntersectionObserver(...)`.

**`this`** — "the object this method belongs to". In `Scene`, `this.meshes` is that scene's list.

**Getter (`get`)** — a property that is calculated when read.
→ `get capacity() { return this.items.length; }` (ParticlePool)

**Module** — a file that shares code with `export` and uses others' code with `import`. **Why:** clear dependencies, no globals.
→ `import { clamp, damp } from "./3d/math.js";`

**`export` / `import`** — share / bring in functions between module files.

**Dynamic `import()`** — load a module only when needed. **Why:** a smaller first download.
→ `import("./showroom3d.js")` runs only when the showroom section comes near.

**UMD wrapper** — code that works as a browser global _and_ in Node. `ticker.js` uses it so tests can load it.

## A4. Decisions and loops

**`if / else`** — run code only when a condition is true.
**Guard clause / early return** — `if (!form) return;` leave early when there's nothing to do. Keeps code flat and readable.
**`switch / case`** — choose between many fixed values (catalog.js `patchFromControl`).
**Ternary `a ? b : c`** — a one-line if/else: `saved ? "Saved" : "Add to wishlist"`.
**`for`, `for...of`, `while`** — loops. **`break`** leaves a loop, **`continue`** skips to the next round.
**`===` / `!==`** — strict equal / not equal (no hidden type conversion; safer than `==`).
**`&&`, `||`, `!`** — and, or, not. `a || b` also means "use b if a is empty".
**`||=`** — assign only if empty.
→ `form.dataset.refundRequestKey ||= crypto.randomUUID();` keeps the same key on retry.
**Optional chaining `?.`** — stops safely if something is null: `header?.dataset`.
**Truthy / falsy** — `0`, `""`, `null`, `undefined`, `NaN`, `false` count as false; everything else as true. `.filter(Boolean)` removes falsy items.

## A5. Text and data helpers

**Template literal** — a string in backticks with values inside: `` `/api/orders/${id}` ``.
**Destructuring** — take parts out of an object/array: `const { items, summary } = cart;`
**Spread `...`** — copy/expand: `{ ...state, ...patch }` makes a new object with changes.
**Rest `...args`** — collect the remaining arguments into an array.
**Array methods:**

- `map` — make a new array from each item.
- `filter` — keep items that pass a test.
- `find` / `findIndex` — first match / its position.
- `forEach` — do something for each item.
- `reduce` — combine into one value (sum of stock in admin-products.js).
- `some` / `every` — is any / are all true?
- `includes` / `indexOf` — contains? / where?
- `slice` (copy part), `splice` (remove), `push` (add), `join` / `split` (array ↔ text).

**`JSON.stringify` / `JSON.parse`** — object → text / text → object. Needed for API bodies and `localStorage`.
**`Map`** — a key → value store (search cache in admin.js).
**`Set`** — unique values only (the ticker's subscribers).
**`WeakMap` / `WeakSet`** — like Map/Set but they don't stop elements from being cleaned up. **Why:** no memory leaks. → `inFlight` (store.js) stops double clicks.
**RegExp (regular expression)** — a text pattern. `/^[1-9][0-9]{5}$/` = a 6-digit PIN not starting with 0. `.test()` says yes/no; `.exec()` returns the match.
**`Intl.NumberFormat`** — formats numbers by country: `₹1,23,456` (Indian grouping).
**`Date`, `Date.now()`** — dates and the current time in ms.
**Typed arrays (`Float32Array`, `Uint8Array`)** — fixed-size number arrays; WebGL needs them.

## A6. Waiting without freezing (async)

**Synchronous vs asynchronous** — sync code runs line by line and blocks; async starts something (a network request) and continues, handling the result later. **Why:** the page never freezes.
**Promise** — an object for "a value that will arrive later". It is pending, then fulfilled (success) or rejected (error).
**`async` function** — always returns a Promise; lets you use `await` inside.
**`await`** — pause _this function_ until the Promise finishes (the page keeps working).
→ `const data = await Nx.api("/api/cart");`
**`.then` / `.catch` / `.finally`** — run code on success / on error / always.
**`try / catch / finally`** — catch errors; `finally` always runs (used to turn off the busy spinner).
**`throw`** — raise an error so a `catch` handles it.
**`Error` object** — has a `message`; your code adds `status`, `fieldErrors`, `code` (app.js).
**`Promise.all`** — wait for several Promises.
**`Promise.race`** — first to finish wins. → the cart flight waits for landing _or_ a timeout.
**Debounce** — wait until typing stops (250 ms) before calling the server. **Why:** not one request per key. (header.js)
**`setTimeout` / `setInterval`** — run once later / repeatedly; cancel with `clearTimeout` / `clearInterval`.
**Race condition** — two async tasks finishing in the wrong order. Fixed with `AbortController` or a `ticket` number (checkout.js `refreshing`).

## A7. The page (DOM)

**DOM (Document Object Model)** — the page as a tree of objects JavaScript can read and change.
**`window`** — the browser tab's global object. **`document`** — the page itself.
**Element** — one tag on the page (`<button>`, `<div>`).
**`querySelector` / `querySelectorAll`** — find the first / all elements matching a CSS selector.
**`closest(selector)`** — walk up to the nearest matching parent. Used with event delegation.
**`createElement`, `append`, `prepend`, `remove`, `replaceWith`, `replaceChildren`** — build and change the page.
**`textContent`** — set plain text. **Safe**: HTML in it is not run. Used for all user data.
**`innerHTML`** — set HTML. Only used with our own fixed markup (icons), never with user text — that would allow **XSS**.
**`classList.add/remove/toggle/contains`** — change CSS classes (how JS triggers CSS animations).
**`dataset`** — read/write `data-*` attributes: `row.dataset.cartItem` reads `data-cart-item`.
**`data-*` attribute** — custom data on an element; the hook between EJS and JS.
**`setAttribute` / `getAttribute` / `removeAttribute`** — work with attributes like `aria-expanded`.
**`style.setProperty("--x", value)`** — set a CSS variable from JS (tilt angles, crop box).
**`getBoundingClientRect()`** — an element's position and size on screen (used to start the fly-to-cart).
**`getComputedStyle()`** — the final CSS values (reads timing tokens).
**`offsetWidth`, `clientWidth`, `scrollWidth`** — element sizes; reading them forces a **reflow**.

## A8. Events

**Event** — something that happened: a click, a key, a scroll, a page load.
**`addEventListener(type, handler, options)`** — run code when an event happens.
**Listener options:** `{ passive: true }` (won't block scrolling → smoother), `{ once: true }` (run once), `{ capture: true }` (run before children), `{ signal }` (removable with an AbortController).
**`event.target`** — the exact element clicked. **`event.currentTarget`** — the element the listener is on.
**`preventDefault()`** — stop the browser's normal action (e.g. a form reloading the page).
**`stopPropagation()`** — stop the event bubbling up to parents.
**Bubbling** — an event travels from the clicked element up to the document.
**Event delegation** — one listener on a parent handles clicks for all children, even ones added later. **Why:** fewer listeners, works for dynamic content. → store.js handles every `[data-cart-add]` from one `document` listener.
**`CustomEvent` / `dispatchEvent`** — your own events between files: `nx:colour`, `nx:cart-added`, `nx:section`.
**Common events:** `click`, `input` (each keystroke), `change` (value committed), `submit`, `keydown`, `pointerdown/move/up/enter/leave/cancel` (mouse+touch+pen in one), `scroll`, `resize`, `load`, `focus/blur`, `wheel`, `popstate` (Back/Forward), `visibilitychange` (tab hidden), `pagehide/pageshow`, `pageswap/pagereveal` (page transitions), `dragstart/dragover/drop`.

## A9. Talking to the server and the browser

**`fetch`** — makes an HTTP request and returns a Promise of the response.
**HTTP methods** — `GET` read, `POST` create, `PATCH` change part, `DELETE` remove.
**Status codes** — 200 OK, 201 created, 400 bad input, 401 not signed in, 403 not allowed, 404 not found, 409 conflict, 429 too many, 500 server error.
**JSON** — the text format the API speaks.
**`FormData`** — form fields + files for uploads (product photos, review photos).
**`credentials: "same-origin"`** — send our cookies (the login) with the request.
**`AbortController` / `signal`** — cancel a fetch, or remove many listeners at once.
**`URL` / `URLSearchParams`** — build and read addresses and `?query=` parts.
**`history.pushState` / `replaceState`** — change the URL without reloading (filters, section switching).
**`location.assign` / `replace` / `reload`** — go to a page / go without a history entry (so Back can't return) / reload.
**`localStorage`** — small data saved in this browser forever (recent searches). **`sessionStorage`** — until the tab closes (flash messages).
**Cookie** — small data sent with every request. **HttpOnly cookie** — JavaScript can't read it (the login token).
**`<dialog>` + `showModal()`** — a built-in modal: traps focus and closes with Escape.
**`IntersectionObserver`** — tells you when an element enters/leaves the screen. Used for reveals, lazy 3D, the sticky buy dock.
**`ResizeObserver`** — tells you when an element's size changes (redraw charts).
**`MutationObserver`** — tells you when the page's HTML changes.
**`matchMedia`** — check a CSS media query in JS (phone width, reduced motion).
**Service worker** — a background script (`sw.js`) for offline pages, caching and push.
**`navigator.share` / `navigator.clipboard`** — the phone share sheet / copy text.
**`crypto.randomUUID()`** — a random unique id (stops double refunds on retry).
**`DOMParser`** — turns HTML text into a document (section switching).
**`FileReader`, `createImageBitmap`** — read files and images (photo previews, crop editor).

## A10. Patterns and ideas

**Progressive enhancement** — the page works without JS; JS adds extras.
**Feature detection** — `if ("IntersectionObserver" in window)` use it only if the browser has it.
**Single source of truth** — one state object (catalog.js) that the URL and screen follow.
**Optimistic UI** — show the result before the server answers (the card flies immediately).
**Idempotent** — doing it twice has the same effect as once (marking an order paid).
**Lazy loading** — load code or images only when needed.
**XSS** — injecting a script through text; prevented with `textContent` and `<%= %>`.
**CSRF** — another site making requests with your cookies; prevented by the origin check.
**JWT** — a signed login token. **Refresh token** — a long-lived token that renews it.

---

# Part B — Animation and 3D words

## B1. Frames and time

**Frame** — one picture on screen. **60 fps** = 60 frames per second (about 16.7 ms each).
**`requestAnimationFrame` (rAF)** — "run this just before the next screen paint". **Why:** perfectly timed to the screen, pauses in hidden tabs.
**Animation loop** — a function that runs every frame to move things.
**Shared ticker** — your **one** loop (`motion/ticker.js`) that every animation joins. **Why:** one frame of work instead of ten separate loops.
**Subscriber** — an animation added with `NxTicker.add(fn)`.
**`dt` (delta time)** — seconds since the last frame. Moving by `speed × dt` gives the same speed on a 60 Hz or 144 Hz screen.
**`dt` cap (0.05)** — if a frame is late, pretend it was only 0.05 s, so nothing teleports.
**`elapsed` / `time`** — total seconds since the animation started (drives waves, drifts).
**`performance.now()`** — a precise clock in milliseconds.
**Jank** — visible stutter when a frame takes too long.
**Reflow (layout)** — the browser recalculating positions and sizes; expensive.
**Repaint** — redrawing pixels.
**Compositing** — the GPU moving finished layers; the cheapest step.
**Layout thrashing** — reading sizes and writing styles back and forth, forcing many reflows per frame. Fixed by doing **reads before writes** (ticker.js).

## B2. Easing (how speed changes)

**Easing** — the speed curve of an animation. Linear = constant speed (robotic); eased = natural.
**Ease-in** — starts slow, ends fast. **Ease-out** — starts fast, ends slow (good for arriving things). **Ease-in-out** — slow at both ends (good for travel, like the cart flight).
**`cubic-bezier(x1, y1, x2, y2)`** — a curve defined by four numbers. Your tokens: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`.
**Spring / overshoot** — goes slightly past the end and settles (`--ease-spring`).
**Ease-out cubic** — `1 − (1 − t)³`, used for counters.
**Binary search** — store.js finds the cubic-bezier value for a time by halving the range 18 times, so JS moves exactly like CSS.
**Damping (`damp`)** — move a fraction of the way to a target each frame: fast at first, then settling. Frame-rate independent.
**Inertia** — after you let go of a drag, it keeps moving and slows down (sport ring, `createDragRotate`).
**Snap** — after inertia, settle on the nearest card.
**Stagger** — start items one after another (80 ms apart) instead of all at once.

## B3. Moving things on screen

**Transform** — move/rotate/scale an element without changing the layout: `translate`, `rotate`, `scale`. **Why:** the GPU does it, so it's smooth.
**`translate3d(x, y, z)`** — move in 3D; also hints the GPU to use its own layer.
**`rotateX/Y/Z`** — rotate around an axis. X = tip forward/back, Y = turn left/right, Z = spin flat.
**`perspective()`** — how strong the 3D effect is; smaller = more dramatic.
**`transform-origin`** — the point it rotates or scales around.
**Opacity** — transparency from 0 (invisible) to 1 (solid). Also GPU-friendly.
**Tilt** — the card leans toward the mouse (`--tilt-x`, `--tilt-y`).
**Glare** — a light spot that follows the cursor on a tilting card.
**Parallax** — layers moving at different speeds to suggest depth (hero background at 35% of scroll; mouse moves the 3D camera).
**Scroll reveal** — elements fade/slide in as they come on screen.
**Scroll-driven animation** — the animation's progress _is_ the scroll position (`animation-timeline: view()`).
**Pinned section** — a tall section that stays on screen while you scroll through it (home hero, sport ring, showroom).
**Scroll progress** — 0 at the start of a pinned section, 1 at its end (`scrollProgress`).
**Morph** — one shape smoothly turning into another (sphere → logo → athlete).
**Bézier curve** — a smooth curve from a start, through a control point, to an end. Fly to cart uses a **quadratic** Bézier: `x = 2(1−p)p·cx + p²·dx`.
**Control point** — the point that pulls the curve; placed above, so the card arcs upward.
**Bank / pitch** — the flying card tilts into the turn (bank, `rotateY`) and with the climb (pitch, `rotateX`).
**Sheen** — a band of light sliding across the flying card.
**FLIP (First, Last, Invert, Play)** — measure before, measure after, move it back, animate to the new place. Used when cart rows glide up after one is removed.
**View Transition** — the browser animates between two pages; the same `view-transition-name` on both makes the product photo flow from card to page.
**Web Animations API (`element.animate()`)** — run keyframe animations from JavaScript (cart row folding, gallery page-turn).
**Count-up** — a number animating from its old value to its new one.
**Roll number** — the old digit slides out, the new slides in (cart badge).
**Bump / pop** — a quick scale up and back (badge, applied coupon).
**Shake** — quick left-right movement for an error (login card, COD).

## B4. Particles and physics

**Particle** — one tiny dot (spark, confetti strip, hero dot).
**Particle system** — many particles created, moved and removed together.
**Particle pool** — a **fixed** array of particles that is reused. **Why:** no new memory during the animation, so no garbage-collection pauses (`ParticlePool`).
**Spawn** — create (activate) a particle. **Life / age** — how long it lives / how long it has lived.
**Velocity (`vx`, `vy`)** — speed and direction.
**Gravity** — pulls particles down each frame (`vy += gravity × dt`).
**Drag / air resistance** — slows particles: `velocity × e^(−drag × dt)`.
**Euler integration** — `position += velocity × dt`: the simplest physics step.
**Burst** — many particles from one point at once (cart landing).
**Trail** — particles left behind a moving object (behind the flying card).
**Flutter / sway** — falling paper drifting side to side (confetti).
**Fibonacci (golden-angle) sphere** — places points evenly on a sphere using the golden angle (hero sphere).
**Sampling a shape** — draw a shape on a hidden canvas, read its pixels, place particles on the filled ones (logo, athlete).
**Seeded random** — "random" numbers that are the same every visit (the showroom layout).

## B5. WebGL and the GPU

**GPU** — the graphics chip; very fast at many small parallel jobs.
**WebGL** — the browser's API for drawing with the GPU.
**Canvas** — the `<canvas>` element WebGL (or 2D) draws into.
**Context (`gl`)** — the object you call WebGL functions on.
**Shader** — a tiny program that runs on the GPU, written in **GLSL**.
**Vertex shader** — runs once **per point**; decides _where_ it goes. Your hero morph happens here.
**Fragment shader** — runs once **per pixel**; decides _what colour_ it is (glowing dot, fog).
**Program** — a vertex + fragment shader linked together.
**Compile / link** — turning shader text into GPU code / joining the two shaders.
**Buffer** — a block of GPU memory holding numbers (positions, colours).
**Attribute** — a value that is different for each point (`aPosition`, `aLogo`, `aRandom`).
**Uniform** — a value that is the same for all points in a frame (`uTime`, `uMorph`, `uMouse`).
**Varying** — a value passed from the vertex shader to the fragment shader (`vAlpha`).
**`gl_Position`** — where the point lands on screen. **`gl_PointSize`** — how big the dot is. **`gl_FragColor`** — the pixel's colour.
**`gl_PointCoord`** — the position inside one dot (to make it round).
**`discard`** — throw a pixel away (cut the square dot into a circle).
**Draw call** — one command telling the GPU to draw (`drawArrays`). Fewer = faster; confetti is one draw call per frame.
**`POINTS`, `LINES`, `TRIANGLES`** — what to draw: dots, lines, filled shapes.
**Mesh** — geometry + shader + uniforms + position/rotation/scale (`class Mesh`).
**Geometry** — the shape's points: `plane`, `cube`, `sphere`, `torus`, `particles`.
**Texture** — an image uploaded to the GPU.
**Blending** — how overlapping colours mix. **Additive** = they add up to brighter light (glow); **alpha** = normal see-through.
**Premultiplied alpha** — colour already multiplied by transparency; avoids dark edges.
**Depth test** — hide things behind other things (turned off for glowing dots).
**Device pixel ratio (DPR)** — screen pixels per CSS pixel (2 or 3 on phones). Capped at 1.5–2 to save work.
**Viewport** — the area of the canvas being drawn to.
**Context lost** — the GPU reset; the code stops quietly and falls back.
**Noise / fbm (fractal Brownian motion)** — layered random-looking patterns for smoke and fog (`fogShader`).
**Vignette** — darker edges that focus the eye on the centre.

## B6. 3D maths words

**Vector (`vec3`)** — a point or direction with x, y, z.
**Matrix (`mat4`)** — a 4×4 grid of numbers that moves, turns and scales points in one multiplication.
**Model matrix** — places an object in the world (position, rotation, scale).
**View matrix** — where the camera is and where it looks (`lookAt`).
**Projection matrix** — turns 3D into 2D with **perspective** (far things look smaller).
**Camera** — position, target and field of view (`fov`).
**Field of view (FOV)** — how wide the camera sees (45° in the hero).
**Near / far plane** — closest and farthest distances that get drawn.
**Column-major** — the order WebGL expects matrix numbers in.
**Dot / cross product** — vector operations used to build the camera's axes.
**Normalize** — make a vector length 1 (direction only).
**Radians** — angle unit: π radians = 180°.

---

# Part C — CSS animation words

**Transition** — animate a property when it changes: `transition: transform 0.25s ease`.
**`@keyframes`** — a named animation with steps (`from`, `to`, or `%`).
→ `@keyframes nx-reveal-up { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }`
**`animation`** — plays keyframes: name, duration, easing, delay, fill mode.
**`animation-delay`** — wait before starting (the stagger).
**`animation-fill-mode: both`** — keep the start style before and the end style after.
**`animation-timeline: view()`** — drive the animation by scroll position.
**CSS custom property (`--name`)** — a CSS variable; JS changes it, CSS uses it (`var(--tilt-x)`).
**Design tokens** — shared values in `tokens.css`: `--duration-*`, `--ease-*`, colours.
**`prefers-reduced-motion`** — the visitor's setting to reduce animation; your motion CSS runs only when it is `no-preference`.
**`stroke-dashoffset`** — slides an SVG line's dash so it appears to **draw itself** (success tick).
**`@view-transition { navigation: auto; }`** — turns on page-to-page transitions.
**`view-transition-name`** — the same name on two pages makes an element morph between them.
**`will-change`** — a hint that an element will animate (GPU layer).
**`backdrop-filter`** — blur behind an element (glass header).
**3D CSS (`transform-style: preserve-3d`, `perspective`)** — real 3D for HTML cards (sport ring, showroom room).
**Skeleton** — grey placeholder blocks shown while content loads.

---

# Part D — Maths functions in your animation

| Function                   | Formula                            | Meaning                             | Used for                   |
| -------------------------- | ---------------------------------- | ----------------------------------- | -------------------------- |
| `clamp(v, min, max)`       | `min(max, max(min, v))`            | Keep a value inside a range         | Everything                 |
| `lerp(a, b, t)`            | `a + (b − a) × t`                  | Blend from a to b (t = 0…1)         | Camera, colours            |
| `smoothstep(e0, e1, x)`    | `t² × (3 − 2t)`                    | Smooth S-curve from 0 to 1          | Morph, glows               |
| `damp(cur, target, λ, dt)` | `lerp(cur, target, 1 − e^(−λ·dt))` | Smooth follow, same at any fps      | Mouse camera, scroll morph |
| Quadratic Bézier           | `2(1−p)p·c + p²·d`                 | Curved path through a control point | Fly to cart                |
| `sin` / `cos`              | waves between −1 and 1             | Gentle drifting, floating, swaying  | Dots, cards, confetti      |
| `Math.hypot(dx, dy)`       | `√(dx² + dy²)`                     | Distance                            | Flight length, pinch zoom  |
| `Math.exp(−k·dt)`          | exponential decay                  | Smooth slowing                      | Drag on sparks             |
| Golden angle               | `π × (3 − √5)`                     | Even spread of points               | Fibonacci sphere           |
| `mod(n, count)`            | wrap-around                        | Endless ring of cards               | Sport ring                 |

---

**Tip for the exam:** if you're asked about any word, give the plain meaning, then say _where it is used in Nexthlon_. For example: "Damping moves a value a fraction of the way to its target every frame, so it settles smoothly at any frame rate. I use it for the mouse-controlled camera and the scroll morph in home3d.js."
