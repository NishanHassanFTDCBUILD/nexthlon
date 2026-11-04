// Admin dashboard: the referral reward setting. Asks before saving and confirms with a toast.
(function () {
  "use strict";

  const form = document.querySelector("[data-referral-form]");
  if (!form) return;

  form.addEventListener("submit", async event => {
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
  });
})();
