// Sign in, sign up and admin sign in forms.
(function () {
  "use strict";

  const RULES = {
    length: value => value.length >= 8 && value.length <= 64,
    letter: value => /[A-Za-z]/.test(value),
    number: value => /\d/.test(value)
  };

  // Ticks the password rules as the user types.
  document.querySelectorAll("[data-strength]").forEach(input => {
    const list = input.closest(".field").querySelector("[data-rules]");
    if (!list) return;
    input.addEventListener("input", () => {
      list.querySelectorAll("[data-rule]").forEach(item => {
        item.classList.toggle("is-met", RULES[item.dataset.rule](input.value));
      });
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
        busyLabel: "Signing in…"
      });
      if (result) {
        Nx.flash(result.message);
        window.location.assign(next);
      }
    });
  });
})();
