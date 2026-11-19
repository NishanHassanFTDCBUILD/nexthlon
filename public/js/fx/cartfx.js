// WebGL sparks for the fly-to-cart moment (ES module in public/js/fx, built on public/js/3d).
// store.js flies the product card to the header cart; this layer adds the light around it:
//   trail(x, y, dx, dy, size)  volt sparks shed behind the card on every frame of the flight
//   burst(x, y)                sparks and an expanding ring where the card lands on the cart
//   puff(x, y)                 a small grey puff where a card that could not be added fades out
// One full-screen canvas, one shader, one buffer. It only draws while there are sparks; idle, it shrinks
// its canvas to one pixel and leaves the shared ticker. store.js loads this file when the page is idle
// and reads window.NxCartFx; it stays null on low-power devices, with reduced motion or reduced data,
// and without WebGL, and then the card still flies, just without sparks.
import {createContext, createProgram} from '../3d/gl.js';
import {
  deviceTier,
  prefersReducedMotion,
  wantsLessData,
} from '../3d/interaction.js';

// ---------- Particles (plain numbers, no DOM: tested in Node) ----------
// A fixed pool: spawning never allocates, and dead particles are swapped out of the live range.
export class ParticlePool {
  constructor(capacity) {
    this.items = Array.from({length: capacity}, () => ({
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      size: 1,
      alpha: 1,
      mix: 0,
      drag: 0,
      gravity: 0,
    }));
    this.count = 0;
  }

  get capacity() {
    return this.items.length;
  }

  // Adds one particle; returns false when the pool is full (the extra spark is simply skipped).
  spawn(
    x,
    y,
    vx,
    vy,
    {life = 0.5, size = 4, alpha = 1, mix = 0, drag = 0, gravity = 0} = {},
  ) {
    if (this.count >= this.items.length) return false;
    const p = this.items[this.count];
    this.count += 1;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.age = 0;
    p.life = Math.max(0.01, life);
    p.size = size;
    p.alpha = alpha;
    p.mix = mix;
    p.drag = drag;
    p.gravity = gravity;
    return true;
  }

  // Moves every particle on by dt seconds: drag slows it, gravity pulls it down (+y), old ones die.
  update(dt) {
    let i = 0;
    while (i < this.count) {
      const p = this.items[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.count -= 1;
        this.items[i] = this.items[this.count];
        this.items[this.count] = p;
        continue;
      }
      const slow = Math.exp(-p.drag * dt);
      p.vx *= slow;
      p.vy = p.vy * slow + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      i += 1;
    }
  }

  // Writes x, y, size, alpha, mix for each live particle into out (5 numbers each). A particle shrinks
  // and fades over its life. Returns how many were written.
  write(out) {
    const n = Math.min(this.count, Math.floor(out.length / 5));
    for (let i = 0; i < n; i += 1) {
      const p = this.items[i];
      const left = 1 - p.age / p.life;
      const o = i * 5;
      out[o] = p.x;
      out[o + 1] = p.y;
      out[o + 2] = p.size * (0.35 + 0.65 * left);
      out[o + 3] = p.alpha * left * left;
      out[o + 4] = p.mix;
    }
    return n;
  }
}

// ---------- The layer ----------
const shader = {
  vertex: `
    attribute vec2 aPos;
    attribute vec3 aLook;
    uniform vec2 uViewport;
    uniform float uRatio;
    varying float vAlpha;
    varying float vMix;
    void main() {
      vec2 clip = aPos / uViewport * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      gl_PointSize = aLook.x * uRatio;
      vAlpha = aLook.y;
      vMix = aLook.z;
    }`,
  // A sharp core and a soft halo, written premultiplied, so the same output works added on a dark
  // page and laid over a light one.
  fragment: `
    precision mediump float;
    uniform vec3 uColorA, uColorB;
    varying float vAlpha;
    varying float vMix;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      if (d > 0.5) discard;
      float core = smoothstep(0.22, 0.0, d);
      float halo = smoothstep(0.5, 0.0, d);
      float light = (core * 0.9 + halo * halo * 0.55) * vAlpha;
      gl_FragColor = vec4(mix(uColorA, uColorB, vMix) * light, light);
    }`,
};

const rand = (min, max) => min + Math.random() * (max - min);

// The page's volt and whether the page is light (sparks are then laid over it, not added to it).
function palette() {
  const style = getComputedStyle(document.documentElement);
  const rgb = (style.getPropertyValue('--brand-rgb') || '212, 255, 58')
    .split(',')
    .map((n) => Number(n) / 255);
  const brand =
    rgb.length === 3 && rgb.every(Number.isFinite) ? rgb : [0.83, 1, 0.23];
  const bg = (
    getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) || [
      0, 0, 0,
    ]
  ).map(Number);
  const light = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.5;
  return {
    light,
    a: brand,
    // Dark pages: the second colour is a near-white volt. Light pages: a deeper green that still shows.
    b: light ? brand.map((c) => c * 0.55) : brand.map((c) => c + (1 - c) * 0.7),
  };
}

export function createCartFx() {
  const tier = deviceTier();
  if (tier === 'low' || prefersReducedMotion() || wantsLessData()) return null;
  const amount = tier === 'high' ? 1 : 0.6;
  const maxRatio = tier === 'high' ? 2 : 1.5;

  const canvas = document.createElement('canvas');
  canvas.className = 'cart-fx';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = 1;
  canvas.height = 1;
  const gl = createContext(canvas, {
    antialias: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;
  const {program, attributes, uniforms} = createProgram(
    gl,
    shader.vertex,
    shader.fragment,
  );
  document.body.append(canvas);

  const pool = new ParticlePool(Math.round(560 * amount));
  const data = new Float32Array(pool.capacity * 5);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

  let colors = palette();
  let stop = null;
  let lost = false;
  let ratio = 1;

  const fit = () => {
    ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  };

  const sleep = () => {
    if (stop) stop();
    stop = null;
    if (lost) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Idle: a one-pixel canvas holds almost no memory.
    canvas.width = 1;
    canvas.height = 1;
    window.removeEventListener('resize', fit);
  };

  const draw = () => {
    const n = pool.write(data);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!n) return;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * 5));
    const stride = 5 * 4;
    gl.enableVertexAttribArray(attributes.aPos);
    gl.vertexAttribPointer(attributes.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attributes.aLook);
    gl.vertexAttribPointer(attributes.aLook, 3, gl.FLOAT, false, stride, 2 * 4);
    gl.uniform2f(uniforms.uViewport, window.innerWidth, window.innerHeight);
    gl.uniform1f(uniforms.uRatio, ratio);
    gl.uniform3fv(uniforms.uColorA, colors.a);
    gl.uniform3fv(uniforms.uColorB, colors.b);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied colour: added on dark pages (light), laid over light pages (normal).
    gl.blendFunc(gl.ONE, colors.light ? gl.ONE_MINUS_SRC_ALPHA : gl.ONE);
    gl.drawArrays(gl.POINTS, 0, n);
  };

  const frame = (time, dt) => {
    pool.update(dt);
    if (!pool.count) {
      sleep();
      return;
    }
    draw();
  };

  // Starts drawing (from the shared ticker, or a small loop of its own if the page has none).
  const wake = () => {
    if (stop || lost) return;
    colors = palette();
    fit();
    window.addEventListener('resize', fit, {passive: true});
    if (window.NxTicker) {
      stop = window.NxTicker.add(frame);
    } else {
      let id = 0;
      let last = 0;
      const loop = (now) => {
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
        last = now;
        frame(0, dt);
        if (stop) id = requestAnimationFrame(loop);
      };
      id = requestAnimationFrame(loop);
      stop = () => cancelAnimationFrame(id);
    }
  };

  const api = {
    ready: true,

    // Called on every frame of a flight: (x, y) is the card's centre, (dx, dy) its direction of travel.
    trail(x, y, dx, dy, size = 60) {
      if (lost) return;
      wake();
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const count = Math.max(1, Math.round(3 * amount));
      for (let i = 0; i < count; i += 1) {
        // From just behind the card, drifting back along the path and a little to either side.
        const back = size * rand(0.15, 0.4);
        const side = rand(-0.35, 0.35) * size;
        const speed = rand(40, 110);
        const spread = rand(-60, 60);
        pool.spawn(
          x - ux * back - uy * side,
          y - uy * back + ux * side,
          -ux * speed - uy * spread,
          -uy * speed + ux * spread,
          {
            life: rand(0.3, 0.6),
            size: rand(3, 9),
            alpha: rand(0.55, 1),
            mix: Math.random(),
            drag: 3,
            gravity: 40,
          },
        );
      }
    },

    // The card lands on the cart: sparks fly out and fall, and a ring of light spreads.
    burst(x, y) {
      if (lost) return;
      wake();
      const sparks = Math.round(30 * amount);
      for (let i = 0; i < sparks; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(150, 420);
        pool.spawn(
          x,
          y,
          Math.cos(angle) * speed,
          Math.sin(angle) * speed - 80,
          {
            life: rand(0.45, 0.85),
            size: rand(3, 7),
            alpha: 1,
            mix: Math.random() * 0.6,
            drag: 4,
            gravity: 420,
          },
        );
      }
      const ring = Math.round(32 * amount);
      for (let i = 0; i < ring; i += 1) {
        const angle = (i / ring) * Math.PI * 2;
        pool.spawn(x, y, Math.cos(angle) * 230, Math.sin(angle) * 230, {
          life: 0.5,
          size: 5,
          alpha: 0.9,
          mix: 1,
          drag: 5,
          gravity: 0,
        });
      }
    },

    // The cart said no: a soft grey-white puff where the card fades out, no burst.
    puff(x, y) {
      if (lost) return;
      wake();
      const count = Math.round(14 * amount);
      for (let i = 0; i < count; i += 1) {
        const angle = rand(0, Math.PI * 2);
        const speed = rand(30, 100);
        pool.spawn(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, {
          life: rand(0.3, 0.5),
          size: rand(6, 12),
          alpha: 0.35,
          mix: 1,
          drag: 3,
          gravity: -20,
        });
      }
    },
  };

  // A lost GPU context (driver reset, too many contexts): stop quietly. Flights carry on without sparks.
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    lost = true;
    api.ready = false;
    sleep();
  });

  return api;
}

if (
  typeof window !== 'undefined' &&
  typeof document !== 'undefined' &&
  !window.NxCartFx
) {
  try {
    window.NxCartFx = createCartFx();
  } catch (error) {
    window.NxCartFx = null;
    if (window.console) console.warn('Cart sparks skipped:', error.message);
  }
}
