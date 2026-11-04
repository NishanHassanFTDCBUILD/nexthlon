// WebGL basics for the Nexthlon 3D engine: context, shaders, buffers, textures and sizing.

// Can this browser draw WebGL at all? (Checked once, on a throwaway canvas.)
let support = null;
export function supportsWebGL() {
  if (support === null) {
    try {
      const probe = document.createElement("canvas");
      support = Boolean(window.WebGLRenderingContext && (probe.getContext("webgl") || probe.getContext("experimental-webgl")));
    } catch {
      support = false;
    }
  }
  return support;
}

export function createContext(canvas, options = {}) {
  const settings = { alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance", ...options };
  return canvas.getContext("webgl", settings) || canvas.getContext("experimental-webgl", settings);
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader did not compile: ${message}`);
  }
  return shader;
}

// A linked program, with every attribute and uniform location looked up once.
export function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Program did not link: ${gl.getProgramInfoLog(program)}`);
  const attributes = {};
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i += 1) {
    const info = gl.getActiveAttrib(program, i);
    attributes[info.name] = gl.getAttribLocation(program, info.name);
  }
  for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(program, info.name);
  }
  return { program, attributes, uniforms };
}

export function createBuffer(gl, data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
}

// Binds a float buffer to an attribute (size = numbers per vertex).
export function bindAttribute(gl, location, buffer, size) {
  if (location === undefined || location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

// Sets a uniform from a plain value: number, [x, y], [x, y, z], [x, y, z, w] or a 4×4 matrix.
export function setUniform(gl, location, value) {
  if (location === undefined || location === null) return;
  if (typeof value === "number") gl.uniform1f(location, value);
  else if (value.length === 2) gl.uniform2fv(location, value);
  else if (value.length === 3) gl.uniform3fv(location, value);
  else if (value.length === 4) gl.uniform4fv(location, value);
  else if (value.length === 16) gl.uniformMatrix4fv(location, false, value);
}

// A texture from an image URL. Shows one transparent pixel until the image arrives.
// Works with any image size (no mipmaps; edges clamp), so small product photos are fine.
export function loadTexture(gl, url) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  const ready = new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      resolve(true);
    };
    image.onerror = () => resolve(false);
    image.src = url;
  });
  return { texture, ready };
}

// Matches the drawing buffer to the canvas's CSS size × device pixel ratio (capped).
// Returns true when the size changed.
export function resize(gl, maxRatio = 2) {
  const canvas = gl.canvas;
  const ratio = Math.min(window.devicePixelRatio || 1, maxRatio);
  const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  return true;
}
