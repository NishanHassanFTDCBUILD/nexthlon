// Home page (classic script): the flip-digit "Deals of the day" countdown and the deal flip cards.
// The 3D scenes live in home3d.js. Without this file the countdown
// shows the time at page load and each deal card shows its offer on hover or focus.
(function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Hero starts behind the header ----------
  // style.css pulls the hero up by --hero-pull on wider screens; this keeps it equal to the
  // header's real height, which changes with the screen size.
  const header = document.querySelector('.site-header');
  if (header) {
    const setPull = () =>
      document.documentElement.style.setProperty(
        '--hero-pull',
        `${header.offsetHeight}px`,
      );
    setPull();
    if ('ResizeObserver' in window) new ResizeObserver(setPull).observe(header);
    else window.addEventListener('resize', setPull);
  }

  // ---------- Flip-digit countdown ----------
  const countdown = document.querySelector('[data-countdown]');
  if (countdown) {
    // The end time itself, not "time left when the page was made": a CDN may hand out a copy of this page
    // made a minute ago (middleware/publicCache.js).
    const ends =
      Date.parse(countdown.dataset.ends) ||
      Date.now() + Number(countdown.dataset.left || 0);
    const boxes = {
      h: countdown.querySelector('[data-countdown-h]'),
      m: countdown.querySelector('[data-countdown-m]'),
      s: countdown.querySelector('[data-countdown-s]'),
    };
    const pad = (n) => String(n).padStart(2, '0');
    // Each changed number flips down like a departure board (motion.css .is-flipping).
    const set = (box, value) => {
      if (!box || box.dataset.value === value) return;
      box.dataset.value = value;
      box.textContent = value;
      if (reduced.matches) return;
      box.classList.remove('is-flipping');
      void box.offsetWidth;
      box.classList.add('is-flipping');
    };
    const tick = () => {
      const left = Math.max(0, ends - Date.now());
      set(boxes.h, pad(Math.floor(left / 3600000)));
      set(boxes.m, pad(Math.floor(left / 60000) % 60));
      set(boxes.s, pad(Math.floor(left / 1000) % 60));
      if (left === 0) {
        clearInterval(timer);
        countdown.setAttribute(
          'aria-label',
          "Today's deals have ended. New deals are coming.",
        );
      }
    };
    const timer = setInterval(tick, 1000);
    tick();
  }

  // ---------- Deal flip cards ----------
  // Hover or keyboard focus turns a card (CSS); the button turns it on touch screens.
  document.querySelectorAll('[data-flip-card]').forEach((card) => {
    const toggle = card.querySelector('[data-flip-toggle]');
    if (!toggle) return;
    toggle.addEventListener('click', () => {
      const flipped = card.classList.toggle('is-flipped');
      toggle.setAttribute('aria-expanded', String(flipped));
      if (flipped) {
        const action = card.querySelector('.flip-back .btn, .flip-back a');
        if (action) action.focus({preventScroll: true});
      }
    });
    // On a touch screen there is no hover: a tap anywhere on the card turns it (not only the small
    // button), and a tap on an empty part of the back turns it back. Links and buttons keep their own job.
    card.addEventListener('click', (event) => {
      if (
        event.target.closest('a, button') ||
        window.matchMedia('(hover: hover)').matches
      )
        return;
      toggle.click();
    });
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && card.classList.contains('is-flipped')) {
        card.classList.remove('is-flipped');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  });

  // Adding a deal to the cart is the shared [data-cart-add] button (store.js).
})();
