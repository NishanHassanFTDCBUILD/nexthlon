// Runs in <head>, before the page paints: applies the theme the visitor picked (light, dark or
// system), so the page never flashes the wrong colours. Also offers window.NxTheme to switch it:
// the choice is saved in localStorage, and the colours fade over (tokens.css, theme-switching).
(function () {
  "use strict";

  const root = document.documentElement;
  const KEY = "nx-theme";
  const MODES = ["system", "light", "dark"];
  let timer = 0;

  function read() {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system"; // storage blocked: follow the system setting
    }
  }

  function apply(mode) {
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    root.setAttribute("data-theme-mode", mode);
  }

  apply(read());

  window.NxTheme = {
    MODES,
    get: read,
    // The colours actually showing: "light" or "dark".
    resolved() {
      const mode = read();
      if (mode !== "system") return mode;
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    },
    set(mode) {
      if (!MODES.includes(mode)) return;
      root.classList.add("theme-switching");
      apply(mode);
      try {
        if (mode === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, mode);
      } catch {
        /* the theme still changes for this page */
      }
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("theme-switching"), 420);
      document.dispatchEvent(new CustomEvent("nx:theme", { detail: { mode } }));
    },
    // System → Light → Dark → System
    next() {
      const mode = read();
      this.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    }
  };
})();
