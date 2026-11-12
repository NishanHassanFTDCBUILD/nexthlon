// The zero-gravity showroom (ES module, home page).
// Wide screens: twelve glass product cards float at fixed "random" spots in a CSS 3D room. The mouse
// turns the camera, scrolling through the pinned section flies it forward, a card faces you on hover,
// and a click flies to it and unfolds a detail card like a book. Phones: a floating swipe row
// (tilted by the gyroscope where the browser allows it without asking). Reduced motion: a still
// grid. Without JavaScript: the same cards as a plain grid of links.
// Everything moves on the site's one shared ticker (public/js/motion/ticker.js).
import { prefersReducedMotion, finePointer, deviceTier } from "./3d/interaction.js";
import { clamp, damp } from "./3d/math.js";
import { Scene, Mesh } from "./3d/scene.js";
import { supportsWebGL } from "./3d/gl.js";

// ---------- The dust field (WebGL) ----------
// Volt particles fill a deep box in front of the camera. As the showroom camera flies forward they
// stream towards the viewer and wrap round to the back, so the room feels deep and the flight feels
// fast; they brighten with speed and turn with the mouse look. One draw call; drawn from the
// showroom's own frame (never a loop of its own).
const DUST_DEPTH = 24;
const dustShader = {
  vertex: `
    attribute vec3 aPosition;
    attribute vec3 aRandom;
    uniform mat4 uModel, uView, uProjection;
    uniform float uTime, uTravel, uScale, uSpeed, uIntro;
    varying float vAlpha;
    varying float vMix;
    void main() {
      vec3 p = aPosition;
      p.z = mod(p.z + uTravel + uTime * 0.25, ${DUST_DEPTH.toFixed(1)}) - ${DUST_DEPTH.toFixed(1)};
      float t = uTime * (0.3 + aRandom.y * 0.4) + aRandom.x * 6.2831;
      p.x += sin(t) * 0.12;
      p.y += cos(t * 0.8) * 0.12;
      vec4 mv = uView * uModel * vec4(p, 1.0);
      gl_Position = uProjection * mv;
      float depth = -mv.z;
      // A real size in the room (0.03 to 0.09 units) seen in perspective: uScale is drawing-buffer
      // pixels per unit at a depth of 1.
      gl_PointSize = clamp((0.03 + aRandom.z * 0.06) * uScale * (1.0 + uSpeed * 0.4) / max(depth, 0.5), 1.5, 30.0);
      // Fades in from the far end and out just before it reaches the viewer.
      float fade = smoothstep(0.4, 2.5, depth) * (1.0 - smoothstep(14.0, ${DUST_DEPTH.toFixed(1)}, depth));
      vAlpha = fade * (0.45 + 0.55 * aRandom.z) * (0.7 + uSpeed * 0.8) * uIntro;
      vMix = aRandom.y;
    }`,
  fragment: `
    precision mediump float;
    varying float vAlpha;
    varying float vMix;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float light = (smoothstep(0.25, 0.0, d) * 0.8 + smoothstep(0.5, 0.0, d) * 0.35) * vAlpha;
      vec3 color = mix(vec3(0.83, 1.0, 0.23), vec3(0.95, 1.0, 0.8), vMix * 0.6);
      gl_FragColor = vec4(color * light, light);
    }`
};

function buildDustField(canvas, tier) {
  const count = tier === "high" ? 1400 : 700;
  const maxRatio = tier === "high" ? 1.5 : 1.25;
  const scene = new Scene(canvas, { maxRatio, camera: { fov: 60, position: [0, 0, 0.001], target: [0, 0, -1], far: 60 } });
  // The showroom draws each frame itself; the scene's own observers only matter for its loop, which
  // never starts.
  const positions = new Float32Array(count * 3);
  const random = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() * 2 - 1) * 7;
    positions[i * 3 + 1] = (Math.random() * 2 - 1) * 4.5;
    positions[i * 3 + 2] = Math.random() * DUST_DEPTH;
    random[i * 3] = Math.random();
    random[i * 3 + 1] = Math.random();
    random[i * 3 + 2] = Math.random();
  }
  const dots = scene.add(new Mesh(scene.gl, { positions }, {
    ...dustShader,
    blending: "additive",
    depthTest: false,
    attributes: { aRandom: { data: random, size: 3 } },
    uniforms: { uTravel: 0, uScale: 1, uSpeed: 0, uIntro: 0 }
  }));
  let lastZ = null;
  let speed = 0;
  return {
    // cam: the showroom camera (z in pixels flown, rx/ry in degrees); intro: 0 to 1 as the room appears.
    draw(time, dt, cam, intro) {
      if (lastZ === null) lastZ = cam.z;
      const moved = dt > 0 ? Math.abs(cam.z - lastZ) / dt : 0;
      lastZ = cam.z;
      speed = damp(speed, clamp(moved / 1400, 0, 1), 6, dt);
      dots.uniforms.uTravel = cam.z / 90;
      dots.uniforms.uSpeed = speed;
      dots.uniforms.uIntro = intro;
      // Drawing-buffer pixels per unit at depth 1, for a 60° field of view (the canvas size is the one
      // from the last frame; render() resizes it).
      dots.uniforms.uScale = Math.max(1, canvas.height) / (2 * Math.tan(Math.PI / 6));
      dots.rotation[0] = (-cam.rx * Math.PI) / 180 * 0.8;
      dots.rotation[1] = (-cam.ry * Math.PI) / 180 * 0.8;
      scene.render(time);
    }
  };
}

// Started here, after the settings above exist (a const used before its line throws).
const section = document.querySelector("[data-showroom]");
if (section) setUpShowroom(section);

// The shared ticker, or a tiny stand-in if the page does not have it.
function getTicker() {
  if (window.NxTicker) return window.NxTicker;
  return {
    add(fn) {
      let id = 0;
      let last = 0;
      let time = 0;
      const loop = now => {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now;
        time += dt;
        fn(time, dt);
        id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }
  };
}

// A small seeded random generator: the room looks the same on every visit.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const h = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return w > 0 && h > 0 ? w * h : 0;
}

function setUpShowroom(root) {
  const ticker = getTicker();
  const reduced = prefersReducedMotion();
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const stage = root.querySelector("[data-showroom-stage]");
  const world = root.querySelector("[data-showroom-world]");
  const cards = [...root.querySelectorAll("[data-zg-card]")];

  // ---------- Add to cart (every mode) ----------
  // The shared Nx.addToCart (store.js): the photo flies the moment the button is pressed, guests sign
  // in first and come back to the product, and "the most you can buy" is a calm note, not an error.
  function addToCart(card, quantity, image, button) {
    const href = card.querySelector("[data-zg-link]").getAttribute("href");
    if (!window.Nx || !Nx.addToCart) {
      window.location.assign(href);
      return;
    }
    Nx.addToCart({ productId: card.dataset.id, quantity, source: image, button, href });
  }
  root.addEventListener("click", event => {
    const add = event.target.closest("[data-zg-add]");
    if (!add) return;
    const card = add.closest("[data-zg-card]");
    addToCart(card, 1, card.querySelector(".zg-media img"), add);
  });

  if (reduced) {
    root.classList.add("is-grid");
    return;
  }
  if (phone) {
    setUpFloat();
    return;
  }
  setUpRoom();

  // ---------- Phones: a floating swipe row ----------
  function setUpFloat() {
    root.classList.add("is-float");
    const floats = cards.map((card, i) => ({ el: card.querySelector(".zg-float"), phase: i * 1.7, speed: 0.8 + (i % 3) * 0.15 }));
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
    // Gyroscope tilt only where the browser allows it without a permission prompt.
    if ("DeviceOrientationEvent" in window && typeof window.DeviceOrientationEvent.requestPermission !== "function") {
      window.addEventListener("deviceorientation", event => {
        if (event.gamma === null || event.beta === null) return;
        tilt.ty = clamp(event.gamma / 30, -1, 1) * 8;
        tilt.tx = clamp((event.beta - 45) / 30, -1, 1) * -6;
      }, { passive: true });
    }
    const frame = (time, dt) => {
      floats.forEach(f => {
        f.el.style.transform = `translate3d(0, ${(Math.sin(time * f.speed + f.phase) * 6).toFixed(2)}px, 0)`;
      });
      tilt.x = damp(tilt.x, tilt.tx, 4, dt);
      tilt.y = damp(tilt.y, tilt.ty, 4, dt);
      root.style.setProperty("--tilt-x", tilt.x.toFixed(2));
      root.style.setProperty("--tilt-y", tilt.y.toFixed(2));
    };
    whileOnScreen(frame);
  }

  // Runs a ticker job only while the section is on screen.
  function whileOnScreen(frame) {
    let stop = null;
    new IntersectionObserver(entries => {
      const visible = entries.some(entry => entry.isIntersecting);
      if (visible && !stop) stop = ticker.add(frame);
      else if (!visible && stop) {
        stop();
        stop = null;
      }
    }, { rootMargin: "120px" }).observe(root);
  }

  // ---------- Wide screens: the 3D room ----------
  function setUpRoom() {
    const PERSPECTIVE = 1200;
    const FLIGHT = 1250; // how far the camera flies over the pinned scroll (the last cards stay in front)
    const tier = deviceTier();
    const items = (tier === "low" ? cards.slice(0, 8) : cards).map(card => ({
      card,
      float: card.querySelector(".zg-float"),
      link: card.querySelector("[data-zg-link]"),
      x: 0, y: 0, z: 0, face: 0, phase: 0, speed: 1, amp: 10,
      hot: false, h: 0, fog: -1, fade: -1, far: false, gone: false, small: false
    }));
    cards.slice(items.length).forEach(card => { card.hidden = true; });
    root.classList.add("is-3d");

    const mouse = { x: 0, y: 0 };
    const cam = { x: 0, y: 0, z: 0, rx: 0, ry: 0 };
    let size = { w: window.innerWidth, h: window.innerHeight, top: 0, travel: 1 };
    let target = null;   // the card the camera flies to (focused or open)
    let openItem = null;
    let intro = 0;
    let focusScroll = 0;   // where the page was when a focused card took the camera
    let restoring = false; // focus coming back after closing the detail card

    // Places the cards: z spread evenly from near to far, alternating sides, each spot tried up to
    // 80 times. A spot is checked from three points of the fly-through (the start, a third and two
    // thirds of the way), not only from the start, so cards stay apart while you fly. Two cards at a
    // similar depth covering each other hides a product, so that counts most; a far card peeking out
    // behind a near one just reads as depth, so it counts little.
    const VIEWS = [0, FLIGHT / 3, (FLIGHT * 2) / 3];
    function place() {
      const box = stage.getBoundingClientRect();
      const head = root.querySelector(".showroom-head").getBoundingClientRect();
      const originY = box.height * 0.56;
      const minY = head.bottom - box.top - originY + 8;
      const maxY = box.height - originY - 16;
      const cardW = items[0].card.offsetWidth || 220;
      const cardH = items[0].card.offsetHeight || 300;
      const rand = seeded(20261105);
      const placed = []; // { x, y, z } in world units
      size = {
        w: box.width,
        h: box.height,
        top: root.getBoundingClientRect().top + window.scrollY,
        travel: Math.max(1, root.offsetHeight - window.innerHeight)
      };
      // Where a card at world (x, y, z) shows on screen when the camera has flown camZ forward.
      const project = (x, y, z, camZ) => {
        const d = z + camZ;
        if (d > 150) return null; // already passed the viewer
        const s = PERSPECTIVE / (PERSPECTIVE - d);
        return { x: x * s, y: y * s, w: cardW * s, h: cardH * s };
      };
      const covered = (a, b) => overlapArea(a, b) / Math.min(a.w * a.h, b.w * b.h);
      items.forEach((item, i) => {
        const z = -140 - (i / Math.max(1, items.length - 1)) * 1460 + (rand() - 0.5) * 80;
        const s = PERSPECTIVE / (PERSPECTIVE - z);
        const side = i % 2 === 0 ? -1 : 1;
        let best = null;
        for (let attempt = 0; attempt < 80; attempt += 1) {
          const screenX = side * (0.1 + rand() * 0.36) * size.w;
          const screenY = minY + rand() * (maxY - minY);
          const world = { x: screenX / s, y: screenY / s, z };
          const start = project(world.x, world.y, z, 0);
          const outside = Math.max(0, Math.abs(start.x) + start.w / 2 - (size.w / 2 - 16))
            + Math.max(0, minY - (start.y - start.h / 2)) + Math.max(0, start.y + start.h / 2 - maxY);
          let score = outside * 4;
          placed.forEach(other => {
            const weight = Math.abs(other.z - z) < 520 ? 4 : 0.6;
            VIEWS.forEach(camZ => {
              const a = project(world.x, world.y, z, camZ);
              const b = project(other.x, other.y, other.z, camZ);
              if (a && b) score += covered(a, b) * weight;
            });
          });
          if (!best || score < best.score) best = { ...world, screenX, score };
          if (score === 0) break;
        }
        placed.push(best);
        item.x = best.x;
        item.y = best.y;
        item.z = z;
        item.face = (-best.screenX / size.w) * 34;
        item.phase = rand() * Math.PI * 2;
        item.speed = 0.45 + rand() * 0.5;
        item.amp = 8 + rand() * 12;
        item.card.style.transform = `translate3d(${item.x.toFixed(1)}px, ${item.y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${item.face.toFixed(2)}deg)`;
      });
      sizeDust();
    }

    // ----- Volt dust -----
    // A WebGL field of particles in depth that streams past as the camera flies (buildDustField).
    // Without WebGL: a few slow motes on a 2D canvas. None on low-end devices.
    const dust = root.querySelector("[data-showroom-dust]");
    let field = null;
    if (dust && tier !== "low" && supportsWebGL()) {
      try {
        field = buildDustField(dust, tier);
      } catch (error) {
        field = null;
        if (window.console) console.warn("Showroom dust skipped:", error.message);
      }
    }
    const ctx = tier === "low" || !dust || field ? null : dust.getContext("2d");
    const motes = ctx ? Array.from({ length: tier === "high" ? 80 : 45 }, () => ({
      x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: 0.2 + Math.random() * 0.8,
      vx: (Math.random() - 0.5) * 0.012, vy: -0.004 - Math.random() * 0.01
    })) : [];
    let dustRatio = 1;
    function sizeDust() {
      if (!ctx) return;
      dustRatio = Math.min(window.devicePixelRatio || 1, 1.5);
      dust.width = Math.round(size.w * dustRatio);
      dust.height = Math.round(size.h * dustRatio);
      ctx.setTransform(dustRatio, 0, 0, dustRatio, 0, 0);
    }
    function drawDust(time, dt) {
      if (field) {
        field.draw(time, dt, cam, intro);
        return;
      }
      if (!ctx) return;
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.fillStyle = "#d4ff3a";
      motes.forEach(m => {
        m.x += m.vx * dt * 6;
        m.y += m.vy * dt * 6;
        if (m.y < -1.1) m.y = 1.1;
        if (m.x < -1.1) m.x = 1.1;
        if (m.x > 1.1) m.x = -1.1;
        const px = size.w / 2 + m.x * size.w * 0.55 + cam.ry * m.z * 6;
        const py = size.h / 2 + m.y * size.h * 0.55 - cam.rx * m.z * 6;
        ctx.globalAlpha = 0.12 + m.z * 0.45;
        ctx.beginPath();
        ctx.arc(px, py, 0.5 + m.z * 1.5, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    // ----- The frame: camera, then each card (writes only) -----
    function frame(time, dt) {
      intro = Math.min(1, intro + dt * 1.2);
      const progress = clamp((window.scrollY - size.top) / size.travel, 0, 1);
      // Scrolling always wins over a keyboard-focused card.
      if (target && !openItem && Math.abs(window.scrollY - focusScroll) > 60) target = null;
      let tz = progress * FLIGHT;
      let tx = -mouse.x * 40;
      let ty = -mouse.y * 24;
      let trx = mouse.y * 4;
      let try_ = mouse.x * 6;
      if (target) {
        // Put the card in front of the viewer: closer for the open detail card.
        tz = -target.z - (openItem ? 420 : 640);
        tx = -target.x;
        ty = -target.y;
        trx = mouse.y * 1.5;
        try_ = mouse.x * 2;
      }
      const speed = target ? 8 : 5;
      cam.z = damp(cam.z, tz, speed, dt);
      cam.x = damp(cam.x, tx, speed, dt);
      cam.y = damp(cam.y, ty, speed, dt);
      cam.rx = damp(cam.rx, trx, speed, dt);
      cam.ry = damp(cam.ry, try_, speed, dt);
      world.style.transform = `translate3d(${cam.x.toFixed(1)}px, ${cam.y.toFixed(1)}px, ${cam.z.toFixed(1)}px) rotateX(${cam.rx.toFixed(2)}deg) rotateY(${cam.ry.toFixed(2)}deg)`;

      items.forEach(item => {
        const d = item.z + cam.z; // depth in front of (negative) or behind the screen
        item.h = damp(item.h, item.hot || item === openItem ? 1 : 0, 10, dt);
        // Far cards settle (no float, so their fixed blur is not redrawn); near ones drift.
        const far = d < -1150;
        const wobble = (1 - item.h) * (far ? 0 : 1);
        const float = Math.sin(time * item.speed + item.phase) * item.amp * wobble;
        const rx = Math.sin(time * item.speed * 0.7 + item.phase) * 4 * wobble;
        const ry = -item.face * item.h + Math.cos(time * item.speed * 0.6 + item.phase) * 6 * wobble;
        const rz = Math.sin(time * item.speed * 0.5 + item.phase * 2) * 2.5 * wobble;
        item.float.style.transform = `translate3d(0, ${float.toFixed(2)}px, ${(80 * item.h).toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg)`;

        // Cards fade out as they pass the viewer; far ones sink into the fog.
        const fade = Math.round(clamp(1 - (d - 200) / 420, 0, 1) * intro * 100) / 100;
        const fog = Math.round(clamp((-d - 450) / 1400, 0, 0.62) * 50) / 50;
        if (fade !== item.fade) {
          item.fade = fade;
          item.card.style.opacity = String(fade);
        }
        if (fog !== item.fog) {
          item.fog = fog;
          item.card.style.setProperty("--fog", String(fog));
        }
        if (far !== item.far) {
          item.far = far;
          item.card.classList.toggle("is-far", far);
        }
        // Too small on screen for its own buttons (they would be tiny): a click opens the detail card,
        // which has full-size ones.
        const small = PERSPECTIVE / (PERSPECTIVE - Math.min(d, PERSPECTIVE - 1)) < 0.72;
        if (small !== item.small) {
          item.small = small;
          item.card.classList.toggle("is-small", small);
        }
        const gone = fade < 0.05;
        if (gone !== item.gone) {
          item.gone = gone;
          item.card.classList.toggle("is-gone", gone);
        }
      });
      drawDust(time, dt);
    }

    // ----- Mouse camera (mouse only) -----
    if (finePointer()) {
      window.addEventListener("pointermove", event => {
        if (event.pointerType !== "mouse") return;
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
      }, { passive: true });
    }

    // ----- Hover, keyboard focus and opening a card -----
    items.forEach(item => {
      item.card.addEventListener("pointerenter", () => { item.hot = true; item.card.classList.add("is-hot"); });
      item.card.addEventListener("pointerleave", () => {
        if (item.card.contains(document.activeElement)) return;
        item.hot = false;
        item.card.classList.remove("is-hot");
      });
      // Tabbing to a card flies the camera to it.
      item.link.addEventListener("focus", () => {
        item.hot = true;
        item.card.classList.add("is-hot");
        if (!openItem && !restoring && item.link.matches(":focus-visible")) {
          target = item;
          focusScroll = window.scrollY;
        }
      });
      item.link.addEventListener("blur", () => {
        item.hot = false;
        item.card.classList.remove("is-hot");
        if (!openItem && target === item) target = null;
      });
      // A click (or Enter) opens the detail card. Cmd/Ctrl/Shift-click still opens the page.
      item.link.addEventListener("click", event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        open(item);
      });
      const quick = item.card.querySelector("[data-zg-quick]");
      if (quick) quick.addEventListener("click", () => open(item));
    });

    // ----- The detail card -----
    const detail = root.querySelector("[data-zg-detail]");
    const photoPage = detail.querySelector("[data-zg-photo-page]");
    const infoPage = detail.querySelector("[data-zg-info-page]");
    const qty = detail.querySelector("[data-zg-qty]");
    const detailAdd = detail.querySelector("[data-zg-d-add]");
    let returnFocus = null;
    let opening = 0;

    function fill(item) {
      const card = item.card;
      const pick = selector => card.querySelector(selector);
      const img = detail.querySelector("[data-zg-d-img]");
      const source = pick(".zg-media img");
      img.src = source.currentSrc || source.src;
      img.alt = source.alt;
      detail.querySelector("[data-zg-d-brand]").textContent = pick(".zg-brand") ? pick(".zg-brand").textContent : "";
      detail.querySelector("[data-zg-d-name]").textContent = pick(".zg-name").textContent;
      const rating = detail.querySelector("[data-zg-d-rating]");
      const reviews = Number(card.dataset.reviews) || 0;
      if (reviews > 0) {
        const score = document.createElement("b");
        score.textContent = `★ ${card.dataset.rating}`;
        rating.replaceChildren(score, ` · ${reviews} ${reviews === 1 ? "review" : "reviews"}`);
      } else {
        rating.textContent = "No reviews yet";
      }
      const copy = (from, to) => {
        const node = detail.querySelector(to);
        const src = pick(from);
        node.replaceChildren(...(src ? [...src.cloneNode(true).childNodes] : []));
        node.hidden = !src;
      };
      copy("[data-zg-price]", "[data-zg-d-price]");
      copy("[data-zg-mrp]", "[data-zg-d-mrp]");
      copy("[data-zg-off]", "[data-zg-d-off]");
      copy("[data-zg-highlights]", "[data-zg-d-highlights]");
      detail.querySelector("[data-zg-d-view]").href = item.link.getAttribute("href");
      const stock = Number(card.dataset.stock) || 0;
      if (qty) {
        qty.max = String(Math.max(1, Math.min(5, stock)));
        qty.value = "1";
        stepQty(0);
      }
      if (detailAdd) {
        detailAdd.disabled = stock <= 0;
        detailAdd.lastChild.textContent = stock > 0 ? " Add to cart" : " Sold out";
      }
    }

    function stepQty(step) {
      const max = Number(qty.max) || 1;
      const value = clamp(Math.round(Number(qty.value) + step) || 1, 1, max);
      qty.value = String(value);
      detail.querySelector('[data-zg-step="-1"]').disabled = value <= 1;
      detail.querySelector('[data-zg-step="1"]').disabled = value >= max;
    }
    detail.querySelectorAll("[data-zg-step]").forEach(button => {
      button.addEventListener("click", () => stepQty(Number(button.dataset.zgStep)));
    });
    if (qty) qty.addEventListener("change", () => stepQty(0));
    if (detailAdd) {
      detailAdd.addEventListener("click", () => {
        if (!openItem) return;
        addToCart(openItem.card, Number(qty.value) || 1, detail.querySelector("[data-zg-d-img]"), detailAdd);
      });
    }

    // While the detail card is open the wheel does not scroll the page (the room stays still).
    const holdWheel = event => event.preventDefault();
    const keys = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        // Keep keyboard focus inside the open card.
        const focusable = [...detail.querySelectorAll("button:not(:disabled), a[href], input")].filter(el => el.offsetParent !== null);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    function open(item) {
      if (openItem === item) return;
      returnFocus = item.link;
      openItem = item;
      target = item;
      fill(item);
      root.classList.add("is-focused");
      items.forEach(other => other.card.classList.toggle("is-active", other === item));
      window.addEventListener("wheel", holdWheel, { passive: false });
      document.addEventListener("keydown", keys);
      // Let the camera fly most of the way first, then unfold the card.
      clearTimeout(opening);
      opening = setTimeout(() => {
        detail.hidden = false;
        photoPage.animate(
          [{ opacity: 0, transform: "translateZ(-220px) scale(0.92)" }, { opacity: 1, transform: "none" }],
          { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
        );
        infoPage.animate(
          [{ opacity: 0, transform: window.innerWidth < 768 ? "rotateX(-120deg)" : "rotateY(-150deg)" }, { opacity: 1, transform: "none" }],
          { duration: 720, delay: 110, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
        );
        detail.querySelector("[data-zg-close]").focus({ preventScroll: true });
      }, 380);
    }

    function close() {
      if (!openItem) return;
      clearTimeout(opening);
      window.removeEventListener("wheel", holdWheel);
      document.removeEventListener("keydown", keys);
      const done = () => {
        detail.hidden = true;
        root.classList.remove("is-focused");
        items.forEach(other => other.card.classList.remove("is-active"));
        openItem = null;
        target = null;
        if (returnFocus) {
          restoring = true;
          returnFocus.focus({ preventScroll: true });
          restoring = false;
        }
      };
      if (detail.hidden) return done();
      infoPage.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: window.innerWidth < 768 ? "rotateX(-120deg)" : "rotateY(-150deg)" }],
        { duration: 340, easing: "cubic-bezier(0.55, 0, 0.75, 0)" }
      );
      photoPage.animate(
        [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateZ(-220px) scale(0.92)" }],
        { duration: 360, easing: "cubic-bezier(0.55, 0, 0.75, 0)" }
      ).finished.catch(() => {}).then(done);
    }
    detail.querySelector("[data-zg-close]").addEventListener("click", close);
    detail.addEventListener("click", event => {
      if (event.target === detail) close(); // a click on the dimmed room outside the card
    });

    // ----- Layout: measured once, and again on resize (reads), never inside the frame -----
    place();
    let resizeFrame = 0;
    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(place);
    });
    // Images arriving can change the card height: place again once they have loaded.
    window.addEventListener("load", place, { once: true });
    whileOnScreen(frame);
  }
}
