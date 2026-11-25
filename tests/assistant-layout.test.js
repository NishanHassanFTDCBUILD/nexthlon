const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('assistant keeps its input above the visual keyboard and restores launcher focus on close', () => {
  function element() {
    return {
      events: {},
      attrs: {},
      styles: {},
      addEventListener(name, handler) {
        this.events[name] = handler;
      },
      setAttribute(name, value) {
        this.attrs[name] = value;
      },
      focus(options) {
        this.focusOptions = options;
        this.focused = true;
      },
    };
  }
  const panel = element();
  panel.hidden = true;
  panel.style = {
    setProperty: (name, value) => {
      panel.styles[name] = value;
    },
  };
  panel.querySelectorAll = () => [];
  const launcher = element();
  const input = element();
  const closer = element();
  const form = element();
  const log = element();
  const nodes = {
    '[data-assistant-log]': log,
    '[data-assistant-form]': form,
    '#assistant-input': input,
    '[data-assistant-close]': closer,
  };
  panel.querySelector = (selector) => nodes[selector];
  const viewport = {
    height: 800,
    offsetTop: 0,
    events: {},
    addEventListener(name, handler) {
      this.events[name] = handler;
    },
  };
  const window = {
    innerHeight: 800,
    visualViewport: viewport,
    events: {},
    addEventListener(name, handler) {
      this.events[name] = handler;
    },
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, '../public/js/assistant.js'), 'utf8'),
    {
      window,
      document: {
        getElementById: () => panel,
        querySelector: () => launcher,
        addEventListener() {},
      },
    },
  );

  launcher.events.click();
  assert.equal(panel.hidden, false);
  assert.equal(launcher.attrs['aria-expanded'], 'true');
  assert.equal(panel.styles['--assistant-viewport-height'], '800px');
  assert.equal(panel.styles['--assistant-keyboard-offset'], '0px');
  assert.equal(input.focusOptions.preventScroll, true);

  viewport.height = 430;
  viewport.events.resize();
  assert.equal(panel.styles['--assistant-keyboard-offset'], '370px');
  viewport.offsetTop = 20;
  viewport.events.scroll();
  assert.equal(panel.styles['--assistant-keyboard-offset'], '350px');

  window.innerHeight = 400;
  viewport.height = 400;
  viewport.offsetTop = 0;
  window.events.resize();
  assert.equal(panel.styles['--assistant-keyboard-offset'], '0px');
  assert.equal(panel.styles['--assistant-viewport-height'], '400px');
  closer.events.click();
  assert.equal(panel.hidden, true);
  assert.equal(launcher.attrs['aria-expanded'], 'false');
  assert.equal(launcher.focused, true);
});
