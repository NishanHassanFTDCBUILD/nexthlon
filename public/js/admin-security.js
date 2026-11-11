// Admin Security page: set up two-step login (QR code, first code, recovery codes), make new recovery
// codes, or turn it off. Everything is checked again on the server (services/twoFactorService.js); this
// file only drives the page.
(function () {
  "use strict";

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;

  Pages.define("admin-security", (root, signal) => {
    const tf = root.querySelector("[data-tf]");
    if (!tf) return;
    const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const recovery = tf.querySelector("[data-tf-recovery]");
    let codes = [];

    const copy = async (text, done) => {
      try {
        await navigator.clipboard.writeText(text);
        Nx.toast(done);
      } catch {
        Nx.toast("Could not copy. Select the text and copy it by hand.", "error");
      }
    };

    // The recovery codes: shown once. The page stays on them until they are marked as saved.
    function showRecovery(list) {
      codes = list;
      const ul = recovery.querySelector("[data-tf-codes]");
      ul.replaceChildren(...list.map(code => {
        const li = document.createElement("li");
        li.textContent = code;
        return li;
      }));
      tf.querySelectorAll("[data-tf-steps], [data-tf-intro], [data-tf-manage], [data-tf-form], .tf-facts").forEach(part => { part.hidden = true; });
      recovery.hidden = false;
      // Whichever way we got here (just turned on, or new codes), two-step login is on now.
      const chip = tf.querySelector("[data-tf-chip]");
      chip.textContent = "On";
      chip.className = "tf-chip is-on";
      const heading = recovery.querySelector("#tf-recovery-title");
      heading.focus({ preventScroll: true });
      recovery.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" });
    }

    const saved = tf.querySelector("[data-tf-saved]");
    const done = tf.querySelector("[data-tf-done]");
    saved.addEventListener("change", () => { done.disabled = !saved.checked; }, { signal });
    done.addEventListener("click", () => window.location.reload(), { signal });
    tf.querySelector("[data-tf-copy-codes]").addEventListener("click", () => copy(codes.join("\n"), "Recovery codes copied."), { signal });
    tf.querySelector("[data-tf-download-codes]").addEventListener("click", () => {
      const text = ["Nexthlon admin recovery codes", `Made ${new Date().toLocaleString("en-IN")}`, "Each code works once. Keep this file somewhere safe.", "", ...codes, ""].join("\n");
      const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      const link = Object.assign(document.createElement("a"), { href: url, download: "nexthlon-recovery-codes.txt" });
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }, { signal });

    // ---------- Off: set it up ----------
    const start = tf.querySelector("[data-tf-start]");
    if (start) {
      const steps = tf.querySelector("[data-tf-steps]");
      const enableForm = tf.querySelector("[data-tf-enable]");

      start.addEventListener("click", async () => {
        Nx.busy(start, true, "Preparing…");
        try {
          const setup = await Nx.api("/api/admin/2fa/setup", { method: "POST" });
          tf.querySelector("[data-tf-qr]").src = setup.qr;
          tf.querySelector("[data-tf-secret]").textContent = setup.secret;
          tf.querySelector("[data-tf-intro]").hidden = true;
          steps.hidden = false;
          enableForm.elements.code.focus({ preventScroll: true });
        } catch (error) {
          Nx.toast(error.message, "error");
        } finally {
          Nx.busy(start, false);
        }
      }, { signal });

      tf.querySelector("[data-tf-copy-secret]").addEventListener("click", () => {
        copy(tf.querySelector("[data-tf-secret]").textContent.replace(/\s/g, ""), "Setup key copied.");
      }, { signal });

      enableForm.addEventListener("submit", async event => {
        event.preventDefault();
        const reply = await Nx.submitForm(enableForm, { url: "/api/admin/2fa/enable", method: "POST", body: Nx.formValues(enableForm), busyLabel: "Checking…" });
        if (reply) showRecovery(reply.recoveryCodes);
      }, { signal });
      // Six digits typed: no need to press the button.
      enableForm.elements.code.addEventListener("input", event => {
        if (/^\d{6}$/.test(event.target.value.replace(/\s/g, ""))) setTimeout(() => enableForm.requestSubmit(), 150);
      }, { signal });
    }

    // ---------- On: new recovery codes, or turn it off ----------
    const manage = tf.querySelector("[data-tf-manage]");
    tf.querySelectorAll("[data-tf-open]").forEach(button => {
      button.addEventListener("click", () => {
        const form = tf.querySelector(`[data-tf-form="${button.dataset.tfOpen}"]`);
        tf.querySelectorAll("[data-tf-form]").forEach(other => { other.hidden = other !== form; });
        manage.hidden = true;
        form.elements.password.focus({ preventScroll: true });
      }, { signal });
    });
    tf.querySelectorAll("[data-tf-cancel]").forEach(button => {
      button.addEventListener("click", () => {
        const form = button.closest("[data-tf-form]");
        form.hidden = true;
        Nx.clearErrors(form);
        form.reset();
        manage.hidden = false;
      }, { signal });
    });
    tf.querySelectorAll("[data-tf-form]").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const turningOff = form.dataset.tfForm === "disable";
        if (turningOff) {
          const ok = await Nx.confirm({
            title: "Turn off two-step login?",
            message: "Signing in will need only your password. A stolen password would then be enough to get in.",
            confirmLabel: "Turn it off",
            tone: "danger"
          });
          if (!ok) return;
        }
        const reply = await Nx.submitForm(form, {
          url: turningOff ? "/api/admin/2fa/disable" : "/api/admin/2fa/recovery-codes",
          method: "POST",
          body: Nx.formValues(form),
          busyLabel: "Checking…"
        });
        if (!reply) return;
        if (turningOff) {
          Nx.flash(reply.message);
          window.location.reload();
        } else {
          showRecovery(reply.recoveryCodes);
        }
      }, { signal });
    });
  });
})();
