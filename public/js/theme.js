// Runs in <head>, before the page paints: applies the light/dark theme the visitor picked.
// With no saved choice nothing is set, and tokens.css follows the system setting.
(function () {
  "use strict";
  try {
    const saved = localStorage.getItem("nx-theme");
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  } catch {
    /* storage blocked: the system setting is used */
  }
})();
