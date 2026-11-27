const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('video shares the photo stage, pauses on exit, and restores the selected photo', () => {
  const element = (dataset = {}) => ({
    dataset,
    hidden: false,
    attrs: {},
    listeners: {},
    addEventListener(name, fn) {
      this.listeners[name] = fn;
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attrs, name);
    },
    getAttribute(name) {
      return this.attrs[name];
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
  });
  const photo = element({src: '/photo.webp'});
  photo.attrs['aria-current'] = 'true';
  const clip = element();
  clip.attrs['data-video-thumb'] = '';
  const classes = new Set();
  const stage = element();
  stage.classList = {
    contains: (name) => classes.has(name),
    toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
  };
  const main = element();
  main.src = '/photo.webp';
  main.closest = () => stage;
  const video = element();
  video.hidden = true;
  video.pause = () => {
    video.pauses = (video.pauses || 0) + 1;
  };
  const gallery = {
    querySelector: (selector) =>
      ({
        '[data-gallery-main]': main,
        '[data-gallery-video]': video,
      })[selector] || null,
    querySelectorAll: (selector) =>
      selector === '.thumb' ? [photo, clip] : [],
  };
  const source = fs.readFileSync(
    require.resolve('../public/js/catalog.js'),
    'utf8',
  );
  const section = source.slice(
    source.indexOf("  document.querySelectorAll('[data-gallery]')"),
  );
  vm.runInNewContext('(function(){' + section, {
    document: {querySelectorAll: () => [gallery]},
    window: {matchMedia: () => ({matches: true})},
  });
  clip.listeners.click();
  assert.equal(video.hidden, false);
  assert.equal(main.hidden, true);
  assert.equal(main.src, '/photo.webp');
  assert.equal(classes.has('is-video'), true);
  assert.equal(clip.attrs['aria-current'], 'true');
  photo.listeners.click();
  assert.equal(video.hidden, true);
  assert.equal(main.hidden, false);
  assert.equal(classes.has('is-video'), false);
  assert.equal(video.pauses, 2);
  assert.equal(photo.attrs['aria-current'], 'true');
});
