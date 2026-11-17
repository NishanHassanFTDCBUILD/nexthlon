# Learn Nexthlon animations from A to Z

Prepared from the local source on 17 November 2026. This is a teaching guide, not an assertion that every effect runs in every browser. Practice changes below are exercises; none were applied to the website.

The guide covers the major animation systems with See → Trace → Explain → Change → Explain back. The generated source index at the end lists every current public CSS keyframe and identifies JavaScript frame/animation entry points. It is an inventory, not a word-by-word annotation of every source file. Work through small blocks and use the original files for the surrounding code.

## Before starting: animation vocabulary

- HTML supplies real elements: headings, images, buttons, canvas, dialogs.
- EJS runs on the server and fills HTML with product/category data. Its output is ordinary HTML.
- CSS controls appearance. A transition interpolates a property between old and new values. Keyframes describe a timeline explicitly.
- Browser JavaScript listens for scrolling, pointer movement, clicking, loading and visibility, then changes classes/styles or draws frames.
- WebGL draws through the GPU. Your engine is under `public/js/3d`; these scenes do not use Three.js.
- Canvas 2D draws using a JavaScript-controlled 2D context. It also supplies hidden pictures that your particle engine samples.
- A mesh combines geometry, shaders, attributes, uniforms and transforms into something the GPU can draw. A point mesh can contain thousands of particles.
- A frame is one drawn image. `requestAnimationFrame` asks the browser for work before a future repaint; it does not guarantee a fixed frame rate.
- `time` is elapsed time; `dt` is the interval since the last update, in seconds in the shared engine.
- A transform changes presentation: `translate` moves, `rotate` turns, `scale` changes size. A transformed element can keep its original layout space.
- `opacity: 0` is transparent, not removed from layout; `hidden` normally removes display in this project.
- Easing changes the rate of progress. Duration says how long; delay says when to start; staggering gives adjacent items different delays.
- X is horizontal, Y is vertical, Z is depth. Browser CSS Y normally points downward; your sampled shape coordinates invert Y for the 3D scene.
- A shader is GPU code written in GLSL, not JavaScript. JavaScript stores shader source in strings and compiles/uploads it through WebGL.
- An attribute supplies per-vertex values; a uniform is shared by a draw call; a varying passes interpolated values from vertex to fragment shader.
- Reduced-motion and reduced-data preferences are inputs to your fallbacks, not errors.

## A. First load and the CSS fallback

**See:** The top home section can initially show a glow or CSS rings/cards before the particle scene appears.

**Trace:** `views/pages/home.ejs` → `public/css/home.css`, `public/css/motion.css` → `public/js/home3d.js` → `public/js/3d/boot.js`.

**Explain:**

```html
<section class="hero3d" data-hero3d>
  <div class="hero3d-sticky">
    <canvas class="hero3d-canvas" data-hero3d-canvas aria-hidden="true"></canvas>
    <div class="hero3d-fallback" aria-hidden="true">...</div>
  </div>
</section>
```

`section` groups the hero. `class` connects CSS. The `data-*` hooks connect JavaScript. `canvas` is the drawing surface, not an image URL. `aria-hidden` hides decoration from assistive technology. The actual headline and links remain separate, accessible HTML.

`boot(container, canvas, build)` checks inputs and data-saving preferences, waits for the section to approach, waits for loading/idle time, and tests WebGL. It calls the builder once. It marks success with `has-webgl`, starts continuous frames, then adds `is-live` so CSS fades the canvas in. Reduced motion renders a still frame after `ready`. A setup failure adds `no-webgl`, preserving the CSS fallback. Touch devices delay expensive initialization until interaction or a four-second timeout after loading. Thus an initial fallback is intentional.

**Change:** On a practice branch, change one `.hf-ring` border colour, refresh, then undo. Do not force WebGL failure to test a colour.

**Explain back:** Why can the customer still read and use the hero before the GPU scene starts?

## B. The shared frame clock

**See:** Several independent effects move smoothly without each needing an always-running private loop.

**Trace:** `views/partials/scripts.ejs` loads `public/js/motion/ticker.js` before shared application scripts. `Scene.sync()` subscribes when needed.

**Explain:**

```js
const stop = NxTicker.add((time, dt) => {
  // Update a running effect.
});
```

`const` declares a binding that will not be reassigned. `stop` receives the unsubscribe function. `NxTicker` is the shared object. Dot notation accesses its `add` method. Parentheses call it. `(time, dt) => {}` is the callback passed to it. Calling `stop()` removes this callback; it does not stop all animations.

In `tick(now)`, `dt` is calculated from timestamps, converted from milliseconds to seconds, and capped at 0.05. Reads run first, subscribers next, writes last. The ticker schedules work only when it has subscribers/queued work and the document is visible. Exceptions in one subscriber are caught so others continue. CSS animations and some local RAF/timer code are separate from this ticker.

**Change:** In a separate scratch exercise, log `dt` for a short subscription, unsubscribe, then remove the log. Avoid logging every frame in production.

**Explain back:** Why multiply velocity by `dt`, rather than moving a fixed amount per frame?

## C. The home sphere: creating the positions

**See:** Thousands of bright dots form a sphere, rather than a single solid ball.

**Trace:** `home3d.js` → `buildHero()` → `spherePoints()` in `3d/shapes.js` → `Mesh` and `Scene` in `3d/scene.js`.

```js
const PARTICLES = { high: 9000, medium: 5000, low: 2400 };
const sphere = { positions: spherePoints(count, 1.85) };
```

`PARTICLES` is an object mapping estimated device capability to a count. Phones have a separate 6000/4200/2400 table. These are heuristics, not measured GPU benchmarks. `positions` contains X/Y/Z triplets. `1.85` is the sphere radius in scene units, not screen pixels.

The actual generator is:

```js
export function spherePoints(count, radius) {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const rr = radius + (Math.random() - 0.5) * radius * 0.06;
    out.set([Math.cos(golden * i) * r * rr, y * rr, Math.sin(golden * i) * r * rr], i * 3);
  }
  return out;
}
```

- `export`: another module may import the function.
- `function`: defines reusable instructions. `spherePoints` is its name. `count` and `radius` are parameters.
- `Float32Array`: a packed typed array of 32-bit floating-point values suitable for GPU buffers.
- `count * 3`: three coordinates per dot. For 5000 dots this is 15000 numbers, not 15000 dots.
- `Math.PI`: π. `Math.sqrt(5)`: square root of five. Their combination forms the golden angle, about 2.4 radians.
- `let i = 0`: start the point index at zero. `i < count`: continue while there are points left. `i += 1`: advance one index.
- `y`: spreads points from the top of the sphere to the bottom, approximately +1 to -1 before radius scaling.
- `r`: radius of the horizontal cross-section at this Y. `1 - y*y` comes from the unit-circle relationship.
- `rr`: varies the radius slightly. `Math.random()` returns a value from zero up to, but not including, one. Subtracting 0.5 centres it around zero. Multiplying by 0.06 produces approximately ±3% radius variation.
- `cos(angle)` creates X around a circle. `sin(angle)` creates Z. Increasing the angle by the golden angle distributes points around successive heights.
- `out.set([...], i * 3)`: writes this point's three numbers starting at its array offset. Point zero starts at index zero, point one at three, point two at six.
- `return out`: gives the completed data to the caller. It does not itself draw anything.

**Change:** On a practice branch change `spherePoints(count, 1.85)` to `spherePoints(count, 1.6)`, compare, then restore. Increasing particle counts first is a poor learning experiment because it changes workload.

**Explain back:** What distinguishes a point's position from its visible dot size?

## D. Scrolling changes sphere → logo → athlete

**See:** Scroll through the pinned hero; the dots hold three shapes and move between them.

**Trace:** `home3d.js`: `morphFor`, `buildHero`, `scene.onUpdate`; `3d/interaction.js`: `scrollProgress`; `3d/shapes.js`: `drawLogo`, `drawAthlete`, `sampleShape`.

```js
function morphFor(progress) {
  if (progress < 0.08) return 0;
  if (progress < 0.3) return (progress - 0.08) / 0.22;
  if (progress < 0.48) return 1;
  if (progress < 0.7) return 1 + (progress - 0.48) / 0.22;
  return 2;
}
```

`progress` is normalized from zero to one. Each `if` checks the next threshold. `return` immediately exits this function. The early-return sequence means the later cases only see values that failed the earlier checks.

| Hero progress | Result | Meaning |
|---|---:|---|
| 0–8% | 0 | Hold sphere |
| 8–30% | 0 → 1 | Blend sphere to logo |
| 30–48% | 1 | Hold logo |
| 48–70% | 1 → 2 | Blend logo to athlete |
| 70–100% | 2 | Hold athlete |

At progress 0.19, `(0.19 - 0.08) / 0.22 = 0.5`. At progress 0.59, `1 + (0.59 - 0.48) / 0.22 = 1.5`.

`scrollProgress` measures the section's viewport rectangle. For the tall hero, travel is section height minus viewport height, and progress is `clamp(-box.top / travel, 0, 1)`. It is progress through this section's pinned travel, not percentage through the entire website. `home.css` gives the animated hero 260 viewport-height units and pins the inner panel for one viewport height. `svh` stabilizes sizing against mobile browser chrome.

```js
const target = morphFor(scrollProgress(hero));
morph = damp(morph, target, 5, dt);
dots.uniforms.uMorph = morph;
```

Nested calls evaluate from the inside: get scroll position, map to the shape target, ease the current value toward it, send that value to the shader. `damp` uses `lerp(current, target, 1 - Math.exp(-lambda * dt))`; a larger positive lambda follows the target faster. The `5` is not a five-second duration.

The logo and athlete are drawn on hidden 2D canvases and sampled into the same number of X/Y/Z positions as the sphere. `sampleShape` reads alpha values, collects filled pixels, picks positions from them and adds shallow random Z depth. The loader waits for the brand font and schedules the two shape calculations in separate tasks. Initially all three attributes use the sphere, so the initial render does not wait for silhouette sampling.

**Change:** Move the final athlete threshold from 0.70 to 0.74 and change the matching transition divisor from 0.22 to 0.26. Restore both afterward. Changing only the threshold would create an inconsistent mapping.

**Explain back:** Why must each shape have matching numbers of particle positions?

## E. The GPU shader and drawing pipeline

**See:** Dots drift, change shape, vary in brightness, and appear round with bright centres.

**Trace:** `particleShader` in `home3d.js`; shader compilation/buffers in `3d/gl.js`; `Camera`, `Mesh`, `Scene` in `3d/scene.js`.

```glsl
attribute vec3 aPosition;
attribute vec3 aLogo;
attribute vec3 aAthlete;
attribute vec3 aRandom;
uniform mat4 uModel, uView, uProjection;
uniform float uTime, uMorph, uSize, uRatio;
```

`vec3` holds three floating-point components. The attributes vary per particle. `mat4` holds a 4×4 matrix. `uModel` positions/rotates/scales the object, `uView` represents the camera, and `uProjection` creates the perspective projection. Uniforms are set by the CPU for the draw call. `uTime` drives ongoing movement; `uMorph` drives shape transitions; `uSize` and `uRatio` control point sizing.

```glsl
vec3 p = mix(mix(aPosition, aLogo, m1), aAthlete, m2);
vec4 mv = uView * uModel * vec4(p, 1.0);
gl_Position = uProjection * mv;
gl_PointSize = uSize * (0.55 + aRandom.x) * uRatio / -mv.z;
```

`mix(A,B,t)` is interpolation: at zero choose A, at one choose B, at half choose their midpoint. First blend sphere/logo, then blend that result with athlete. The actual `m1` and `m2` expressions clamp and smooth the transitions and stagger particles using `aRandom.y`.

`vec4(p,1.0)` adds the coordinate needed for matrix transforms. Matrix multiplication order matters; the rightmost transform acts first on the vector. `mv` is the position in camera/view space. `gl_Position` is clip-space output, not an HTML pixel position. Dividing point size by `-mv.z` gives perspective sizing for points in front of this camera.

In the fragment shader, `gl_PointCoord` is a coordinate inside the point sprite. `length(gl_PointCoord - 0.5)` measures distance to its centre. Pixels outside radius 0.5 are discarded, changing the square sprite into a round dot. Core/halo calculations vary brightness radially. `mix(uColorA,uColorB,vMix)` changes colour per dot; alpha controls transparency. Additive blending accumulates light where dots overlap.

Technical reading note: several current fragment shaders call GLSL `smoothstep` with descending edges. The intended result is an inverted radial fade, but reversed edges are not portable GLSL. A portable form is `1.0 - smoothstep(low, high, d)`. This guide describes intent and flags the caveat; it does not silently change the effect.

`Scene.render()` resizes the drawing buffer, updates camera matrices, clears colour/depth buffers and draws meshes. `Mesh.draw()` binds attributes/uniforms and selects `drawArrays` for non-indexed points or `drawElements` for indexed geometry. JavaScript owns state; the GPU performs per-point and per-fragment work.

**Change:** Change only one component of `COLOR_A`, staying in the 0–1 range, then restore. Do not edit matrices as a first experiment.

**Explain back:** Which shader decides where the dot is, and which decides its pixels' colour?

## F. Animated fog

**See:** Dark smoky movement and a faint volt glow behind the hero particles.

**Trace:** `fogShader` in `3d/shapes.js`, added as a plane before the dots in `buildHero`.

**Explain:** The plane's shader draws across the canvas. UV coordinates locate pixels on it. `hash` generates repeatable pseudo-random scalar values from positions. `noise` blends neighbouring values. `fbm` sums four noise layers, doubling spatial frequency and reducing amplitude. This creates smoke detail without downloading a smoke video. `uTime * 0.04` and `uTime * 0.025` drift the sample coordinates. Noise blends obsidian/smoke colours; mouse proximity adds a light spot; distance from centre darkens edges. Disabling depth testing and drawing fog first keeps it behind the point layer.

**Change:** Change `uTime * 0.04` to `uTime * 0.02` in the fog coordinate expression, compare its horizontal drift, then restore.

**Explain back:** Why can changing time animate a procedural texture without moving the plane?

## G. Pointer parallax and phone fitting

**See:** Moving the mouse changes the viewpoint. On tall screens the shapes fit above the headline.

**Trace:** `createParallax` in `3d/interaction.js`; `buildHero` update and `measure` in `home3d.js`.

```js
state.targetX = (event.clientX / window.innerWidth) * 2 - 1;
scene.camera.position[0] = x * 0.7;
```

At the left edge targetX is -1, at centre zero, at the right edge +1. The `update(dt)` method damps input before the camera consumes it. Multiplication by 0.7 controls camera travel. Array index zero is X, one is Y, two is Z. Rotation on the sphere is separately controlled by `Math.sin(time * 0.22)` and the pointer.

Phone fitting is not just shrinking a desktop screenshot. The code measures free space above `.hero3d-kicker`, converts pixels to scene units using camera distance/FOV, interpolates the three shapes' fit scales, and adjusts position and brightness. Pixel ratio caps reduce GPU workload. Gyroscope input is attached only where the browser permits it without a permission request; it is not guaranteed on every phone.

**Change:** Change the X multiplier from 0.7 to 0.35 to halve horizontal camera parallax, then restore.

**Explain back:** Why does the pointer position need normalizing before it controls a scene?

## H. Hero letters, buttons and scroll cue

**See:** Headline letters rise in sequence; supporting copy enters later; a short vertical scroll cue repeats.

**Trace:** `headline`, `letterIndex`, `.char` spans in `home.ejs`; `nx-char-in`, `nx-hero-rise`, `nx-scroll-cue` in `motion.css`; `js-motion` from `motion.js`.

```css
animation: nx-char-in var(--duration-slower) var(--ease-out)
  calc(var(--i) * var(--stagger) + var(--duration-fast)) both;
```

Read animation shorthand in order: name, duration, easing, delay, fill mode. `--i` is the letter index. `--stagger` is 32ms in current tokens; index ten adds 320ms to the base delay. `both` applies first keyframe styles before starting and final styles afterward. The actual keyframes start at opacity 0.15 and `translateY(0.35em)`, ending at full opacity and no transform. Despite an older comment mentioning rotateX, these hero letters currently rise without rotation. The plain heading's `aria-label` and hidden decorative character spans preserve accessible words.

The Shop all gear link has `data-magnetic` in home markup, but the only current handler for that attribute is in `product.js`, which the home template does not load. That attribute alone does not make the home button magnetic. Do not confuse a hook with an installed behaviour.

**Change:** Locally override the hero characters' delay to a fixed 150ms, observe all letters start together, then restore the stagger expression.

**Explain back:** What is the difference between an animation's duration and its per-letter delay?

## I. Revealing sections while scrolling

**See:** Cards/section headings fade or rise as they enter the viewport; headings can draw an underline.

**Trace:** `data-reveal` on templates → `setupReveal` in `motion.js` → reveal selectors/keyframes in `motion.css`.

**Explain:** Content is normal visible HTML until successful initialization adds `js-motion`. Already visible items and sideways-scrolling items are revealed immediately. An IntersectionObserver handles entrances; capable browsers use view-timeline CSS for scroll-linked progress. The observer marks `is-revealed`; in the fallback it assigns `--reveal-delay` in document order, 80ms apart, capped at ten steps. An element's own `data-reveal-delay` overrides that delay. `data-reveal-done` prevents repeated entrance animation. Print and reduced-motion handling show content immediately. A view timeline follows scrolling; a time-driven CSS entrance simply plays after its trigger.

**Change:** Give one existing off-screen card `data-reveal-delay="160"` on a practice branch, compare with neighbours, then remove the override.

**Explain back:** Why does the code add `js-motion` last rather than hiding everything in base CSS?

## J. Zero-gravity showroom: movement through the room

**See:** Product cards float at different depths; desktop scrolling feels like flying between them.

**Trace:** `data-showroom` markup in `home.ejs` → lazy import in `home3d.js` → `setUpShowroom`, `setUpRoom`, `setUpFloat` in `showroom3d.js` → `home.css`.

**Explain:** This room's product cards are real DOM elements using CSS 3D, not meshes in the hero's WebGL scene. Its dust is a separate optional WebGL layer. The module loads when the section is within roughly one viewport ahead. Reduced motion selects a grid. Phone mode at initialization selects a horizontal floating row. Desktop mode uses perspective 1200 and a 1250-unit camera flight.

Card placement spreads Z values and alternates sides. A seeded pseudo-random generator tests candidate positions at several points through the fly-through and favours less overlap. Near cards float with sine waves and rotate slightly; far cards settle to save redraw work. Hover/focus raises and steadies a card. A target causes the world to translate toward that card. The world transform uses damped camera coordinates; depth controls fog, fading and which controls are usable. `whileOnScreen` subscribes only near the viewport.

```js
cam.z = damp(cam.z, tz, speed, dt);
world.style.transform = `translate3d(${cam.x.toFixed(1)}px, ${cam.y.toFixed(1)}px, ${cam.z.toFixed(1)}px) rotateX(${cam.rx.toFixed(2)}deg) rotateY(${cam.ry.toFixed(2)}deg)`;
```

Backticks make a template literal; `${...}` inserts computed values; `toFixed` limits the printed decimals. Moving the containing world simulates a camera for these DOM cards.

**Change:** Reduce `FLIGHT` from 1250 to 1100 on a practice branch, compare the end of the room, then restore. Check that the final cards remain usable.

**Explain back:** How can the showroom appear 3D without rendering each product card in WebGL?

## K. Showroom detail card unfolds

**See:** Selecting a showroom card moves toward it and opens a two-part product detail presentation.

**Trace:** `open(item)` / `close()` in `showroom3d.js`; `photoPage.animate` and `infoPage.animate`; showroom detail markup/styles.

**Explain:** The chosen item becomes the camera target and fills the detail HTML. After a 380ms camera lead-in, the photo animates for 520ms from deeper/smaller to normal. The information panel unfolds over 720ms after a 110ms delay. On narrow dimensions it uses rotateX; otherwise rotateY. `fill: "backwards"` applies its start state during the delay. Close uses shorter reverse motions and hides the detail after completion. Keyboard focus moves to Close, stays in the presentation, and returns to the opening product afterward. Disabling scroll while open is interaction management, not an animation formula.

**Change:** Change only the information panel's 720ms opening duration to 900ms, then restore. Do not remove focus or Escape handling.

**Explain back:** Why is a delay useful between camera movement and the panel unfolding?

## L. Pick your sport: ring, inertia, reflection and tabs

**See:** Sport cards form a rotating ring. Dragging, scroll, tabs, arrow keys and idle rotation select sports.

**Trace:** `setUpSportRing()` in `home3d.js`; ring markup in `home.ejs`; `.sport-ring` selectors in `home.css`.

```js
const step = 360 / count;
const mod = n => ((n % count) + count) % count;
```

`step` is the angle between adjacent cards: six cards means 60 degrees. JavaScript remainder can be negative; the double remainder expression wraps negative and positive indices into the valid range. `offsetBetween` chooses the shortest signed direction to a sport. Radius is calculated from card width and card count, so it adapts to layout.

`setAngle` writes `--angle`, computes the front index, updates relative card positions, and synchronizes tabs, dots, the big sport word, glow, underline and counter. The reflection is a cloned, inert, aria-hidden track; links are replaced with spans to avoid duplicate interactive controls.

Pointer movement must exceed six pixels before being treated as a drag. Release estimates speed from recent samples and projects a bounded extra angle before snapping to a card. This is inertia simulation, not real physical momentum. Clicks after dragging are suppressed so a swipe does not open a product/category. An interval checks every 250ms, but advances only after at least four seconds without interaction, and only when visible, not hovered/dragged/focused, and the document is visible. Initial card entrances use Web Animations with delays based on distance from the front card.

Reduced motion switches to a normal swipe row. Desktop pinning is selected separately from pointer capability.

**Change:** Change the four-second idle threshold to six seconds on a practice branch, then restore. Do not confuse the 250ms polling interval with the four-second advance threshold.

**Explain back:** Why must dragging and clicking be distinguished? Why should an automatic carousel pause during keyboard focus?

## M. Showcase product and podium

**See:** A highlighted product floats above a turning podium; labels draw in; mouse movement shifts the lighting and tilt.

**Trace:** Showcase markup in `home.ejs`; final showcase block of `home3d.js`; `home.css`; `nx-hover-float` and `nx-podium` in `motion.css`.

**Explain:** An observer adds `is-in` at a 0.3 threshold. CSS uses that state to draw SVG callout lines by reducing stroke-dashoffset and to reveal label text with delays. Product float and podium rotation are repeating CSS keyframes. The product uses individual `translate` for the float, allowing other transform properties to coexist. Pointer position supplies `--lx`, `--ly`, `--rx`, and `--ry`; the spotlight and tilt read them. Pointer lighting runs only with motion allowed, a fine pointer, and a non-low device tier. Labels are hidden by phone layout rules where they would cover the product.

**Change:** Reduce the local showcase rotation multipliers from 16/8 to 8/4, then restore.

**Explain back:** Which portions run because time passes, and which portions respond to user input?

## N. Deal cards flip

**See:** A deal card turns to show the reverse face and its offer/actions.

**Trace:** `data-flip-card` in `home.ejs`; deal-card handlers in `home.js`; `.flip-inner`/front/back styling in `home.css`.

**Explain:** Perspective belongs to a surrounding element, preserve-3d retains depth between faces, and backface visibility hides the reverse side of each face. Hover/focus CSS turns the inner card. Touch and the explicit button toggle `is-flipped` and update `aria-expanded`. Clicking an actual link/button retains its original job. Escape clears the flipped state and restores toggle focus. Reduced motion removes the transition; the content still changes.

**Change:** Change only the practice card's flip transition duration, compare mouse, keyboard and touch-emulation behaviour, then restore.

**Explain back:** Why are two faces needed, and why should the back face not remain mirrored through the front?

## O. Countdown digits flip

**See:** Hours, minutes and seconds update; a changed number flips into place.

**Trace:** Initial time computed in `home.ejs`; countdown block in `home.js`; `nx-flip-digit` in `motion.css`.

```js
const left = Math.max(0, ends - Date.now());
set(boxes.s, pad(Math.floor(left / 1000) % 60));
```

`ends` is an absolute timestamp. Subtracting the current timestamp avoids drift from decrementing an old cached number. Milliseconds divided by 1000 become seconds; floor drops fractions; remainder 60 isolates the seconds within a minute. `String(...).padStart(2,"0")` writes 7 as 07. Only changed values receive `is-flipping`. Removing that class, reading `offsetWidth`, then re-adding it restarts the CSS animation. This deliberate layout read is used for isolated events, not every animation frame. At zero the interval clears.

**Change:** In an isolated exercise, calculate the displayed minutes and seconds for 90500ms. Do not change the real deal end time just to learn arithmetic.

**Explain back:** Why is an absolute end time better than subtracting one from a counter every interval?

## P. Depth tiles, number counters, image loading and product rails

**See:** Cards tilt under a mouse, statistics count upward, loaded photos fade in, and horizontal product rails scroll.

**Trace:** `setupTilt`, `setupCounters`, `setupImages` in `motion.js`; rail handlers in `store.js`; relevant reveal/tilt CSS.

**Explain:** `setupTilt` normalizes a pointer relative to the card centre, not the window. It sets `--tilt-x/y`, normalized layer offsets and glare position. At the edge, the default maximum is eight degrees. It batches pointer updates with RAF, resets on leave, and skips touch/reduced motion. The apparent glare is a styled element rather than a real light simulation.

Counters read the final `data-count-to` value, start when observed, use `1 - (1 - t)^3` easing, and stop at the exact target. Their duration is capped; they do not repeatedly query the backend. `setupImages` adds fade states only for unfinished images below the first screen and clears loading on error too. First-screen images are not hidden waiting for load effects. Product rail buttons scroll an overflow container; the data remains ordinary product markup.

**Change:** Set `data-tilt-max="4"` on one practice card to halve its tilt. Restore after comparing. Keep the final counter target accurate.

**Explain back:** Which coordinate system would you use for tilting one card: window-relative or card-relative?

## Q. Header, suggestions, menus and drawers

**See:** Header gains a glass treatment after scrolling; mobile header tucks away; suggestions stagger; menus pop; phone search and drawers slide.

**Trace:** `header.ejs`; `setupScroll` in `motion.js`; `setupHeader`, `setupMenus`, dialog handlers in `app.js`; `header.js`; `style.css`, `mobile.css`, `components.css`.

**Explain:** The glass state changes at scrollY > 20. Mobile hide/show uses scroll direction, `.is-tucked`, and translateY(-100%); it stays visible during interaction. `--header-h` tracks how much header currently covers the viewport so sticky followers sit correctly. `header.js` opens search, updates aria-expanded, dims the page with a scrim, and makes search a full-screen sheet at its phone breakpoint. Suggestion entrance delays use their generated `--i`. Menus switch `hidden`; CSS supplies the entrance. Native dialogs manage modal focus; open/close CSS supplies presentation. The HTTP request returns search data, not animation frames.

**Change:** In a practice override change a suggestion's entrance from translateY(6px) to 3px, then restore. Keep names, links, focus and Escape intact.

**Explain back:** Does clicking All categories make a database request for every animation frame?

## R. Wishlist hearts, buttons, tooltips and loading placeholders

**See:** Buttons lift/press, a wishlist heart bursts, loading placeholders pulse, tooltips appear, successful controls pop.

**Trace:** `store.js` wishlist handlers, shared feedback helpers in `app.js`, `.card-add` and tooltip CSS in `components.css`, micro-interactions in `motion.css`, skeleton rules in `style.css`.

**Explain:** UI classes represent states: idle, loading, saved, error. CSS transforms and opacity visualize those states. A pseudo-element can draw a burst without adding another DOM node. The heart count must follow application state, not simply whether a burst played. Skeletons hold a layout while data loads; pulse is decoration over a placeholder, not progress percentage. Focus-visible styling provides keyboard feedback even when hover is unavailable.

**Change:** Reduce a local hover translate distance by half, then restore. Never replace pending server state with a permanent success class to force an animation.

**Explain back:** Why is a successful animation not proof that an API request succeeded?

## S. Photo flies to cart, sparks and catch

**See:** A small photo lifts off, curves toward the header cart, shrinks and triggers a catch/ring/sparks. Failure during flight can reverse it.

**Trace:** `Nx.addToCart`, `Nx.startFlight`, `cartTarget`, `catchAt` in `store.js`; `fx/cartfx.js`; `.fly-card`/cart catch rules in `style.css`; badge update in `app.js`.

```js
const u = 1 - p;
const x = 2 * u * p * cx + p * p * dx;
const y = 2 * u * p * cy + p * p * dy;
```

These are quadratic Bézier coordinates with start at (0,0), end at (dx,dy), and a raised control point (cx,cy). `p` is eased progress from zero to one. The starting rectangle and cart target are measured, then transforms animate a decorative photo copy. Sine-shaped lift/bank terms rotate it along the path. It shrinks as it lands. Sheen moves independently. `direction = -1` reverses a still-running flight after a failed add request; it does not reverse a completed server transaction.

Cart sparks use one separate full-screen WebGL canvas, a fixed particle pool and trail/burst/puff methods. Particle age/lifetime controls shrinking/fading. Drag damps velocity; gravity changes it. Idle state unsubscribes and shrinks the canvas. Reduced motion skips the flight; low-power/reduced-data/no-WebGL paths may skip sparks. The request starts alongside the animation, and the badge follows the authoritative response. A timeout prevents background-tab frame suspension from blocking completion UI indefinitely.

**Change:** On a practice branch reduce the lift coefficient from 0.32 to 0.20, compare the arc, then restore. Test visually without placing a paid order.

**Explain back:** What is the difference between the product photo copy, the cart API request, and the spark layer?

## T. Cart rows fold away; totals and badges change

**See:** Removing a cart item folds its row backward, then remaining rows slide into place. Numbers can roll/bump.

**Trace:** `removeRow()` in `cart.js`; `Nx.rollNumber`, `Nx.setCartCount` in `app.js`; cart/badge styles.

**Explain:** The row stores its leaving Promise to avoid starting two removal animations. It measures neighbouring rows before deletion, animates the removed row with perspective/rotateX/translateZ and fading, removes it after completion, measures neighbours again, then animates their positional difference back to zero. This is the FLIP family of techniques: First, Last, Invert, Play. No new stock or prices are calculated by the transform. Reduced motion removes the row directly. The roll-number helper animates a display change; the returned cart determines the actual totals.

**Change:** In a disposable test cart or local UI exercise, reduce the row's rotateX magnitude from -78 to -45, then restore. Do not delete a real saved purchase just to see the animation.

**Explain back:** Why measure neighbouring rows both before and after removal?

## U. Product gallery, magnifier and full-screen zoom

**See:** Product photos turn in depth with a light sweep. Hover can magnify; the full-screen viewer supports zoom/pan and gestures.

**Trace:** Gallery markup in `product.ejs`; gallery block in `catalog.js`; magnifier/lightbox blocks in `product.js`; `product.css`.

**Explain:** During a change, a decorative copy of the previous photo rotates/fades away; the real main image rotates in; a light layer sweeps across. Duplicate transition names are disabled on the copy. Finished callbacks remove temporary elements. `dir` changes the rotation direction. Selected thumbnails and visible-photo lists remain state separate from animation; colour changes filter thumbnails and an empty colour restores all photos.

The magnifier measures the pointer relative to the image and updates the source/background position for the magnified pane. The full-screen dialog tracks a scale, translations and pointer positions; two pointers provide pinch distance, dragging pans when enlarged, and swipe changes image at normal scale. Zoom limits and bounds keep the image controllable. These are input-driven transforms, not an autoplay carousel.

**Change:** Reduce the gallery's practice rotateY entrance magnitude from 48 to 30 degrees, then restore. Leave keyboard, reduced-motion and cleanup paths working.

**Explain back:** Why keep a separate leaving photo instead of changing a single image's source and hoping a transition remembers the old pixels?

## V. Product headline, price, magnetic controls, stock and sticky dock

**See:** The product title rises by words, price counts to its real value, buttons follow the cursor, features tilt, a stock marker pulses, a marquee scrolls, and a buy bar appears after scrolling past the buy panel.

**Trace:** `product.js` sections beginning at title/price/magnetic/feature cards/dock; `product.css`; picker shake in `cart.js`.

**Explain:** The product headline is split in the browser into word wrappers; this differs from the home headline split into characters by EJS. The accessible label retains plain text. Price count uses `t += dt/1.2` and quartic easing, then restores the exact original formatted value. A 1600ms timeout also restores it if frames pause. This display effect never determines the amount charged.

Magnetic controls use card-relative pointer offsets multiplied by 0.18/0.3 and reset on leave, only for fine pointers with motion enabled. Feature tilt writes product-specific `--rx/ry` and light positions; shared tilt writes different variables, so trace which selector reads which. The dock observer checks both intersection and whether the buy panel has passed above the viewport; it does not show the dock just because the panel is below the screen. Hidden dock actions leave the tab order. Product CSS includes stock pulses, button sheen, repeated-half marquee movement, review entrances, and side/bottom size-guide entrances. A missing variant triggers the picker shake; reduced motion removes that shake.

**Change:** Halve magnetic movement multipliers on a practice branch, then restore. Do not change the price target to learn a count effect.

**Explain back:** Which product effects modify a display, and which underlying cart/order data must stay independent?

## W. Authentication particles, admin globe and form feedback

**See:** Customer authentication decoration morphs athlete → football → dumbbell; the admin login shows a globe. Forms have entry, shake, focus, spinner and success effects.

**Trace:** `views/pages/auth.ejs`, recovery templates, `views/admin/login.ejs`; `auth3d.js`, `auth.js`, `auth.css`; shared engine/shapes.

**Explain:** Customer shape changes are time-driven, unlike the home hero's scroll-driven morph. `HOLD=3.4`, `MORPH=1.4`. `weightsAt(time)` chooses the active shape and blends to the next over the transition interval. Three weights multiply the matching positions. Pointer repulsion computes distance to the mouse, an exponential falloff, a radial direction and a perpendicular swirl. The wireframe admin globe uses lines for latitude/longitude plus data dots, updated over time. Form animations visualize focus, submission, errors or success; authentication remains an HTTP/backend operation.

`auth.css` includes character motto in/out, fallback rings, form rise, soft/full shake, dropdown entrance, spinner, blink, success pop, SVG check drawing, admin scan/caret and envelope drawing. Their selectors and source index show the triggering state; their presence alone does not establish that every state is visible on the same page.

**Change:** In a practice branch change the customer HOLD from 3.4 to 4.5, compare, then restore. Do not modify password/security logic for an animation exercise.

**Explain back:** Why does stopping the decorative scene not log a customer out?

## X. Checkout and payment states

**See:** Checkout steps enter, applied coupons pop, a payment overlay enters, pending dots/spinners move, and success/error marks draw or shake.

**Trace:** Checkout templates, `checkout.js`, `payment.js`, `confetti.js`, payment and checkout sections in `motion.css`; actual payment outcome comes from backend services/provider verification.

**Explain:** JavaScript switches overlay states; selectors select their visuals. `nx-step-in` moves a new step from the side. `nx-coupon-pop` briefly overshoots scale before settling. Spinner keyframes rotate a loader; they measure elapsed visual cycles, not gateway completion percentage. SVG circles/checkmarks use stroke-dasharray and offset so a line appears to draw. Pending dots pulse/breathe. Error shake is short horizontal translation. State changes must follow server responses; CSS cannot establish that payment succeeded. Phone details are presented as a sheet with separate interaction/focus rules.

**Change:** Adjust a local coupon pop scale from 1.02 to 1.01, then restore. Use a mock/isolated UI or supported sandbox flow, never a real payment just to inspect animation.

**Explain back:** Why must the payment success state be independent of the animation finishing?

## Y. Success confetti

**See:** After success/check drawing, coloured strips burst, rotate, fall, flutter and fade.

**Trace:** Order-success template; `confetti.js`; optional `fx/confetti3d.js`; success keyframes in `motion.css`.

```js
p.vy = p.vy * slow + GRAVITY * dt;
p.y += p.vy * dt;
p.angle += p.spin * dt;
```

`p` is one strip. `vy` is vertical velocity. Air drag scales velocity with `slow`; gravity adds vertical speed; multiplying speed by time advances position. Spin advances angle. The WebGL implementation caps falling speed and adds sideways flutter. The 2D fallback has its own RAF-based physics and finite duration. The success page delays its burst until after the tick sequence and uses WebGL if available, otherwise 2D. Reduced motion skips celebration. Resize listeners and temporary canvas elements are cleaned up after use.

**Change:** Change only the 2D fallback's local duration from 3500ms to 2500ms in a practice branch, then restore. That does not change the WebGL implementation's duration.

**Explain back:** How do gravity, velocity and position differ?

## Z. Page transitions and remaining feedback effects

**See:** Supported browsers animate page changes, including a product photo appearing to flow from a card into its detail page. Toasts, saved-address ticks, empty illustrations and small indicators provide additional feedback.

**Trace:** `pageswap` handler in `app.js`, early `page-reveal.js`, View Transition rules in `motion.css`; shared feedback helpers in `app.js`; `components.css`, `style.css`, page-specific CSS.

**Explain:** The browser captures old/new visual states during cross-document navigation. Matching `view-transition-name: product-photo` pairs the source photo with the destination photo. Only one element per state may use the same name; duplicate names cancel the transition. History traversal supplies forward/back types, and CSS chooses different entry/exit keyframes. `page-reveal.js` loads without defer so it can prepare the arriving state before the first transition frame. Unsupported browsers navigate normally. Rejected/cancelled transition promises are handled. This is different from AJAX section navigation and from a product-gallery change within one document.

Toast entrance/exit is state-driven; its timer bar visually counts down, with pause styling. Saved-address ticks draw their SVG stroke while the card glows. Empty-state illustrations float and their shadows shrink to suggest height; small details twinkle. Input autofill feedback fades from a dimmer state. Shipping/payment detail icons have local pulse/roll effects. Some admin/account shells intentionally omit the shared motion layer, so a counter function existing in `motion.js` does not prove it runs on every admin page. Use the template's script settings to check availability.

The generated index below includes small CSS keyframes beyond these primary chapters. To learn one, find its selector, determine which class/attribute enables it, read from/to or percentage states, then trace the code that changes that state. Hover-only transitions do not necessarily have named keyframes.

**Change:** In a practice branch reduce a single page-root translate distance, then restore. Do not rename only one side of a shared-photo transition; both sides must agree.

**Explain back:** What happens in a browser that does not support View Transitions?

## Practice rules and learning checkpoints

1. Work on a separate practice branch or copy. Keep exercises separate from working website changes.
2. Change one visual number/property at a time, observe and explain, then restore. The guide has not applied these exercises.
3. Do not remove reduced-motion, keyboard, focus, fallback or cleanup paths to simplify a lesson.
4. CSS duration tokens use seconds; Web Animations options generally use milliseconds; engine `dt` is seconds. Convert explicitly.
5. An effect requires all its connections: relevant HTML, loaded stylesheet, loaded script if needed, trigger, and any capability/preference checks. A data attribute or keyframe definition alone is not enough.
6. Backend routes/controllers/models provide content and authoritative state. Most frame generation is frontend-only; do not search for a MongoDB sphere model.
7. Check mobile, desktop, reduced motion, off-screen/hidden-tab behaviour and keyboard use for your exercise. Viewport emulation is not a guarantee about every physical GPU/browser.
8. Explain the input, state, output, stop condition and fallback before calling a feature understood.

For chapter C/D, a good explanation is: “The server returns the hero HTML. The browser loads our module and engine. A typed array supplies sphere positions. Hidden drawings supply matching logo and athlete positions. Scroll progress chooses a morph target, damping smooths it, and the vertex shader blends positions. A fragment shader draws glowing dots. The scene draws while needed; CSS and static alternatives preserve content when motion or WebGL is unavailable.”

## Source inventory

The following section is generated from the current public source. Line numbers identify definitions and entry points at generation time, not stable permanent IDs. It complements, rather than replaces, reading the surrounding code.


### CSS keyframes, by file

- `public/css/account.css`: `acct-spin` (line 14).
- `public/css/admin.css`: `admin-spin` (line 11).
- `public/css/auth.css`: `nx-motto-in` (line 242); `nx-motto-out` (line 243); `nx-au-ring` (line 246); `nx-au-ring-b` (line 247); `nx-au-rise` (line 250); `nx-au-soft-shake` (line 252); `nx-au-shake` (line 254); `nx-au-drop` (line 256); `nx-au-spin` (line 261); `nx-au-blink` (line 263); `nx-au-pop` (line 265); `nx-au-draw` (line 269); `nx-au-draw-mark` (line 270); `nx-cr-scan` (line 272); `nx-cr-caret` (line 274); `nx-au-draw-env` (line 312).
- `public/css/components.css`: `nx-add-pulse` (line 463); `rise` (line 505); `pop` (line 506); `slide-in` (line 507); `sheet-up` (line 508); `drawer-in` (line 509); `drawer-in-right` (line 510); `spin` (line 511); `shimmer` (line 512); `indeterminate` (line 513); `countdown` (line 514); `cart-bump` (line 515).
- `public/css/filters.css`: `fx-open` (line 44); `fx-fade` (line 175).
- `public/css/motion.css`: `nx-reveal-up` (line 26); `nx-reveal-fade` (line 40); `nx-reveal-scale` (line 41); `nx-step-in` (line 113); `nx-coupon-pop` (line 115); `nx-glow` (line 122); `nx-details-in` (line 126); `nx-tick-pop` (line 128); `nx-pay-in` (line 136); `nx-pay-pulse` (line 138); `nx-shackle` (line 140); `nx-spin` (line 142); `nx-draw-circle` (line 148); `nx-draw-mark` (line 149); `nx-shake` (line 151); `nx-dot-pulse` (line 157); `nx-dot-breathe` (line 159); `nx-step-rise` (line 166); `nx-line-draw` (line 167); `nx-truck-roll` (line 174); `nx-float` (line 184); `nx-float-shadow` (line 185); `nx-twinkle` (line 186); `nx-char-in` (line 196); `nx-hero-rise` (line 199); `nx-scroll-cue` (line 203); `nx-ring-a` (line 209); `nx-ring-b` (line 210); `nx-ring-c` (line 211); `nx-hover-float` (line 215); `nx-podium` (line 220); `nx-flip-digit` (line 230); `nx-turn-up` (line 234); `nx-filled` (line 246); `nx-page-out` (line 260); `nx-page-in` (line 261); `nx-page-out-back` (line 269); `nx-page-in-back` (line 270); `nx-heart-burst` (line 284); `nx-success-pop` (line 295); `nx-tick-draw` (line 307); `nx-saved-glow` (line 308).
- `public/css/product.css`: `pdx-pulse` (line 89); `pdx-rise` (line 94); `size-guide-side` (line 149); `size-guide-up` (line 150); `pdx-ask` (line 178); `pdx-sheen` (line 204); `pdx-bump` (line 276); `pdx-marquee` (line 309); `pdx-review-in` (line 400).
- `public/css/style.css`: `nx-skeleton-sweep` (line 49); `pe-badge-in` (line 533); `pe-turn` (line 544); `nx-cart-catch` (line 653); `nx-cart-ring` (line 654); `nx-search-nudge` (line 773); `nx-suggest-in` (line 808).

### JavaScript animation and trigger entry points

This scan lists likely animation-related call sites, including fallback and conditional paths; it does not establish that a path executes on every page. Read each surrounding function and the template script list.


**`public/js/3d/boot.js`**

- line 34: `requestAnimationFrame(() => container.classList.add("is-live"));`

**`public/js/3d/scene.js`**

- line 262: `if (window.NxTicker) this.unsubscribe = window.NxTicker.add((time, dt) => this.step(dt));`
- line 263: `else this.frame = requestAnimationFrame(this.loop);`
- line 296: `this.frame = requestAnimationFrame(this.loop);`

**`public/js/admin-dashboard.js`**

- line 95: `node.animate([{ transform: from === "left" ? "scaleX(0)" : "scaleY(0)" }, { transform: "none" }],`
- line 102: `path.animate([{ strokeDasharray: '${length}', strokeDashoffset: length }, { strokeDasharray: '${length}', strokeDashoffset: 0 }],`
- line 276: `slices.forEach(s => s.slice.animate(`
- line 372: `cells.filter(c => c.count).forEach(c => c.rect.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: (c.d * 24 + c.h) * 4, fill: "backwards" }));`
- line 410: `requestAnimationFrame(step);`
- line 412: `requestAnimationFrame(step);`
- line 454: `frame = requestAnimationFrame(() => render(false));`
- line 554: `frame = requestAnimationFrame(() => render(false));`

**`public/js/app.js`**

- line 377: `if (progress < 1) requestAnimationFrame(step);`
- line 379: `requestAnimationFrame(step);`
- line 405: `ghost.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: 'translateY(${up ? "-80%" : "80%"})', opacity: 0 }], timing);`
- line 406: `now.animate([{ transform: 'translateY(${up ? "80%" : "-80%"})', opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], timing)`
- line 556: `requestAnimationFrame(() => {`
- line 693: `window.addEventListener("pageswap", event => {`

**`public/js/auth.js`**

- line 22: `frame = requestAnimationFrame(() => {`

**`public/js/auth3d.js`**

- line 114: `scene.onUpdate((time, dt) => {`
- line 241: `scene.onUpdate(time => {`

**`public/js/cart.js`**

- line 220: `const fold = row.animate([`
- line 228: `if (shift) other.animate([{ transform: 'translateY(${shift}px)' }, { transform: "none" }], { duration: Nx.motionMs("--duration-medium", 320), easing: Nx.motionEase("--ease-out") });`

**`public/js/catalog.js`**

- line 632: `leaving.animate([`
- line 636: `main.animate([`
- line 640: `light.animate([`

**`public/js/confetti.js`**

- line 62: `requestAnimationFrame(frame);`
- line 69: `requestAnimationFrame(frame);`

**`public/js/consent.js`**

- line 107: `requestAnimationFrame(() => banner.classList.add("is-in"));`

**`public/js/fx/cartfx.js`**

- line 214: `stop = window.NxTicker.add(frame);`
- line 222: `if (stop) id = requestAnimationFrame(loop);`
- line 224: `id = requestAnimationFrame(loop);`

**`public/js/fx/confetti3d.js`**

- line 201: `stop = window.NxTicker.add((t, dt) => frame(dt));`
- line 209: `if (stop) id = requestAnimationFrame(loop);`
- line 211: `id = requestAnimationFrame(loop);`

**`public/js/header.js`**

- line 63: `requestAnimationFrame(() => scrim.classList.add("is-on"));`

**`public/js/home3d.js`**

- line 160: `scene.onUpdate((time, dt) => {`
- line 320: `frame = requestAnimationFrame(() => {`
- line 411: `scrollFrame = requestAnimationFrame(() => {`
- line 430: `resizeFrame = requestAnimationFrame(measure);`
- line 475: `drag.frame = requestAnimationFrame(() => {`
- line 526: `tiltFrame = requestAnimationFrame(() => {`
- line 566: `float.animate(`
- line 610: `frame = requestAnimationFrame(() => {`

**`public/js/motion.js`**

- line 96: `frame = requestAnimationFrame(() => {`
- line 149: `requestAnimationFrame(update);`
- line 170: `if (t < 1) requestAnimationFrame(step);`
- line 173: `requestAnimationFrame(step);`

**`public/js/page-reveal.js`**

- line 13: `window.addEventListener("pagereveal", event => {`

**`public/js/product.js`**

- line 28: `if (mainPhoto.complete) requestAnimationFrame(done);`
- line 422: `const stop = NxTicker.add((time, dt) => {`

**`public/js/showroom3d.js`**

- line 119: `id = requestAnimationFrame(loop);`
- line 121: `id = requestAnimationFrame(loop);`
- line 572: `photoPage.animate(`
- line 576: `infoPage.animate(`
- line 602: `infoPage.animate(`
- line 606: `photoPage.animate(`
- line 629: `resizeFrame = requestAnimationFrame(place);`

**`public/js/store.js`**

- line 127: `stop = window.NxTicker.add((time, dt) => { if (fn(dt) === false && stop) stop(); });`
- line 137: `if (running) id = requestAnimationFrame(loop);`
- line 139: `id = requestAnimationFrame(loop);`
- line 641: `frame = requestAnimationFrame(() => Nx.updateRail(rail));`

Inventory: 90 CSS keyframe definitions and 62 candidate JavaScript entry/call sites. CSS transitions and indirect calls are not exhaustively identified by these patterns.
