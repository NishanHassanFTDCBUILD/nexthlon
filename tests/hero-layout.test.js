const test = require('node:test');
const assert = require('node:assert/strict');

test('hero: phones draw every particle like laptops; laptops keep their dot size, phones get readable dots', async () => {
  const {heroQuality} = await import('../public/js/3d/hero-layout.js');
  for (const tier of ['low', 'medium', 'high']) {
    let previous = 0;
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      const quality = heroQuality(width, 900, tier);
      assert.equal(quality.count, quality.capacity);
      assert.ok(quality.ratio <= (width <= 720 ? 2.25 : 2));
      assert.ok(quality.dotPixels >= previous);
      previous = quality.dotPixels;
    }
    for (const width of [721, 768, 1024, 1440, 1920])
      assert.equal(heroQuality(width, 768, tier).dotPixels, 26 / 7);
    const phone = heroQuality(390, 844, tier);
    assert.ok(phone.dotPixels >= 2 && phone.dotPixels <= 3);
    assert.equal(phone.crisp, 1);
    assert.equal(heroQuality(1440, 900, tier).crisp, 0);
    // Phones that are not weak get close to the laptop particle count.
    if (tier !== 'low') assert.ok(phone.capacity >= 8000);
  }
});

test('hero: compact scroll stages hold each fully formed shape and preserve desktop timing', async () => {
  const {heroMorph} = await import('../public/js/3d/hero-layout.js');
  assert.equal(heroMorph(0.09, true), 0);
  assert.equal(heroMorph(0.34, true), 1);
  assert.equal(heroMorph(0.5, true), 1);
  assert.equal(heroMorph(0.76, true), 2);
  assert.equal(heroMorph(1, true), 2);
  assert.equal(heroMorph(0.3), 1);
  assert.equal(heroMorph(0.48), 1);
  assert.equal(heroMorph(0.7), 2);
  let previous = 0;
  for (let progress = 0; progress <= 1; progress += 0.01) {
    const morph = heroMorph(progress, true);
    assert.ok(morph >= previous && morph <= 2);
    previous = morph;
  }
});

test('hero: dumbbell, logo and athlete fit clear of text at phone, tablet and laptop sizes', async () => {
  const {heroLayout} = await import('../public/js/3d/hero-layout.js');
  const cases = [
    {
      width: 320,
      height: 640,
      contentTop: 269,
      textRight: 300,
      headerHeight: 163,
    },
    {
      width: 390,
      height: 844,
      contentTop: 440,
      textRight: 370,
      headerHeight: 163,
    },
    {
      width: 768,
      height: 1024,
      contentTop: 669,
      textRight: 730,
      headerHeight: 121,
    },
    {
      width: 1024,
      height: 768,
      contentTop: 229,
      textRight: 460,
      headerHeight: 121,
    },
    {
      width: 1440,
      height: 900,
      contentTop: 261,
      textRight: 570,
      headerHeight: 121,
    },
    {
      width: 1920,
      height: 1080,
      contentTop: 379,
      textRight: 800,
      headerHeight: 121,
    },
    {
      width: 844,
      height: 390,
      contentTop: 170,
      textRight: 380,
      headerHeight: 100,
    },
  ];
  for (const input of cases) {
    for (const [morph, dimensions] of [
      [0, [4.1, 2.7]],
      [1, [4.9, 1.31]],
      [2, [4.2, 3.36]],
    ]) {
      const layout = heroLayout({...input, morph});
      const pixelsPerUnit =
        input.height / (2 * layout.distance * Math.tan(Math.PI / 8));
      const [w, h] = dimensions.map(
        (value) => value * layout.scale * pixelsPerUnit,
      );
      assert.ok(w <= layout.rect.right - layout.rect.left);
      assert.ok(h <= layout.rect.bottom - layout.rect.top);
      assert.ok(layout.rect.top > input.headerHeight);
      if (input.width < 1000 && input.height >= 600) {
        assert.ok(layout.rect.bottom < input.contentTop);
      } else {
        assert.ok(layout.rect.left > input.textRight);
      }
    }
  }
});

test('hero: shorter particle draws still cover the complete object', async () => {
  const {heroQuality} = await import('../public/js/3d/hero-layout.js');
  for (const tier of ['low', 'medium', 'high']) {
    const {capacity, count} = heroQuality(320, 640, tier);
    const indices = Array.from(
      {length: capacity},
      (_, i) => (i * 7919) % capacity,
    );
    assert.equal(new Set(indices).size, capacity);
    const selected = indices.slice(0, count);
    assert.ok(Math.min(...selected) < capacity * 0.02);
    assert.ok(Math.max(...selected) > capacity * 0.98);
  }
});

test('hero: solid dumbbell uses valid indexed geometry and unit lighting normals', async () => {
  const {dumbbellGeometry} = await import('../public/js/3d/dumbbell.js');
  for (const segments of [32, 64]) {
    const model = dumbbellGeometry(segments);
    const vertices = model.positions.length / 3;
    assert.equal(model.normals.length, model.positions.length);
    assert.equal(model.materials.length, vertices);
    assert.equal(model.uvs.length, vertices * 2);
    assert.ok(vertices < 65536);
    assert.ok(model.indices.every((index) => index >= 0 && index < vertices));
    assert.ok(model.positions.every(Number.isFinite));
    for (let i = 0; i < model.normals.length; i += 3) {
      assert.ok(
        Math.abs(Math.hypot(...model.normals.slice(i, i + 3)) - 1) < 0.0001,
      );
    }
  }
});

test('hero: the logo and runner are drawn larger than the dumbbell on laptops and phones; phones draw every particle', async () => {
  const {heroLayout, heroQuality} =
    await import('../public/js/3d/hero-layout.js');
  const laptop = {
    width: 1440,
    height: 900,
    contentTop: 261,
    textRight: 570,
    headerHeight: 121,
  };
  const share = (morph, [w]) => {
    const layout = heroLayout({...laptop, morph});
    const pixelsPerUnit =
      laptop.height / (2 * layout.distance * Math.tan(Math.PI / 8));
    return (
      (w * layout.scale * pixelsPerUnit) /
      (layout.rect.right - layout.rect.left)
    );
  };
  // The dumbbell keeps its 83% share; the logo and runner fill up to 93%.
  assert.ok(share(0, [4.1]) <= 0.83 + 1e-9);
  assert.ok(share(1, [4.9]) > 0.88 && share(1, [4.9]) <= 0.93 + 1e-9);
  // Phones: every particle, and the logo fills up to 96% of its space.
  for (const tier of ['medium', 'high']) {
    const phone = heroQuality(390, 844, tier);
    assert.equal(phone.count, phone.capacity);
  }
  const small = {
    width: 390,
    height: 844,
    contentTop: 440,
    textRight: 370,
    headerHeight: 163,
  };
  const logo = heroLayout({...small, morph: 1});
  const pixelsPerUnit =
    small.height / (2 * logo.distance * Math.tan(Math.PI / 8));
  const logoShare =
    (4.9 * logo.scale * pixelsPerUnit) / (logo.rect.right - logo.rect.left);
  assert.ok(logoShare > 0.9 && logoShare <= 0.96 + 1e-9);
});
