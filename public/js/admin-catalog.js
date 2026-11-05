// Admin Catalog sections: inventory corrections, review moderation and Q&A.
// No animation and no libraries: a change is sent, the server answers, the row is brought in line.
// Section modules use window.NxPages (section-nav.js), so they keep working when sections switch
// without a reload.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  const reload = message => {
    if (window.NxNav) return window.NxNav.reload().then(() => message && Nx.toast(message));
    if (message) Nx.flash(message);
    window.location.reload();
    return Promise.resolve();
  };

  // ---------- Inventory ----------

  const STATE_PILL = { out: "pill-red", low: "pill-amber", healthy: "pill-green" };
  const STATE_LABEL = { out: "Out of stock", low: "Low", healthy: "In stock" };

  Pages.define("admin-inventory", (root, signal) => {
    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-inv-form]");
      if (!form) return;
      event.preventDefault();
      const id = form.dataset.invForm;
      const name = form.dataset.name;
      const action = form.elements.action.value;
      const units = Number(form.elements.units.value);
      const button = form.querySelector("button");

      // The server checks this again; stopping here just saves a pointless round trip.
      if (!Number.isInteger(units) || units < 0 || units > 100000 || (action !== "count" && units < 1)) {
        Nx.toast("Enter a whole number of units.", "error");
        form.elements.units.focus();
        return;
      }
      // Setting an exact count can lose stock by accident, so it asks first.
      if (action === "count") {
        const ok = await Nx.confirm({
          title: `Set ${name} to ${units} in stock?`,
          message: "This replaces the current number, it does not add to it. Use it after counting the shelf.",
          confirmLabel: "Set the stock",
          tone: "primary"
        });
        if (!ok) return;
      }

      Nx.busy(button, true, "Saving…");
      try {
        const reply = await Nx.api(`/api/admin/inventory/${encodeURIComponent(id)}`, { method: "PATCH", body: { action, units } });
        const product = reply.product;
        const row = root.querySelector(`[data-inv-row="${id}"]`);
        if (row) {
          row.querySelector("[data-inv-stock]").textContent = String(product.stock);
          const state = row.querySelector("[data-inv-state]");
          state.textContent = STATE_LABEL[product.state];
          state.className = `pill ${STATE_PILL[product.state]}`;
          row.querySelector("[data-inv-value]").textContent = Nx.formatPrice(product.stockValue);
        }
        form.elements.units.value = "";
        Nx.toast(reply.message);
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        Nx.busy(button, false);
      }
    }, { signal });
  });

  // ---------- Reviews ----------

  Pages.define("admin-reviews", (root, signal) => {
    root.addEventListener("click", async event => {
      const toggle = event.target.closest("[data-review-toggle]");
      const remove = event.target.closest("[data-review-delete]");
      if (!toggle && !remove) return;

      if (toggle) {
        const id = toggle.dataset.reviewToggle;
        const isHidden = toggle.dataset.hidden === "true";
        let reason = "";
        if (!isHidden) {
          // Hiding needs a short reason, kept in the audit log and never shown to the customer.
          reason = (window.prompt("Why is this review being hidden? (for the audit log)") || "").trim();
          if (reason.length < 3) {
            if (reason !== "") Nx.toast("Please give a reason of at least 3 characters.", "error");
            return;
          }
        }
        Nx.busy(toggle, true, isHidden ? "Showing…" : "Hiding…");
        try {
          const reply = await Nx.api(`/api/admin/reviews/${encodeURIComponent(id)}/hidden`, {
            method: "PATCH",
            body: { isHidden: !isHidden, reason }
          });
          Nx.busy(toggle, false);
          const nowHidden = reply.review.isHidden;
          const row = root.querySelector(`[data-review-row="${id}"]`);
          if (row) {
            row.classList.toggle("is-unlisted", nowHidden);
            const state = row.querySelector("[data-review-state]");
            state.textContent = nowHidden ? "Hidden" : "Visible";
            state.className = `pill ${nowHidden ? "pill-grey" : "pill-green"}`;
          }
          toggle.dataset.hidden = String(nowHidden);
          toggle.textContent = nowHidden ? "Show" : "Hide";
          toggle.className = `btn btn-sm ${nowHidden ? "btn-secondary" : "btn-danger-soft"}`;
          Nx.toast(reply.message);
        } catch (error) {
          Nx.busy(toggle, false);
          Nx.toast(error.message, "error");
        }
        return;
      }

      const id = remove.dataset.reviewDelete;
      const ok = await Nx.confirm({
        title: "Delete this review?",
        message: "It is removed for good and the product's stars are worked out again. Hiding it instead can be undone.",
        confirmLabel: "Delete the review"
      });
      if (!ok) return;
      Nx.busy(remove, true, "Deleting…");
      try {
        const reply = await Nx.api(`/api/admin/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
        const row = root.querySelector(`[data-review-row="${id}"]`);
        if (row) row.remove();
        Nx.toast(reply.message);
      } catch (error) {
        Nx.busy(remove, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  });

  // ---------- Questions & answers ----------

  Pages.define("admin-questions", (root, signal) => {
    const questionIdOf = node => {
      const card = node.closest("[data-question]");
      return card ? card.dataset.question : "";
    };

    // Answering as the team (also used to edit that answer: the server replaces it).
    root.addEventListener("submit", async event => {
      const form = event.target.closest("[data-qa-answer]");
      if (!form) return;
      event.preventDefault();
      const reply = await Nx.submitForm(form, {
        url: `/api/admin/questions/${encodeURIComponent(form.dataset.qaAnswer)}/answer`,
        busyLabel: "Posting…"
      });
      if (reply) reload(reply.message);
    }, { signal });

    root.addEventListener("click", async event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      // --- Edit the wording of a question or of one answer.
      const editAnswer = target.closest("[data-qa-edit]");
      const editQuestion = target.closest("[data-qa-edit-question]");
      if (editAnswer || editQuestion) {
        const button = editAnswer || editQuestion;
        const id = questionIdOf(button);
        const answerId = editAnswer ? editAnswer.dataset.qaEdit : null;
        const holder = answerId ? root.querySelector(`[data-answer="${answerId}"]`) : button.closest("[data-question]");
        const current = holder ? holder.querySelector("[data-qa-body]").textContent.trim() : "";
        const next = (window.prompt(answerId ? "Edit the answer:" : "Edit the question:", current) || "").trim();
        if (!next || next === current) return;
        try {
          const reply = await Nx.api(`/api/admin/questions/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: answerId ? { body: next, answerId } : { body: next }
          });
          reload(reply.message);
        } catch (error) {
          Nx.toast(error.message, "error");
        }
        return;
      }

      // --- Hide or show a question or one answer.
      const hideAnswer = target.closest("[data-qa-hide]");
      const hideQuestion = target.closest("[data-qa-hide-question]");
      if (hideAnswer || hideQuestion) {
        const button = hideAnswer || hideQuestion;
        const id = questionIdOf(button);
        const answerId = hideAnswer ? hideAnswer.dataset.qaHide : null;
        const isHidden = button.dataset.hidden === "true";
        Nx.busy(button, true, isHidden ? "Showing…" : "Hiding…");
        try {
          const reply = await Nx.api(`/api/admin/questions/${encodeURIComponent(id)}/hidden`, {
            method: "PATCH",
            body: answerId ? { isHidden: !isHidden, answerId } : { isHidden: !isHidden }
          });
          reload(reply.message);
        } catch (error) {
          Nx.busy(button, false);
          Nx.toast(error.message, "error");
        }
        return;
      }

      // --- Delete a question (with its answers) or one answer.
      const deleteAnswer = target.closest("[data-qa-delete]");
      const deleteQuestion = target.closest("[data-qa-delete-question]");
      if (!deleteAnswer && !deleteQuestion) return;
      const button = deleteAnswer || deleteQuestion;
      const id = questionIdOf(button);
      const answerId = deleteAnswer ? deleteAnswer.dataset.qaDelete : null;
      const ok = await Nx.confirm({
        title: answerId ? "Delete this answer?" : "Delete this question?",
        message: answerId
          ? "The answer is removed for good. Hiding it instead can be undone."
          : "The question and every answer under it are removed for good. Hiding it instead can be undone.",
        confirmLabel: "Delete"
      });
      if (!ok) return;
      Nx.busy(button, true, "Deleting…");
      try {
        const url = `/api/admin/questions/${encodeURIComponent(id)}${answerId ? `?answerId=${encodeURIComponent(answerId)}` : ""}`;
        const reply = await Nx.api(url, { method: "DELETE" });
        reload(reply.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    }, { signal });
  });
})();
