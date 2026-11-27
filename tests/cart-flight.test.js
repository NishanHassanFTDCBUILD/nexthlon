const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function store({native = false} = {}) {
  const appended = [];
  const frames = new Set();
  const requests = [];
  const animations = [];
  const listeners = new Map();
  const classes = () => ({add() {}, remove() {}, contains: () => false});
  const element = () => ({
    style: {},
    classList: classes(),
    setAttribute() {},
    append() {},
    ...(native
      ? {
          animate(keyframes) {
            let finish;
            const animation = {
              keyframes,
              currentTime: 0,
              finished: new Promise((resolve) => {
                finish = resolve;
              }),
              cancel() {},
              play() {},
              finish: () => finish(),
            };
            animations.push(animation);
            return animation;
          },
        }
      : {}),
    remove() {
      appended.splice(appended.indexOf(this), 1);
    },
  });
  const header = {dataset: {shopper: 'customer'}};
  const icon = {
    ...element(),
    closest: () => null,
    getClientRects: () => [1],
    getBoundingClientRect: () => ({left: 340, top: 20, width: 24, height: 24}),
  };
  const document = {
    cookie: '',
    readyState: 'loading',
    querySelector: (selector) =>
      selector === '[data-site-header]'
        ? header
        : selector === '[data-cart-link] .cart-icon'
          ? icon
          : null,
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    createElement: element,
    body: {append: (node) => appended.push(node)},
  };
  const Nx = {
    motionMs: () => 700,
    motionEase: () => 'ease',
    api: async (url, options) => {
      requests.push({url, options});
      return {cart: {summary: {count: 1}, items: []}, message: 'Added'};
    },
    setCartCount() {},
    toast() {},
  };
  const window = {
    Nx,
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: () => ({matches: false}),
    requestAnimationFrame() {},
    NxTicker: {
      add: (fn) => {
        frames.add(fn);
        return () => frames.delete(fn);
      },
    },
    addEventListener() {},
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/store.js'), 'utf8'),
    {
      window,
      document,
      setTimeout() {},
      clearTimeout() {},
      localStorage: {getItem: () => null},
    },
  );
  const box = (left, top, width, height) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  const photo = (rect) => ({
    tagName: 'IMG',
    src: '/product.webp',
    getBoundingClientRect: () => rect,
  });
  return {
    Nx,
    appended,
    frames,
    requests,
    photo,
    box,
    classes,
    animations,
    listeners,
  };
}

test('cart flight: a photo above the screen launches from the visible add button', async () => {
  const {Nx, appended, frames, photo, box} = store();
  const button = {getBoundingClientRect: () => box(300, 500, 44, 44)};
  const flight = Nx.startFlight(photo(box(20, -300, 220, 220)), '', button);
  assert.equal(appended.length, 1);
  assert.equal(appended[0].style.left, '294px');
  for (let i = 0; i < 16; i += 1) frames.forEach((fn) => fn(i / 20, 0.05));
  await flight.landed;
  assert.equal(appended.length, 0);
  assert.equal(frames.size, 0);
});

test('cart flight: a partly visible transformed photo launches inside the viewport', () => {
  const {Nx, appended, photo, box} = store();
  Nx.startFlight(photo(box(-500, -800, 700, 1000)));
  assert.equal(appended.length, 1);
  assert.equal(appended[0].style.left, '58px');
  assert.equal(appended[0].style.top, '58px');
});

test('cart flight: an unavailable animation cannot block adding or leave the button disabled', async () => {
  const {Nx, requests, classes} = store();
  Nx.startFlight = () => {
    throw new Error('Animation unavailable');
  };
  const button = {
    classList: classes(),
    setAttribute() {},
    removeAttribute() {},
  };
  const result = await Nx.addToCart({productId: 'test-product', button});
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(button.disabled, false);
});

test('cart flight: native animation reaches the cart even when the shared ticker never runs', async () => {
  const {Nx, appended, animations, photo, box} = store({native: true});
  const flight = Nx.startFlight(photo(box(20, 200, 220, 220)));
  assert.equal(appended.length, 1);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].keyframes.length, 41);
  assert.notEqual(
    animations[0].keyframes[0].transform,
    animations[0].keyframes[40].transform,
  );
  animations[0].finish();
  await flight.landed;
  assert.equal(appended.length, 0);
});

test('cart flight: a rejected add reverses the native flight and cleans it up', async () => {
  const {Nx, appended, animations, photo, box} = store({native: true});
  const flight = Nx.startFlight(photo(box(20, 200, 220, 220)));
  flight.abort();
  assert.ok(animations[0].playbackRate < 0);
  animations[0].finish();
  await flight.landed;
  assert.equal(appended.length, 0);
});

test('cart flight: showroom quick-add is active without loading the 3D module', () => {
  const {Nx, listeners} = store();
  const calls = [];
  Nx.addToCart = (options) => calls.push(options);
  const photo = {currentSrc: '/tent.webp'};
  const card = {
    dataset: {id: 'tent-id'},
    querySelector: (selector) =>
      selector === 'img'
        ? photo
        : {getAttribute: () => '/products/all-terrain-expedition-tent'},
  };
  const button = {dataset: {}, closest: () => card};
  const target = {
    closest: (selector) => (selector.includes('[data-zg-add]') ? button : null),
  };
  let prevented = false;
  for (const listener of listeners.get('click'))
    listener({target, preventDefault: () => (prevented = true)});
  assert.equal(prevented, true);
  assert.equal(calls.length, 1, 'one click produces exactly one add');
  assert.equal(calls[0].productId, 'tent-id');
  assert.equal(calls[0].source, photo);
  assert.equal(calls[0].src, '/tent.webp');
  assert.equal(calls[0].href, '/products/all-terrain-expedition-tent');
});

test('cart flight: a successful add plays the entire flight after confirmation and before the badge update', async () => {
  const {Nx} = store();
  const events = [];
  let confirm;
  let land;
  Nx.api = () => new Promise((resolve) => (confirm = resolve));
  Nx.startFlight = () => {
    events.push('flight');
    return {landed: new Promise((resolve) => (land = resolve)), abort() {}};
  };
  Nx.setCartCount = () => events.push('badge');
  const pending = Nx.addToCart({productId: 'tent-id'});
  assert.deepEqual(
    events,
    [],
    'a pending or rejected add cannot look successful',
  );
  confirm({cart: {summary: {count: 1}, items: []}, message: 'Added'});
  await new Promise(setImmediate);
  assert.deepEqual(events, ['flight']);
  land();
  assert.equal((await pending).ok, true);
  assert.deepEqual(events, ['flight', 'badge']);
});

test('cart flight: rejected products show the exact reason on the card and never launch a false flight', async () => {
  for (const code of [
    'cart_limit',
    'option_required',
    'out_of_stock',
    'invalid_input',
  ]) {
    const {Nx, classes} = store();
    let launched = false;
    let note;
    const host = {
      querySelector: () => note,
      append: (node) => (note = node),
    };
    const button = {
      closest: () => host,
      classList: classes(),
      setAttribute() {},
      removeAttribute() {},
    };
    Nx.startFlight = () => {
      launched = true;
    };
    const error = Object.assign(new Error(`Cannot add: ${code}`), {code});
    Nx.api = async () => {
      throw error;
    };
    const result = await Nx.addToCart({productId: 'boot-id', button});
    assert.equal(result.ok, false);
    assert.equal(launched, false);
    assert.equal(note.textContent, error.message);
    assert.equal(note.hidden, false);
    assert.equal(button.disabled, false);
  }
});
