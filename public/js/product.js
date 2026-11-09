// Product page: full-screen photos, delivery date by PIN code, and sharing.
(function () {
  "use strict";

  // ---------- Full-screen photo viewer (a <dialog>: focus stays inside, Escape closes it) ----------
  const lightbox = document.querySelector("[data-lightbox]");
  const opener = document.querySelector("[data-lightbox-open]");
  if (lightbox && opener && typeof lightbox.showModal === "function") {
    let photos = [];
    try {
      photos = JSON.parse(lightbox.dataset.photos || "[]");
    } catch {
      photos = [];
    }
    const img = lightbox.querySelector("[data-lightbox-img]");
    const counter = lightbox.querySelector("[data-lightbox-index]");
    const mainPhoto = document.querySelector("[data-gallery-main]");
    let index = 0;

    const show = next => {
      if (!photos.length) return;
      index = (next + photos.length) % photos.length;
      img.src = photos[index];
      if (counter) counter.textContent = String(index + 1);
    };
    const open = () => {
      const current = mainPhoto ? photos.indexOf(mainPhoto.getAttribute("src")) : 0;
      show(Math.max(0, current));
      lightbox.showModal();
      document.body.classList.add("drawer-open");
    };

    opener.addEventListener("click", open);
    // Clicking the main photo opens the viewer too (the zoom only works with a mouse hover).
    if (mainPhoto) mainPhoto.addEventListener("click", open);
    lightbox.addEventListener("close", () => document.body.classList.remove("drawer-open"));
    lightbox.querySelector("[data-lightbox-close]").addEventListener("click", () => lightbox.close());
    lightbox.querySelectorAll("[data-lightbox-step]").forEach(button => {
      button.addEventListener("click", () => show(index + Number(button.dataset.lightboxStep)));
    });
    lightbox.addEventListener("keydown", event => {
      if (event.key === "ArrowRight") show(index + 1);
      if (event.key === "ArrowLeft") show(index - 1);
    });
    lightbox.addEventListener("click", event => {
      if (event.target === lightbox || event.target.classList.contains("lightbox-stage")) lightbox.close();
    });
    // Swipe between photos.
    let startX = null;
    img.addEventListener("pointerdown", event => { startX = event.clientX; });
    img.addEventListener("pointerup", event => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    });
  }

  // ---------- Delivery date by PIN code ----------
  const delivery = document.querySelector("[data-delivery-check]");
  if (delivery) {
    const input = delivery.querySelector('input[name="pincode"]');
    const result = delivery.querySelector("[data-delivery-result]");
    const check = async pincode => {
      result.className = "delivery-result is-loading";
      result.textContent = "Checking delivery dates…";
      input.removeAttribute("aria-invalid");
      try {
        const { estimate } = await Nx.api(`/api/delivery/estimate?pincode=${encodeURIComponent(pincode)}`);
        result.className = "delivery-result is-ok";
        result.textContent = `Delivery by ${estimate.label} to ${estimate.pincode}.${estimate.orderBy ? ` Order before ${estimate.orderBy}.` : ""}`;
        try {
          localStorage.setItem("nx-pincode", estimate.pincode);
        } catch {
          /* not saved; fine */
        }
      } catch (error) {
        result.className = "delivery-result is-error";
        result.textContent = error.message;
        input.setAttribute("aria-invalid", "true");
      }
    };
    delivery.addEventListener("submit", event => {
      event.preventDefault();
      const pincode = input.value.trim();
      if (!/^[1-9][0-9]{5}$/.test(pincode)) {
        result.className = "delivery-result is-error";
        result.textContent = "Enter a valid 6-digit PIN code.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      check(pincode);
    });
    // Show the estimate straight away for the PIN code used last time.
    try {
      const saved = localStorage.getItem("nx-pincode");
      if (saved && /^[1-9][0-9]{5}$/.test(saved)) {
        input.value = saved;
        check(saved);
      }
    } catch {
      /* storage blocked */
    }
  }

  // ---------- Share ----------
  document.querySelectorAll("[data-share]").forEach(button => {
    button.addEventListener("click", async () => {
      const url = window.location.origin + window.location.pathname;
      const title = button.dataset.shareTitle || document.title;
      if (navigator.share) {
        try {
          await navigator.share({ title, url });
        } catch {
          /* the shopper closed the share sheet */
        }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        Nx.toast("Link copied. Paste it anywhere to share.");
      } catch {
        window.prompt("Copy this link to share:", url);
      }
    });
  });
})();
