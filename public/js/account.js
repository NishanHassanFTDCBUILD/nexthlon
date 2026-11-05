// My Account (every account page): the sliding sidebar indicator, rise-in, 3D tilt, rolling
// numbers, copy-code tickets, lists (drag and drop with a "Move to" fallback), reviews, security,
// notification switches, referral sharing, help requests, "Buy it again" and the wallet flip.
// Everything here is an enhancement: links and server-rendered content work without it.
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const mouse = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reloadWith = (message, type = "success") => {
    Nx.flash(message, type);
    window.location.reload();
  };

  // ---------- Sidebar: a volt indicator that slides to the active (or hovered) section ----------
  const nav = document.querySelector("[data-acct-nav]");
  if (nav) {
    const indicator = nav.querySelector("[data-acct-indicator]");
    const active = nav.querySelector(".acct-link.is-active");
    const wide = window.matchMedia("(min-width: 1025px)");
    const moveTo = link => {
      if (!link || !indicator) return;
      if (wide.matches) {
        indicator.style.setProperty("--ind-y", `${link.offsetTop}px`);
        indicator.style.setProperty("--ind-h", `${link.offsetHeight}px`);
      } else {
        indicator.style.setProperty("--ind-x", `${link.offsetLeft}px`);
        indicator.style.setProperty("--ind-w", `${link.offsetWidth}px`);
      }
    };
    if (active) {
      moveTo(active);
      requestAnimationFrame(() => nav.classList.add("has-indicator"));
      // On phones the active tab scrolls into view.
      if (!wide.matches) nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
      if (mouse) {
        nav.querySelectorAll(".acct-link").forEach(link => link.addEventListener("pointerenter", () => moveTo(link)));
        nav.addEventListener("pointerleave", () => moveTo(active));
      }
      wide.addEventListener("change", () => moveTo(active));
      window.addEventListener("resize", () => moveTo(active));
    }
  }

  // ---------- Rise-in: sections and cards rise once, with a small stagger ----------
  const risers = [...document.querySelectorAll("[data-rise]")];
  if (risers.length) {
    if (!("IntersectionObserver" in window) || reduced) {
      risers.forEach(el => el.classList.add("is-in"));
    } else {
      const watcher = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          watcher.unobserve(entry.target);
        });
      }, { rootMargin: "0px 0px -6% 0px" });
      risers.forEach(el => watcher.observe(el));
    }
  }

  // ---------- 3D tilt (mouse only) ----------
  if (mouse && !reduced) {
    document.querySelectorAll("[data-acct-tilt]").forEach(card => {
      const max = card.classList.contains("acct-card3d") ? 8 : 6;
      let frame = 0;
      card.addEventListener("pointermove", event => {
        const { clientX, clientY } = event;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const box = card.getBoundingClientRect();
          const x = (clientX - box.left) / box.width - 0.5;
          const y = (clientY - box.top) / box.height - 0.5;
          card.classList.add("is-tilting");
          card.style.setProperty("--ty", `${(x * max * 2).toFixed(2)}deg`);
          card.style.setProperty("--tx", `${(-y * max * 2).toFixed(2)}deg`);
        });
      });
      card.addEventListener("pointerleave", () => {
        cancelAnimationFrame(frame);
        card.classList.remove("is-tilting");
        card.style.setProperty("--tx", "0deg");
        card.style.setProperty("--ty", "0deg");
      });
    });
  }

  // ---------- Rolling numbers: count up from 0 when they come into view ----------
  const money = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  const rollers = [...document.querySelectorAll("[data-roll]")];
  if (rollers.length && !reduced && "IntersectionObserver" in window) {
    const show = (el, value) => {
      el.textContent = el.hasAttribute("data-roll-money") ? money.format(value / 100) : String(Math.round(value));
    };
    const roll = el => {
      const target = Number(el.dataset.roll) || 0;
      if (target <= 0) return;
      const duration = 1100;
      let elapsed = 0;
      show(el, 0);
      const add = window.NxTicker ? window.NxTicker.add.bind(window.NxTicker) : null;
      if (!add) return show(el, target);
      const stop = add((time, dt) => {
        elapsed += dt * 1000;
        const t = Math.min(1, elapsed / duration);
        show(el, target * (1 - Math.pow(1 - t, 4)));
        if (t >= 1) {
          show(el, target);
          stop();
        }
      });
    };
    const watcher = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        watcher.unobserve(entry.target);
        roll(entry.target);
      });
    }, { threshold: 0.5 });
    rollers.forEach(el => watcher.observe(el));
  }

  // ---------- Confetti on a fixed canvas (made on first use) ----------
  function confetti() {
    if (!Nx.confetti || reduced) return;
    let canvas = document.querySelector(".acct-confetti");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "acct-confetti";
      canvas.setAttribute("aria-hidden", "true");
      document.body.append(canvas);
    }
    Nx.confetti(canvas);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Older browsers: a hidden field and the copy command.
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.append(field);
      field.select();
      const done = document.execCommand && document.execCommand("copy");
      field.remove();
      return Boolean(done);
    }
  }

  // ---------- Copy a coupon or referral code: the ticket stub tears a little, with confetti ----------
  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-copy-code]");
    if (!button) return;
    const text = button.dataset.copyCode;
    if (!(await copyText(text))) {
      Nx.toast("Copying didn't work. Select the code and copy it instead.", "error");
      return;
    }
    const ticket = button.closest(".ticket");
    if (ticket && !reduced) {
      ticket.classList.remove("is-torn");
      void ticket.offsetWidth;
      ticket.classList.add("is-torn");
    }
    confetti();
    Nx.toast(`${button.dataset.copyLabel || "Code"} copied: ${text}`);
  });

  // ---------- Add to cart from "Buy it again" and the order page ----------
  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-quick-cart]");
    if (!button) return;
    Nx.busy(button, true, "Adding…");
    try {
      const result = await Nx.api("/api/cart/items", { method: "POST", body: { productId: button.dataset.quickCart, quantity: 1 } });
      Nx.busy(button, false);
      const card = button.closest("article, li");
      if (Nx.flyToCart) await Nx.flyToCart(card && card.querySelector("img"));
      Nx.setCartCount(result.cart.summary.count);
      Nx.toast(result.message);
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, "error");
    }
  });

  // ---------- Recently viewed ----------
  const clearRecent = document.querySelector("[data-clear-recent]");
  if (clearRecent) {
    clearRecent.addEventListener("click", async () => {
      const ok = await Nx.confirm({ title: "Clear your history?", message: "Your recently viewed products will be removed from every device.", confirmLabel: "Clear history" });
      if (!ok) return;
      try {
        reloadWith((await Nx.api("/api/account/recent", { method: "DELETE" })).message);
      } catch (error) {
        Nx.toast(error.message, "error");
      }
    });
  }

  // ---------- Notification switches: saved as soon as they change ----------
  document.querySelectorAll("[data-pref]").forEach(input => {
    input.addEventListener("change", async () => {
      const row = input.closest(".pref");
      input.disabled = true;
      try {
        await Nx.api("/api/account/preferences", { method: "PATCH", body: { [input.dataset.pref]: input.checked } });
        row.classList.add("is-saved");
        setTimeout(() => row.classList.remove("is-saved"), 900);
        Nx.toast("Preferences saved.");
      } catch (error) {
        input.checked = !input.checked;
        Nx.toast(error.message, "error");
      } finally {
        input.disabled = false;
      }
    });
  });

  // ---------- A small text prompt (rename a list), built on <dialog> ----------
  function askText({ title, label, value = "", confirmLabel = "Save", maxLength = 40 }) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal acct-ask";
    dialog.innerHTML = `<form method="dialog" class="form"><div class="modal-head"><h2></h2></div><div class="modal-body"><div class="field"><label for="acct-ask-input"></label><input id="acct-ask-input" name="value" required></div></div><div class="modal-foot"><button class="btn btn-ghost" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" value="ok"></button></div></form>`;
    dialog.querySelector("h2").textContent = title;
    dialog.querySelector("label").textContent = label;
    const input = dialog.querySelector("input");
    input.value = value;
    input.maxLength = maxLength;
    dialog.querySelector('[value="ok"]').textContent = confirmLabel;
    document.body.append(dialog);
    dialog.showModal();
    input.select();
    return new Promise(resolve => {
      dialog.addEventListener("close", () => {
        resolve(dialog.returnValue === "ok" ? input.value.trim() : null);
        dialog.remove();
      }, { once: true });
    });
  }

  // ---------- Lists ----------
  const listCreate = document.querySelector("[data-list-create]");
  if (listCreate) {
    listCreate.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(listCreate, { url: "/api/lists", busyLabel: "Creating…" });
      if (reply) reloadWith(reply.message);
    });
  }

  async function listCall(url, options, message) {
    try {
      const reply = await Nx.api(url, options);
      reloadWith(message || reply.message);
      return reply;
    } catch (error) {
      Nx.toast(error.message, "error");
      return null;
    }
  }

  document.addEventListener("click", async event => {
    const rename = event.target.closest("[data-list-rename]");
    if (rename) {
      const name = await askText({ title: "Rename list", label: "List name", value: rename.dataset.name });
      if (name && name !== rename.dataset.name) listCall(`/api/lists/${rename.dataset.listRename}`, { method: "PATCH", body: { name } });
      return;
    }
    const remove = event.target.closest("[data-list-delete]");
    if (remove) {
      const ok = await Nx.confirm({ title: `Delete "${remove.dataset.name}"?`, message: "The list and its saved items will be removed. The products themselves stay in the store.", confirmLabel: "Delete list" });
      if (ok) listCall(`/api/lists/${remove.dataset.listDelete}`, { method: "DELETE" });
      return;
    }
    const removeItem = event.target.closest("[data-list-remove]");
    if (removeItem) {
      const block = removeItem.closest("[data-list]");
      removeItem.classList.add("is-popping");
      setTimeout(() => listCall(`/api/lists/${block.dataset.list}/items/${removeItem.dataset.listRemove}`, { method: "DELETE" }), reduced ? 0 : 320);
      return;
    }
    const toCart = event.target.closest("[data-list-cart]");
    if (toCart) {
      const block = toCart.closest("[data-list]");
      Nx.busy(toCart, true, "Moving…");
      try {
        const reply = await Nx.api(`/api/lists/${block.dataset.list}/items/${toCart.dataset.listCart}/move-to-cart`, { method: "POST" });
        const card = toCart.closest("[data-list-item]");
        if (Nx.flyToCart) await Nx.flyToCart(card && card.querySelector("img"));
        reloadWith(reply.message);
      } catch (error) {
        Nx.busy(toCart, false);
        Nx.toast(error.message, "error");
      }
      return;
    }
    const copyShare = event.target.closest("[data-share-copy]");
    if (copyShare) {
      const url = new URL(copyShare.dataset.shareCopy, window.location.origin).href;
      if (await copyText(url)) Nx.toast("Share link copied.");
    }
  });

  document.querySelectorAll("[data-list-share]").forEach(input => {
    input.addEventListener("change", () => {
      input.disabled = true;
      listCall(`/api/lists/${input.dataset.listShare}/share`, { method: "PATCH", body: { enabled: input.checked } }).then(reply => {
        if (!reply) {
          input.checked = !input.checked;
          input.disabled = false;
        }
      });
    });
  });

  const move = (productId, from, to) => listCall("/api/lists/move", { method: "POST", body: { productId, from, to } });

  // Keyboard-friendly way to move: the "Move to…" menu on every card.
  document.querySelectorAll("[data-list-move]").forEach(select => {
    select.addEventListener("change", () => {
      if (!select.value) return;
      const from = select.closest("[data-list]").dataset.list;
      move(select.dataset.listMove, from, select.value);
    });
  });

  // Drag and drop (mouse): drag a card onto one of the list chips that appear at the top.
  const acct = document.querySelector("[data-acct]");
  let dragged = null;
  document.querySelectorAll("[data-list-item]").forEach(card => {
    card.addEventListener("dragstart", event => {
      dragged = card;
      card.classList.add("is-dragged");
      acct.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", card.dataset.listItem);
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("is-dragged");
      acct.classList.remove("is-dragging");
      dragged = null;
    });
  });
  document.querySelectorAll("[data-drop-list]").forEach(target => {
    target.addEventListener("dragover", event => {
      if (!dragged || target.dataset.dropList === dragged.dataset.from) return;
      event.preventDefault();
      target.classList.add("is-over");
    });
    target.addEventListener("dragleave", () => target.classList.remove("is-over"));
    target.addEventListener("drop", event => {
      event.preventDefault();
      target.classList.remove("is-over");
      if (!dragged || target.dataset.dropList === dragged.dataset.from) return;
      move(dragged.dataset.listItem, dragged.dataset.from, target.dataset.dropList);
    });
  });

  // ---------- Your reviews: edit in place, or delete ----------
  document.querySelectorAll("[data-review]").forEach(card => {
    const id = card.dataset.review;
    const view = card.querySelector("[data-review-view]");
    const form = card.querySelector("[data-review-form]");
    card.querySelector("[data-review-edit]").addEventListener("click", () => {
      view.hidden = true;
      form.hidden = false;
      form.querySelector("textarea").focus();
    });
    form.querySelector("[data-review-cancel]").addEventListener("click", () => {
      form.hidden = true;
      view.hidden = false;
    });
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const values = Nx.formValues(form);
      const body = { rating: Number(values.rating), title: values.title, body: values.body };
      const reply = await Nx.submitForm(form, { url: `/api/account/reviews/${id}`, method: "PATCH", body, busyLabel: "Saving…" });
      if (reply) reloadWith(reply.message);
    });
    card.querySelector("[data-review-delete]").addEventListener("click", async () => {
      const ok = await Nx.confirm({ title: "Delete this review?", message: "It will be removed from the product page. You can write a new one later.", confirmLabel: "Delete review" });
      if (!ok) return;
      try {
        reloadWith((await Nx.api(`/api/account/reviews/${id}`, { method: "DELETE" })).message);
      } catch (error) {
        Nx.toast(error.message, "error");
      }
    });
  });

  // ---------- Login & security ----------
  const emailForm = document.querySelector("[data-email-form]");
  if (emailForm) {
    emailForm.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(emailForm, { url: "/api/account/email", method: "PATCH", busyLabel: "Saving…" });
      if (reply) reloadWith(reply.message);
    });
  }

  // A success card with a check that draws itself, then the sign-in page.
  function successThen(message, href) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal acct-success";
    dialog.innerHTML = `<div class="modal-body" style="text-align:center;display:grid;gap:12px;padding:32px"><span class="check-draw"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span><p></p></div>`;
    dialog.querySelector("p").textContent = message;
    document.body.append(dialog);
    dialog.showModal();
    setTimeout(() => window.location.assign(href), reduced ? 600 : 1500);
  }

  const logoutAll = document.querySelector("[data-logout-all]");
  if (logoutAll) {
    logoutAll.addEventListener("click", async () => {
      const ok = await Nx.confirm({ title: "Log out of all devices?", message: "Every device signed in to your account, including this one, will be signed out straight away.", confirmLabel: "Log out everywhere" });
      if (!ok) return;
      Nx.busy(logoutAll, true, "Signing out…");
      try {
        const reply = await Nx.api("/api/account/logout-all", { method: "POST" });
        successThen(reply.message, "/login?reason=logged_out_all");
      } catch (error) {
        Nx.busy(logoutAll, false);
        Nx.toast(error.message, "error");
      }
    });
  }

  const deleteForm = document.querySelector("[data-delete-form]");
  if (deleteForm) {
    deleteForm.addEventListener("submit", async event => {
      event.preventDefault();
      const ok = await Nx.confirm({ title: "Delete your account?", message: "You will be signed out and won't be able to sign in again. This can't be undone from here.", confirmLabel: "Delete account" });
      if (!ok) return;
      const reply = await Nx.submitForm(deleteForm, { url: "/api/account/delete", busyLabel: "Deleting…" });
      if (reply) successThen(reply.message, "/");
    });
  }

  // ---------- Referral: share (Web Share API) opens the gift box ----------
  const share = document.querySelector("[data-referral-share]");
  if (share) {
    const box = document.querySelector("[data-gift-box]");
    share.addEventListener("click", async () => {
      if (box) box.classList.add("is-open");
      const data = { title: "Join me on Nexthlon", text: `Use my code ${share.dataset.code} when you sign up on Nexthlon.`, url: share.dataset.link };
      if (navigator.share) {
        try {
          await navigator.share(data);
          confetti();
        } catch {
          /* the visitor closed the share sheet */
        }
      } else if (await copyText(share.dataset.link)) {
        confetti();
        Nx.toast("Invite link copied. Paste it anywhere to share.");
      }
    });
  }

  // ---------- Help requests ----------
  const ticketForm = document.querySelector("[data-ticket-form]");
  if (ticketForm) {
    ticketForm.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(ticketForm, { url: "/api/support/tickets", busyLabel: "Sending…" });
      if (reply) {
        Nx.flash(reply.message);
        window.location.assign(`/account/help/${reply.ticket.ticketId}`);
      }
    });
  }
  const replyForm = document.querySelector("[data-ticket-reply]");
  if (replyForm) {
    replyForm.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(replyForm, { url: `/api/support/tickets/${replyForm.dataset.ticketReply}/messages`, busyLabel: "Sending…" });
      if (reply) reloadWith(reply.message);
    });
  }

  // ---------- Wallet card flip ----------
  const flip = document.querySelector("[data-wallet-flip]");
  if (flip) {
    flip.querySelectorAll("[data-wallet-flip-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const flipped = flip.classList.toggle("is-flipped");
        const front = flip.querySelector(".wallet-face-front");
        const back = flip.querySelector(".wallet-face-back");
        front.setAttribute("aria-hidden", String(flipped));
        back.setAttribute("aria-hidden", String(!flipped));
        front.querySelectorAll("a, button").forEach(el => { el.tabIndex = flipped ? -1 : 0; });
        back.querySelectorAll("button").forEach(el => { el.tabIndex = flipped ? 0 : -1; });
        const toggle = flipped ? back.querySelector("[data-wallet-flip-toggle]") : front.querySelector("[data-wallet-flip-toggle]");
        flip.querySelector("[data-wallet-flip-toggle][aria-pressed]").setAttribute("aria-pressed", String(flipped));
        setTimeout(() => toggle.focus({ preventScroll: true }), reduced ? 0 : 420);
      });
    });
  }
})();
