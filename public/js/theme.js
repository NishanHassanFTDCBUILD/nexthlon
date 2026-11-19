// Runs in <head>, before the page paints. Nexthlon has one look, the dark (obsidian) theme: there is
// no light mode or theme switch any more. tokens.css reads <html data-theme="dark">, so it is set
// here before anything shows. A choice saved by the old theme switch is cleared.
(function () {
  'use strict';
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-theme-mode', 'dark');
  // "JavaScript is on", set before the first paint: layouts that JavaScript changes (the phone
  // filter sheet) use it, so the page never draws one layout and then jumps to another.
  document.documentElement.classList.add('js');
  // "The 3D scenes will run" (the same test as 3d/interaction.js: motion allowed, not saving data).
  // The home hero is a tall pinned section when its scene runs; knowing that before the first paint
  // means the page is drawn at its final height, instead of jumping when the scene starts later.
  try {
    const connection = navigator.connection || {};
    const lessData =
      connection.saveData ||
      connection.effectiveType === '2g' ||
      connection.effectiveType === 'slow-2g' ||
      window.matchMedia('(prefers-reduced-data: reduce)').matches;
    if (
      !lessData &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      document.documentElement.classList.add('will-3d');
  } catch {
    /* no matchMedia: no 3D either */
  }
  try {
    localStorage.removeItem('nx-theme');
  } catch {
    /* storage blocked: nothing saved anyway */
  }
})();
