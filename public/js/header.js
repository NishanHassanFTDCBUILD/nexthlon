// Header: live search suggestions and the phone menu drawer.
// The category mega-menu and the account menu use the shared [data-menu] code in app.js.
(function () {
  "use strict";

  // ---------- Phone menu drawer (a <dialog>: the browser keeps focus inside and handles Escape) ----------
  document.querySelectorAll("[data-drawer-open]").forEach(opener => {
    const drawer = document.getElementById(opener.dataset.drawerOpen);
    if (!drawer || typeof drawer.showModal !== "function") return;
    opener.addEventListener("click", () => {
      drawer.showModal();
      opener.setAttribute("aria-expanded", "true");
      document.body.classList.add("drawer-open");
    });
    drawer.addEventListener("close", () => {
      opener.setAttribute("aria-expanded", "false");
      document.body.classList.remove("drawer-open");
    });
    // A click on the dimmed backdrop lands on the dialog itself, outside its content.
    drawer.addEventListener("click", event => {
      if (event.target === drawer) drawer.close();
    });
    drawer.querySelectorAll("[data-drawer-close]").forEach(button => button.addEventListener("click", () => drawer.close()));
    window.matchMedia("(min-width: 1025px)").addEventListener("change", event => {
      if (event.matches && drawer.open) drawer.close();
    });
  });

  // ---------- Live search suggestions ----------
  const form = document.querySelector("[data-search]");
  const input = form && form.querySelector('input[name="q"]');
  const box = form && form.querySelector("[data-suggest]");
  if (!form || !input || !box) return;

  const list = box.querySelector("[data-suggest-list]");
  const status = box.querySelector("[data-suggest-status]");
  const category = form.querySelector('select[name="category"]');
  const DEBOUNCE_MS = 250;
  const MAX_SUGGESTIONS = 6;
  let timer = 0;
  let controller = null;
  let options = [];
  let active = -1;

  function open() {
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function close() {
    clearTimeout(timer);
    if (controller) controller.abort();
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function setStatus(text, tone = "") {
    status.textContent = text;
    status.className = `suggest-status${tone ? ` is-${tone}` : ""}`;
  }

  function highlight(target, text, query) {
    // Bold the typed text inside the product name, built from text nodes so nothing is read as HTML.
    const at = text.toLowerCase().indexOf(query.toLowerCase());
    if (at < 0) {
      target.textContent = text;
      return;
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + query.length);
    target.append(text.slice(0, at), mark, text.slice(at + query.length));
  }

  function option(id, href) {
    const item = document.createElement("li");
    item.id = id;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", "false");
    const link = document.createElement("a");
    link.href = href;
    link.tabIndex = -1;
    item.append(link);
    return { item, link };
  }

  function render(products, query) {
    list.replaceChildren();
    options = [];
    active = -1;
    input.removeAttribute("aria-activedescendant");

    products.slice(0, MAX_SUGGESTIONS).forEach((product, index) => {
      const { item, link } = option(`suggest-${index}`, `/products/${encodeURIComponent(product.slug)}`);
      link.className = "suggest-item";
      const img = document.createElement("img");
      img.alt = "";
      img.width = 44;
      img.height = 44;
      img.loading = "lazy";
      if (/^(\/|https:\/\/)/.test(product.image || "")) img.src = product.image;
      const text = document.createElement("span");
      text.className = "suggest-text";
      const name = document.createElement("span");
      name.className = "suggest-name";
      highlight(name, product.name, query);
      const meta = document.createElement("span");
      meta.className = "suggest-meta";
      meta.textContent = `${product.category} · ${Nx.formatPrice(product.price)}`;
      text.append(name, meta);
      link.append(img, text);
      list.append(item);
      options.push(item);
    });

    const params = new URLSearchParams({ q: query });
    if (category && category.value) params.set("category", category.value);
    const { item, link } = option("suggest-all", `/products?${params}`);
    link.className = "suggest-all";
    link.textContent = `See all results for "${query}"`;
    list.append(item);
    options.push(item);

    setStatus(products.length
      ? `${Math.min(products.length, MAX_SUGGESTIONS)} suggestions. Use the up and down arrows to choose.`
      : `No products match "${query}". Press Enter to search anyway.`, products.length ? "" : "empty");
    open();
  }

  async function lookup(query) {
    if (controller) controller.abort();
    controller = new AbortController();
    const params = new URLSearchParams({ q: query });
    if (category && category.value) params.set("category", category.value);
    list.replaceChildren();
    options = [];
    setStatus("Searching…", "loading");
    open();
    try {
      const response = await fetch(`/api/products/search?${params}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("search failed");
      const data = await response.json();
      if (input.value.trim() !== query) return;
      render(Array.isArray(data.products) ? data.products : [], query);
    } catch (error) {
      if (error.name === "AbortError") return;
      setStatus("Suggestions are not available right now. Press Enter to search.", "error");
    }
  }

  function move(step) {
    if (box.hidden || !options.length) return;
    if (active >= 0) options[active].setAttribute("aria-selected", "false");
    active = (active + step + options.length) % options.length;
    const current = options[active];
    current.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", current.id);
    current.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) {
      close();
      return;
    }
    timer = setTimeout(() => lookup(query), DEBOUNCE_MS);
  });

  input.addEventListener("keydown", event => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (box.hidden && input.value.trim().length >= 2) {
        lookup(input.value.trim());
        return;
      }
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && active >= 0 && !box.hidden) {
      event.preventDefault();
      window.location.assign(options[active].querySelector("a").href);
    } else if (event.key === "Escape" && !box.hidden) {
      event.preventDefault();
      close();
    }
  });

  if (category) category.addEventListener("change", () => {
    if (input.value.trim().length >= 2) lookup(input.value.trim());
  });

  // Keep the cursor in the search box while a suggestion is clicked.
  list.addEventListener("pointerdown", event => event.preventDefault());
  form.addEventListener("focusout", event => {
    if (!form.contains(event.relatedTarget)) close();
  });
  document.addEventListener("click", event => {
    if (!form.contains(event.target)) close();
  });
  form.addEventListener("submit", close);
})();
