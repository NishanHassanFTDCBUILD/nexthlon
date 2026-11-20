// Shapes and shaders shared by the Nexthlon particle scenes (home hero, sign-in pages).
// A shape is drawn on a hidden 2D canvas and turned into particle positions.

// Points sampled from a shape drawn on a hidden 2D canvas, centred, `scale` world units wide.
export function sampleShape(draw, count, {width, height, scale, depth}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: true});
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

// An even sphere of points (the Fibonacci spiral), slightly rough.
export function spherePoints(count, radius) {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const rr = radius + (Math.random() - 0.5) * radius * 0.06;
    out.set(
      [Math.cos(golden * i) * r * rr, y * rr, Math.sin(golden * i) * r * rr],
      i * 3,
    );
  }
  return out;
}

// The logo as letter OUTLINES, spaced out and sized to fill the width: solid heavy letters
// turn into one glowing block when drawn with dots.
// The NEXTHLON wordmark: outlined letters (wide screens), or filled ones ({ fill: true }, phones,
// where an outline only a few pixels thick breaks up into speckle).
export function drawLogo(font, {fill = false, stroke = 0.04} = {}) {
  return (ctx, w, h) => {
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = Math.max(5, h * stroke);
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(h * 0.05)}px`;
    ctx.font = `800 100px ${font}`;
    const size = Math.min(
      h * 0.78,
      (100 * w * 0.92) / Math.max(1, ctx.measureText('NEXTHLON').width),
    );
    ctx.font = `800 ${Math.round(size)}px ${font}`;
    if (fill) ctx.fillText('NEXTHLON', w / 2, h / 2 + h * 0.03);
    else ctx.strokeText('NEXTHLON', w / 2, h / 2 + h * 0.03);
  };
}

function limbs(ctx) {
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return (width, ...points) => {
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2)
      ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
  };
}

// A running athlete mid-stride (drawn on a 400 × 320 canvas).
export function drawAthlete(ctx) {
  const limb = limbs(ctx);
  ctx.beginPath();
  ctx.arc(232, 52, 24, 0, Math.PI * 2);
  ctx.fill();
  limb(34, 222, 92, 196, 176);
  limb(17, 216, 104, 172, 128, 146, 100);
  limb(17, 216, 104, 256, 140, 292, 120);
  limb(22, 196, 176, 248, 214, 240, 280);
  limb(9, 240, 280, 266, 284);
  limb(22, 196, 176, 156, 222, 104, 238);
  limb(9, 104, 238, 92, 222);
}

// A football: the outline, a centre pentagon and the seams to the edge (400 × 320 canvas).
export function drawFootball(ctx) {
  const limb = limbs(ctx);
  const cx = 200;
  const cy = 160;
  const r = 132;
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const corner = (i, radius) => [
    cx + Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 5) * radius,
    cy + Math.sin(-Math.PI / 2 + (i * Math.PI * 2) / 5) * radius,
  ];
  ctx.beginPath();
  for (let i = 0; i < 5; i += 1) ctx.lineTo(...corner(i, 46));
  ctx.closePath();
  ctx.fill();
  for (let i = 0; i < 5; i += 1) {
    const [x1, y1] = corner(i, 46);
    const [x2, y2] = corner(i, r);
    limb(9, x1, y1, x2, y2);
  }
}

// A dumbbell: two plates on each side of a bar (400 × 320 canvas).
export function drawDumbbell(ctx) {
  ctx.fillStyle = '#fff';
  const plate = (x, w, h) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, 160 - h / 2, w, h, 10);
    else ctx.rect(x, 160 - h / 2, w, h);
    ctx.fill();
  };
  ctx.fillRect(84, 150, 232, 20);
  plate(40, 34, 170);
  plate(80, 26, 128);
  plate(326, 34, 170);
  plate(294, 26, 128);
}

// An animated obsidian fog with a faint volt glow, drawn on a full-screen quad behind everything.
export const fogShader = {
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
      vec3 obsidian = vec3(0.018, 0.018, 0.022), smoke = vec3(0.075, 0.075, 0.085), volt = vec3(0.83, 1.0, 0.23);
      vec3 colour = mix(obsidian, smoke, n);
      float glow = smoothstep(0.5, 0.92, n) * (0.55 + 0.25 * sin(uTime * 0.35 + uMorph));
      vec2 m = vec2(uMouse.x * 0.5 + 0.5, 0.5 - uMouse.y * 0.5);
      float spot = 0.12 / (0.2 + distance(vUv, m) * 2.6);
      colour += volt * (glow * 0.16 + spot * 0.12);
      colour *= 1.0 - 0.45 * length(vUv - vec2(0.5, 0.55));
      gl_FragColor = vec4(colour, 1.0);
    }`,
};

// Soft round glowing dots (additive blending), coloured between two colours.
export const dotFragment = `
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
  }`;
