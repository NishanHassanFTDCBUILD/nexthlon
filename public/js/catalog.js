// Product list filters, the phone filter drawer, and the product photo gallery.
//
// Architecture: ONE filter state object is the single source of truth. It is read from the URL on
// load, every change patches it, and it is written straight back to the URL — so a refresh, the
// Back button and a shared link all give the same page. Render functions only ever read from the
// state; nothing scrapes values back out of the DOM.
//
// Without JavaScript the same markup is an ordinary GET form, so the server-rendered catalogue is
// the complete fallback.
(function () {
  "use strict";

  const results = document.querySelector("[data-results]");
  const catalog = document.querySelector("[data-catalog]");
  const filterForm = document.querySelector("[data-filter-form]");
  const resultsContent = document.querySelector("[data-results-content]");
  const resultsSummary = document.querySelector("[data-results-summary]");
  const resultsHeading = document.getElementById("results-heading");
  const chipList = document.querySelector("[data-active-chips]");
  const toolbarHint = document.querySelector(".toolbar-hint");

  // ---------- The filter state ----------

  const DEFAULTS = {
    q: "", category: "", brands: [], min: null, max: null,
    discount: 0, rating: 0, inStock: false, sort: "relevance", view: "grid", page: 1
  };
  const SORTS = ["relevance", "price_asc", "price_desc", "newest", "rating", "discount", "name_asc"];
  // The server validates all of this again (services/productService.js readFilters); these checks
  // only keep a hand-typed URL from putting nonsense on screen before the answer comes back.
  // null when the value is missing or empty — Number(null) and Number("") are both 0, which would
  // otherwise turn "no price given" into "price 0" and put ?min=0 in every URL.
  const whole = (value, max) => {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const oneOf = (value, allowed, fallback) => (allowed.includes(Number(value)) ? Number(value) : fallback);

  let state = { ...DEFAULTS };
  // Set by the price-slider block below; renderControls() calls it once it exists.
  let paintPrice = null;

  function readState(search) {
    const params = new URLSearchParams(search);
    const next = {
      ...DEFAULTS,
      q: (params.get("q") || "").trim().slice(0, 80),
      category: (params.get("category") || "").trim().toLowerCase().slice(0, 80),
      brands: [...new Set(params.getAll("brand").map(name => name.trim()).filter(Boolean))].slice(0, 20),
      min: whole(params.get("min"), 10000000),
      max: whole(params.get("max"), 10000000),
      discount: oneOf(params.get("discount"), [10, 20, 30, 40, 50], 0),
      rating: oneOf(params.get("rating"), [4, 3, 2], 0),
      inStock: params.get("inStock") === "1" || params.get("inStock") === "true",
      sort: SORTS.includes(params.get("sort")) ? params.get("sort") : "relevance",
      view: params.get("view") === "list" ? "list" : "grid",
      page: whole(params.get("page"), 10000) || 1
    };
    // A back-to-front range is simply swapped, as the server does.
    if (next.min !== null && next.max !== null && next.min > next.max) [next.min, next.max] = [next.max, next.min];
    return next;
  }

  // The state as a query string. Defaults are left out, so the URL stays short and shareable.
  function toQuery(from = state) {
    const query = new URLSearchParams();
    if (from.q) query.set("q", from.q);
    if (from.category) query.set("category", from.category);
    from.brands.forEach(brand => query.append("brand", brand));
    if (from.min !== null) query.set("min", String(from.min));
    if (from.max !== null) query.set("max", String(from.max));
    if (from.discount) query.set("discount", String(from.discount));
    if (from.rating) query.set("rating", String(from.rating));
    if (from.inStock) query.set("inStock", "1");
    if (from.sort !== "relevance") query.set("sort", from.sort);
    if (from.view === "list") query.set("view", "list");
    if (from.page > 1) query.set("page", String(from.page));
    return query;
  }

  const urlFor = from => {
    const search = toQuery(from).toString();
    return `/products${search ? `?${search}` : ""}`;
  };
  // The link that removes one filter: a copy of the state with that part cleared.
  const without = patch => urlFor({ ...state, ...patch, page: 1 });

  // How many filters are on, for the badges. Sort, view, page and the search box are not filters.
  const activeCount = () =>
    (state.category ? 1 : 0) + state.brands.length + (state.min !== null ? 1 : 0) + (state.max !== null ? 1 : 0) +
    (state.discount ? 1 : 0) + (state.rating ? 1 : 0) + (state.inStock ? 1 : 0) + (state.q ? 1 : 0);

  // ---------- Reading the controls ----------

  // One place that turns a changed control into a state patch, so no other code reads the DOM.
  function patchFromControl(field) {
    switch (field.name) {
      case "category": return { category: field.value };
      case "discount": return { discount: Number(field.value) || 0 };
      case "rating": return { rating: Number(field.value) || 0 };
      case "inStock": return { inStock: field.checked };
      case "sort": return { sort: SORTS.includes(field.value) ? field.value : "relevance" };
      case "brand": {
        const brands = field.checked
          ? [...new Set([...state.brands, field.value])]
          : state.brands.filter(name => name !== field.value);
        return { brands };
      }
      default: return null;
    }
  }

  // The price boxes are read together, and only when the shopper applies them.
  function pricePatch() {
    const minBox = filterForm.querySelector("[data-price-min]");
    const maxBox = filterForm.querySelector("[data-price-max]");
    let min = minBox.value === "" ? null : whole(minBox.value, 10000000);
    let max = maxBox.value === "" ? null : whole(maxBox.value, 10000000);
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    return { min, max };
  }

  // ---------- Rendering, all of it from the state ----------

  function renderControls() {
    if (!filterForm) return;
    filterForm.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(field => {
      if (field.name === "category") field.checked = field.value === state.category;
      else if (field.name === "brand") field.checked = state.brands.includes(field.value);
      else if (field.name === "discount") field.checked = field.value === (state.discount ? String(state.discount) : "");
      else if (field.name === "rating") field.checked = field.value === (state.rating ? String(state.rating) : "");
      else if (field.name === "inStock") field.checked = state.inStock;
    });
    // The hidden fields keep the no-JavaScript submit carrying the search, sort and layout.
    const hidden = (name, value) => {
      const field = filterForm.querySelector(`input[type=hidden][name="${name}"]`);
      if (field) field.value = value;
    };
    hidden("q", state.q);
    hidden("sort", state.sort === "relevance" ? "" : state.sort);
    hidden("view", state.view === "list" ? "list" : "");

    const minBox = filterForm.querySelector("[data-price-min]");
    const maxBox = filterForm.querySelector("[data-price-max]");
    if (minBox) minBox.value = state.min === null ? "" : state.min;
    if (maxBox) maxBox.value = state.max === null ? "" : state.max;
    if (paintPrice) paintPrice();

    document.querySelectorAll('select[data-filter-field][name="sort"]').forEach(field => { field.value = state.sort; });
    document.querySelectorAll("[data-view-link]").forEach(link => {
      const active = link.dataset.viewLink === state.view;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
      link.href = urlFor({ ...state, view: link.dataset.viewLink, page: 1 });
    });
    // Every group reports whether it is open, for screen readers and for tests.
    document.querySelectorAll("[data-filter-group] > summary").forEach(summary => {
      summary.setAttribute("aria-expanded", String(summary.parentElement.open));
    });

    // A dot (or the number of brands) on each group that holds a choice, so it shows when closed.
    const groupCounts = {
      category: state.category ? 1 : 0,
      price: state.min !== null || state.max !== null ? 1 : 0,
      brand: state.brands.length,
      rating: state.rating ? 1 : 0,
      discount: state.discount ? 1 : 0
    };
    document.querySelectorAll("[data-group-count]").forEach(dot => {
      const count = groupCounts[dot.dataset.groupCount] || 0;
      dot.hidden = count === 0;
      dot.textContent = count > 1 ? String(count) : "";
      dot.classList.toggle("has-num", count > 1);
    });

    // The quick price range that matches the current min and max is shown as chosen.
    document.querySelectorAll("[data-price-preset]").forEach(button => {
      const min = button.dataset.min === "" ? null : Number(button.dataset.min);
      const max = button.dataset.max === "" ? null : Number(button.dataset.max);
      const on = min === state.min && max === state.max;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-pressed", String(on));
    });
  }

  // The label a category chip shows, taken from the radio the server rendered.
  function categoryLabel() {
    const field = filterForm && filterForm.querySelector(`input[name="category"][value="${CSS.escape(state.category)}"]`);
    const text = field && field.parentElement.querySelector("span");
    return text ? text.textContent.trim() : state.category;
  }

  function renderChips() {
    const count = activeCount();
    document.querySelectorAll("[data-filter-count]").forEach(badge => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    document.querySelectorAll("[data-clear-filters]").forEach(link => {
      link.hidden = count === 0;
      link.href = "/products";
    });
    if (toolbarHint) toolbarHint.hidden = count > 0;
    if (!chipList) return;

    const entries = [];
    const add = (label, patch) => entries.push({ label, href: without(patch) });
    if (state.q) add(`“${state.q}”`, { q: "" });
    if (state.category) add(categoryLabel(), { category: "" });
    state.brands.forEach(brand => add(brand, { brands: state.brands.filter(name => name !== brand) }));
    if (state.min !== null) add(`From ₹${state.min.toLocaleString("en-IN")}`, { min: null });
    if (state.max !== null) add(`Up to ₹${state.max.toLocaleString("en-IN")}`, { max: null });
    if (state.rating) add(`${state.rating}★ and up`, { rating: 0 });
    if (state.discount) add(`${state.discount}% off or more`, { discount: 0 });
    if (state.inStock) add("In stock", { inStock: false });

    chipList.replaceChildren(...entries.map(({ label, href }) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "chip";
      link.href = href;
      link.setAttribute("aria-label", `Remove filter: ${label}`);
      link.append(document.createTextNode(`${label} ×`));
      item.append(link);
      return item;
    }));
    if (entries.length) {
      const item = document.createElement("li");
      const clear = document.createElement("a");
      clear.className = "chip chip-clear";
      clear.href = "/products";
      clear.dataset.clearFilters = "";
      clear.textContent = "Clear all";
      item.append(clear);
      chipList.append(item);
    }
    chipList.hidden = entries.length === 0;
  }

  function renderPagination(pagination) {
    const old = resultsContent.querySelector(".pagination");
    if (old) old.remove();
    if (pagination.pages <= 1) return;
    const nav = document.createElement("nav");
    nav.className = "pagination";
    nav.setAttribute("aria-label", "Pages");
    const add = (label, page, className, current) => {
      const link = document.createElement("a");
      link.className = className;
      link.href = urlFor({ ...state, page });
      link.textContent = label;
      if (current) link.setAttribute("aria-current", "page");
      nav.append(link);
    };
    if (pagination.page > 1) add("Previous", pagination.page - 1, "page-step");
    const pages = [...new Set([1, pagination.page - 1, pagination.page, pagination.page + 1, pagination.pages]
      .filter(page => page >= 1 && page <= pagination.pages))];
    pages.forEach((page, index) => {
      if (index && page > pages[index - 1] + 1) {
        const gap = document.createElement("span");
        gap.className = "page-gap";
        gap.textContent = "…";
        nav.append(gap);
      }
      add(String(page), page, `page-num${page === pagination.page ? " is-current" : ""}`, page === pagination.page);
    });
    if (pagination.page < pagination.pages) add("Next", pagination.page + 1, "page-step");
    resultsContent.append(nav);
  }

  function renderCount(pagination) {
    // The live total in the filter panel head and on the phone sheet's "Show N results" button.
    const word = pagination.total === 1 ? "result" : "results";
    document.querySelectorAll("[data-filter-total]").forEach(el => { el.textContent = `${pagination.total} ${word}`; });
    document.querySelectorAll("[data-filter-total-num]").forEach(el => { el.textContent = String(pagination.total); });
    document.querySelectorAll("[data-filter-total-word]").forEach(el => { el.textContent = word; });
    if (!resultsSummary) return;
    resultsSummary.replaceChildren();
    if (!pagination.total) {
      resultsSummary.textContent = "0 results";
      return;
    }
    const first = (pagination.page - 1) * pagination.limit + 1;
    const last = Math.min(pagination.page * pagination.limit, pagination.total);
    const total = document.createElement("strong");
    total.textContent = String(pagination.total);
    resultsSummary.append(`Showing ${first}–${last} of `, total, ` ${pagination.total === 1 ? "result" : "results"}`);
  }

  function renderResults(data) {
    const { products, pagination } = data;
    if (resultsHeading) {
      resultsHeading.textContent = state.q ? `Results for “${state.q}”` : state.category ? categoryLabel() : "All sports gear";
    }
    renderCount(pagination);
    const body = document.createDocumentFragment();
    if (products.length) {
      const grid = document.createElement("div");
      grid.className = `product-grid product-grid-3${state.view === "list" ? " is-list" : ""}`;
      products.forEach(product => grid.append(window.Nx.productCard(product)));
      body.append(grid);
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const title = document.createElement("h2");
      title.textContent = `No gear matches ${state.q ? `“${state.q}”` : "those filters"}`;
      const copy = document.createElement("p");
      copy.textContent = "Check the spelling, try a more general word, or remove a filter.";
      const browse = document.createElement("a");
      browse.className = "btn btn-primary";
      browse.href = "/products";
      browse.textContent = "Browse all gear";
      empty.append(title, copy, browse);
      body.append(empty);
    }
    resultsContent.replaceChildren(body);
    renderPagination(pagination);
    renderChips();
    renderControls();
    if (document.querySelector("[data-wish-link]")) {
      resultsContent.querySelectorAll("[data-wish-id]").forEach(button => { button.hidden = false; });
    }
  }

  // ---------- Loading ----------

  let request = null;
  const setLoading = on => {
    if (!results) return;
    results.classList.toggle("is-loading", on);
    if (on) results.setAttribute("aria-busy", "true");
    else results.removeAttribute("aria-busy");
  };
  // Coming back with the browser's Back button restores the page from cache; clear the busy look.
  window.addEventListener("pageshow", () => setLoading(false));

  async function load({ history = "push", focusResults = false } = {}) {
    if (!filterForm || !resultsContent) return;
    if (request) request.abort();
    const controller = new AbortController();
    request = controller;
    const query = toQuery();
    // The chips, badges and controls follow the state at once, before the answer arrives.
    renderChips();
    renderControls();
    setLoading(true);
    try {
      const response = await fetch(`/api/products${query.toString() ? `?${query}` : ""}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw new Error("Couldn’t update the catalogue.");
      const data = await response.json();
      if (history === "push") window.history.pushState({}, "", urlFor());
      renderResults(data);
      if (focusResults && resultsHeading) resultsHeading.focus({ preventScroll: true });
    } catch (error) {
      if (error.name !== "AbortError" && window.Nx && window.Nx.toast) window.Nx.toast(error.message, "error");
    } finally {
      if (request === controller) {
        request = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }

  // Every change goes through here: patch the state, then reload. A new filter always starts at
  // page 1, because page 7 of the old results means nothing once the filter has changed.
  function apply(patch, { keepPage = false, focusResults = true } = {}) {
    state = { ...state, ...patch };
    if (!keepPage) state.page = 1;
    load({ focusResults });
  }

  // ---------- Events ----------

  if (filterForm) {
    state = readState(window.location.search);

    filterForm.addEventListener("change", event => {
      const patch = patchFromControl(event.target);
      if (patch) apply(patch);
    });
    // The price group applies on its own button (and on Enter inside a price box).
    filterForm.addEventListener("submit", event => {
      event.preventDefault();
      apply(pricePatch());
    });
    document.querySelectorAll("[data-filter-field]").forEach(field => {
      field.addEventListener("change", () => {
        const patch = patchFromControl(field);
        if (patch) apply(patch);
      });
    });
    // Chips, pagination, the view toggle and "Clear all" are real links: their href already holds
    // the state they mean, so the click just reads it back.
    catalog.addEventListener("click", event => {
      const link = event.target.closest(".chip, .pagination a, [data-view-link], [data-clear-filters]");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault();
      state = readState(new URL(link.href, window.location.origin).search);
      load({ focusResults: true });
    });
    window.addEventListener("popstate", () => {
      state = readState(window.location.search);
      load({ history: "none" });
    });
    // Keep the open/closed state of each group reported correctly.
    filterForm.addEventListener("toggle", event => {
      const group = event.target.closest("[data-filter-group]");
      if (group) group.querySelector("summary").setAttribute("aria-expanded", String(group.open));
    }, true);
    renderControls();
  }

  // ---------- Price range slider ----------
  // Two range handles drive the min/max boxes. Only the boxes are read into the state, and a box
  // left at the end of the range is cleared, so the URL stays clean.
  const priceBox = document.querySelector("[data-price-filter]");
  if (priceBox) {
    const slider = priceBox.querySelector("[data-range]");
    const lowRange = priceBox.querySelector("[data-range-min]");
    const highRange = priceBox.querySelector("[data-range-max]");
    const minBox = priceBox.querySelector("[data-price-min]");
    const maxBox = priceBox.querySelector("[data-price-max]");
    const fill = priceBox.querySelector("[data-range-fill]");
    const low = Number(priceBox.dataset.low);
    const high = Number(priceBox.dataset.high);
    const clamp = value => Math.min(Math.max(value, low), high);
    const rupees = value => `₹${Number(value).toLocaleString("en-IN")}`;

    // Draws the filled part of the track and keeps the handles in step with the boxes.
    paintPrice = () => {
      lowRange.value = minBox.value === "" ? low : clamp(Number(minBox.value));
      highRange.value = maxBox.value === "" ? high : clamp(Number(maxBox.value));
      const span = high - low || 1;
      fill.style.setProperty("--from", String((Number(lowRange.value) - low) / span));
      fill.style.setProperty("--to", String((Number(highRange.value) - low) / span));
      lowRange.setAttribute("aria-valuetext", rupees(lowRange.value));
      highRange.setAttribute("aria-valuetext", rupees(highRange.value));
    };
    const fromRanges = moved => {
      if (Number(lowRange.value) > Number(highRange.value)) {
        if (moved === lowRange) lowRange.value = highRange.value;
        else highRange.value = lowRange.value;
      }
      minBox.value = Number(lowRange.value) <= low ? "" : lowRange.value;
      maxBox.value = Number(highRange.value) >= high ? "" : highRange.value;
      paintPrice();
    };
    if (high > low) {
      slider.hidden = false;
      lowRange.addEventListener("input", () => fromRanges(lowRange));
      highRange.addEventListener("input", () => fromRanges(highRange));
      // Letting go of a handle applies the new range.
      [lowRange, highRange].forEach(range => range.addEventListener("change", () => apply(pricePatch())));
      minBox.addEventListener("input", paintPrice);
      maxBox.addEventListener("input", paintPrice);
      paintPrice();
    }
  }

  // ---------- Quick price ranges ----------
  // A preset fills both price boxes and applies them; tapping the chosen one again clears the price.
  if (filterForm) {
    filterForm.addEventListener("click", event => {
      const button = event.target.closest("[data-price-preset]");
      if (!button) return;
      const minBox = filterForm.querySelector("[data-price-min]");
      const maxBox = filterForm.querySelector("[data-price-max]");
      const again = button.classList.contains("is-active");
      minBox.value = again ? "" : button.dataset.min;
      maxBox.value = again ? "" : button.dataset.max;
      if (paintPrice) paintPrice();
      apply(pricePatch());
    });
  }

  // ---------- Brand search and "Show all brands" ----------
  // Only hides and shows the brand rows already on the page; choosing still goes through the state.
  const brandBox = document.querySelector("[data-brand-box]");
  if (brandBox) {
    const list = brandBox.querySelector(".fx-checks");
    const rows = [...brandBox.querySelectorAll("[data-brand-name]")];
    const search = brandBox.querySelector("[data-brand-search]");
    const more = brandBox.querySelector("[data-brand-more]");
    const none = brandBox.querySelector("[data-brand-none]");
    const filterRows = () => {
      const text = search ? search.value.trim().toLowerCase() : "";
      // While searching, every match shows, including the ones normally behind "Show all".
      list.classList.toggle("is-expanded", Boolean(text) || (more && more.getAttribute("aria-expanded") === "true"));
      let shown = 0;
      rows.forEach(row => {
        const match = !text || row.dataset.brandName.includes(text);
        row.classList.toggle("is-filtered-out", !match);
        if (match) shown += 1;
      });
      if (none) none.hidden = shown > 0;
      if (more) more.hidden = Boolean(text);
    };
    if (search) search.addEventListener("input", filterRows);
    if (more) {
      more.addEventListener("click", () => {
        const open = more.getAttribute("aria-expanded") !== "true";
        more.setAttribute("aria-expanded", String(open));
        more.textContent = open ? "Show fewer brands" : `Show all ${rows.length} brands`;
        filterRows();
      });
    }
  }

  // ---------- Filter drawer (phones and small tablets) ----------
  const drawer = document.querySelector("[data-filter-drawer]");
  const openButton = document.querySelector("[data-filter-open]");
  if (catalog && drawer && openButton) {
    // Without this script the filters simply show above the results, so nothing is ever out of reach.
    catalog.classList.add("is-enhanced");
    const backdrop = catalog.querySelector(".drawer-backdrop");
    const small = window.matchMedia("(max-width: 900px)");
    const focusable = () => [...drawer.querySelectorAll("a[href], button, input, select, summary")]
      .filter(el => !el.disabled && el.offsetParent !== null);

    const open = () => {
      drawer.classList.add("is-open");
      backdrop.hidden = false;
      document.body.classList.add("drawer-open");
      openButton.setAttribute("aria-expanded", "true");
      drawer.setAttribute("role", "dialog");
      drawer.setAttribute("aria-modal", "true");
      const first = drawer.querySelector("input:checked") || focusable()[0];
      if (first) first.focus();
    };
    const close = () => {
      if (!drawer.classList.contains("is-open")) return;
      drawer.classList.remove("is-open");
      backdrop.hidden = true;
      document.body.classList.remove("drawer-open");
      openButton.setAttribute("aria-expanded", "false");
      drawer.removeAttribute("role");
      drawer.removeAttribute("aria-modal");
      openButton.focus();
    };

    openButton.addEventListener("click", open);
    catalog.querySelectorAll("[data-filter-close]").forEach(el => el.addEventListener("click", close));
    small.addEventListener("change", close);

    drawer.addEventListener("keydown", event => {
      if (!drawer.classList.contains("is-open")) return;
      if (event.key === "Escape") {
        close();
        return;
      }
      // Keep keyboard focus inside the open drawer.
      if (event.key === "Tab") {
        const list = focusable();
        const first = list[0];
        const last = list[list.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
  }

  // ---------- Zoom on hover ----------
  // Only for a real mouse: on touch screens there is no hover, so the photo stays as it is.
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)");
  document.querySelectorAll("[data-zoom]").forEach(frame => {
    const img = frame.querySelector("img");
    if (!img) return;
    frame.addEventListener("pointermove", event => {
      if (!canHover.matches || event.pointerType !== "mouse") return;
      const box = frame.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * 100;
      const y = ((event.clientY - box.top) / box.height) * 100;
      img.style.transformOrigin = `${x}% ${y}%`;
      frame.classList.add("is-zooming");
    });
    frame.addEventListener("pointerleave", () => frame.classList.remove("is-zooming"));
  });

  // ---------- Product gallery ----------
  document.querySelectorAll("[data-gallery]").forEach(gallery => {
    const main = gallery.querySelector("[data-gallery-main]");
    const thumbs = [...gallery.querySelectorAll(".thumb")];
    const counter = gallery.querySelector("[data-gallery-index]");
    if (!main || !thumbs.length) return;
    let current = Math.max(0, thumbs.findIndex(thumb => thumb.getAttribute("aria-current") === "true"));

    const show = index => {
      current = (index + thumbs.length) % thumbs.length;
      const thumb = thumbs[current];
      // The big photo comes in several sizes: switch its srcset together with its src, or the browser
      // would keep choosing from the previous photo's set.
      if (thumb.dataset.srcset) main.srcset = thumb.dataset.srcset;
      else main.removeAttribute("srcset");
      main.src = thumb.dataset.src;
      thumbs.forEach(other => other.removeAttribute("aria-current"));
      thumb.setAttribute("aria-current", "true");
      if (counter) counter.textContent = String(current + 1);
    };

    thumbs.forEach((thumb, index) => {
      thumb.addEventListener("click", () => show(index));
      thumb.addEventListener("keydown", event => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        show(current + (event.key === "ArrowRight" ? 1 : -1));
        thumbs[current].focus();
      });
    });
    gallery.querySelectorAll("[data-gallery-step]").forEach(button => {
      button.addEventListener("click", () => show(current + Number(button.dataset.galleryStep)));
    });

    // Touch: swipe the big photo sideways for the next or previous one. The photo follows the finger
    // a little, so the gesture feels connected; a short or mostly vertical drag is left alone (the page
    // scrolls, or the tap opens the full-screen viewer as before).
    const stage = main.closest("[data-stage]");
    if (stage && thumbs.length > 1) {
      let startX = 0;
      let startY = 0;
      let dragging = false;
      let swiped = false;
      const settle = () => {
        main.style.transition = "";
        main.style.translate = "";
      };
      stage.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" || event.target.closest("button, a")) return;
        startX = event.clientX;
        startY = event.clientY;
        dragging = true;
        swiped = false;
      });
      stage.addEventListener("pointermove", event => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(event.clientY - startY)) return;
        main.style.transition = "none";
        main.style.translate = `${(dx * 0.35).toFixed(1)}px 0`;
      });
      const end = event => {
        if (!dragging) return;
        dragging = false;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        settle();
        if (event.type === "pointerup" && Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          swiped = true;
          show(current + (dx < 0 ? 1 : -1));
        }
      };
      stage.addEventListener("pointerup", end);
      stage.addEventListener("pointercancel", end);
      // A swipe is not a tap: stop the click that follows it from opening the viewer.
      stage.addEventListener("click", event => {
        if (!swiped) return;
        swiped = false;
        event.stopImmediatePropagation();
        event.preventDefault();
      }, true);
    }
  });
})();
