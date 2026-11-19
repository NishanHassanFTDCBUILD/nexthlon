# Nexthlon animation guide, A to Z

Every moving thing on the site, file by file, explained from the current code. No animation library is used:
it is plain CSS, plain JavaScript and hand-written WebGL.

---

## 0. The big picture

```
                      tokens.css  (--ease-*, --duration-*: one set of timings for everything)
                          │
     ┌────────────────────┼──────────────────────────────────────────┐
     ▼                    ▼                                          ▼
 motion.css          motion/ticker.js  (ONE requestAnimationFrame loop)   page-reveal.js + app.js
 (CSS keyframes,         │                                            (page-to-page View Transitions)
  hover, reveals)        ├── motion.js        scroll reveal, tilt, glass header, counters
                         ├── store.js         fly-to-cart card
                         ├── fx/cartfx.js     WebGL sparks for the cart
                         ├── fx/confetti3d.js WebGL confetti (confetti.js = 2D fallback)
                         └── 3d/ engine ──► home3d.js  (hero particles, sport ring, showcase)
                                          ├► showroom3d.js (zero-gravity product room)
                                          └► auth3d.js  (sign-in particles, admin globe)
```

Four rules every animation file follows (good exam points):

1. **One loop.** Everything subscribes to `NxTicker` instead of running its own `requestAnimationFrame`, so the page does one frame of work, not ten.
2. **Only `transform` and `opacity` change per frame.** The GPU can move these without re-laying out the page, so it stays at 60 fps.
3. **Decoration only.** Without JavaScript, WebGL or motion, the page shows the same content as flat sections. If an animation file crashes, nothing is lost.
4. **Respect the visitor.** `prefers-reduced-motion` → still frames or nothing. Low-power devices, Data Saver and slow connections → lighter or no 3D. Hidden tab or off-screen canvas → the loop stops.

---

## 1. `public/css/tokens.css` — the timing design system (lines ~294-306)

| Token | Value | Used for |
|---|---|---|
| `--ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | most transitions |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | things arriving |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | the cart flight path |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | small overshoot "pop" |
| `--duration-fast` … `--duration-slower` | 0.15 s … 0.7 s | press, hover, drawers, reveals, longest entrance |

JavaScript reads the same tokens through `Nx.motionMs("--duration-slower", 700)` and `Nx.motionEase(...)` (in `app.js`), so CSS and JS animations move with exactly the same timing.

---

## 2. `public/js/motion/ticker.js` — the one animation loop (92 lines)

The heart of all motion. Loaded first, as `window.NxTicker`.

- **Lines 8-11:** a UMD wrapper. In the browser it creates `window.NxTicker`; in Node it exports the factory so tests can run it.
- **Lines 17-22:** state: a `Set` of `subscribers`, two queues `reads` and `writes`, the current `frame` id, `last` timestamp and `elapsed` seconds.
- **`run(fn)` (27-34):** calls one function inside `try/catch`. *One broken animation never stops the others.*
- **`tick(now)` (36-48):** runs once per frame:
  1. `dt = (now - last) / 1000`, **capped at 0.05 s**. If the browser stalls, animations jump at most 1/20 s instead of teleporting.
  2. Runs all queued **reads** first, then every **subscriber** `(elapsed, dt)`, then all **writes**. Reading layout before writing avoids "layout thrashing" (forcing the browser to recalculate layout many times in one frame).
  3. `schedule()` asks for the next frame.
- **`schedule()` (50-53):** only asks for a frame if nothing is pending, the tab is visible, and someone is subscribed. **An idle page runs no loop at all.**
- **`pause()` (55-59):** cancels the frame and resets `last = 0`, so returning to the tab does not produce a giant `dt`.
- **`visibilitychange` (61-66):** hidden tab → pause; visible → resume.
- **API (68-91):** `add(fn)` subscribes and **returns an unsubscribe function**; `read(fn)` / `write(fn)` queue one-off jobs; `size` and `running` for tests.

---

## 3. `public/js/motion.js` — page motion layer (216 lines)

Plain script, runs on every page. Content is only hidden while `<html>` has class `js-motion`, which is added **last** (line 210). If anything throws, the `catch` (211-215) removes it, so nothing stays invisible.

### 3.1 Scroll reveal — `setupReveal()` (22-72)
- Finds every `[data-reveal]` element (buttons skipped; password toggles reuse that attribute).
- No `IntersectionObserver` support → show everything.
- **Lines 33-41:** anything already on screen, or inside a sideways-scrolling row, is shown immediately — nothing blinks out after first paint.
- **Lines 45-46:** if the browser supports CSS **scroll-driven animations** (`animation-timeline: view()`), adds `sd-reveal`; the entrance then follows the scroll position in pure CSS (`motion.css`).
- **Lines 48-64:** otherwise an `IntersectionObserver` watches items. Items arriving together are **sorted in page order** and staggered **80 ms apart** (max 10 steps), via the CSS variable `--reveal-delay`. Then `is-revealed` triggers the CSS keyframe `nx-reveal-up`.
- **Lines 69-71:** printing, or switching reduced motion on, reveals everything at once.

### 3.2 3D tilt and glare — `setupTilt()` (75-121)
- For each `[data-tilt]` card (product cards, payment methods). Max tilt 8° (or `data-tilt-max`).
- `pointermove` (mouse only, never touch or reduced motion): inside one `requestAnimationFrame` it works out the pointer position as -0.5…0.5 and sets CSS variables:
  - `--tilt-x = -y × max × 2` deg, `--tilt-y = x × max × 2` deg (the card leans toward the cursor),
  - `--tilt-nx/--tilt-ny` (-1…1) for inner layers that move in pixels (the photo slides against the tilt like a window),
  - `--glare-x/--glare-y` to move a light spot under the cursor (a `<span class="tilt-glare">` added on first hover).
- `pointerleave` resets everything to 0. **JavaScript only sets numbers; CSS in `motion.css` does the actual `transform`.**

### 3.3 Glass header and parallax — `setupScroll()` (124-155)
- On scroll, throttled to one update per frame with a `ticking` flag.
- `header.is-scrolled` after 20 px → CSS cross-fades a solid layer to a frosted-glass layer.
- If a page has a `.hero`, its background moves at **35 % of scroll speed** (`translate`), so it drifts behind the text (parallax).

### 3.4 Counters — `setupCounters()` (158-183)
- `[data-count-to]` numbers (admin dashboard) count up when 40 % visible.
- Duration `min(1600, 600 + target × 8)` ms. Easing **ease-out cubic**: `1 - (1 - t)^3` (fast start, gentle stop).

### 3.5 Image fade-in — `setupImages()` (187-202)
- Product photos **below the first screen** that are not loaded yet get `is-loading` (transparent), then `is-loaded` fades them in.
- Photos on the first screen are never hidden (that would delay the main paint). A broken image (`error`) is also shown, never left invisible.

---

## 4. `public/css/motion.css` — all CSS animation (313 lines)

Almost everything sits inside `@media (prefers-reduced-motion: no-preference)`, so reduced-motion users get static pages automatically.

| Lines | What | How |
|---|---|---|
| 11-50 | Scroll reveal | `nx-reveal-up` (fade + rise 28px), `nx-reveal-fade`, `nx-reveal-scale`; with `.sd-reveal` it uses `animation-timeline: view()` so the scroll position drives it. Heading underlines draw in on reveal. |
| 52-75 | Tilt + glare | `transform: perspective() rotateX(var(--tilt-x)) rotateY(var(--tilt-y))`; the inner photo moves with `--tilt-nx/ny` for depth. |
| 77-87 | Buttons | Hover lifts 2px with a shadow; press pushes down. Only on devices with hover. |
| 89-103 | Glass header | Two layers swap by opacity after 20px scroll. |
| 105-108 | Images | `is-loading` → `is-loaded` opacity fade. |
| 110-116 | Checkout | `nx-step-in` slides each step in; `nx-coupon-pop` pops an applied coupon. |
| 118-175 | Payment and orders | Active step glow (`nx-glow`), details slide (`nx-details-in`), Pay button shine sweep, overlay pop-in (`nx-pay-in`), lock shackle closing (`nx-shackle`), spinner (`nx-spin`), success tick **drawn** with `stroke-dashoffset` (`nx-draw-circle`, `nx-draw-mark`), error shake (`nx-shake`), Paid dot pulse / Pending breathe, tracking timeline steps rising and lines drawing (`nx-step-rise`, `nx-line-draw`), truck rolling (`nx-truck-roll`). |
| 177-187 | Empty states | Illustrations float (`nx-float`) with a shadow that shrinks as they rise; twinkles. |
| 189-237 | 3D home | Headline letters rise one by one (`nx-char-in`, starting at 0.15 opacity, never invisible, because the headline is the page's largest paint); CSS 3D fallback rings (`nx-ring-a/b/c`) and floating cards; showcase podium turning (`nx-podium`); flip-digit countdown (`nx-flip-digit`); stats turning up (`nx-turn-up`). |
| 239-241 | Reduced motion | Turns animations off. |
| 243-247 | Auto-filled fields | Town/state filled from the PIN code fade in (`nx-filled`) so the change is noticed. |
| 249-end | Page transitions | `@view-transition { navigation: auto; }` enables cross-page View Transitions; the "back" type plays them reversed. |

---

## 5. Page transitions — `public/js/page-reveal.js` (44 lines) + `app.js` (`pageswap`)

**Cross-document View Transitions:** the browser screenshots the old page and the new page and animates between them.

- **Leaving side (in `app.js`, on `pageswap`):** when you click a product card, the card photo gets `view-transition-name: product-photo`, so it **flows into the big photo** on the product page.
- **Arriving side (`page-reveal.js`)**, loaded in `<head>` without `defer` because `pagereveal` fires just before the first frame:
  - Line 11: does nothing in browsers without View Transitions or the Navigation API (they change page normally).
  - Line 16: cancelled transitions reject promises; they are caught silently (expected, not errors).
  - Lines 17-21: on **back/forward** navigation, compares history indexes and adds the type `"back"` or `"forward"`, so CSS can play it in reverse.
  - Lines 24-36: if you came back **from a product page**, it finds the card that links to that product on this page.
  - Lines 38-42: removes the name from any other photo (only one element may carry a name), gives it to the card photo, so the big photo **flows back into its card**, then clears it when finished.

---

## 6. The 3D engine — `public/js/3d/` (no library, ~900 lines)

### 6.1 `gl.js` — WebGL basics (117 lines)
- `supportsWebGL()` — tries once on a throwaway canvas, caches the answer.
- `createContext(canvas, options)` — `alpha`, `antialias`, `premultipliedAlpha`, `high-performance` GPU by default.
- `compile()` / `createProgram(vertex, fragment)` — compiles both **shaders** (small GPU programs), links them, throws a clear error on failure, and **looks up every attribute and uniform location once** (faster than looking them up every frame).
- `createBuffer`, `bindAttribute` — upload vertex data to the GPU and connect it to a shader input.
- `setUniform` — sets a shader value from a number, a 2/3/4-vector or a 4×4 matrix by its length.
- `loadTexture(url)` — shows a 1×1 transparent pixel until the photo loads (so drawing never waits), then uploads it with linear filtering and clamped edges (works with any image size). Returns `{ texture, ready }`.
- `resize(gl, maxRatio)` — matches the canvas pixels to its CSS size × device pixel ratio, **capped** (2× desktop, 1.5× phones), because drawing at 3× on phones is wasted work.

### 6.2 `math.js` — vectors and matrices (116 lines)
- `vec3`: add, subtract, scale, dot, cross, length, normalize, lerp.
- `mat4` (column-major `Float32Array(16)`, the layout WebGL expects): `identity`, `multiply`, **`perspective`** (things far away look smaller), **`lookAt`** (camera at `eye` looking at `target`), translation, scaling, rotations X/Y/Z, and `compose(position, rotation, scale)` = the model matrix.
- `clamp`, `lerp`, `smoothstep` (smooth 0→1: `t² × (3 − 2t)`).
- **`damp(current, target, lambda, dt)`** = `lerp(current, target, 1 − e^(−lambda·dt))`. *Frame-rate independent easing:* the motion looks the same at 30, 60 or 144 fps. Used everywhere for smooth following (mouse, morphs).

### 6.3 `shapes.js` — shapes made of particles (175 lines)
- **`sampleShape(draw, count, size)` — the key trick:** draw a shape (text, an athlete) in white on a hidden 2D canvas, read its pixels, collect every filled pixel (alpha > 128, every 2nd pixel), then pick `count` random filled pixels and convert them to 3D positions (centred, scaled, with a little random depth). *Any drawing becomes a particle cloud.*
- `spherePoints(count, radius)` — an even sphere using the **Fibonacci / golden-angle spiral**, slightly rough.
- `drawLogo(font)` — the NEXTHLON word, **outlined** on wide screens (solid letters become a glowing blob in dots), **filled** on phones (thin outlines break into speckle). Sized to fill 92 % of the width.
- `drawAthlete`, `drawFootball`, `drawDumbbell` — simple drawings with thick round lines (`limbs()` helper).
- **`fogShader`** — a full-screen animated fog: value **noise** → **fbm** (4 layers of noise, each double frequency, half strength) → warped by itself over time. Mixes obsidian and smoke colours, adds a volt glow that breathes with `sin(time)`, a spotlight following the mouse, and a vignette (darker edges).
- `dotFragment` — the shader for one round glowing dot: discard outside the circle, `smoothstep` glow squared for a soft edge.

### 6.4 `scene.js` — camera, meshes, render loop (304 lines)
- `Camera` — fov, near/far, position, target; `update(aspect)` builds the projection and view matrices.
- `geometry` — `plane`, `cube`, torus (rings), `particles` (Fibonacci sphere by default): plain arrays of positions, uvs, normals, indices.
- **`Mesh`** — geometry + shader + uniforms + its own position/rotation/scale. Uploads each attribute to a GPU buffer; `setAttribute()` swaps one later (used to load new particle targets). `draw()` binds buffers, sets `uModel`, `uView`, `uProjection` and all uniforms, then sets blending:
  - `"additive"` (`SRC_ALPHA, ONE`) — overlapping dots add up to brighter light (glow),
  - `"alpha"` — normal see-through,
  - none — solid.
  Then `drawElements` (indexed triangles) or `drawArrays` (points).
- **`Scene`** — the render loop:
  - Listens to `visibilitychange` and an `IntersectionObserver` (120px margin) on the canvas.
  - `sync()` (257-270): runs **only when wanted AND the tab is visible AND the canvas is on screen**. It subscribes to `NxTicker` (or its own fallback loop).
  - `step(dt)` → all `onUpdate` functions → `render()`: resize, update camera, clear, draw every mesh.
  - `render(time)` can also draw a **single still frame** (used for reduced motion).

### 6.5 `interaction.js` — input and device checks (123 lines)
- `prefersReducedMotion()`, `finePointer()` (a real mouse).
- `wantsLessData()` — Data Saver, `2g`/`slow-2g`, or `prefers-reduced-data` → skip 3D.
- **`deviceTier()`** — `low` (≤2 cores or ≤2 GB), `medium` (small screen, ≤4 cores or ≤4 GB), else `high`. Scenes choose particle counts from this.
- **`createParallax()`** — mouse position as -1…1 (or the **gyroscope** on phones where no permission prompt is needed), eased with `damp`.
- **`createDragRotate(el)`** — drag to rotate with **inertia**: velocity measured while dragging, then decays with friction after release. A move under 6px still counts as a click. Arrow keys work too.
- **`scrollProgress(el)`** — 0→1 through a tall pinned section (0 = its top at the screen top, 1 = its bottom at the screen bottom). Drives scroll-linked scenes.

### 6.6 `boot.js` — starting a scene safely (73 lines)
1. Data Saver → add `no-webgl` (the CSS fallback stays) and stop.
2. Wait until the section is **within 200px of the screen** (IntersectionObserver).
3. Then wait until the page has loaded and the browser is **idle** (`requestIdleCallback`). On touch phones, wait for the first scroll/tap or 4 seconds, because building a scene (compiling shaders, uploading textures) is most of a second of work and must not delay the first tap.
4. No WebGL → `no-webgl`. Otherwise `build(canvas, { reduced, tier })`, add `has-webgl`.
5. Reduced motion → draw **one still frame** (`scene.render(2)`) and stop. Otherwise `scene.start()` and add `is-live` next frame (CSS fades the canvas in).
6. Any error (driver, shader) → fall back to the CSS version. *Never a broken page.*

---

## 7. `public/js/home3d.js` — the home page (625 lines)

### 7.1 Hero particles (lines 35-214)
- **Particle count** by tier: 9000 / 5000 / 2400 (phones 6000 / 4200 / 2400).
- Each particle has **three target positions** stored as GPU attributes: `aPosition` (sphere), `aLogo` (NEXTHLON word), `aAthlete` (runner), plus `aRandom` (3 random numbers per dot).
- **The vertex shader does the morph on the GPU** (lines 49-56):
  - `m1` = sphere→logo amount, `m2` = logo→athlete amount, each slightly offset per dot by `aRandom.y`, so dots **don't all move at once** (a ripple instead of a jump).
  - `p = mix(mix(sphere, logo, m1), athlete, m2)`.
  - A small `sin/cos` drift; extra swirl **during** the change (`transit = sin(morph × π)`), almost none while the logo holds, so the letters stay sharp.
  - `gl_PointSize = size / -mv.z` → closer dots look bigger (perspective).
- Fragment shader: a sharp bright core + soft halo per dot, mixed between two volt colours.
- **`morphFor(progress)`** (83-89) maps scroll to shape with "holds": sphere until 8 %, change to logo until 30 %, **hold logo** until 48 %, change to athlete until 70 %, hold athlete to the end.
- **Lazy shapes** (128-136): the logo and athlete start as copies of the sphere and are sampled in **separate small tasks** after the first frame (the logo after the brand font loads), so the page is never frozen for a second.
- **Every frame** (`onUpdate`, 160-205):
  - Mouse parallax moves the camera (x × 0.7, y × 0.45).
  - `morph = damp(morph, target, 5, dt)` — smoothly follows the scroll.
  - Camera steps back on narrow screens so the logo fits.
  - The sphere slowly sways (`sin(time × 0.22)`), stopping as it becomes the logo.
  - Wide screens: shape sits right of the headline; phones: measured free space above the text, and the shape is **scaled to fit** that space as it morphs.
  - Sets `hero.dataset.stage` 0/1/2 so CSS can change the text with the shape.
- Behind it, the **fog** mesh (full-screen) follows the mouse and morph.

### 7.2 Showroom loading (18-33)
`showroom3d.js` is downloaded with `import()` only when its section comes within one screen.

### 7.3 "Pick your sport" ring (216-589) — CSS 3D, not WebGL
- Set up only when within 1.5 screens.
- Six cards on a ring: each card is `rotateY(i × 60°) translateZ(--r)`. The radius `--r` is computed from card width (`cardWidth / 2 / tan(π / 6) × 1.32 + 24`) so neighbours never overlap.
- **Turning the ring** = changing one CSS variable `--angle`. `setAngle()` works out which card is in front and gives every card `data-pos` (-3…3) for CSS styling.
- **Inputs:** scroll through the pinned section (one sport per step), tabs (ARIA tabs with arrow/Home/End keys), dots, arrow keys, Enter opens the front sport, and **drag/swipe with inertia then snap**: speed measured from the last 6 pointer samples, projected forward (`speed × 0.18`, max 2 cards), rounded to the nearest card.
- A real drag never opens a link; clicking a side card turns it to the front.
- **Front card tilt:** follows the mouse, photo and text at different depths (parallax), plus glare.
- **Auto-turn every 4 s** only when visible, not hovered, not dragged, not focused, tab visible.
- **Reflective floor:** a faded, cloned, `inert` copy of the ring (links turned into spans).
- **First appearance:** cards rise from depth one after another with the Web Animations API (`element.animate`, 900 ms, 110 ms stagger).
- **Reduced motion:** a plain swipe row; the card nearest the middle becomes active.

### 7.4 Showcase light (591-625)
When 30 % visible → `is-in` (CSS animations start). With a mouse: sets `--lx/--ly` (light position) and `--rx/--ry` (a gentle 3D turn) per frame.

---

## 8. `public/js/showroom3d.js` — the zero-gravity showroom (635 lines)

- **Wide screens:** 12 glass product cards float in a **CSS 3D room**.
  - Card spots come from a **seeded random generator** (the room looks the same every visit). Each spot is tried up to 80 times and scored for overlap from three points along the fly-through, so cards don't hide each other while you fly.
  - **Scroll** through the pinned section flies the camera forward; the **mouse** turns it. Near cards float and drift; far cards stay still (their blur is not redrawn — cheaper); cards fade as they pass you and sink into fog far away.
  - Hover turns a card to face you; Tab focus flies to it; click flies there and **unfolds a detail card like a book**. While open, the wheel does not scroll the page and keyboard focus stays inside.
  - **Volt dust (WebGL, `buildDustField`)**: particles in a deep box stream towards you as the camera flies and wrap to the back; they brighten with speed. One draw call, drawn from the showroom's own frame. No WebGL → a few slow motes on a 2D canvas; none on low-end devices.
  - Layout is measured once and on resize (reads), **never inside the frame** (frames only write) — the read/write rule from the ticker.
- **Phones:** a floating swipe row, tilted by the gyroscope where allowed.
- **Reduced motion:** a still grid. **No JavaScript:** a plain grid of links.
- Add to cart uses the shared `Nx.addToCart` (so the fly-to-cart animation works here too).

---

## 9. `public/js/auth3d.js` — sign-in pages (262 lines)

- **Customers:** particles loop **athlete → football → dumbbell**. `weightsAt(time)` (17-28): each shape holds 3.4 s, then morphs 1.4 s into the next with a `smoothstep` blend; the vertex shader mixes the three positions by these weights.
- **Mouse swirl** (shader, lines 47-53): near the pointer, particles are pushed away **and spun around it** (`dir + perpendicular × 1.4`), with strength `exp(-distance² × 1.8)` (strong close, fading fast). `pointerTracker` converts the mouse to world units on the z = 0 plane.
- **Phones/tablets:** a short strip above the form with fewer (2600), smaller, dimmer dots, placed on the right so they don't glare behind the motto.
- **Admins:** a turning **wireframe globe** (`globeLines`: latitude/longitude lines) with pulsing data points — the "control room" look.

---

## 10. Fly to cart — `public/js/store.js` (lines 40-265) + `public/js/fx/cartfx.js`

### 10.1 The flying card (`store.js`)
1. `Nx.addToCart()` (311) starts **`Nx.startFlight()` at the same moment as the `POST /api/cart/items` request**, so the animation never waits for the server.
2. `startFlight` (152): skips for reduced motion or an off-screen photo. `cartTarget()` (49) finds the header cart icon; on phones it **brings the hidden header back** first so the card lands on a visible icon.
3. Creates `<div class="fly-card">` with a copy of the photo and a light "sheen", placed over the original photo.
4. **Path = quadratic Bézier curve** (181-219): from the photo `(0,0)` to the cart `(dx, dy)` through a control point **above** both ends: `x = 2(1−p)p·cx + p²·dx`.
5. `p` goes through `easing()` (102-121) — the CSS `--ease-in-out` cubic-bezier, **solved by binary search** (18 steps) so JS moves exactly like CSS.
6. Per frame: lift-off bump, shrink (`(1 + 0.12·lift)(1 − 0.82p²)`), **bank** (`rotateY`) into the turn, **pitch** (`rotateX`) with the climb (from the curve's slope), sheen slides across, fade near the end. Only `transform` and `opacity`.
7. **Landing** (`end(true)`, 221): the icon gets `is-catching` (CSS squash + ring), sparks burst, card removed. Then the badge count updates and a toast appears.
8. **Server says no:** `abort()` sets `direction = -1`; the card flies back 40 % faster and ends in a grey puff.
9. A `setTimeout` race (251) means the cart count never waits on a paused background tab.

### 10.2 The sparks (`fx/cartfx.js`, 306 lines)
- Loaded lazily (when idle, or on the first press of an add button). Returns `null` on low-power devices, reduced motion, Data Saver or no WebGL — the card still flies, just without sparks.
- **`ParticlePool`** (15-72): a **fixed array** of particles, so no memory is allocated during the animation. Dead particles are **swapped** to the end (O(1) removal). `update(dt)`: `velocity × e^(−drag·dt)`, gravity added to `vy`, position += velocity × dt. `write()` packs x, y, size, alpha, colour into a `Float32Array` (5 numbers per particle); particles shrink and fade (`alpha × left²`).
- **Shader:** each point a sharp core + soft halo, coloured from the site's `--brand-rgb`. Blending: added on dark pages (glow), laid over on light pages.
- **Effects:** `trail()` — 3 sparks per frame behind the card, drifting back along its path; `burst()` — ~30 sparks flying out and falling (gravity 420) plus a ring of 32 spreading at the same speed; `puff()` — soft grey dots rising slightly.
- **Idle:** canvas shrinks to 1×1 pixel and leaves the ticker (almost no memory). A lost GPU context stops it quietly.

---

## 11. Confetti — `public/js/confetti.js` (98 lines) + `public/js/fx/confetti3d.js` (226 lines)

- Order success page and payment overlay.
- **`confetti3d.js` (WebGL):** paper strips in the brand colours fly from **two cannons at the bottom corners** (40 % each) and pop out of the success tick (20 %). Each strip **spins and flips in 3D**: it narrows as it turns edge-on (`cos(flip)`), darkens as it turns away and glints as it faces you. Once falling, it **flutters** (slow fall, side-to-side sway). One canvas, one shader, **one draw call per frame**, on the shared ticker.
- **`confetti.js` (2D canvas fallback):** used when the WebGL version returns false (low-power, no WebGL). Same brand colours read from `tokens.css`. Reduced motion → **no confetti at all**.

---

## 12. Other small animated pieces

| File | Animation |
|---|---|
| `public/js/app.js` (around line 549, `is-tucked`; `Nx.showHeader` at 565) | Phone header **tucks away** scrolling down, returns scrolling up; held visible during a cart flight. |
| `public/js/app.js` `Nx.countUp` (365) | Numbers counting up, timed by `--duration-long`. |
| `public/js/catalog.js`, `public/css/filters.css` | Filter sheet slides up on phones. |
| `public/js/product.js` | Gallery and option changes. |
| `public/js/checkout.js`, `payment.js` | Step transitions, payment overlay states (uses the `motion.css` keyframes in section 4). |
| `public/js/admin-dashboard.js` | Dashboard charts and counters. |
| `public/js/section-nav.js` | Admin sections swap without reload (`X-Partial: 1`). |
| `public/js/theme.js` | Light/dark switch. |

(These use CSS transitions and the shared keyframes; read each file's top comment for details.)

---

## 13. Performance and accessibility checklist (say this in the exam)

| Technique | Where | Why |
|---|---|---|
| One shared loop | `ticker.js` | One frame of work per refresh, not many |
| Loop stops when idle / hidden / off screen | `ticker.js`, `scene.js` | Saves battery and CPU |
| `dt` capped at 0.05 s | ticker, scene | No teleporting after a stall |
| `damp()` frame-rate independent easing | `math.js` | Same feel at 30/60/144 fps |
| Only `transform` + `opacity` per frame | motion.js, store.js, CSS | GPU-composited, no layout |
| Reads before writes | ticker, showroom | No layout thrashing |
| Morph on the GPU (vertex shader) | home3d, auth3d | Thousands of dots, no per-dot JavaScript |
| Fixed particle pool | cartfx | No garbage collection pauses |
| Lazy load (`import()`, idle, IntersectionObserver) | boot, home3d, store | Fast first paint and first tap |
| Device tier, Data Saver, pixel-ratio cap | interaction, gl, scenes | Phones get lighter versions |
| `prefers-reduced-motion` | everywhere | Still frames or none |
| Fallbacks: CSS 3D, 2D canvas, plain links | boot, confetti, showroom | Never a broken page |
| `aria-hidden`, `inert`, keyboard controls | ring, showroom, fly-card | Decoration hidden from screen readers; still usable by keyboard |

## 14. One-minute exam answer

> "All animation runs on one shared requestAnimationFrame loop that stops when the tab is hidden or nothing is moving. Page motion — scroll reveals, tilt, the glass header — is CSS keyframes driven by IntersectionObserver and CSS variables, and animates only transform and opacity. The 3D is a small WebGL engine I wrote: shaders, matrix maths, a scene loop. On the home page thousands of particles morph from a sphere to the logo to an athlete as you scroll, with the morph computed on the GPU. Add to cart flies the photo along a Bézier curve to the cart with WebGL sparks. Everything respects reduced motion, low-power devices and Data Saver, and falls back to plain content."
