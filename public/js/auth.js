// Sign in, sign up and admin sign in forms, and the password rules checklist.
(function () {
  "use strict";

  const RULES = {
    length: value => value.length >= 8 && value.length <= 64,
    letter: value => /[A-Za-z]/.test(value),
    number: value => /\d/.test(value)
  };

  // Ticks the password rules as the user types and fills the strength bar.
  document.querySelectorAll("[data-strength]").forEach(input => {
    const field = input.closest(".field");
    const list = field.querySelector("[data-rules]");
    const bar = field.querySelector("[data-strength-bar]");
    if (!list) return;
    input.addEventListener("input", () => {
      let met = 0;
      list.querySelectorAll("[data-rule]").forEach(item => {
        const ok = RULES[item.dataset.rule](input.value);
        if (ok) met += 1;
        item.classList.toggle("is-met", ok);
        const state = item.querySelector("[data-rule-state]");
        if (state) state.textContent = ok ? " (done)" : " (not yet)";
      });
      if (bar) bar.dataset.score = input.value ? String(met) : "0";
    });
  });

  document.querySelectorAll("[data-auth-form]").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const values = Nx.formValues(form);
      const next = values.next || "/";
      delete values.next;

      // Quick checks in the browser. The server checks everything again.
      const errors = {};
      if (form.elements.name && values.name.trim().length < 2) errors.name = "Enter your name.";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email.trim())) errors.email = "Enter a valid email address.";
      if (!values.password) errors.password = "Enter your password.";
      if (form.elements.confirmPassword && values.confirmPassword !== values.password) {
        errors.confirmPassword = "Passwords do not match.";
      }
      if (Object.keys(errors).length) {
        Nx.clearErrors(form);
        Nx.showErrors(form, errors);
        return;
      }

      const result = await Nx.submitForm(form, {
        url: form.dataset.endpoint,
        body: values,
        busyLabel: form.dataset.busyLabel || "Signing in…"
      });
      if (result) {
        Nx.formAlert(form, result.message, "success");
        Nx.busy(form.querySelector('[type="submit"]'), true, "Taking you there…");
        Nx.flash(result.message);
        // replace, not assign: Back must not return to the sign-in form.
        window.location.replace(next);
      }
    });
  });
})();
