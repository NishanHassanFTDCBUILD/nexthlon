// Product page photo stage, drawn with plain WebGL (no libraries).
// - The photo sits on a full-canvas quad, cover-fitted like object-fit: cover.
// - Moving the mouse tilts it with a soft parallax, a lens bulge and a light chromatic edge under the cursor.
// - Changing photo (thumbs, arrows) runs a liquid noise dissolve between the old and the new texture.
// The <img data-gallery-main> stays in the page: the gallery script swaps its src, and we follow it.
// Without WebGL (or with reduced motion) the stage simply keeps showing that <img>.
import { supportsWebGL, createContext, createProgram } from "./3d/gl.js";

const stage = document.querySelector("[data-stage]");
const canvas = stage && stage.querySelector("[data-stage-canvas]");
const photo = stage && stage.querySelector("[data-gallery-main]");
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The WebGL stage is an extra: the plain photo is already on screen. So it starts only once the page
// has loaded and the browser is idle, keeping shader compiling and the photo upload to the GPU out of
// the first seconds (they block the page on slower phones). Then it fades in over the photo.
function whenIdle(run) {
  const later = () => ("requestIdleCallback" in window ? window.requestIdleCallback(run, { timeout: 2000 }) : setTimeout(run, 300));
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}
if (stage && canvas && photo && window.NxTicker && !reduced) whenIdle(() => { if (supportsWebGL()) start(); });

function start() {
  const gl = createContext(canvas, { antialias: false, premultipliedAlpha: false });
  if (!gl) return;

  const vertex = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      vUv.y = 1.0 - vUv.y;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }`;

  const fragment = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uFrom;
    uniform sampler2D uTo;
    uniform vec2 uFromSize;
    uniform vec2 uToSize;
    uniform vec2 uView;
    uniform vec2 uMouse;     // 0..1, eased
    uniform float uHover;    // 0..1, eased
    uniform float uMix;      // 0..1 transition
    uniform float uTime;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
      return v;
    }
    // object-fit: cover, with a little zoom so the parallax never shows an edge.
    vec2 cover(vec2 uv, vec2 img, float zoom) {
      float rv = uView.x / uView.y; float ri = img.x / img.y;
      vec2 scale = rv > ri ? vec2(1.0, ri / rv) : vec2(rv / ri, 1.0);
      return (uv - 0.5) * scale / zoom + 0.5;
    }

    void main() {
      vec2 uv = vUv;
      vec2 m = uMouse;
      vec2 toMouse = uv - m;
      float aspect = uView.x / uView.y;
      float d = length(toMouse * vec2(aspect, 1.0));

      // Parallax drift towards the cursor, and a lens bulge around it.
      vec2 drift = (m - 0.5) * 0.035 * uHover;
      float lens = smoothstep(0.38, 0.0, d) * 0.06 * uHover;
      vec2 base = uv - drift - toMouse * lens;

      // Liquid dissolve between photos.
      float n = fbm(uv * 3.2 + uTime * 0.15);
      float edge = smoothstep(uMix - 0.18, uMix + 0.18, n * 0.7 + uv.y * 0.3);
      float wave = sin(3.14159 * uMix);
      vec2 warpA = vec2(n - 0.5) * 0.12 * wave;

      float zoom = 1.06 + 0.04 * uHover;
      float ca = 0.004 * uHover * smoothstep(0.45, 0.0, d) + 0.006 * wave;

      vec2 fa = cover(base + warpA * (1.0 - edge), uFromSize, zoom);
      vec2 ta = cover(base - warpA * edge, uToSize, zoom + 0.08 * (1.0 - uMix));
      vec3 from = vec3(texture2D(uFrom, fa + vec2(ca, 0.0)).r, texture2D(uFrom, fa).g, texture2D(uFrom, fa - vec2(ca, 0.0)).b);
      vec3 to = vec3(texture2D(uTo, ta + vec2(ca, 0.0)).r, texture2D(uTo, ta).g, texture2D(uTo, ta - vec2(ca, 0.0)).b);
      vec3 color = mix(from, to, 1.0 - edge);

      // Volt rim on the dissolve front, a soft light under the cursor, and a vignette.
      float rim = smoothstep(0.06, 0.0, abs(edge - 0.5)) * wave;
      color += vec3(0.83, 1.0, 0.23) * rim * 0.45;
      color += vec3(1.0) * smoothstep(0.5, 0.0, d) * 0.06 * uHover;
      float vig = smoothstep(1.15, 0.35, length((uv - 0.5) * vec2(1.0, 1.1)));
      color *= mix(0.72, 1.0, vig);
      gl_FragColor = vec4(color, 1.0);
    }`;

  let prog;
  try {
    prog = createProgram(gl, vertex, fragment);
  } catch (error) {
    console.warn(error);
    return;
  }
  const { program, attributes: a, uniforms: u } = prog;

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const blankTexture = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 18, 20, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { tex, w: 1, h: 1 };
  };

  // Textures are cached per URL. Images need CORS to be drawn into WebGL (Unsplash and our own uploads allow it).
  const cache = new Map();
  const loadTexture = src => {
    if (cache.has(src)) return cache.get(src);
    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        const t = blankTexture();
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        t.w = img.naturalWidth;
        t.h = img.naturalHeight;
        resolve(t);
      };
      img.onerror = reject;
      img.src = src;
    });
    cache.set(src, promise);
    return promise;
  };

  let from = null;
  let to = null;
  let mix = 1;
  let mixTarget = 1;
  const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  let hover = 0;
  let hoverTarget = 0;
  let visible = true;
  let width = 0;
  let height = 0;

  const resize = () => {
    const box = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, Math.round(box.width * dpr));
    height = Math.max(1, Math.round(box.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = time => {
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(a.aPos);
    gl.vertexAttribPointer(a.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.uniform1i(u.uFrom, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, to.tex);
    gl.uniform1i(u.uTo, 1);
    gl.uniform2f(u.uFromSize, from.w, from.h);
    gl.uniform2f(u.uToSize, to.w, to.h);
    gl.uniform2f(u.uView, width, height);
    gl.uniform2f(u.uMouse, mouse.x, mouse.y);
    gl.uniform1f(u.uHover, hover);
    gl.uniform1f(u.uMix, mix);
    gl.uniform1f(u.uTime, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  // Only render while something is moving, so an idle page costs nothing.
  let stop = null;
  const settled = () => Math.abs(mix - mixTarget) < 0.001 && Math.abs(hover - hoverTarget) < 0.001 &&
    Math.abs(mouse.x - mouse.tx) < 0.0005 && Math.abs(mouse.y - mouse.ty) < 0.0005;
  const frame = (time, dt) => {
    const k = 1 - Math.pow(0.0015, dt);
    mouse.x += (mouse.tx - mouse.x) * k;
    mouse.y += (mouse.ty - mouse.y) * k;
    hover += (hoverTarget - hover) * k;
    mix += Math.sign(mixTarget - mix) * Math.min(Math.abs(mixTarget - mix), dt / 1.1);
    draw(time);
    if (settled() || !visible) {
      stop();
      stop = null;
    }
  };
  const wake = () => {
    if (!stop && from && visible) stop = window.NxTicker.add(frame);
  };

  // ---------- Follow the gallery ----------
  const show = async src => {
    try {
      const next = await loadTexture(src);
      if (!from) {
        from = next;
        to = next;
        mix = mixTarget = 1;
        resize();
        draw(0);
        stage.classList.add("is-gl");
        return;
      }
      // Start a fresh dissolve from whatever is on screen now.
      from = mix > 0.5 ? to : from;
      to = next;
      mix = 0;
      mixTarget = 1;
      wake();
    } catch {
      // The photo could not be used as a texture (no CORS): fall back to the plain <img>.
      stage.classList.remove("is-gl");
    }
  };
  new MutationObserver(() => show(photo.getAttribute("src"))).observe(photo, { attributes: true, attributeFilter: ["src"] });
  show(photo.getAttribute("src"));

  // ---------- Pointer ----------
  stage.addEventListener("pointermove", event => {
    const box = stage.getBoundingClientRect();
    mouse.tx = (event.clientX - box.left) / box.width;
    mouse.ty = (event.clientY - box.top) / box.height;
    hoverTarget = event.pointerType === "mouse" ? 1 : 0.6;
    wake();
  });
  stage.addEventListener("pointerleave", () => {
    hoverTarget = 0;
    mouse.tx = 0.5;
    mouse.ty = 0.5;
    wake();
  });

  // ---------- Size and visibility ----------
  new ResizeObserver(() => {
    resize();
    if (from) draw(0);
  }).observe(stage);
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) wake();
  }).observe(stage);

  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    stage.classList.remove("is-gl");
    if (stop) stop();
    stop = null;
    from = null;
  });
}
