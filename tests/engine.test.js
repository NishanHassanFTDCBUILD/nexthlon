// The 3D engine's maths and geometry (public/js/3d). These run in Node without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {pathToFileURL} = require('url');

const load = (name) =>
  import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', '3d', name)).href
  );
const close = (a, b, eps = 1e-5) => Math.abs(a - b) < eps;

test('mat4: identity, multiply and translation', async () => {
  const {mat4} = await load('math.js');
  const id = mat4.identity();
  const t = mat4.translation(1, 2, 3);
  assert.deepEqual([...mat4.multiply(id, t)], [...t]);
  const both = mat4.multiply(t, mat4.translation(1, 1, 1));
  assert.deepEqual([both[12], both[13], both[14]], [2, 3, 4]);
});

test('mat4: perspective and lookAt put a point in front of the camera at the centre of the screen', async () => {
  const {mat4} = await load('math.js');
  const view = mat4.lookAt([0, 0, 5], [0, 0, 0]);
  const projection = mat4.perspective(Math.PI / 4, 1, 0.1, 100);
  const mvp = mat4.multiply(projection, view);
  // The origin, 5 units ahead: clip x and y are 0, and it lies inside the depth range.
  const [x, y, z, w] = [0, 1, 2, 3].map((row) => mvp[12 + row]);
  assert.ok(close(x / w, 0) && close(y / w, 0));
  assert.ok(z / w > -1 && z / w < 1);
  assert.ok(close(w, 5));
});

test('mat4: a quarter turn about Y sends +X to -Z', async () => {
  const {mat4} = await load('math.js');
  const r = mat4.rotationY(Math.PI / 2);
  const x = r[0] * 1;
  const z = r[2] * 1;
  assert.ok(close(x, 0) && close(z, -1));
});

test('vec3 helpers and easing', async () => {
  const {vec3, clamp, smoothstep, damp} = await load('math.js');
  assert.deepEqual([...vec3.cross([1, 0, 0], [0, 1, 0])], [0, 0, 1]);
  assert.ok(close(vec3.length(vec3.normalize([3, 4, 0])), 1));
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.ok(damp(0, 10, 4, 1 / 60) > 0 && damp(0, 10, 4, 1 / 60) < 10);
});

test('geometry: plane, cube, sphere, torus and particles have the right sizes', async () => {
  const {geometry} = await load('scene.js');
  const plane = geometry.plane(2, 1, 4, 2);
  assert.equal(plane.positions.length / 3, 5 * 3);
  assert.equal(plane.indices.length, 4 * 2 * 6);
  assert.equal(geometry.cube().indices.length, 36);
  const sphere = geometry.sphere(1, 8, 6);
  assert.equal(sphere.positions.length / 3, 9 * 7);
  assert.ok(sphere.indices.every((i) => i < sphere.positions.length / 3));
  assert.equal(geometry.torus(1, 0.3, 12, 8).indices.length, 12 * 8 * 6);
  const dots = geometry.particles(500);
  assert.equal(dots.positions.length, 1500);
  // The even sphere: every point sits on the unit sphere.
  for (let i = 0; i < 500; i += 50) {
    const r = Math.hypot(
      dots.positions[i * 3],
      dots.positions[i * 3 + 1],
      dots.positions[i * 3 + 2],
    );
    assert.ok(close(r, 1, 1e-4));
  }
});
