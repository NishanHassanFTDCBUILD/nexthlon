// Admin users page: block and unblock customers without reloading the page.
(function () {
  "use strict";

  document.querySelectorAll("[data-block-user]").forEach(button => {
    button.addEventListener("click", async () => {
      const isBlocked = button.dataset.blocked === "true";
      const name = button.dataset.name;
      const confirmed = await Nx.confirm({
        title: isBlocked ? `Unblock ${name}?` : `Block ${name}?`,
        message: isBlocked
          ? "They will be able to sign in and use their account again."
          : "They will be signed out right away and cannot sign in until you unblock them.",
        confirmLabel: isBlocked ? "Unblock" : "Block customer"
      });
      if (!confirmed) return;

      button.disabled = true;
      try {
        const result = await Nx.api(`/api/admin/customers/${encodeURIComponent(button.dataset.blockUser)}/block`, {
          method: "PATCH",
          body: { isBlocked: !isBlocked }
        });
        const nowBlocked = result.customer.isBlocked;
        const row = button.closest("tr");
        const status = row.querySelector("[data-status]");
        status.textContent = nowBlocked ? "Blocked" : "Active";
        status.className = `pill ${nowBlocked ? "pill-red" : "pill-green"}`;
        button.dataset.blocked = String(nowBlocked);
        button.textContent = nowBlocked ? "Unblock" : "Block";
        button.className = `btn btn-sm ${nowBlocked ? "btn-secondary" : "btn-danger-soft"}`;
        Nx.toast(result.message);
      } catch (error) {
        Nx.toast(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
})();
