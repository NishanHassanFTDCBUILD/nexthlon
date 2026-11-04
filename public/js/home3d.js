// Home page 3D (ES module, built on public/js/3d):
//   1. Hero: thousands of glowing particles form a sphere, then the NEXTHLON logo, then a running
//      athlete as you scroll, over an animated orange and navy fog. The mouse moves the camera.
//      This is the page's only WebGL canvas.
//   2. Product galaxy: product cards on a CSS 3D ring. Drag, swipe or arrow keys spin it.
//   3. Journey: scrolling flies through a CSS 3D tunnel of sports.
//   4. Showcase: a product on a turning podium, lit by the mouse.
// Everything is decoration over real links and text: without JavaScript, WebGL or motion, the
// page shows the same content as flat sections.
import { Scene, Mesh, geometry } from "./3d/scene.js";
import { boot } from "./3d/boot.js";
import { createParallax, createDragRotate, scrollProgress, prefersReducedMotion, finePointer, deviceTier } from "./3d/interaction.js";
import { clamp, damp } from "./3d/math.js";

const reduced = prefersReducedMotion();

// ---------- 1. Hero particles ----------
const PARTICLES = { high: 9000, medium: 5000, low: 2400 };

// Points sampled from a shape drawn on a hidden 2D canvas, centred, `scale` world units wide.
function sampleShape(draw, count, { width, height, scale, depth }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  draw(ctx, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const filled = [];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (pixels[(y * width + x) * 4 + 3] > 128) filled.push(x, y);
    }
  }
  const total = filled.length / 2;
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const k = total ? Math.floor(Math.random() * total) : 0;
    const x = total ? filled[k * 2] + Math.random() * 2 : width / 2;
    const y = total ? filled[k * 2 + 1] + Math.random() * 2 : height / 2;
    out[i * 3] = ((x - width / 2) / width) * scale;
    out[i * 3 + 1] = (-(y - height / 2) / width) * scale;
    out[i * 3 + 2] = (Math.random() - 0.5) * depth;
  }
  return out;
}

// The logo as letter OUTLINES, spaced out and sized to fill the width: solid heavy letters
// turn into one glowing block when drawn with dots.
function drawLogo(font) {
  return (ctx, w, h) => {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = Math.max(4, h * 0.03);
    ctx.lineJoin = "round";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${Math.round(h * 0.05)}px`;
    ctx.font = `800 100px ${font}`;
    const size = Math.min(h * 0.78, (100 * w * 0.92) / Math.max(1, ctx.measureText("NEXTHLON").width));
    ctx.font = `800 ${Math.round(size)}px ${font}`;
    ctx.strokeText("NEXTHLON", w / 2, h / 2 + h * 0.03);
  };
}

// A running athlete, drawn with round strokes: head, body, arms and legs mid-stride.
function drawAthlete(ctx) {
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const limb = (width, ...points) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
  };
  ctx.beginPath();
  ctx.arc(232, 52, 24, 0, Math.PI * 2);
  ctx.fill();
  limb(34, 222, 92, 196, 176);                // body, leaning forward
  limb(17, 216, 104, 172, 128, 146, 100);     // back arm
  limb(17, 216, 104, 256, 140, 292, 120);     // front arm
  limb(22, 196, 176, 248, 214, 240, 280);     // front leg
  limb(9, 240, 280, 266, 284);                // front foot
  limb(22, 196, 176, 156, 222, 104, 238);     // back leg
  limb(9, 104, 238, 92, 222);                 // back foot
}

const fogShader = {
  vertex: `
    attribute vec3 aPosition;
    attribute vec2 aUv;
    varying vec2 vUv;
    void main() { vUv = aUv; gl_Position = vec4(aPosition.xy * 2.0, 0.999, 1.0); }`,
  fragment: `
    precision mediump float;
    uniform float uTime;
    uniform vec2 uMouse;
    uniform float uMorph;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      vec2 p = vUv * 3.0 + vec2(uTime * 0.04, uTime * 0.025);
      float n = fbm(p + fbm(p + uTime * 0.05));
      vec3 navy = vec3(0.016, 0.035, 0.075), deep = vec3(0.05, 0.11, 0.22), orange = vec3(1.0, 0.46, 0.1);
      vec3 colour = mix(navy, deep, n);
      float glow = smoothstep(0.5, 0.92, n) * (0.55 + 0.25 * sin(uTime * 0.35 + uMorph));
      vec2 m = vec2(uMouse.x * 0.5 + 0.5, 0.5 - uMouse.y * 0.5);
      float spot = 0.12 / (0.2 + distance(vUv, m) * 2.6);
      colour += orange * (glow * 0.38 + spot * 0.22);
      colour *= 1.0 - 0.45 * length(vUv - vec2(0.5, 0.55));
      gl_FragColor = vec4(colour, 1.0);
    }`
};

const particleShader = {
  vertex: `
    attribute vec3 aPosition;
    attribute vec3 aLogo;
    attribute vec3 aAthlete;
    attribute vec3 aRandom;
    uniform mat4 uModel, uView, uProjection;
    uniform float uTime, uMorph, uSize, uRatio;
    varying float vMix;
    varying float vAlpha;
    void main() {
      float m1 = smoothstep(0.0, 1.0, clamp(uMorph * 1.15 - aRandom.y * 0.15, 0.0, 1.0));
      float m2 = smoothstep(0.0, 1.0, clamp((uMorph - 1.0) * 1.15 - aRandom.y * 0.15, 0.0, 1.0));
      vec3 p = mix(mix(aPosition, aLogo, m1), aAthlete, m2);
      float t = uTime * 0.7 + aRandom.y * 6.2831;
      float transit = sin(clamp(uMorph, 0.0, 2.0) * 3.14159);
      p += vec3(sin(t), cos(t * 1.3), sin(t * 0.7)) * (0.025 + 0.32 * transit) * aRandom.x;
      vec4 mv = uView * uModel * vec4(p, 1.0);
      gl_Position = uProjection * mv;
      gl_PointSize = uSize * (0.55 + aRandom.x) * uRatio / -mv.z;
      vMix = aRandom.z;
      vAlpha = 0.5 + 0.5 * aRandom.x;
    }`,
  fragment: `
    precision mediump float;
    uniform vec3 uColorA, uColorB;
    varying float vMix;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float glow = smoothstep(0.5, 0.0, d);
      glow *= glow;
      gl_FragColor = vec4(mix(uColorA, uColorB, vMix) * glow, glow * vAlpha);
    }`
};

// Scroll progress (0 to 1) → shape (0 sphere, 1 logo, 2 athlete), holding each shape still for a
// while so it can be seen: sphere until 12%, logo from 38% to 58%, athlete from 84%.
function morphFor(progress) {
  if (progress < 0.12) return 0;
  if (progress < 0.38) return (progress - 0.12) / 0.26;
  if (progress < 0.58) return 1;
  if (progress < 0.84) return 1 + (progress - 0.58) / 0.26;
  return 2;
}

function buildHero(canvas, { tier }) {
  const scene = new Scene(canvas, { maxRatio: tier === "low" ? 1.25 : 2, camera: { fov: 45, position: [0, 0, 7] } });
  const gl = scene.gl;
  const count = PARTICLES[tier] || PARTICLES.medium;
  const sphere = geometry.particles(count, (i, n) => {
    const golden = Math.PI * (3 - Math.sqrt(5));
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const radius = 1.85 + (Math.random() - 0.5) * 0.12;
    return [Math.cos(golden * i) * r * radius, y * radius, Math.sin(golden * i) * r * radius];
  });
  const random = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 1) random[i] = Math.random();
  const logoSize = { width: 900, height: 240, scale: 4.9, depth: 0.12 };
  const logo = sampleShape(drawLogo('"Arial Black", Arial, sans-serif'), count, logoSize);
  const athlete = sampleShape(drawAthlete, count, { width: 400, height: 320, scale: 4.2, depth: 0.45 });

  const fog = scene.add(new Mesh(gl, geometry.plane(1, 1), { ...fogShader, depthTest: false }));
  const dots = scene.add(new Mesh(gl, sphere, {
    ...particleShader,
    blending: "additive",
    depthTest: false,
    attributes: { aLogo: { data: logo, size: 3 }, aAthlete: { data: athlete, size: 3 }, aRandom: { data: random, size: 3 } },
    uniforms: { uSize: 26, uRatio: 1, uColorA: [1.0, 0.5, 0.12], uColorB: [1.0, 0.82, 0.62] }
  }));
  fog.uniforms = { uMouse: [0, 0], uMorph: 0 };

  // The brand font for the logo, once the browser has it.
  const ready = document.fonts && document.fonts.load
    ? document.fonts.load('800 120px "Barlow Condensed"').then(() => {
      dots.setAttribute("aLogo", sampleShape(drawLogo('"Barlow Condensed", "Arial Black", sans-serif'), count, logoSize));
    }).catch(() => {})
    : Promise.resolve();

  const parallax = createParallax();
  const hero = canvas.closest("[data-hero3d]");
  let morph = 0;
  let stage = -1;
  scene.onUpdate((time, dt) => {
    const { x, y } = parallax.update(dt);
    const target = morphFor(scrollProgress(hero));
    morph = damp(morph, target, 5, dt);
    // Keep the logo inside the screen on narrow phones by stepping the camera back.
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const distance = Math.max(6.6, 7.9 / Math.max(aspect, 0.3));
    scene.camera.position[0] = x * 0.7;
    scene.camera.position[1] = -y * 0.45 + 0.35;
    scene.camera.position[2] = distance;
    scene.camera.target[1] = 0.35;
    dots.rotation[1] = Math.sin(time * 0.22) * 0.65 * (1 - clamp(morph, 0, 1)) + x * 0.12;
    dots.rotation[0] = y * 0.08;
    // On wide screens the shapes sit to the right of the headline; on tall screens, above it.
    dots.position[0] = aspect > 1.25 ? Math.min(1.8, 0.8 + (aspect - 1.25) * 2) : 0;
    dots.position[1] = aspect > 1.25 ? 0.3 : clamp(distance * 0.21, 0.75, 3.8);
    dots.uniforms.uMorph = morph;
    dots.uniforms.uRatio = Math.min(window.devicePixelRatio || 1, 2) * (distance / 7);
    fog.uniforms.uMouse = [x, y];
    fog.uniforms.uMorph = morph;
    const next = morph < 0.5 ? 0 : morph < 1.5 ? 1 : 2;
    if (next !== stage) {
      stage = next;
      hero.dataset.stage = String(stage);
    }
  });
  dots.uniforms.uMorph = 0;
  return { scene, ready };
}

const hero = document.querySelector("[data-hero3d]");
if (hero) {
  if (reduced) hero.classList.add("is-reduced");
  boot(hero, hero.querySelector("[data-hero3d-canvas]"), buildHero);
}

// ---------- A small rAF loop that runs only while its element is on screen ----------
function whileVisible(element, frame) {
  let running = false;
  let id = 0;
  let last = 0;
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    frame(dt);
    id = requestAnimationFrame(loop);
  };
  const watcher = new IntersectionObserver(entries => {
    const visible = entries.some(entry => entry.isIntersecting);
    if (visible && !running) {
      running = true;
      last = performance.now();
      id = requestAnimationFrame(loop);
    } else if (!visible && running) {
      running = false;
      cancelAnimationFrame(id);
    }
  }, { rootMargin: "100px" });
  watcher.observe(element);
}

// ---------- 2. Product galaxy ----------
const galaxy = document.querySelector("[data-galaxy]");
if (galaxy && !reduced && "IntersectionObserver" in window) {
  const stage = galaxy.querySelector("[data-galaxy-stage]");
  const ring = galaxy.querySelector("[data-galaxy-ring]");
  const cards = [...ring.querySelectorAll("[data-galaxy-card]")];
  const count = cards.length;
  const step = (Math.PI * 2) / count;
  let radius = 0;
  const measure = () => {
    const width = cards[0].offsetWidth || 200;
    radius = Math.round(((width / 2) / Math.tan(Math.PI / count)) * 1.18);
    ring.style.setProperty("--ring-radius", `${radius}px`);
  };
  galaxy.classList.add("is-3d");
  measure();
  window.addEventListener("resize", measure);

  const drag = createDragRotate(stage, { speed: 0.008 });
  let hovering = false;
  let focusTarget = null;
  stage.addEventListener("pointerenter", () => { hovering = true; });
  stage.addEventListener("pointerleave", () => { hovering = false; });
  // Tabbing to a card turns the ring to bring it to the front.
  cards.forEach((card, i) => {
    card.addEventListener("focus", () => {
      const turns = Math.round((drag.state.angle + i * step) / (Math.PI * 2));
      focusTarget = turns * Math.PI * 2 - i * step;
    });
    // Picking a card flies in towards it, then opens the product.
    card.addEventListener("click", event => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      card.classList.add("is-flying");
      galaxy.classList.add("is-zooming");
      setTimeout(() => window.location.assign(card.href), 420);
    });
  });

  whileVisible(stage, dt => {
    const state = drag.update(dt);
    if (focusTarget !== null) {
      state.angle = damp(state.angle, focusTarget, 8, dt);
      if (Math.abs(state.angle - focusTarget) < 0.002) focusTarget = null;
    } else if (!hovering && !state.dragging && Math.abs(state.velocity) < 0.05) {
      state.angle += dt * 0.16;
    }
    ring.style.transform = `translateZ(${-radius}px) rotateY(${state.angle}rad)`;
    cards.forEach((card, i) => {
      const facing = Math.cos(i * step + state.angle);
      card.style.opacity = (0.18 + 0.82 * ((facing + 1) / 2) ** 1.6).toFixed(3);
      card.style.pointerEvents = facing > 0.35 ? "auto" : "none";
      card.style.zIndex = String(Math.round((facing + 1) * 50));
    });
  });
}

// ---------- 3. Journey through the sports ----------
const journey = document.querySelector("[data-journey]");
if (journey && !reduced) {
  const track = journey.querySelector("[data-journey-track]");
  const cards = [...journey.querySelectorAll("[data-journey-card]")];
  const dots = [...journey.querySelectorAll("[data-journey-dot]")];
  const GAP = 900;
  journey.classList.add("is-3d");
  let frame = 0;
  const update = () => {
    frame = 0;
    const progress = scrollProgress(journey);
    const z = progress * ((cards.length - 1) * GAP + 260);
    track.style.transform = `translateZ(${z.toFixed(1)}px)`;
    cards.forEach((card, i) => {
      const d = z - i * GAP;
      let opacity = 1;
      if (d > 120) opacity = clamp(1 - (d - 120) / 260, 0, 1);
      else if (d < -GAP * 1.6) opacity = clamp((d + GAP * 2.6) / GAP, 0, 1);
      card.style.opacity = opacity.toFixed(3);
      card.style.pointerEvents = Math.abs(d) < 360 ? "auto" : "none";
      card.tabIndex = Math.abs(d) < 360 ? 0 : -1;
    });
    const active = Math.round(progress * (cards.length - 1));
    dots.forEach((dot, i) => dot.classList.toggle("is-active", i === active));
  };
  window.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
  window.addEventListener("resize", update);
  update();
}

// ---------- 4. Showcase light ----------
const showcase = document.querySelector("[data-showcase-stage]");
if (showcase) {
  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        showcase.classList.add("is-in");
        watcher.disconnect();
      }
    }, { threshold: 0.3 });
    watcher.observe(showcase);
  } else {
    showcase.classList.add("is-in");
  }
  if (!reduced && finePointer() && deviceTier() !== "low") {
    let frame = 0;
    showcase.addEventListener("pointermove", event => {
      const { clientX, clientY } = event;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = showcase.getBoundingClientRect();
        const x = (clientX - box.left) / box.width;
        const y = (clientY - box.top) / box.height;
        showcase.style.setProperty("--lx", `${(x * 100).toFixed(1)}%`);
        showcase.style.setProperty("--ly", `${(y * 100).toFixed(1)}%`);
        showcase.style.setProperty("--ry", `${((x - 0.5) * 16).toFixed(2)}deg`);
        showcase.style.setProperty("--rx", `${((0.5 - y) * 8).toFixed(2)}deg`);
      });
    });
    showcase.addEventListener("pointerleave", () => {
      showcase.style.setProperty("--ry", "0deg");
      showcase.style.setProperty("--rx", "0deg");
    });
  }
}
