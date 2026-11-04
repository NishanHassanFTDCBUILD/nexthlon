// Profile page: account details, password change, and the address book.
(function () {
  "use strict";

  function reloadWith(message) {
    Nx.flash(message);
    window.location.reload();
  }

  // ---------- Account details ----------
  const profileForm = document.querySelector("[data-profile-form]");
  if (profileForm) {
    profileForm.addEventListener("submit", async event => {
      event.preventDefault();
      const result = await Nx.submitForm(profileForm, { url: "/api/profile", method: "PATCH", busyLabel: "Saving…" });
      if (result) reloadWith(result.message);
    });
  }

  // ---------- Password ----------
  const passwordForm = document.querySelector("[data-password-form]");
  if (passwordForm) {
    passwordForm.addEventListener("submit", async event => {
      event.preventDefault();
      const values = Nx.formValues(passwordForm);
      if (values.newPassword !== values.confirmPassword) {
        Nx.clearErrors(passwordForm);
        Nx.showErrors(passwordForm, { confirmPassword: "Passwords do not match." });
        return;
      }
      const result = await Nx.submitForm(passwordForm, {
        url: "/api/profile/password",
        method: "PATCH",
        body: values,
        busyLabel: "Updating…"
      });
      if (result) {
        passwordForm.reset();
        passwordForm.querySelectorAll("[data-rules] .is-met").forEach(item => item.classList.remove("is-met"));
        const bar = passwordForm.querySelector("[data-strength-bar]");
        if (bar) bar.dataset.score = "0";
        Nx.formAlert(passwordForm, result.message, "success");
        Nx.toast(result.message);
      }
    });
  }

  // ---------- Section menu ----------
  // Highlights the section currently on screen in the side menu.
  const navLinks = [...document.querySelectorAll("[data-account-nav] a[href^='#']")];
  if (navLinks.length && "IntersectionObserver" in window) {
    const mark = id => navLinks.forEach(link => {
      const on = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-active", on);
      if (on) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) mark(entry.target.id); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    navLinks.forEach(link => {
      const section = document.querySelector(link.getAttribute("href"));
      if (section) observer.observe(section);
    });
    mark((location.hash || navLinks[0].getAttribute("href")).slice(1));
  }

  // ---------- Address book ----------
  const dialog = document.getElementById("address-dialog");
  const addressForm = document.querySelector("[data-address-form]");
  if (!dialog || !addressForm) return;
  const title = dialog.querySelector("#address-dialog-title");

  function openAddressDialog(address) {
    addressForm.reset();
    Nx.clearErrors(addressForm);
    addressForm.elements.id.value = address ? address.id : "";
    if (address) {
      for (const key of ["fullName", "phone", "line1", "line2", "landmark", "city", "state", "pincode"]) {
        addressForm.elements[key].value = address[key] || "";
      }
      addressForm.elements.isDefault.checked = Boolean(address.isDefault);
    }
    title.textContent = address ? "Edit address" : "Add a new address";
    addressForm.querySelector('[type="submit"]').textContent = address ? "Save changes" : "Save address";
    dialog.showModal();
    addressForm.elements.fullName.focus();
  }

  document.querySelectorAll("[data-address-add]").forEach(button => {
    button.addEventListener("click", () => openAddressDialog(null));
  });

  document.querySelectorAll("[data-address-edit]").forEach(button => {
    button.addEventListener("click", () => openAddressDialog(JSON.parse(button.dataset.address)));
  });

  dialog.querySelectorAll("[data-dialog-close]").forEach(button => {
    button.addEventListener("click", () => dialog.close());
  });

  addressForm.addEventListener("submit", async event => {
    event.preventDefault();
    const values = Nx.formValues(addressForm);
    const id = values.id;
    delete values.id;
    const result = await Nx.submitForm(addressForm, {
      url: id ? `/api/addresses/${encodeURIComponent(id)}` : "/api/addresses",
      method: id ? "PATCH" : "POST",
      body: values,
      busyLabel: "Saving…"
    });
    if (result) reloadWith(result.message);
  });

  document.querySelectorAll("[data-address-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      const confirmed = await Nx.confirm({
        title: "Remove this address?",
        message: `The address for ${button.dataset.name} will be deleted. This cannot be undone.`,
        confirmLabel: "Remove address"
      });
      if (!confirmed) return;
      Nx.busy(button, true, "Removing…");
      try {
        const result = await Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDelete)}`, { method: "DELETE" });
        reloadWith(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-address-default]").forEach(button => {
    button.addEventListener("click", async () => {
      Nx.busy(button, true, "Saving…");
      try {
        const result = await Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDefault)}/default`, { method: "PATCH" });
        reloadWith(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });
  });
})();
