// Sign in, create account and admin sign in. The server checks everything again; this file only
// makes the forms pleasant: the 3D card flip between /login and /signup (the URL follows), live
// checks as you type, a password strength meter, email typo hints, a Caps Lock warning, the
// show/hide eye, the submit button states and the transition into the store.
(function () {
  "use strict";

  const page = document.querySelector("[data-auth]");
  if (!page) return;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const wait = ms => new Promise(resolve => setTimeout(resolve, reduced() ? Math.min(ms, 120) : ms));
  page.classList.add("is-enhanced");

  // ---------- The glass card tilts towards the mouse, and its border glows where the cursor is ----------
  document.querySelectorAll("[data-tilt-card]").forEach(card => {
    let frame = 0;
    card.addEventListener("pointermove", event => {
      if (event.pointerType !== "mouse" || !finePointer.matches) return;
      const { clientX, clientY } = event;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = card.getBoundingClientRect();
        const x = (clientX - box.left) / box.width;
        const y = (clientY - box.top) / box.height;
        card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        if (reduced()) return;
        card.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
        card.style.setProperty("--ry", `${((x - 0.5) * 6).toFixed(2)}deg`);
      });
    });
    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--rx", "0deg");
      card.style.setProperty("--ry", "0deg");
    });
  });

  // ---------- Sign in ↔ create account: the card flips and the URL follows ----------
  const flip = page.querySelector("[data-auth-flip]");
  const switchLinks = [...page.querySelectorAll("[data-auth-to]")];
  const faces = { login: page.querySelector('[data-face="login"]'), signup: page.querySelector('[data-face="signup"]') };
  const TITLES = { login: "Sign in | Nexthlon", signup: "Create your account | Nexthlon" };

  function showMode(mode, { focus = true } = {}) {
    if (!faces[mode]) return;
    page.dataset.mode = mode;
    switchLinks.forEach(link => {
      if (link.dataset.authTo === mode) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    Object.entries(faces).forEach(([name, face]) => {
      const active = name === mode;
      face.inert = !active;
      if (active) face.removeAttribute("aria-hidden");
      else face.setAttribute("aria-hidden", "true");
    });
    document.title = TITLES[mode];
    if (focus) {
      // After the flip, the first field of the new side.
      setTimeout(() => {
        const first = faces[mode].querySelector("input:not([type=hidden])");
        if (first) first.focus({ preventScroll: true });
      }, reduced() ? 0 : 420);
    }
  }

  if (flip && faces.login && faces.signup) {
    switchLinks.forEach(link => {
      link.addEventListener("click", event => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        const mode = link.dataset.authTo;
        if (mode === page.dataset.mode) return;
        const url = new URL(link.href, window.location.href);
        window.history.pushState({ mode }, "", url.pathname + url.search);
        showMode(mode);
      });
    });
    window.addEventListener("popstate", () => {
      const mode = window.location.pathname.startsWith("/signup") ? "signup" : "login";
      showMode(mode, { focus: false });
    });
  }

  // ---------- Field helpers ----------
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const NAME = /^\p{L}[\p{L} .'-]*$/u;
  const DOMAINS = ["gmail.com", "yahoo.com", "yahoo.co.in", "hotmail.com", "outlook.com", "icloud.com", "rediffmail.com", "live.com", "protonmail.com"];

  // How many single-letter edits turn a into b (small strings only).
  function distance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let prev = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const keep = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = keep;
      }
    }
    return row[b.length];
  }

  // "asha@gmial.com" → "asha@gmail.com" (or null when it looks fine).
  function emailFix(value) {
    const at = value.lastIndexOf("@");
    if (at < 1) return null;
    const domain = value.slice(at + 1).toLowerCase();
    if (!domain || DOMAINS.includes(domain)) return null;
    let best = null;
    DOMAINS.forEach(candidate => {
      const d = distance(domain, candidate);
      if (d > 0 && d <= 2 && (!best || d < best.d)) best = { d, candidate };
    });
    return best ? `${value.slice(0, at + 1)}${best.candidate}` : null;
  }

  const RULES = {
    length: v => v.length >= 8 && v.length <= 64,
    letter: v => /[A-Za-z]/.test(v),
    number: v => /\d/.test(v),
    upper: v => /[A-Z]/.test(v),
    symbol: v => /[^A-Za-z0-9\s]/.test(v)
  };

  // Mirrors the server's rules, to help while typing. Returns a message or "".
  function problemFor(input, form) {
    const value = input.value;
    switch (input.name) {
      case "name": {
        const name = value.trim().replace(/\s+/g, " ");
        if (name.length < 2) return "Enter your name (at least 2 letters).";
        if (!NAME.test(name)) return "Use letters, spaces, dots, apostrophes or hyphens only.";
        return "";
      }
      case "email":
        return EMAIL.test(value.trim()) ? "" : "Enter a valid email address.";
      case "password":
        if (form.dataset.kind !== "signup") return value ? "" : "Enter your password.";
        if (!RULES.length(value)) return "Use 8 to 64 characters.";
        if (!RULES.letter(value) || !RULES.number(value)) return "Include at least one letter and one number.";
        return "";
      case "confirmPassword":
        return value && value === form.elements.password.value ? "" : "Passwords do not match.";
      case "referralCode": {
        const code = value.replace(/\s+/g, "").toUpperCase();
        return !code || /^[A-Z0-9]{6,12}$/.test(code) ? "" : "A referral code has 6 to 12 letters and numbers.";
      }
      default:
        return "";
    }
  }

  function setFieldState(input, form, { show = false } = {}) {
    const field = input.closest("[data-field]");
    if (!field) return true;
    const problem = problemFor(input, form);
    const slot = form.querySelector(`[data-error-for="${input.name}"]`);
    const touched = field.classList.contains("is-touched") || show;
    field.classList.toggle("is-valid", !problem && input.value !== "");
    if (touched && problem) {
      const fresh = slot && slot.textContent !== problem;
      if (slot) slot.textContent = problem;
      input.setAttribute("aria-invalid", "true");
      if (fresh) {
        field.classList.remove("is-shaking");
        void field.offsetWidth;
        field.classList.add("is-shaking");
      }
    } else if (!problem) {
      if (slot) slot.textContent = "";
      input.removeAttribute("aria-invalid");
    }
    return !problem;
  }

  // Strength 0–4 from the checklist; the bar and label follow.
  function updateMeter(form) {
    const box = form.querySelector("[data-strength-box]");
    if (!box) return;
    const value = form.elements.password.value;
    let met = 0;
    box.querySelectorAll("[data-check]").forEach(item => {
      const ok = RULES[item.dataset.check](value);
      if (ok) met += 1;
      if (item.classList.contains("is-met") !== ok) item.classList.toggle("is-met", ok);
      const state = item.querySelector("[data-check-state]");
      if (state) state.textContent = ok ? " (done)" : " (not yet)";
    });
    const required = RULES.length(value) && RULES.letter(value) && RULES.number(value);
    const score = !value ? 0 : !required ? 1 : met >= 5 && value.length >= 12 ? 4 : met >= 4 ? 3 : 2;
    box.dataset.score = String(score);
    const label = box.querySelector("[data-meter-label]");
    label.textContent = ["Use 8 or more characters with a letter and a number.", "Too weak so far.", "Good. Add an uppercase letter or a symbol for more.", "Strong password.", "Very strong password."][score];
  }

  // ---------- Each form ----------
  document.querySelectorAll("[data-auth-form]").forEach(form => {
    const submit = form.querySelector("[data-submit]");
    const inputs = [...form.querySelectorAll("[data-field] input")];

    inputs.forEach(input => {
      const field = input.closest("[data-field]");
      input.addEventListener("blur", () => {
        if (input.value) field.classList.add("is-touched");
        setFieldState(input, form);
        if (input.name === "email") showEmailFix(input);
      });
      input.addEventListener("input", () => {
        setFieldState(input, form);
        if (input.name === "password") {
          updateMeter(form);
          if (form.elements.confirmPassword && form.elements.confirmPassword.value) setFieldState(form.elements.confirmPassword, form);
        }
        if (input.name === "email") hideEmailFix(input);
        if (input.name === "referralCode") input.value = input.value.toUpperCase();
      });
      // Caps Lock warning on password fields.
      if (input.type === "password") {
        const caps = field.querySelector("[data-caps]");
        const check = event => {
          if (caps && typeof event.getModifierState === "function") caps.hidden = !event.getModifierState("CapsLock");
        };
        input.addEventListener("keydown", check);
        input.addEventListener("keyup", check);
        input.addEventListener("blur", () => { if (caps) caps.hidden = true; });
      }
    });

    // "Did you mean gmail.com?"
    function showEmailFix(input) {
      const field = input.closest("[data-field]");
      const fix = emailFix(input.value.trim());
      let hint = field.querySelector("[data-typo]");
      if (!fix) {
        if (hint) hint.remove();
        return;
      }
      if (!hint) {
        hint = document.createElement("p");
        hint.className = "au-hint au-typo";
        hint.setAttribute("data-typo", "");
        hint.setAttribute("role", "status");
        field.append(hint);
      }
      hint.textContent = "Did you mean ";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link-btn";
      button.textContent = fix;
      button.addEventListener("click", () => {
        input.value = fix;
        hint.remove();
        setFieldState(input, form);
        input.focus();
      });
      hint.append(button, "?");
    }
    function hideEmailFix(input) {
      const hint = input.closest("[data-field]").querySelector("[data-typo]");
      if (hint) hint.remove();
    }

    // Show/hide password: the eye blinks as it changes.
    form.querySelectorAll("[data-eye]").forEach(eye => {
      eye.addEventListener("click", () => {
        const input = document.getElementById(eye.getAttribute("aria-controls"));
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        eye.setAttribute("aria-pressed", String(show));
        eye.setAttribute("aria-label", show ? "Hide password" : "Show password");
        eye.classList.remove("is-blinking");
        void eye.offsetWidth;
        eye.classList.add("is-blinking");
        input.focus();
      });
    });

    // The card shakes when something is wrong.
    function shakeCard() {
      const card = form.closest("[data-tilt-card]");
      if (!card || reduced()) return;
      card.classList.remove("is-shaking");
      void card.offsetWidth;
      card.classList.add("is-shaking");
    }

    function setButton(state) {
      submit.dataset.state = state;
      submit.disabled = state === "loading" || state === "done";
      submit.setAttribute("aria-busy", String(state === "loading"));
    }

    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submit.disabled) return;
      inputs.forEach(input => input.closest("[data-field]").classList.add("is-touched"));
      const results = inputs.map(input => setFieldState(input, form, { show: true }));
      const firstBad = inputs[results.indexOf(false)];
      if (firstBad) {
        Nx.formAlert(form, "Please fix the highlighted fields.");
        shakeCard();
        firstBad.focus();
        return;
      }
      const values = Nx.formValues(form);
      const next = values.next || "/";
      delete values.next;
      if (values.referralCode) values.referralCode = values.referralCode.replace(/\s+/g, "").toUpperCase();

      Nx.clearErrors(form);
      setButton("loading");
      let result;
      try {
        result = await Nx.api(form.dataset.endpoint, { method: "POST", body: values });
      } catch (error) {
        setButton("idle");
        Nx.showErrors(form, error.fieldErrors);
        let message = error.message;
        // How many tries are left before the rate limit pauses sign-ins.
        const header = error.headers && error.headers.get("RateLimit");
        const left = header && /remaining=(\d+)/.exec(header);
        if (error.status === 429) {
          message = "Too many attempts from this device. Please wait 15 minutes, then try again.";
        } else if (left && Number(left[1]) <= 5 && form.dataset.kind !== "signup") {
          message += ` ${left[1]} ${Number(left[1]) === 1 ? "attempt" : "attempts"} left before a 15-minute pause.`;
        }
        Nx.formAlert(form, message);
        shakeCard();
        return;
      }

      // Success: the button turns into a tick, then the page zooms into the store.
      setButton("done");
      Nx.formAlert(form, result.message, "success");
      await wait(650);
      if (form.dataset.kind === "signup") await celebrate(result);
      await zoomOut();
      // replace, not assign: Back must not return to the sign-in form.
      window.location.replace(next);
    });
  });

  // ---------- After creating an account: confetti and a welcome ----------
  async function celebrate(result) {
    const box = page.querySelector("[data-auth-success]");
    if (!box) return;
    const first = (result.user && result.user.name ? result.user.name : "").split(" ")[0];
    box.querySelector("[data-success-title]").textContent = first ? `Welcome to Nexthlon, ${first}!` : "Welcome to Nexthlon!";
    box.querySelector("[data-success-text]").textContent = /wallet/.test(result.message) ? result.message.replace(/^Welcome to Nexthlon! /, "") : "Your account is ready. Let's get you some gear.";
    box.hidden = false;
    void box.offsetWidth;
    box.classList.add("is-open");
    if (Nx.confetti) Nx.confetti(box.querySelector("[data-auth-confetti]"), { keep: true });
    await wait(1700);
  }

  // The whole page zooms and fades into the store.
  async function zoomOut() {
    const zoom = page.querySelector("[data-auth-zoom]");
    if (!zoom || reduced()) return;
    zoom.classList.add("is-active");
    page.classList.add("is-leaving");
    await wait(520);
  }

  // ---------- The motto turns over, one line after another ----------
  const motto = page.querySelector("[data-motto]");
  if (motto && !reduced()) {
    const lines = (motto.dataset.lines || "").split("|").filter(Boolean);
    let index = 0;
    const render = text => {
      motto.textContent = "";
      [...text].forEach((ch, i) => {
        const span = document.createElement("span");
        span.className = "au-motto-char";
        span.style.setProperty("--i", String(i));
        span.textContent = ch === " " ? " " : ch;
        motto.append(span);
      });
    };
    if (lines.length > 1) {
      render(lines[0]);
      setInterval(() => {
        if (document.hidden) return;
        motto.classList.add("is-out");
        setTimeout(() => {
          index = (index + 1) % lines.length;
          render(lines[index]);
          motto.classList.remove("is-out");
        }, 450);
      }, 3200);
    }
  }

  // ---------- Admin terminal: types its lines one after another ----------
  const terminal = page.querySelector("[data-terminal]");
  if (terminal) {
    const lines = (terminal.dataset.text || "").split("|");
    if (reduced()) {
      terminal.textContent = lines.join("\n");
    } else {
      terminal.textContent = "";
      let line = 0;
      let char = 0;
      const type = () => {
        if (line >= lines.length) {
          terminal.classList.add("is-done");
          return;
        }
        if (char === 0 && line > 0) terminal.append("\n");
        terminal.append(lines[line][char]);
        char += 1;
        if (char >= lines[line].length) {
          line += 1;
          char = 0;
          setTimeout(type, 420);
        } else {
          setTimeout(type, 28 + Math.random() * 40);
        }
      };
      setTimeout(type, 500);
    }
  }
})();
