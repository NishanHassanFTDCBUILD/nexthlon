// Admin console: the shell (collapsible sidebar groups, the phone menu, global search, the Ctrl+K
// command palette and the notification bell) and the section modules for customers, settings
// and support tickets. No animation: everything appears and disappears instantly.
// Section modules use window.NxPages (section-nav.js) with init(root)/destroy(), so they keep
// working when sections switch without a reload.
(function () {
  "use strict";

  const body = document.body;
  const BASE = body.dataset.adminPath || "";
  if (!BASE || !document.querySelector(".admin-shell")) return;
  const Pages = window.NxPages;
  const go = href => (window.NxNav && window.NxNav.inArea(href) ? window.NxNav.go(href) : window.location.assign(href));
  const refresh = message => {
    if (window.NxNav) return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ } }
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const iconSvg = name => `<svg class="i i-sm" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;

  // ---------- Sidebar: collapsible groups (remembered), the group with the active page stays open ----------
  const COLLAPSED_KEY = "nx-admin-collapsed";
  function setGroup(group, open) {
    const toggle = group.querySelector("[data-admin-group-toggle]");
    toggle.setAttribute("aria-expanded", String(open));
    group.querySelector(".admin-group-items").hidden = !open;
  }
  function applyGroups() {
    const collapsed = store.get(COLLAPSED_KEY, []);
    document.querySelectorAll("[data-admin-group]").forEach(group => {
      const hasActive = Boolean(group.querySelector(".admin-link.is-active"));
      setGroup(group, hasActive || !collapsed.includes(group.dataset.adminGroup));
    });
  }
  document.addEventListener("click", event => {
    const toggle = event.target instanceof Element && event.target.closest("[data-admin-group-toggle]");
    if (!toggle) return;
    const group = toggle.closest("[data-admin-group]");
    const open = toggle.getAttribute("aria-expanded") !== "true";
    setGroup(group, open);
    const collapsed = new Set(store.get(COLLAPSED_KEY, []));
    if (open) collapsed.delete(group.dataset.adminGroup);
    else collapsed.add(group.dataset.adminGroup);
    store.set(COLLAPSED_KEY, [...collapsed]);
  });
  applyGroups();

  // ---------- Phones and tablets: the sidebar is a menu panel ----------
  const side = document.querySelector("[data-admin-side]");
  const scrim = document.querySelector(".admin-scrim");
  const menuButton = document.querySelector("[data-admin-menu-open]");
  function setMenu(open) {
    side.classList.toggle("is-open", open);
    scrim.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    body.classList.toggle("admin-menu-open", open);
    if (open) (side.querySelector(".admin-link.is-active") || side.querySelector("a")).focus();
    else if (side.contains(document.activeElement)) menuButton.focus();
  }
  menuButton.addEventListener("click", () => setMenu(true));
  document.querySelectorAll("[data-admin-menu-close]").forEach(button => button.addEventListener("click", () => setMenu(false)));
  side.addEventListener("click", event => { if (event.target.closest("a[href]")) setMenu(false); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && side.classList.contains("is-open")) setMenu(false); });

  // A new section is shown: keep its sidebar group open.
  document.addEventListener("nx:section", applyGroups);

  // ---------- Search (top bar and palette share it) ----------
  const STATUS = { placed: "Placed", confirmed: "Confirmed", shipped: "Shipped", out_for_delivery: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled", return_requested: "Return requested", returned: "Returned" };
  const cache = new Map();
  async function searchApi(q) {
    const key = q.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const reply = await Nx.api(`/api/admin/search?q=${encodeURIComponent(q)}`);
    cache.set(key, reply.results);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return reply.results;
  }
  // Results as plain entries: { group, label, meta, href, icon }.
  function entriesFrom(results) {
    return [
      ...results.orders.map(o => ({ group: "Orders", icon: "package-check", label: o.orderId, meta: `${o.customer} · ${Nx.formatPrice(o.total)} · ${STATUS[o.status] || o.status}`, href: `${BASE}/orders?q=${encodeURIComponent(o.orderId)}` })),
      ...results.products.map(p => ({ group: "Products", icon: "box", label: p.name, meta: `${p.brand ? p.brand + " · " : ""}${p.stock} in stock${p.isListed ? "" : " · unlisted"}`, href: `${BASE}/products/${p.id}/edit` })),
      ...results.customers.map(c => ({ group: "Customers", icon: "users", label: c.name, meta: `${c.email}${c.isBlocked ? " · blocked" : ""}`, href: `${BASE}/customers?q=${encodeURIComponent(c.email)}` }))
    ];
  }

  // A keyboard-friendly list (top bar dropdown and palette): arrows, Enter, mouse.
  function makeList(listEl, input, onPick) {
    let entries = [];
    let index = -1;
    function render(items, emptyText) {
      entries = items;
      index = items.length ? 0 : -1;
      listEl.textContent = "";
      if (!items.length) {
        listEl.append(el("li", "admin-list-empty", emptyText || "No matches."));
        input.removeAttribute("aria-activedescendant");
        return;
      }
      let lastGroup = "";
      items.forEach((entry, i) => {
        if (entry.group !== lastGroup) {
          lastGroup = entry.group;
          const head = el("li", "admin-list-group", entry.group);
          head.setAttribute("role", "presentation");
          listEl.append(head);
        }
        const li = el("li", "admin-list-item");
        li.id = `${listEl.id}-${i}`;
        li.setAttribute("role", "option");
        li.dataset.index = String(i);
        li.innerHTML = iconSvg(entry.icon);
        const text = el("span", "admin-list-text");
        text.append(el("strong", "", entry.label));
        if (entry.meta) text.append(el("small", "", entry.meta));
        li.append(text);
        listEl.append(li);
      });
      highlight();
    }
    function highlight() {
      listEl.querySelectorAll(".admin-list-item").forEach(li => {
        const on = Number(li.dataset.index) === index;
        li.classList.toggle("is-active", on);
        li.setAttribute("aria-selected", String(on));
        if (on) {
          input.setAttribute("aria-activedescendant", li.id);
          li.scrollIntoView({ block: "nearest" });
        }
      });
    }
    input.addEventListener("keydown", event => {
      if (!entries.length) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        index = (index + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length;
        highlight();
      } else if (event.key === "Enter" && index >= 0) {
        event.preventDefault();
        onPick(entries[index]);
      }
    });
    listEl.addEventListener("mousedown", event => event.preventDefault()); // keep focus in the input
    listEl.addEventListener("click", event => {
      const li = event.target.closest(".admin-list-item");
      if (li) onPick(entries[Number(li.dataset.index)]);
    });
    return { render, clear() { entries = []; index = -1; listEl.textContent = ""; } };
  }

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ---------- Top bar search ----------
  const searchBox = document.querySelector("[data-admin-search]");
  const searchInput = searchBox.querySelector("[data-admin-search-input]");
  const searchPop = searchBox.querySelector("[data-admin-search-results]");
  let searchSeq = 0;
  function closeSearch() {
    searchPop.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
  }
  const searchList = makeList(searchPop, searchInput, entry => { closeSearch(); searchInput.value = ""; go(entry.href); });
  const runSearch = debounce(async () => {
    const q = searchInput.value.trim();
    const seq = ++searchSeq;
    if (q.length < 2) return closeSearch();
    try {
      const results = await searchApi(q);
      if (seq !== searchSeq) return;
      searchList.render(entriesFrom(results), `Nothing found for "${q}".`);
      searchPop.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
    } catch (error) {
      if (seq === searchSeq) Nx.toast(error.message, "error");
    }
  }, 180);
  searchInput.addEventListener("input", runSearch);
  searchInput.addEventListener("focus", () => { if (searchInput.value.trim().length >= 2) runSearch(); });
  searchInput.addEventListener("keydown", event => { if (event.key === "Escape") { closeSearch(); searchInput.blur(); } });
  document.addEventListener("click", event => { if (!searchBox.contains(event.target)) closeSearch(); });

  // ---------- Ctrl+K command palette ----------
  const palette = document.querySelector("[data-admin-palette]");
  const paletteInput = palette.querySelector("[data-admin-palette-input]");
  const paletteList = palette.querySelector("[data-admin-palette-list]");
  const sections = [...document.querySelectorAll(".admin-link[data-nav-link]")].map(link => ({
    group: "Go to", icon: (link.querySelector("use") || { getAttribute: () => "" }).getAttribute("href").split("#")[1] || "grid",
    label: link.dataset.label, meta: link.dataset.group, href: link.getAttribute("href")
  }));
  let paletteSeq = 0;
  const list = makeList(paletteList, paletteInput, entry => { palette.close(); go(entry.href); });
  const updatePalette = debounce(async () => {
    const q = paletteInput.value.trim().toLowerCase();
    const seq = ++paletteSeq;
    const matches = sections.filter(s => !q || s.label.toLowerCase().includes(q) || s.meta.toLowerCase().includes(q));
    list.render(matches, "No sections match.");
    if (q.length < 2) return;
    try {
      const results = await searchApi(q);
      if (seq !== paletteSeq || !palette.open) return;
      list.render([...matches, ...entriesFrom(results)], `Nothing found for "${paletteInput.value.trim()}".`);
    } catch {
      /* the section list still works */
    }
  }, 150);
  function openPalette() {
    if (palette.open) return;
    closeSearch();
    paletteInput.value = "";
    palette.showModal();
    paletteInput.focus();
    updatePalette();
  }
  paletteInput.addEventListener("input", updatePalette);
  palette.addEventListener("click", event => { if (event.target === palette) palette.close(); });
  document.querySelectorAll("[data-admin-palette-open]").forEach(button => button.addEventListener("click", openPalette));
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (palette.open) palette.close();
      else openPalette();
    } else if (event.key === "/" && !event.ctrlKey && !event.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
      event.preventDefault();
      searchInput.focus();
    }
  });

  // ---------- Notification bell ----------
  const bell = document.querySelector("[data-admin-bell]");
  const bellToggle = bell.querySelector("[data-admin-bell-toggle]");
  const bellPanel = bell.querySelector("[data-admin-bell-panel]");
  const bellList = bell.querySelector("[data-admin-bell-list]");
  const bellCount = bell.querySelector("[data-admin-bell-count]");
  async function loadBell() {
    try {
      const data = await Nx.api("/api/admin/notifications");
      bellCount.hidden = data.total === 0;
      bellCount.textContent = data.total > 99 ? "99+" : String(data.total);
      bellToggle.setAttribute("aria-label", data.total ? `Notifications, ${data.total} need attention` : "Notifications, nothing needs attention");
      bellList.textContent = "";
      data.items.forEach(item => {
        const li = el("li", item.count ? "" : "is-zero");
        const a = el("a", "admin-bell-item");
        a.href = `${BASE}/${item.section}`;
        a.innerHTML = iconSvg(item.icon);
        a.append(el("span", "", item.label), el("strong", "", String(item.count)));
        li.append(a);
        bellList.append(li);
      });
    } catch {
      bellList.textContent = "";
      bellList.append(el("li", "muted", "Could not load notifications."));
    }
  }
  function setBell(open) {
    bellPanel.hidden = !open;
    bellToggle.setAttribute("aria-expanded", String(open));
    if (open) loadBell();
  }
  bellToggle.addEventListener("click", () => setBell(bellPanel.hidden));
  bell.querySelector("[data-admin-bell-refresh]").addEventListener("click", loadBell);
  bellPanel.addEventListener("click", event => { if (event.target.closest("a")) setBell(false); });
  document.addEventListener("click", event => { if (!bell.contains(event.target)) setBell(false); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !bellPanel.hidden) { setBell(false); bellToggle.focus(); } });
  loadBell();
  // Refresh the badge every 2 minutes while the tab is visible.
  setInterval(() => { if (!document.hidden && bellPanel.hidden) loadBell(); }, 120000);

  // ================= Section modules =================

  Pages.define("admin-dashboard", () => {});
  Pages.define("admin-soon", () => {});

  // ---------- Customers: block and unblock without reloading ----------
  Pages.define("admin-customers", (root, signal) => {
    root.addEventListener("click", async event => {
      const button = event.target.closest("[data-block-user]");
      if (!button) return;
      const isBlocked = button.dataset.blocked === "true";
      const name = button.dataset.name;
      const confirmed = await Nx.confirm({
        title: isBlocked ? `Unblock ${name}?` : `Block ${name}?`,
        message: isBlocked
          ? "They will be able to sign in and use their account again."
          : "They will be signed out right away and cannot sign in until you unblock them.",
        confirmLabel: isBlocked ? "Unblock" : "Block customer",
        tone: isBlocked ? "primary" : "danger"
      });
      if (!confirmed) return;
      Nx.busy(button, true, isBlocked ? "Unblocking…" : "Blocking…");
      try {
        const result = await Nx.api(`/api/admin/customers/${encodeURIComponent(button.dataset.blockUser)}/block`, { method: "PATCH", body: { isBlocked: !isBlocked } });
        Nx.busy(button, false);
        const nowBlocked = result.customer.isBlocked;
        const row = button.closest("tr");
        const status = row.querySelector("[data-status]");
        status.textContent = nowBlocked ? "Blocked" : "Active";
        status.className = `pill ${nowBlocked ? "pill-red" : "pill-green"}`;
        button.dataset.blocked = String(nowBlocked);
        button.textContent = nowBlocked ? "Unblock" : "Block";
        button.setAttribute("aria-label", `${nowBlocked ? "Unblock" : "Block"} ${name}`);
        button.className = `btn btn-sm ${nowBlocked ? "btn-secondary" : "btn-danger-soft"}`;
        Nx.toast(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  });

  // ---------- Store settings: the referral reward ----------
  Pages.define("admin-settings", (root, signal) => {
    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-referral-form]");
      if (!form) return;
      event.preventDefault();
      Nx.clearErrors(form);
      const raw = form.elements.referralReward.value.trim();
      if (!/^\d{1,4}$/.test(raw) || Number(raw) > 1000) {
        Nx.showErrors(form, { referralReward: "Enter a whole amount from ₹0 to ₹1,000." });
        form.elements.referralReward.focus();
        return;
      }
      const amount = Number(raw);
      const confirmed = await Nx.confirm({
        title: amount ? `Set the referral reward to ${Nx.formatPrice(amount * 100)}?` : "Turn off referral rewards?",
        message: amount
          ? "New sign-ups with a referral code will give this amount to both people. Rewards already given stay as they are."
          : "New sign-ups with a referral code will not get any wallet credit.",
        confirmLabel: amount ? "Save reward" : "Turn off",
        tone: amount ? "primary" : "danger"
      });
      if (!confirmed) return;
      const reply = await Nx.submitForm(form, { url: "/api/admin/settings/referral", method: "PATCH", body: { referralReward: raw }, busyLabel: "Saving…" });
      if (reply) Nx.toast(reply.message);
    }, { signal });
  });

  // ---------- Support tickets ----------
  Pages.define("admin-tickets", () => {});
  Pages.define("admin-ticket", (root, signal) => {
    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-admin-ticket-reply]");
      if (!form) return;
      event.preventDefault();
      const reply = await Nx.submitForm(form, { url: `/api/admin/tickets/${form.dataset.adminTicketReply}/reply`, busyLabel: "Sending…" });
      if (reply) refresh(reply.message);
    }, { signal });
  });
})();
