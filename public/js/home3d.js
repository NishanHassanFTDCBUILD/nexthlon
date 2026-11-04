// Home page 3D (ES module, built on public/js/3d):
//   1. Hero: thousands of glowing particles form a sphere, then the NEXTHLON logo, then a running
//      athlete as you scroll, over an animated obsidian and volt fog. The mouse moves the camera.
//      This is the page's only WebGL canvas.
//   2. Product galaxy: product cards on a CSS 3D ring. Drag, swipe or arrow keys spin it.
//   3. Pick your sport: six sport cards on a CSS 3D ring, turned by scroll, drag, tabs, keys and a timer.
//   4. Showcase: a product on a turning podium, lit by the mouse.
// Everything is decoration over real links and text: without JavaScript, WebGL or motion, the
// page shows the same content as flat sections.
import { Scene, Mesh, geometry } from "./3d/scene.js";
import { boot } from "./3d/boot.js";
import { createParallax, createDragRotate, scrollProgress, prefersReducedMotion, finePointer, deviceTier } from "./3d/interaction.js";
import { clamp, damp } from "./3d/math.js";
import { sampleShape, spherePoints, drawLogo, drawAthlete, fogShader, dotFragment } from "./3d/shapes.js";

const reduced = prefersReducedMotion();

// ---------- 1. Hero particles ----------
const PARTICLES = { high: 9000, medium: 5000, low: 2400 };

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
  fragment: dotFragment
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
  const sphere = { positions: spherePoints(count, 1.85) };
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
    uniforms: { uSize: 26, uRatio: 1, uColorA: [0.83, 1.0, 0.23], uColorB: [0.96, 1.0, 0.82] }
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

// ---------- 3. Pick your sport: the 3D sport carousel ring ----------
// Six sport cards stand on a CSS 3D ring. On wide screens the section is pinned and scrolling turns
// the ring one sport at a time; drag or swipe (with inertia, then a snap), the tabs, the dots, the
// arrow keys and a 4-second timer turn it too. The card facing the front is the active one.
// With reduced motion it becomes a plain swipe row; without JavaScript it is a grid of links.
const sportRing = document.querySelector("[data-sport-ring]");
if (sportRing) setUpSportRing(sportRing);

function setUpSportRing(section) {
  const stage = section.querySelector("[data-ring-stage]");
  const track = section.querySelector("[data-ring-track]");
  const cards = [...section.querySelectorAll("[data-ring-card]")];
  const tabs = [...section.querySelectorAll("[data-ring-tab]")];
  const dots = [...section.querySelectorAll("[data-ring-dot]")];
  const glows = [...section.querySelectorAll("[data-ring-glow]")];
  const words = [...section.querySelectorAll("[data-ring-word]")];
  const tabList = section.querySelector("[data-ring-tabs]");
  const line = section.querySelector("[data-ring-line]");
  const counter = section.querySelector("[data-ring-current]");
  const count = cards.length;
  const step = 360 / count;
  const mod = n => ((n % count) + count) % count;
  // The shortest signed way round the ring from a to b (-3 to 3 for six cards).
  const offsetBetween = (a, b) => {
    let d = mod(b - a);
    if (d > count / 2) d -= count;
    return d;
  };

  tabList.hidden = false;
  section.querySelector("[data-ring-foot]").hidden = false;

  let active = -1;
  // Everything that follows the active sport: tabs, underline, dots, counter, word and glow.
  const paint = index => {
    if (index === active) return;
    active = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
    });
    dots.forEach((dot, i) => dot.setAttribute("aria-pressed", String(i === index)));
    glows.forEach((glow, i) => glow.classList.toggle("is-active", i === index));
    words.forEach((word, i) => {
      word.classList.toggle("is-active", i === index);
      word.classList.toggle("is-before", offsetBetween(index, i) < 0);
    });
    counter.textContent = String(index + 1).padStart(2, "0");
    moveLine();
  };
  const moveLine = () => {
    const tab = tabs[active];
    if (!tab) return;
    line.style.setProperty("--line-x", `${tab.offsetLeft + 10}px`);
    line.style.setProperty("--line-w", ((tab.offsetWidth - 20) / 100).toFixed(3));
    // On a phone the tabs scroll sideways: keep the active one in view.
    const left = tab.offsetLeft - (tabList.clientWidth - tab.offsetWidth) / 2;
    if (Math.abs(tabList.scrollLeft - left) > 4) tabList.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  };

  // Tabs follow the ARIA tabs pattern: the arrow keys move between them and choose one.
  const tabKeys = (event, choose) => {
    const at = tabs.indexOf(event.currentTarget);
    let next = null;
    if (event.key === "ArrowRight") next = mod(at + 1);
    else if (event.key === "ArrowLeft") next = mod(at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    tabs[next].focus();
    choose(next);
  };

  // ----- Reduced motion: a swipe row. Tabs and dots scroll to a card; no ring, no timer. -----
  if (reduced) {
    section.classList.add("is-row");
    // A chosen card is active straight away, even when the row cannot scroll it to the middle.
    let chosenAt = 0;
    const show = i => {
      paint(i);
      chosenAt = performance.now();
      cards[i].scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => show(i));
      tab.addEventListener("keydown", event => tabKeys(event, show));
    });
    dots.forEach((dot, i) => dot.addEventListener("click", () => show(i)));
    let frame = 0;
    track.addEventListener("scroll", () => {
      if (frame || performance.now() - chosenAt < 500) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const middle = track.getBoundingClientRect().left + track.clientWidth / 2;
        let best = 0;
        let bestGap = Infinity;
        cards.forEach((card, i) => {
          const box = card.getBoundingClientRect();
          const gap = Math.abs(box.left + box.width / 2 - middle);
          if (gap < bestGap) { bestGap = gap; best = i; }
        });
        paint(best);
      });
    }, { passive: true });
    paint(0);
    window.addEventListener("resize", moveLine);
    return;
  }

  // ----- The 3D ring -----
  const phone = window.matchMedia("(max-width: 767px)");
  const mouse = finePointer();
  section.classList.add("is-ring");
  stage.tabIndex = 0;
  stage.setAttribute("role", "region");
  stage.setAttribute("aria-roledescription", "carousel");
  stage.setAttribute("aria-label", "Sports. Use the left and right arrow keys to turn, Enter to open the sport in front.");

  // A faint mirrored copy of the ring makes the reflective floor (hidden on phones by CSS).
  const mirror = document.createElement("div");
  mirror.className = "sport-ring-mirror";
  mirror.setAttribute("aria-hidden", "true");
  mirror.inert = true;
  const mirrorTrack = track.cloneNode(true);
  mirrorTrack.removeAttribute("data-ring-track");
  mirrorTrack.querySelectorAll("a").forEach(link => {
    const copy = document.createElement("span");
    copy.className = link.className;
    copy.setAttribute("style", link.getAttribute("style"));
    copy.innerHTML = link.innerHTML;
    link.replaceWith(copy);
  });
  const mirrorCards = [...mirrorTrack.children];
  mirror.append(mirrorTrack);
  stage.prepend(mirror);

  // The radius comes from the card width, so neighbouring cards never overlap.
  let cardWidth = 300;
  const measure = () => {
    cardWidth = track.offsetWidth || 300;
    const radius = Math.round((cardWidth / 2 / Math.tan(Math.PI / count)) * 1.32 + 24);
    section.style.setProperty("--r", `${radius}px`);
    moveLine();
  };

  let index = 0;        // which card faces the front; can go past 5 or below 0 (the ring wraps)
  let scrollIndex = 0;  // the part chosen by scrolling through the pinned section
  let offset = 0;       // what drag, tabs, keys and the timer have added on top of scrolling
  let lastTouch = 0;    // the last time the visitor did anything with the ring
  let lastAuto = 0;

  const setAngle = angle => {
    section.style.setProperty("--angle", `${angle.toFixed(2)}deg`);
    const front = mod(Math.round(-angle / step));
    cards.forEach((card, i) => {
      const pos = String(offsetBetween(front, i));
      if (card.dataset.pos !== pos) {
        card.dataset.pos = pos;
        mirrorCards[i].dataset.pos = pos;
        card.tabIndex = pos === "0" ? 0 : -1;
        if (pos !== "0") resetTilt(card);
      }
    });
    paint(front);
  };
  const go = next => {
    index = next;
    offset = index - scrollIndex;
    setAngle(-index * step);
  };
  const goTo = sport => go(index + offsetBetween(mod(index), sport));
  const touched = () => { lastTouch = performance.now(); };

  // Scrolling through the pinned section turns the ring one sport at a time.
  const pinned = () => !phone.matches;
  const readScroll = () => {
    if (!pinned()) return 0;
    return Math.round(scrollProgress(section) * (count - 1));
  };
  let scrollFrame = 0;
  window.addEventListener("scroll", () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      const next = readScroll();
      if (next === scrollIndex) return;
      scrollIndex = next;
      touched();
      go(scrollIndex + offset);
    });
  }, { passive: true });
  const layout = () => {
    section.classList.toggle("is-pinned", pinned());
    scrollIndex = readScroll();
    offset = index - scrollIndex;
    measure();
  };
  phone.addEventListener("change", layout);
  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(measure);
  });

  // Tabs, dots and keys.
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => { touched(); goTo(i); });
    tab.addEventListener("keydown", event => tabKeys(event, i2 => { touched(); goTo(i2); }));
  });
  dots.forEach((dot, i) => dot.addEventListener("click", () => { touched(); goTo(i); }));
  stage.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      touched();
      go(index + (event.key === "ArrowRight" ? 1 : -1));
    } else if (event.key === "Enter" && event.target === stage) {
      window.location.assign(cards[mod(index)].href);
    }
  });

  // Drag or swipe: the ring follows the finger, keeps some speed after letting go, then snaps.
  const drag = { down: false, moved: 0, startX: 0, startAngle: 0, angle: 0, samples: [], frame: 0 };
  stage.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag.down = true;
    drag.moved = 0;
    drag.startX = event.clientX;
    drag.startAngle = -index * step;
    drag.angle = drag.startAngle;
    drag.samples = [{ x: event.clientX, t: event.timeStamp }];
  });
  stage.addEventListener("pointermove", event => {
    if (!drag.down) return;
    const dx = event.clientX - drag.startX;
    drag.moved = Math.max(drag.moved, Math.abs(dx));
    if (drag.moved < 6) return;
    if (!section.classList.contains("is-dragging")) {
      section.classList.add("is-dragging");
      stage.setPointerCapture(event.pointerId);
      resetTilt(cards[mod(index)]);
    }
    // Dragging one card's width turns the ring by one card.
    drag.angle = drag.startAngle + (dx / (cardWidth * 1.1)) * step;
    drag.samples.push({ x: event.clientX, t: event.timeStamp });
    if (drag.samples.length > 6) drag.samples.shift();
    if (!drag.frame) {
      drag.frame = requestAnimationFrame(() => {
        drag.frame = 0;
        setAngle(drag.angle);
      });
    }
  });
  const release = () => {
    if (!drag.down) return;
    drag.down = false;
    if (!section.classList.contains("is-dragging")) return;
    touched();
    const first = drag.samples[0];
    const last = drag.samples[drag.samples.length - 1];
    const seconds = Math.max(0.016, (last.t - first.t) / 1000);
    const speed = ((last.x - first.x) / seconds / (cardWidth * 1.1)) * step; // degrees per second
    const projected = drag.angle + clamp(speed * 0.18, -step * 2, step * 2);
    cancelAnimationFrame(drag.frame);
    drag.frame = 0;
    section.classList.remove("is-dragging");
    go(Math.round(-projected / step));
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  // After a real drag the click must not open a link. A side card turns to the front instead.
  stage.addEventListener("click", event => {
    if (drag.moved >= 6) {
      event.preventDefault();
      event.stopPropagation();
      drag.moved = 0;
      return;
    }
    const card = event.target.closest("[data-ring-card]");
    if (!card || card.dataset.pos === "0") return;
    event.preventDefault();
    touched();
    go(index + Number(card.dataset.pos));
  }, true);

  // The front card tilts towards the mouse, with a glare, and its photo and text sit at different
  // depths (photo 20px, text 60px) so they move apart.
  function resetTilt(card) {
    if (!card.classList.contains("is-tilting")) return;
    card.classList.remove("is-tilting");
    ["--tx", "--ty", "--mx", "--my"].forEach(name => card.style.removeProperty(name));
  }
  if (mouse) {
    let tiltFrame = 0;
    stage.addEventListener("pointermove", event => {
      if (drag.down || phone.matches) return;
      const { clientX, clientY } = event;
      cancelAnimationFrame(tiltFrame);
      tiltFrame = requestAnimationFrame(() => {
        const card = cards[mod(index)];
        const box = card.getBoundingClientRect();
        const x = (clientX - box.left) / box.width - 0.5;
        const y = (clientY - box.top) / box.height - 0.5;
        if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) {
          resetTilt(card);
          return;
        }
        card.classList.add("is-tilting");
        card.style.setProperty("--ty", `${(x * 16).toFixed(2)}deg`);
        card.style.setProperty("--tx", `${(-y * 12).toFixed(2)}deg`);
        card.style.setProperty("--mx", `${(-x * 18).toFixed(1)}px`);
        card.style.setProperty("--my", `${(-y * 18).toFixed(1)}px`);
        card.style.setProperty("--gx", `${(x * box.width).toFixed(1)}px`);
        card.style.setProperty("--gy", `${(y * box.height).toFixed(1)}px`);
      });
    });
    stage.addEventListener("pointerleave", () => resetTilt(cards[mod(index)]));
  }

  // Turn by itself every 4 seconds while the ring is on screen and nobody is using it.
  let visible = false;
  let hovering = false;
  stage.addEventListener("pointerenter", () => { hovering = true; });
  stage.addEventListener("pointerleave", () => { hovering = false; });
  setInterval(() => {
    const now = performance.now();
    if (!visible || hovering || drag.down || document.hidden || section.contains(document.activeElement)) return;
    if (now - Math.max(lastTouch, lastAuto) < 4000) return;
    lastAuto = now;
    go(index + 1);
  }, 250);

  // The first time the ring is seen, the cards fade and rise in from depth, front card first.
  const rise = () => {
    section.classList.remove("is-waiting");
    section.querySelectorAll(".sport-card-float").forEach(float => {
      const card = float.parentElement;
      const order = Math.abs(Number(card.dataset.pos) || 0);
      float.animate(
        [{ opacity: 0, transform: "translate3d(0, 90px, -160px)" }, { opacity: 1, transform: "none" }],
        { duration: 900, delay: order * 110, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "backwards" }
      );
    });
  };
  if ("IntersectionObserver" in window) {
    section.classList.add("is-waiting");
    let risen = false;
    new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible && !risen) {
        risen = true;
        rise();
        lastAuto = performance.now();
      }
    }, { threshold: 0.25 }).observe(stage);
  } else {
    visible = true;
  }

  layout();
  go(scrollIndex);
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
