// Sign-in pages in 3D (ES module, built on public/js/3d):
//   customers  glowing particles form a running athlete, then a football, then a dumbbell, in a
//              loop over the obsidian and volt fog. The mouse makes them swirl away and come back.
//   admins     a turning wireframe globe with glowing data points, for the "control room".
// Decoration only: without WebGL the scene shows its CSS fallback, and with reduced motion one
// still frame is drawn.
import { Scene, Mesh, geometry } from "./3d/scene.js";
import { boot } from "./3d/boot.js";
import { clamp, damp } from "./3d/math.js";
import { sampleShape, drawAthlete, drawFootball, drawDumbbell, spherePoints, fogShader, dotFragment } from "./3d/shapes.js";

const COUNTS = { high: 6500, medium: 4000, low: 2000 };
const HOLD = 3.4;   // seconds each shape stays
const MORPH = 1.4;  // seconds to change into the next

// Weights for [athlete, football, dumbbell] at this moment of the loop.
function weightsAt(time) {
  const cycle = HOLD + MORPH;
  const k = Math.floor(time / cycle) % 3;
  const local = time % cycle;
  const t = clamp((local - HOLD) / MORPH, 0, 1);
  const blend = t * t * (3 - 2 * t);
  const w = [0, 0, 0];
  w[k] = 1 - blend;
  w[(k + 1) % 3] += blend;
  return w;
}

const swirlShader = {
  vertex: `
    attribute vec3 aPosition;
    attribute vec3 aBall;
    attribute vec3 aBell;
    attribute vec3 aRandom;
    uniform mat4 uModel, uView, uProjection;
    uniform float uTime, uSize, uRatio, uPush;
    uniform vec3 uWeights;
    uniform vec2 uMouse;
    varying float vMix;
    varying float vAlpha;
    void main() {
      vec3 p = aPosition * uWeights.x + aBall * uWeights.y + aBell * uWeights.z;
      float settled = max(max(uWeights.x, uWeights.y), uWeights.z);
      float t = uTime * 0.8 + aRandom.y * 6.2831;
      p += vec3(sin(t), cos(t * 1.3), sin(t * 0.7)) * (0.02 + (1.0 - settled) * 0.9) * aRandom.x;
      vec4 world = uModel * vec4(p, 1.0);
      // Near the mouse, particles are pushed away and spun around it.
      vec2 d = world.xy - uMouse;
      float dist2 = dot(d, d);
      float force = exp(-dist2 * 1.8) * uPush;
      vec2 dir = dist2 > 0.0001 ? normalize(d) : vec2(0.0, 1.0);
      world.xy += (dir + vec2(-dir.y, dir.x) * 1.4) * force * (0.45 + aRandom.x * 0.6);
      world.z += force * (aRandom.z - 0.5) * 1.2;
      vec4 mv = uView * world;
      gl_Position = uProjection * mv;
      gl_PointSize = uSize * (0.55 + aRandom.x) * uRatio / -mv.z;
      vMix = aRandom.z;
      vAlpha = 0.5 + 0.5 * aRandom.x;
    }`,
  fragment: dotFragment
};

// The pointer in world units on the z = 0 plane, for a canvas and camera.
function pointerTracker(canvas) {
  const state = { x: 0, y: 0, inside: false, last: 0 };
  window.addEventListener("pointermove", event => {
    const box = canvas.getBoundingClientRect();
    state.inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    state.x = ((event.clientX - box.left) / box.width) * 2 - 1;
    state.y = ((event.clientY - box.top) / box.height) * 2 - 1;
    state.last = performance.now();
  }, { passive: true });
  return state;
}

function buildAthletes(canvas, { tier }) {
  const scene = new Scene(canvas, { maxRatio: tier === "low" ? 1.25 : 2, camera: { fov: 45, position: [0, 0, 7] } });
  const gl = scene.gl;
  const count = COUNTS[tier] || COUNTS.medium;
  const size = { width: 400, height: 320, scale: 4.4, depth: 0.5 };
  const random = new Float32Array(count * 3);
  for (let i = 0; i < random.length; i += 1) random[i] = Math.random();
  const fog = scene.add(new Mesh(gl, geometry.plane(1, 1), { ...fogShader, depthTest: false }));
  fog.uniforms = { uMouse: [0, 0], uMorph: 0 };
  const dots = scene.add(new Mesh(gl, { positions: sampleShape(drawAthlete, count, size) }, {
    ...swirlShader,
    blending: "additive",
    depthTest: false,
    attributes: {
      aBall: { data: sampleShape(drawFootball, count, size), size: 3 },
      aBell: { data: sampleShape(drawDumbbell, count, size), size: 3 },
      aRandom: { data: random, size: 3 }
    },
    uniforms: { uSize: 30, uRatio: 1, uPush: 0, uMouse: [0, 0], uWeights: [1, 0, 0], uColorA: [0.83, 1.0, 0.23], uColorB: [0.96, 1.0, 0.82] }
  }));
  const pointer = pointerTracker(canvas);
  let push = 0;
  let mx = 0;
  let my = 0;
  scene.onUpdate((time, dt) => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const distance = Math.max(6.2, 6.6 / Math.max(aspect, 0.35));
    const half = Math.tan((scene.camera.fov * Math.PI) / 360) * distance;
    const active = pointer.inside && performance.now() - pointer.last < 1200;
    push = damp(push, active ? 1 : 0, active ? 6 : 1.6, dt);
    mx = damp(mx, pointer.x * half * aspect, 10, dt);
    my = damp(my, -pointer.y * half, 10, dt);
    scene.camera.position[0] = pointer.x * 0.35;
    scene.camera.position[1] = -pointer.y * 0.25;
    scene.camera.position[2] = distance;
    dots.rotation[1] = Math.sin(time * 0.3) * 0.35;
    dots.uniforms.uWeights = weightsAt(time);
    dots.uniforms.uPush = push;
    dots.uniforms.uMouse = [mx, my];
    dots.uniforms.uRatio = Math.min(window.devicePixelRatio || 1, 2) * (distance / 7);
    fog.uniforms.uMouse = [pointer.x, pointer.y];
    fog.uniforms.uMorph = time * 0.2;
  });
  return { scene };
}

// ---------- The admin globe: latitude and longitude lines, and pulsing data points ----------
const lineShader = {
  vertex: `
    attribute vec3 aPosition;
    uniform mat4 uModel, uView, uProjection;
    varying float vFront;
    void main() {
      vec4 mv = uView * uModel * vec4(aPosition, 1.0);
      vec4 centre = uView * uModel * vec4(0.0, 0.0, 0.0, 1.0);
      vFront = clamp((mv.z - centre.z) / 2.0 + 0.5, 0.0, 1.0);
      gl_Position = uProjection * mv;
    }`,
  fragment: `
    precision mediump float;
    varying float vFront;
    void main() {
      vec3 colour = mix(vec3(0.2, 0.2, 0.23), vec3(0.83, 1.0, 0.23), vFront);
      gl_FragColor = vec4(colour * (0.2 + 0.6 * vFront), 1.0);
    }`
};

const beaconShader = {
  vertex: `
    attribute vec3 aPosition;
    attribute vec3 aRandom;
    uniform mat4 uModel, uView, uProjection;
    uniform float uTime, uSize, uRatio;
    varying float vMix;
    varying float vAlpha;
    void main() {
      vec4 mv = uView * uModel * vec4(aPosition, 1.0);
      vec4 centre = uView * uModel * vec4(0.0, 0.0, 0.0, 1.0);
      float front = clamp((mv.z - centre.z) / 2.0 + 0.5, 0.0, 1.0);
      float pulse = 0.6 + 0.6 * sin(uTime * 2.4 + aRandom.y * 6.2831);
      gl_Position = uProjection * mv;
      gl_PointSize = uSize * (0.6 + aRandom.x * 0.8) * pulse * uRatio / -mv.z;
      vMix = aRandom.z;
      vAlpha = 0.25 + 0.75 * front;
    }`,
  fragment: dotFragment
};

function globeLines(radius, lats = 9, longs = 14, steps = 64) {
  const out = [];
  for (let i = 1; i < lats; i += 1) {
    const theta = (i / lats) * Math.PI;
    const y = Math.cos(theta) * radius;
    const r = Math.sin(theta) * radius;
    for (let s = 0; s < steps; s += 1) {
      const a = (s / steps) * Math.PI * 2, b = ((s + 1) / steps) * Math.PI * 2;
      out.push(Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(b) * r, y, Math.sin(b) * r);
    }
  }
  for (let j = 0; j < longs; j += 1) {
    const phi = (j / longs) * Math.PI * 2;
    for (let s = 0; s < steps; s += 1) {
      const a = (s / steps) * Math.PI, b = ((s + 1) / steps) * Math.PI;
      out.push(Math.sin(a) * Math.cos(phi) * radius, Math.cos(a) * radius, Math.sin(a) * Math.sin(phi) * radius,
        Math.sin(b) * Math.cos(phi) * radius, Math.cos(b) * radius, Math.sin(b) * Math.sin(phi) * radius);
    }
  }
  return new Float32Array(out);
}

function buildGlobe(canvas, { tier }) {
  const scene = new Scene(canvas, { maxRatio: tier === "low" ? 1.25 : 2, camera: { fov: 40, position: [0, 0.6, 6.4] } });
  const gl = scene.gl;
  const fog = scene.add(new Mesh(gl, geometry.plane(1, 1), { ...fogShader, depthTest: false }));
  fog.uniforms = { uMouse: [0.4, -0.2], uMorph: 0 };
  const lines = scene.add(new Mesh(gl, { positions: globeLines(1.9) }, { ...lineShader, mode: gl.LINES, blending: "additive", depthTest: false }));
  const beaconCount = tier === "low" ? 90 : 180;
  const random = new Float32Array(beaconCount * 3);
  for (let i = 0; i < random.length; i += 1) random[i] = Math.random();
  const beacons = scene.add(new Mesh(gl, { positions: spherePoints(beaconCount, 1.93) }, {
    ...beaconShader,
    blending: "additive",
    depthTest: false,
    attributes: { aRandom: { data: random, size: 3 } },
    uniforms: { uSize: 70, uRatio: 1, uColorA: [0.83, 1.0, 0.23], uColorB: [0.96, 0.96, 0.92] }
  }));
  scene.onUpdate(time => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    scene.camera.position[2] = Math.max(6.4, 6.6 / Math.max(aspect, 0.4));
    // Wide screens: the globe sits left of the sign-in card. Tall screens: above it.
    const x = aspect > 1.2 ? -Math.min(1.45, 0.9 + (aspect - 1.2) * 1.4) : 0;
    const y = aspect > 1.2 ? 0 : 1.4;
    [lines, beacons].forEach(mesh => {
      mesh.rotation[1] = time * 0.18;
      mesh.rotation[0] = 0.32;
      mesh.position[0] = x;
      mesh.position[1] = y;
    });
    beacons.uniforms.uRatio = Math.min(window.devicePixelRatio || 1, 2);
    fog.uniforms.uMorph = time * 0.15;
  });
  return { scene };
}

const customer = document.querySelector("[data-auth-scene]");
if (customer) boot(customer, customer.querySelector("[data-auth-canvas]"), buildAthletes);
const admin = document.querySelector("[data-globe-scene]");
if (admin) boot(admin, admin.querySelector("[data-globe-canvas]"), buildGlobe);
