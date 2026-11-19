// Small vector and matrix maths for the Nexthlon 3D engine.
// Matrices are column-major Float32Arrays of 16 numbers, the layout WebGL expects.

export const vec3 = {
  create: (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
  add: (a, b) => vec3.create(a[0] + b[0], a[1] + b[1], a[2] + b[2]),
  sub: (a, b) => vec3.create(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  scale: (a, s) => vec3.create(a[0] * s, a[1] * s, a[2] * s),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) =>
    vec3.create(
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ),
  length: (a) => Math.hypot(a[0], a[1], a[2]),
  normalize(a) {
    const len = vec3.length(a) || 1;
    return vec3.create(a[0] / len, a[1] / len, a[2] / len);
  },
  lerp: (a, b, t) =>
    vec3.create(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ),
};

export const mat4 = {
  identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },

  // out = a × b
  multiply(a, b) {
    const out = new Float32Array(16);
    for (let col = 0; col < 4; col += 1) {
      for (let row = 0; row < 4; row += 1) {
        let sum = 0;
        for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  },

  // fovy in radians.
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) * nf;
    m[11] = -1;
    m[14] = 2 * far * near * nf;
    return m;
  },

  // The view matrix of a camera at eye looking at target.
  lookAt(eye, target, up = [0, 1, 0]) {
    const z = vec3.normalize(vec3.sub(eye, target));
    const x = vec3.normalize(vec3.cross(up, z));
    const y = vec3.cross(z, x);
    const m = mat4.identity();
    m[0] = x[0];
    m[4] = x[1];
    m[8] = x[2];
    m[1] = y[0];
    m[5] = y[1];
    m[9] = y[2];
    m[2] = z[0];
    m[6] = z[1];
    m[10] = z[2];
    m[12] = -vec3.dot(x, eye);
    m[13] = -vec3.dot(y, eye);
    m[14] = -vec3.dot(z, eye);
    return m;
  },

  translation(x, y, z) {
    const m = mat4.identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  },

  translate: (m, v) => mat4.multiply(m, mat4.translation(v[0], v[1], v[2])),

  scaling(x, y = x, z = x) {
    const m = mat4.identity();
    m[0] = x;
    m[5] = y;
    m[10] = z;
    return m;
  },

  rotationX(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const m = mat4.identity();
    m[5] = c;
    m[6] = s;
    m[9] = -s;
    m[10] = c;
    return m;
  },
  rotationY(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const m = mat4.identity();
    m[0] = c;
    m[2] = -s;
    m[8] = s;
    m[10] = c;
    return m;
  },
  rotationZ(rad) {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const m = mat4.identity();
    m[0] = c;
    m[1] = s;
    m[4] = -s;
    m[5] = c;
    return m;
  },
  rotate(m, [rx, ry, rz]) {
    return mat4.multiply(
      m,
      mat4.multiply(
        mat4.rotationY(ry),
        mat4.multiply(mat4.rotationX(rx), mat4.rotationZ(rz)),
      ),
    );
  },

  // Model matrix from position, rotation (radians, applied Y then X then Z) and scale.
  compose(position, rotation, scale) {
    let m = mat4.translation(position[0], position[1], position[2]);
    m = mat4.rotate(m, rotation);
    return mat4.multiply(m, mat4.scaling(scale[0], scale[1], scale[2]));
  },
};

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;
// Smooth 0 → 1 between edge0 and edge1.
export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
// Frame-rate independent easing towards a target ("damping" per second).
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));
