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
        Nx.toast(result.message);
      }
    });
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
      try {
        const result = await Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDelete)}`, { method: "DELETE" });
        reloadWith(result.message);
      } catch (error) {
        Nx.toast(error.message, "error");
      }
    });
  });

  document.querySelectorAll("[data-address-default]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await Nx.api(`/api/addresses/${encodeURIComponent(button.dataset.addressDefault)}/default`, { method: "PATCH" });
        reloadWith(result.message);
      } catch (error) {
        button.disabled = false;
        Nx.toast(error.message, "error");
      }
    });
  });
})();
