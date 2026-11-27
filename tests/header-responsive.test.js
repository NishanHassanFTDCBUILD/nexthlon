const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('open search releases the phone scroll lock when resized to a laptop and restores it on return', () => {
  function element() {
    const classes = new Set();
    return {
      hidden: false,
      value: 'running',
      events: {},
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        contains: (name) => classes.has(name),
        toggle(name, on) {
          if (on) classes.add(name);
          else classes.delete(name);
        },
      },
      addEventListener(name, handler) {
        this.events[name] = handler;
      },
      setAttribute() {},
      removeAttribute() {},
      replaceChildren() {},
    };
  }
  const input = element();
  const box = element();
  box.hidden = true;
  const list = element();
  const status = element();
  const form = element();
  const root = element();
  const scrim = element();
  box.querySelector = (selector) =>
    selector === '[data-suggest-list]' ? list : status;
  form.querySelector = (selector) => {
    if (selector === 'input[name="q"]') return input;
    if (selector === '[data-suggest]') return box;
    return null;
  };
  const phone = {
    matches: true,
    addEventListener(_name, callback) {
      this.change = callback;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/header.js'), 'utf8'),
    {
      document: {
        querySelectorAll: () => [],
        querySelector: () => form,
        createElement: () => scrim,
        body: {append() {}},
        documentElement: root,
        addEventListener() {},
      },
      window: {matchMedia: () => phone},
      Nx: {},
      AbortController,
      URLSearchParams,
      fetch: () => new Promise(() => {}),
      requestAnimationFrame: (callback) => callback(),
      setTimeout: () => 1,
      clearTimeout() {},
    },
  );
  input.events.keydown({key: 'ArrowDown', preventDefault() {}});
  assert.equal(box.hidden, false);
  assert.equal(root.classList.contains('search-sheet-open'), true);
  assert.equal(form.classList.contains('is-sheet'), true);
  assert.equal(scrim.hidden, true);

  phone.matches = false;
  phone.change();
  assert.equal(root.classList.contains('search-sheet-open'), false);
  assert.equal(form.classList.contains('is-sheet'), false);
  assert.equal(scrim.hidden, false);
  assert.equal(scrim.classList.contains('is-on'), true);

  phone.matches = true;
  phone.change();
  assert.equal(root.classList.contains('search-sheet-open'), true);
  assert.equal(form.classList.contains('is-sheet'), true);
  assert.equal(scrim.hidden, true);
  assert.equal(scrim.classList.contains('is-on'), false);

  input.events.keydown({key: 'Escape', preventDefault() {}});
  assert.equal(box.hidden, true);
  assert.equal(root.classList.contains('search-sheet-open'), false);
});
