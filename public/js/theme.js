// Runs in <head>, before the page paints. Nexthlon has one look, the dark (obsidian) theme: there is
// no light mode or theme switch any more. tokens.css reads <html data-theme="dark">, so it is set
// here before anything shows. A choice saved by the old theme switch is cleared.
(function () {
  "use strict";
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.setAttribute("data-theme-mode", "dark");
  try {
    localStorage.removeItem("nx-theme");
  } catch {
    /* storage blocked: nothing saved anyway */
  }
})();
