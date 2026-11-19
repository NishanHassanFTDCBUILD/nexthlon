// Page transitions, the arriving side (C1). Loaded in <head> without defer, because "pagereveal" fires
// just before the new page's first frame, which is when its half of a cross-document View Transition is
// decided. (The leaving side, a card's photo flowing into the product page, is in app.js on "pageswap".)
//
// Going BACK (or forward through history): the transition gets the type "back", so motion.css plays it
// the other way round. And when the page left behind was a product page, the card for that product
// takes the photo's name here, so the big photo flows back into its card.
// Browsers without View Transitions or the Navigation API ignore all of this and change page normally.
(function () {
  'use strict';

  // A transition the browser cancels (the other page has no transitions, as My Account and the admin
  // console do, or the page was already shown) rejects its promises: expected, not errors. They are
  // silenced here, in <head>, for BOTH sides of every page change. app.js does the same on "pageswap",
  // but it loads deferred, so a click before it has run used to leave "Uncaught (in promise)
  // InvalidStateError: Transition was aborted" in the console.
  const quiet = (transition) => {
    if (transition)
      ['ready', 'updateCallbackDone', 'finished'].forEach(
        (name) => transition[name] && transition[name].catch(() => {}),
      );
  };
  if ('onpageswap' in window)
    window.addEventListener('pageswap', (event) => quiet(event.viewTransition));
  if ('onpagereveal' in window)
    window.addEventListener('pagereveal', (event) =>
      quiet(event.viewTransition),
    );

  if (!('onpagereveal' in window) || !window.navigation) return;

  window.addEventListener('pagereveal', (event) => {
    const transition = event.viewTransition;
    const activation = window.navigation.activation;
    if (
      !transition ||
      !activation ||
      activation.navigationType !== 'traverse' ||
      !activation.from
    )
      return;

    const back = activation.from.index > activation.entry.index;
    if (transition.types) transition.types.add(back ? 'back' : 'forward');

    // Which product page did we come from? Only our own product pages count.
    let from;
    try {
      from = new URL(activation.from.url);
    } catch {
      return;
    }
    if (
      from.origin !== window.location.origin ||
      !/^\/products\/[^/]+$/.test(from.pathname)
    )
      return;

    // The card that links to it, if it is on this page (the list may have changed or scrolled away).
    const link = document.querySelector(
      `a[href="${CSS.escape(from.pathname)}"]`,
    );
    const card =
      link &&
      link.closest(
        '.product-card, .zg-card, .rail-card, .wish-card, [data-product-card]',
      );
    const photo = card && card.querySelector('img');
    if (!photo) return;
    // Only one element may carry the name: this page's own big photo (a related product) gives it up.
    document.querySelectorAll('.pdx-photo').forEach((img) => {
      img.style.viewTransitionName = 'none';
    });
    photo.style.viewTransitionName = 'product-photo';
    // A transition the browser cancels (the other page has none) rejects: give the name up either way.
    const clear = () => {
      photo.style.viewTransitionName = '';
    };
    transition.finished.then(clear, clear);
  });
})();
