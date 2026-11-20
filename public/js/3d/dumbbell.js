// Product geometry and matching particle targets use the same dimensions/angle.
function present(x, y, z) {
  const yaw = -0.48;
  const pitch = 0.18;
  const roll = 0.22;
  const turnX = x * Math.cos(yaw) + z * Math.sin(yaw);
  const turnZ = -x * Math.sin(yaw) + z * Math.cos(yaw);
  const tiltY = y * Math.cos(pitch) - turnZ * Math.sin(pitch);
  return [
    turnX * Math.cos(roll) - tiltY * Math.sin(roll),
    turnX * Math.sin(roll) + tiltY * Math.cos(roll),
    y * Math.sin(pitch) + turnZ * Math.cos(pitch),
  ];
}

export function dumbbellGeometry(segments = 64) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const materials = [];
  const lathe = (profile, material) => {
    for (let j = 0; j < profile.length - 1; j += 1) {
      const [x0, r0] = profile[j];
      const [x1, r1] = profile[j + 1];
      const dx = x1 - x0;
      const dr = r1 - r0;
      const length = Math.hypot(dx, dr);
      const start = positions.length / 3;
      for (let i = 0; i <= segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        for (const [x, radius] of [
          [x0, r0],
          [x1, r1],
        ]) {
          positions.push(
            ...present(x, Math.cos(angle) * radius, Math.sin(angle) * radius),
          );
          normals.push(
            ...present(
              -dr / length,
              (dx / length) * Math.cos(angle),
              (dx / length) * Math.sin(angle),
            ),
          );
          uvs.push(x, angle);
          materials.push(material === 0 && dx !== 0 && dr !== 0 ? 2 : material);
        }
      }
      for (let i = 0; i < segments; i += 1) {
        const a = start + i * 2;
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  };
  const cylinder = (from, to, radius, material, bevel = 0.025) => {
    lathe(
      [
        [from, 0],
        [from, radius - bevel],
        [from + bevel, radius],
        [to - bevel, radius],
        [to, radius - bevel],
        [to, 0],
      ],
      material,
    );
  };
  cylinder(-0.84, 0.84, 0.12, 1, 0.012);
  for (const side of [-1, 1]) {
    const part = (from, to, radius, material, bevel) =>
      cylinder(
        Math.min(from * side, to * side),
        Math.max(from * side, to * side),
        radius,
        material,
        bevel,
      );
    part(0.76, 0.95, 0.2, 1, 0.02);
    part(0.96, 1.16, 0.62, 0, 0.04);
    part(1.2, 1.45, 0.78, 0, 0.045);
    part(1.49, 1.7, 0.7, 0, 0.04);
    part(1.7, 1.83, 0.15, 1, 0.02);
  }
  return {
    positions,
    normals,
    uvs,
    indices,
    materials: new Float32Array(materials),
  };
}

export const dumbbellShader = {
  vertex: `
    attribute vec3 aPosition, aNormal;
    attribute vec2 aUv;
    attribute float aMaterial;
    uniform mat4 uModel, uView, uProjection;
    varying vec3 vNormal, vWorld;
    varying vec2 vUv;
    varying float vMaterial;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorld = world.xyz;
      vNormal = normalize(mat3(uModel) * aNormal);
      vUv = aUv;
      vMaterial = aMaterial;
      gl_Position = uProjection * uView * world;
    }`,
  fragment: `
    precision mediump float;
    uniform float uOpacity;
    uniform vec3 uEye;
    varying vec3 vNormal, vWorld;
    varying vec2 vUv;
    varying float vMaterial;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 view = normalize(uEye - vWorld);
      vec3 key = normalize(vec3(-0.6, 1.0, 1.6));
      vec3 fill = normalize(vec3(0.9, -0.3, 0.8));
      bool metal = vMaterial > 0.5 && vMaterial < 1.5;
      vec3 base = metal ? vec3(0.48, 0.52, 0.56) : vec3(0.075, 0.085, 0.1);
      if (vMaterial > 1.5) base = vec3(0.19, 0.22, 0.25);
      float texture = 1.0;
      if (metal && abs(vUv.x) < 0.74) {
        float grooves = sin(vUv.x * 190.0 + vUv.y * 15.0) * sin(vUv.x * 190.0 - vUv.y * 15.0);
        texture = 0.8 + 0.2 * grooves;
      }
      float diffuse = max(dot(n, key), 0.0);
      float side = max(dot(n, fill), 0.0);
      float spec = pow(max(dot(n, normalize(key + view)), 0.0), metal ? 65.0 : 24.0);
      float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
      vec3 color = base * texture * (0.42 + diffuse * 1.5 + side * 0.45);
      color += vec3(0.85, 0.92, 1.0) * spec * (metal ? 0.8 : 0.18);
      color += vec3(0.65, 0.8, 0.25) * rim * 0.18;
      gl_FragColor = vec4(color * uOpacity, uOpacity);
    }`,
};

export function dumbbellPoints(count) {
  const parts = [];
  const cylinder = (from, to, radius, weight) =>
    parts.push({kind: 'cylinder', from, to, radius, weight});
  const face = (x, radius, weight) =>
    parts.push({kind: 'face', x, radius, weight});
  const rim = (x, radius, weight) =>
    parts.push({kind: 'rim', x, radius, weight});
  cylinder(-0.84, 0.84, 0.12, 9);
  parts.push({kind: 'grip', weight: 9});
  for (const side of [-1, 1]) {
    cylinder(side * 0.76, side * 0.95, 0.2, 3);
    rim(side * 0.8, 0.2, 1);
    rim(side * 0.94, 0.2, 1);
    const plates = [
      [0.96, 1.16, 0.62],
      [1.2, 1.45, 0.78],
      [1.49, 1.7, 0.7],
    ];
    for (const [inner, outer, radius] of plates) {
      cylinder(side * inner, side * outer, radius, 5);
      for (const x of [inner, outer]) {
        face(side * x, radius - 0.045, 4);
        rim(side * x, radius - 0.035, 3);
      }
      rim(side * ((inner + outer) / 2), radius, 1.5);
    }
    cylinder(side * 1.7, side * 1.83, 0.15, 1.5);
    face(side * 1.83, 0.15, 1);
    rim(side * 1.83, 0.15, 1);
  }
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const fraction = (value) => value - Math.floor(value);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    let weight = (i / count) * total;
    let index = 0;
    while (index < parts.length - 1 && weight >= parts[index].weight) {
      weight -= parts[index].weight;
      index += 1;
    }
    const part = parts[index];
    const u = fraction((i + 0.5) * 0.754877666);
    const v = fraction((i + 0.5) * 0.569840291);
    let angle = v * Math.PI * 2;
    let x;
    let radius;
    if (part.kind === 'grip') {
      x = -0.73 + u * 1.46;
      // Two opposed helices form a subtle diamond texture around the handle.
      angle = (i % 2 === 0 ? 1 : -1) * x * 55 + ((i % 8) * Math.PI) / 4;
      radius = 0.126;
    } else if (part.kind === 'cylinder') {
      x = part.from + (part.to - part.from) * u;
      radius = part.radius;
    } else {
      x = part.x;
      radius = part.kind === 'face' ? Math.sqrt(u) * part.radius : part.radius;
    }
    const y = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.set(present(x, y, z), i * 3);
  }
  return {positions};
}
