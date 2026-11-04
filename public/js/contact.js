// Contact page: sends the form to /api/contact. Every field is checked again on the server.
(function () {
  "use strict";

  const form = document.querySelector("[data-contact-form]");
  const done = document.querySelector("[data-contact-done]");
  if (!form || !done) return;

  // Live character count for the message.
  const message = form.querySelector('textarea[name="message"]');
  const counter = form.querySelector("[data-char-count]");
  const showCount = () => {
    if (counter) counter.textContent = `${message.value.length} of ${counter.dataset.charCount} characters`;
  };
  if (message) message.addEventListener("input", showCount);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const reply = await Nx.submitForm(form, { url: "/api/contact", busyLabel: "Sending…" });
    if (!reply) return;
    done.querySelector("[data-contact-done-text]").textContent = reply.message;
    form.hidden = true;
    done.hidden = false;
    done.focus();
  });

  done.querySelector("[data-contact-again]").addEventListener("click", () => {
    const name = form.elements.name.value;
    const email = form.elements.email.value;
    form.reset();
    form.elements.name.value = name;
    form.elements.email.value = email;
    showCount();
    done.hidden = true;
    form.hidden = false;
    form.elements.topic.focus();
  });
})();
