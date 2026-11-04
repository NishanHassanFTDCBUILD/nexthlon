// Runs in <head>, before the page paints: applies the theme the visitor picked, so the page never
// flashes the wrong colours. Dark (obsidian) is the default. "System" follows the device setting.
// <html data-theme> is always "dark" or "light" (what tokens.css reads); data-theme-mode is the
// choice itself, for the toggle icon. Also offers window.NxTheme to switch it: the choice is saved
// in localStorage and the colours fade over (tokens.css, theme-switching).
(function () {
  "use strict";

  const root = document.documentElement;
  const KEY = "nx-theme";
  const MODES = ["dark", "light", "system"];
  const systemLight = window.matchMedia("(prefers-color-scheme: light)");
  let timer = 0;

  function read() {
    try {
      const saved = localStorage.getItem(KEY);
      return MODES.includes(saved) ? saved : "dark";
    } catch {
      return "dark"; // storage blocked: the default theme
    }
  }

  function resolve(mode) {
    if (mode === "system") return systemLight.matches ? "light" : "dark";
    return mode;
  }

  function apply(mode) {
    root.setAttribute("data-theme", resolve(mode));
    root.setAttribute("data-theme-mode", mode);
  }

  apply(read());
  // On "System", follow the device when it switches between light and dark.
  systemLight.addEventListener("change", () => {
    if (read() === "system") apply("system");
  });

  window.NxTheme = {
    MODES,
    get: read,
    // The colours actually showing: "light" or "dark".
    resolved() {
      return resolve(read());
    },
    set(mode) {
      if (!MODES.includes(mode)) return;
      root.classList.add("theme-switching");
      apply(mode);
      try {
        localStorage.setItem(KEY, mode);
      } catch {
        /* the theme still changes for this page */
      }
      clearTimeout(timer);
      timer = setTimeout(() => root.classList.remove("theme-switching"), 420);
      document.dispatchEvent(new CustomEvent("nx:theme", { detail: { mode } }));
    },
    // Dark → Light → System → Dark
    next() {
      const mode = read();
      this.set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
    }
  };
})();
