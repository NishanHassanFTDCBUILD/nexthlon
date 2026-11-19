// Scenes for the Nexthlon 3D engine: a camera, meshes, ready-made geometry and a render loop
// that pauses when the tab is hidden or the canvas scrolls off screen.
import {mat4, vec3} from './math.js';
import {
  createContext,
  createProgram,
  createBuffer,
  bindAttribute,
  setUniform,
  resize,
} from './gl.js';

export class Camera {
  constructor({
    fov = 45,
    near = 0.1,
    far = 100,
    position = [0, 0, 6],
    target = [0, 0, 0],
  } = {}) {
    this.fov = fov;
    this.near = near;
    this.far = far;
    this.position = vec3.create(...position);
    this.target = vec3.create(...target);
    this.projection = mat4.identity();
    this.view = mat4.identity();
  }

  update(aspect) {
    this.projection = mat4.perspective(
      (this.fov * Math.PI) / 180,
      aspect,
      this.near,
      this.far,
    );
    this.view = mat4.lookAt(this.position, this.target);
  }
}

// ---------- Geometry: plain arrays of positions, uvs, normals and indices ----------
export const geometry = {
  plane(width = 1, height = 1, segX = 1, segY = 1) {
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    for (let y = 0; y <= segY; y += 1) {
      for (let x = 0; x <= segX; x += 1) {
        const u = x / segX;
        const v = y / segY;
        positions.push((u - 0.5) * width, (v - 0.5) * height, 0);
        uvs.push(u, v);
        normals.push(0, 0, 1);
      }
    }
    for (let y = 0; y < segY; y += 1) {
      for (let x = 0; x < segX; x += 1) {
        const a = y * (segX + 1) + x;
        const b = a + 1;
        const c = a + segX + 1;
        const d = c + 1;
        indices.push(a, b, d, a, d, c);
      }
    }
    return {positions, uvs, normals, indices};
  },

  cube(size = 1) {
    const h = size / 2;
    const faces = [
      [
        [0, 0, 1],
        [-h, -h, h],
        [h, -h, h],
        [h, h, h],
        [-h, h, h],
      ],
      [
        [0, 0, -1],
        [h, -h, -h],
        [-h, -h, -h],
        [-h, h, -h],
        [h, h, -h],
      ],
      [
        [1, 0, 0],
        [h, -h, h],
        [h, -h, -h],
        [h, h, -h],
        [h, h, h],
      ],
      [
        [-1, 0, 0],
        [-h, -h, -h],
        [-h, -h, h],
        [-h, h, h],
        [-h, h, -h],
      ],
      [
        [0, 1, 0],
        [-h, h, h],
        [h, h, h],
        [h, h, -h],
        [-h, h, -h],
      ],
      [
        [0, -1, 0],
        [-h, -h, -h],
        [h, -h, -h],
        [h, -h, h],
        [-h, -h, h],
      ],
    ];
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    faces.forEach(([normal, ...corners], face) => {
      corners.forEach((corner) => {
        positions.push(...corner);
        normals.push(...normal);
      });
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      const o = face * 4;
      indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    });
    return {positions, uvs, normals, indices};
  },

  sphere(radius = 1, segments = 32, rings = 20) {
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    for (let r = 0; r <= rings; r += 1) {
      const theta = (r / rings) * Math.PI;
      for (let s = 0; s <= segments; s += 1) {
        const phi = (s / segments) * Math.PI * 2;
        const x = Math.sin(theta) * Math.cos(phi);
        const y = Math.cos(theta);
        const z = Math.sin(theta) * Math.sin(phi);
        positions.push(x * radius, y * radius, z * radius);
        normals.push(x, y, z);
        uvs.push(s / segments, 1 - r / rings);
      }
    }
    for (let r = 0; r < rings; r += 1) {
      for (let s = 0; s < segments; s += 1) {
        const a = r * (segments + 1) + s;
        const b = a + segments + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return {positions, uvs, normals, indices};
  },

  torus(radius = 1, tube = 0.3, segments = 48, sides = 16) {
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    for (let i = 0; i <= segments; i += 1) {
      const u = (i / segments) * Math.PI * 2;
      for (let j = 0; j <= sides; j += 1) {
        const v = (j / sides) * Math.PI * 2;
        const cx = Math.cos(u) * radius;
        const cz = Math.sin(u) * radius;
        const nx = Math.cos(u) * Math.cos(v);
        const ny = Math.sin(v);
        const nz = Math.sin(u) * Math.cos(v);
        positions.push(cx + nx * tube, ny * tube, cz + nz * tube);
        normals.push(nx, ny, nz);
        uvs.push(i / segments, j / sides);
      }
    }
    for (let i = 0; i < segments; i += 1) {
      for (let j = 0; j < sides; j += 1) {
        const a = i * (sides + 1) + j;
        const b = a + sides + 1;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return {positions, uvs, normals, indices};
  },

  // count points; place(i) returns [x, y, z]. Defaults to an even (Fibonacci) sphere.
  particles(count, place = null) {
    const positions = new Float32Array(count * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i += 1) {
      let p;
      if (place) p = place(i, count);
      else {
        const y = 1 - (i / (count - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        p = [Math.cos(golden * i) * r, y, Math.sin(golden * i) * r];
      }
      positions.set(p, i * 3);
    }
    return {positions};
  },
};

// A drawable object: geometry + shader program + uniforms + its own position, rotation and scale.
// attributes: extra per-vertex arrays, e.g. { aTarget: { data: Float32Array, size: 3 } }.
export class Mesh {
  constructor(
    gl,
    geo,
    {
      vertex,
      fragment,
      uniforms = {},
      attributes = {},
      mode = null,
      blending = 'normal',
      depthTest = true,
    } = {},
  ) {
    this.gl = gl;
    this.shader = createProgram(gl, vertex, fragment);
    this.uniforms = uniforms;
    this.mode = mode === null ? (geo.indices ? gl.TRIANGLES : gl.POINTS) : mode;
    this.blending = blending;
    this.depthTest = depthTest;
    this.position = [0, 0, 0];
    this.rotation = [0, 0, 0];
    this.scale = [1, 1, 1];
    this.visible = true;
    this.buffers = {};
    const add = (name, data, size) => {
      if (!data) return;
      this.buffers[name] = {
        buffer: createBuffer(
          gl,
          data instanceof Float32Array ? data : new Float32Array(data),
        ),
        size,
      };
    };
    add('aPosition', geo.positions, 3);
    add('aUv', geo.uvs, 2);
    add('aNormal', geo.normals, 3);
    Object.entries(attributes).forEach(([name, {data, size}]) =>
      add(name, data, size),
    );
    this.count = geo.positions.length / 3;
    if (geo.indices) {
      this.indexBuffer = createBuffer(
        gl,
        new Uint16Array(geo.indices),
        gl.ELEMENT_ARRAY_BUFFER,
      );
      this.indexCount = geo.indices.length;
    }
  }

  // Replaces one attribute's data (e.g. new particle targets).
  setAttribute(name, data, size = 3) {
    const gl = this.gl;
    if (!this.buffers[name])
      this.buffers[name] = {buffer: gl.createBuffer(), size};
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[name].buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  }

  draw(camera, shared) {
    if (!this.visible) return;
    const gl = this.gl;
    const {program, attributes, uniforms} = this.shader;
    gl.useProgram(program);
    Object.entries(this.buffers).forEach(([name, {buffer, size}]) =>
      bindAttribute(gl, attributes[name], buffer, size),
    );
    const model = mat4.compose(this.position, this.rotation, this.scale);
    setUniform(gl, uniforms.uModel, model);
    setUniform(gl, uniforms.uView, camera.view);
    setUniform(gl, uniforms.uProjection, camera.projection);
    Object.entries({...shared, ...this.uniforms}).forEach(([name, value]) => {
      if (value && value.texture !== undefined) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, value.texture);
        gl.uniform1i(uniforms[name], 0);
      } else if (value !== undefined) {
        setUniform(
          gl,
          uniforms[name],
          typeof value === 'function' ? value() : value,
        );
      }
    });
    if (this.depthTest) gl.enable(gl.DEPTH_TEST);
    else gl.disable(gl.DEPTH_TEST);
    if (this.blending === 'additive') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
    } else if (this.blending === 'alpha') {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(true);
    } else {
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }
    if (this.indexBuffer) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.drawElements(this.mode, this.indexCount, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.drawArrays(this.mode, 0, this.count);
    }
  }
}

// The render loop. update(time, dt) runs before each frame; meshes draw in the order added.
// It stops drawing while the tab is hidden or the canvas is off screen, and resizes itself.
export class Scene {
  constructor(
    canvas,
    {maxRatio = 2, clearColor = [0, 0, 0, 0], camera = {}} = {},
  ) {
    this.canvas = canvas;
    this.gl = createContext(canvas);
    if (!this.gl) throw new Error('WebGL is not available.');
    this.camera = new Camera(camera);
    this.meshes = [];
    this.maxRatio = maxRatio;
    this.clearColor = clearColor;
    this.uniforms = {uTime: 0, uResolution: [1, 1]};
    this.updaters = [];
    this.running = false;
    this.onScreen = true;
    this.frame = 0;
    this.last = 0;
    this.elapsed = 0;
    this.loop = this.loop.bind(this);

    this.visibility = () => this.sync();
    document.addEventListener('visibilitychange', this.visibility);
    if ('IntersectionObserver' in window) {
      this.observer = new IntersectionObserver(
        (entries) => {
          this.onScreen = entries.some((entry) => entry.isIntersecting);
          this.sync();
        },
        {rootMargin: '120px'},
      );
      this.observer.observe(canvas);
    }
  }

  add(mesh) {
    this.meshes.push(mesh);
    return mesh;
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  start() {
    this.wanted = true;
    this.sync();
  }

  stop() {
    this.wanted = false;
    this.sync();
  }

  // Runs only when wanted, visible and on screen.
  // Frames come from the site's shared ticker (public/js/motion/ticker.js) when it is loaded.
  sync() {
    const go = this.wanted && !document.hidden && this.onScreen;
    if (go && !this.running) {
      this.running = true;
      this.last = performance.now();
      if (window.NxTicker)
        this.unsubscribe = window.NxTicker.add((time, dt) => this.step(dt));
      else this.frame = requestAnimationFrame(this.loop);
    } else if (!go && this.running) {
      this.running = false;
      if (this.unsubscribe) this.unsubscribe();
      this.unsubscribe = null;
      cancelAnimationFrame(this.frame);
    }
  }

  // Draws one frame now (used for the static, reduced-motion version too).
  render(time = this.elapsed) {
    const gl = this.gl;
    resize(gl, this.maxRatio);
    this.uniforms.uTime = time;
    this.uniforms.uResolution = [gl.canvas.width, gl.canvas.height];
    this.camera.update(gl.canvas.width / gl.canvas.height);
    gl.clearColor(...this.clearColor);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.meshes.forEach((mesh) => mesh.draw(this.camera, this.uniforms));
  }

  step(dt) {
    this.elapsed += dt;
    this.updaters.forEach((fn) => fn(this.elapsed, dt));
    this.render(this.elapsed);
  }

  // Fallback loop, used only when the shared ticker is not on the page.
  loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.step(dt);
    this.frame = requestAnimationFrame(this.loop);
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this.visibility);
    if (this.observer) this.observer.disconnect();
  }
}
