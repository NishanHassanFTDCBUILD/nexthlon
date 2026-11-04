// Wallet page: copy the referral code or link, and share the invite with the phone's share sheet.
(function () {
  "use strict";

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // http://localhost without a secure context: fall back to a hidden text box.
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.className = "sr-only";
    document.body.append(box);
    box.select();
    const done = document.execCommand("copy");
    box.remove();
    if (!done) throw new Error("copy failed");
  }

  document.querySelectorAll("[data-copy]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await copyText(button.dataset.copy);
        Nx.toast(button.dataset.copyLabel || "Copied");
      } catch {
        Nx.toast("Could not copy. Select the text and copy it yourself.", "error");
      }
    });
  });

  document.querySelectorAll("[data-share-link]").forEach(button => {
    button.addEventListener("click", async () => {
      const url = button.dataset.shareLink;
      const text = "Join me on Nexthlon for sports gear, and we both get wallet cash.";
      if (navigator.share) {
        try {
          await navigator.share({ title: "Nexthlon invite", text, url });
        } catch {
          // The share sheet was closed: nothing to do.
        }
        return;
      }
      try {
        await copyText(url);
        Nx.toast("Invite link copied. Paste it to a friend.");
      } catch {
        Nx.toast("Could not copy the link.", "error");
      }
    });
  });
})();
