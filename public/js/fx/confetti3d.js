// WebGL confetti for the order-success moment (ES module in public/js/fx, built on public/js/3d).
// Paper strips in the brand colours fly from two cannons at the bottom corners and pop out of the tick,
// then flutter down. Each strip spins and flips in 3D: it narrows as it turns edge-on and catches the
// light as it faces you. One canvas, one shader, one draw call per frame.
// confetti.js calls window.NxConfetti3d(canvas) and falls back to its 2D confetti when this returns
// false (low-power device, no WebGL) or is missing. Reduced motion: no confetti at all (confetti.js).
import {createContext, createProgram} from '../3d/gl.js';
import {deviceTier, prefersReducedMotion} from '../3d/interaction.js';

// ---------- The strips (plain numbers, no DOM: tested in Node) ----------
const GRAVITY = 980; // px per second squared
const AIR = 1.4; // drag: how fast a strip loses the speed it was fired with
const FALL = 240; // the most a fluttering strip falls per second

// count strips in a width × height screen: 40% from each bottom corner, 20% popping out of (popX, popY).
export function makePieces(
  count,
  width,
  height,
  {popX = width / 2, popY = height * 0.32, colors = 6, rand = Math.random} = {},
) {
  const pieces = [];
  const between = (min, max) => min + rand() * (max - min);
  for (let i = 0; i < count; i += 1) {
    const kind = i / count;
    let x;
    let y;
    let angle;
    let speed;
    if (kind < 0.8) {
      const left = kind < 0.4;
      x = left ? width * 0.04 : width * 0.96;
      y = height + 10;
      // Up and in towards the middle: -90° is straight up.
      angle = ((left ? -62 : -118) + between(-14, 14)) * (Math.PI / 180);
      speed = between(0.75, 1.35) * Math.max(700, height * 1.35);
    } else {
      x = popX;
      y = popY;
      angle = between(0, Math.PI * 2);
      speed = between(180, 520);
    }
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: between(9, 16),
      angle: between(0, Math.PI * 2),
      spin: between(-6, 6),
      flip: between(0, Math.PI * 2),
      flipSpeed: between(5, 12),
      sway: between(30, 70),
      swayRate: between(2, 4),
      phase: between(0, Math.PI * 2),
      color: Math.floor(rand() * colors),
    });
  }
  return pieces;
}

// Moves every strip on by dt seconds (t is the time since the burst, for the sway).
export function stepPieces(pieces, dt, t) {
  const slow = Math.exp(-AIR * dt);
  for (const p of pieces) {
    p.vx *= slow;
    p.vy = p.vy * slow + GRAVITY * dt;
    // Once it is falling, paper flutters: it falls slowly and drifts from side to side.
    if (p.vy > FALL) p.vy = FALL;
    p.x += (p.vx + Math.sin(t * p.swayRate + p.phase) * p.sway) * dt;
    p.y += p.vy * dt;
    p.angle += p.spin * dt;
    p.flip += p.flipSpeed * dt;
  }
}

// ---------- Drawing ----------
const shader = {
  vertex: `
    attribute vec2 aPos;
    attribute vec4 aShape;   // size, angle, flip, alpha
    attribute vec3 aColor;
    uniform vec2 uViewport;
    uniform float uRatio;
    varying vec4 vShape;
    varying vec3 vColor;
    void main() {
      vec2 clip = aPos / uViewport * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      gl_PointSize = aShape.x * uRatio * 1.5;
      vShape = aShape;
      vColor = aColor;
    }`,
  // A strip turned by its angle inside the point, narrowed by its flip (edge-on when cos(flip) is 0),
  // darker as it turns away and with a bright glint as it faces the viewer.
  fragment: `
    precision mediump float;
    varying vec4 vShape;
    varying vec3 vColor;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float c = cos(vShape.y);
      float s = sin(vShape.y);
      p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
      float facing = cos(vShape.z);
      float halfWidth = max(0.04, 0.32 * abs(facing));
      if (abs(p.x) > halfWidth || abs(p.y) > 0.15) discard;
      float shade = 0.55 + 0.45 * abs(facing);
      float glint = pow(max(0.0, facing), 24.0) * 0.6;
      vec3 color = vColor * shade + glint;
      gl_FragColor = vec4(color * vShape.w, vShape.w);
    }`,
};

// The brand colours from tokens.css (each "r, g, b" in a --*-rgb token, or a hex colour), 0 to 1.
function palette() {
  const style = getComputedStyle(document.documentElement);
  const fallback = [
    [212, 255, 58],
    [236, 255, 158],
    [245, 245, 240],
    [52, 211, 153],
    [96, 165, 250],
    [255, 90, 31],
  ];
  return [
    '--volt',
    '--volt-light',
    '--ivory',
    '--success',
    '--info',
    '--deal',
  ].map((name, i) => {
    const value = style.getPropertyValue(name).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    const rgb = hex
      ? [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16))
      : fallback[i];
    return rgb.map((n) => n / 255);
  });
}

const DURATION = 3.6; // seconds, the last 0.9 of them fading out

export function celebrate(canvas, {keep = false, popAt = null} = {}) {
  if (!canvas || prefersReducedMotion()) return false;
  const tier = deviceTier();
  if (tier === 'low') return false;
  const gl = createContext(canvas, {
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: 'low-power',
  });
  if (!gl) return false;
  const {program, attributes, uniforms} = createProgram(
    gl,
    shader.vertex,
    shader.fragment,
  );

  const ratio = Math.min(
    window.devicePixelRatio || 1,
    tier === 'high' ? 2 : 1.5,
  );
  let width = 0;
  let height = 0;
  const fit = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  fit();
  window.addEventListener('resize', fit);

  const colors = palette();
  const count = Math.min(tier === 'high' ? 240 : 150, Math.round(width / 3.5));
  const pieces = makePieces(count, width, height, {
    popX: popAt ? popAt.x : width / 2,
    popY: popAt ? popAt.y : height * 0.32,
    colors: colors.length,
  });
  const STRIDE = 9; // x, y, size, angle, flip, alpha, r, g, b
  const data = new Float32Array(count * STRIDE);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);

  let time = 0;
  let stop = null;
  const finish = () => {
    if (stop) stop();
    stop = null;
    window.removeEventListener('resize', fit);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!keep) canvas.remove();
  };

  const frame = (dt) => {
    time += dt;
    stepPieces(pieces, dt, time);
    const alpha = Math.min(1, Math.max(0, (DURATION - time) / 0.9));
    let n = 0;
    for (const p of pieces) {
      if (p.y > height + 40 && p.vy > 0) continue;
      const o = n * STRIDE;
      const color = colors[p.color];
      data[o] = p.x;
      data[o + 1] = p.y;
      data[o + 2] = p.size;
      data[o + 3] = p.angle;
      data[o + 4] = p.flip;
      data[o + 5] = alpha;
      data[o + 6] = color[0];
      data[o + 7] = color[1];
      data[o + 8] = color[2];
      n += 1;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (n) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, n * STRIDE));
      const bytes = STRIDE * 4;
      gl.enableVertexAttribArray(attributes.aPos);
      gl.vertexAttribPointer(attributes.aPos, 2, gl.FLOAT, false, bytes, 0);
      gl.enableVertexAttribArray(attributes.aShape);
      gl.vertexAttribPointer(
        attributes.aShape,
        4,
        gl.FLOAT,
        false,
        bytes,
        2 * 4,
      );
      gl.enableVertexAttribArray(attributes.aColor);
      gl.vertexAttribPointer(
        attributes.aColor,
        3,
        gl.FLOAT,
        false,
        bytes,
        6 * 4,
      );
      gl.uniform2f(uniforms.uViewport, width, height);
      gl.uniform1f(uniforms.uRatio, ratio);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, n);
    }
    if (time >= DURATION || !n) finish();
  };

  // On the site's shared ticker, or a loop of its own.
  if (window.NxTicker) {
    stop = window.NxTicker.add((t, dt) => frame(dt));
  } else {
    let id = 0;
    let last = 0;
    const loop = (now) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      frame(dt);
      if (stop) id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    stop = () => cancelAnimationFrame(id);
  }
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.NxConfetti3d = (canvas, options) => {
    try {
      return celebrate(canvas, options);
    } catch (error) {
      if (window.console) console.warn('3D confetti skipped:', error.message);
      return false;
    }
  };
}
