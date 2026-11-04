// Home page: the hero carousel and the "Deals of the day" countdown.
// Without this file the slides simply scroll sideways and the countdown shows the time at page load.
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- Hero carousel: auto-play, swipe, arrows and dots ----------
  const carousel = document.querySelector("[data-carousel]");
  const track = carousel && carousel.querySelector("[data-carousel-track]");
  const slides = track ? [...track.querySelectorAll("[data-slide]")] : [];
  const controls = carousel && carousel.querySelector("[data-carousel-controls]");

  if (carousel && slides.length > 1 && controls) {
    const AUTOPLAY_MS = 6000;
    const SWIPE_PX = 50;
    const dots = [...carousel.querySelectorAll("[data-carousel-dot]")];
    const pauseButton = carousel.querySelector("[data-carousel-pause]");
    let index = 0;
    let timer = 0;
    let userPaused = false;
    let hovering = false;
    let focused = false;

    carousel.classList.add("is-enhanced");
    controls.hidden = false;

    const show = (next, { announce = false } = {}) => {
      index = (next + slides.length) % slides.length;
      track.style.transform = `translateX(${-index * 100}%)`;
      slides.forEach((slide, n) => {
        const current = n === index;
        slide.setAttribute("aria-hidden", String(!current));
        // Off-screen slides cannot be reached with Tab.
        slide.inert = !current;
      });
      dots.forEach((dot, n) => {
        if (n === index) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      // Only announce slide changes the visitor asked for, never the automatic ones.
      track.setAttribute("aria-live", announce ? "polite" : "off");
    };

    const playing = () => !userPaused && !hovering && !focused && !reduced.matches && !document.hidden;
    const schedule = () => {
      clearInterval(timer);
      if (playing()) timer = setInterval(() => show(index + 1), AUTOPLAY_MS);
    };

    carousel.querySelectorAll("[data-carousel-step]").forEach(button => {
      button.addEventListener("click", () => {
        show(index + Number(button.dataset.carouselStep), { announce: true });
        schedule();
      });
    });
    dots.forEach(dot => dot.addEventListener("click", () => {
      show(Number(dot.dataset.carouselDot), { announce: true });
      schedule();
    }));

    // Pause button: aria-pressed="true" means the slideshow is paused.
    const showPaused = () => {
      pauseButton.setAttribute("aria-pressed", String(userPaused || reduced.matches));
      carousel.classList.toggle("is-paused", userPaused || reduced.matches);
    };
    pauseButton.addEventListener("click", () => {
      userPaused = !userPaused;
      showPaused();
      schedule();
    });

    carousel.addEventListener("pointerenter", event => {
      if (event.pointerType === "mouse") { hovering = true; schedule(); }
    });
    carousel.addEventListener("pointerleave", () => { hovering = false; schedule(); });
    carousel.addEventListener("focusin", () => { focused = true; schedule(); });
    carousel.addEventListener("focusout", event => {
      if (!carousel.contains(event.relatedTarget)) { focused = false; schedule(); }
    });
    document.addEventListener("visibilitychange", schedule);
    reduced.addEventListener("change", () => { showPaused(); schedule(); });

    carousel.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.target.closest("input, select, textarea")) return;
      show(index + (event.key === "ArrowRight" ? 1 : -1), { announce: true });
    });

    // Swipe with a finger, pen or mouse drag. Vertical scrolling still works (touch-action: pan-y).
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let moved = false;
    track.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      dragging = true;
      moved = false;
      startX = event.clientX;
      startY = event.clientY;
    });
    track.addEventListener("pointermove", event => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(event.clientY - startY)) {
        moved = true;
        track.setPointerCapture(event.pointerId);
        carousel.classList.add("is-dragging");
      }
      if (moved) track.style.transform = `translateX(calc(${-index * 100}% + ${dx}px))`;
    });
    const endDrag = event => {
      if (!dragging) return;
      dragging = false;
      carousel.classList.remove("is-dragging");
      if (!moved) return;
      const dx = event.clientX - startX;
      if (Math.abs(dx) > SWIPE_PX) show(index + (dx < 0 ? 1 : -1), { announce: true });
      else show(index);
      schedule();
    };
    track.addEventListener("pointerup", endDrag);
    track.addEventListener("pointercancel", endDrag);
    // A drag must not also count as a click on the slide's button.
    track.addEventListener("click", event => {
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    }, true);

    show(0);
    showPaused();
    schedule();
  }

  // ---------- Deals of the day countdown ----------
  // The server sends how long is left, so a wrong clock on this device cannot change it.
  const countdown = document.querySelector("[data-countdown]");
  if (countdown) {
    const left = Number(countdown.dataset.left);
    const endsAt = Date.now() + (Number.isFinite(left) ? left : new Date(countdown.dataset.ends).getTime() - Date.now());
    const boxes = {
      h: countdown.querySelector("[data-countdown-h]"),
      m: countdown.querySelector("[data-countdown-m]"),
      s: countdown.querySelector("[data-countdown-s]")
    };
    const pad = n => String(n).padStart(2, "0");
    let timer = 0;
    const tick = () => {
      const ms = Math.max(0, endsAt - Date.now());
      boxes.h.textContent = pad(Math.floor(ms / 3600000));
      boxes.m.textContent = pad(Math.floor(ms / 60000) % 60);
      boxes.s.textContent = pad(Math.floor(ms / 1000) % 60);
      countdown.setAttribute("aria-label", `Today's deals end in ${Math.floor(ms / 3600000)} hours and ${Math.floor(ms / 60000) % 60} minutes`);
      if (ms === 0) {
        clearInterval(timer);
        const label = countdown.querySelector(".countdown-label");
        if (label) label.textContent = "New deals are live. Refresh the page.";
      }
    };
    tick();
    timer = setInterval(tick, 1000);
  }
})();
