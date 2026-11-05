// Questions & Answers on the product page: ask, answer, mark helpful, search and "show more".
// No libraries. Every card is built with createElement and textContent, never innerHTML, so a
// question containing markup can only ever appear as text.
(function () {
  "use strict";

  const section = document.querySelector("[data-qa]");
  if (!section) return;

  const productId = section.dataset.productId;
  const list = section.querySelector("[data-qa-list]");
  const searchForm = section.querySelector("[data-qa-search]");
  const askForm = section.querySelector("[data-qa-ask]");
  const askOpen = section.querySelector("[data-qa-ask-open]");
  const moreButton = section.querySelector("[data-qa-more]");
  const errorBox = section.querySelector("[data-qa-error]");
  const emptyBox = section.querySelector("[data-qa-empty]");
  // Only signed-in customers get the ask form, so its presence is the test.
  const signedIn = Boolean(askForm);

  const iconSvg = (name, extra = "i-xs") => `<svg class="i ${extra}" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const shortDate = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const when = value => (value ? shortDate.format(new Date(value)) : "");

  // ---------- Drawing one question ----------

  function helpfulButton(questionId, answerId, count, voted) {
    const button = el("button", `link-btn qa-vote${voted ? " is-voted" : ""}`);
    button.type = "button";
    button.dataset.qaHelpful = questionId;
    if (answerId) button.dataset.answerId = answerId;
    button.setAttribute("aria-pressed", String(voted));
    button.innerHTML = `${iconSvg("check")} Helpful `;
    button.append(el("span", "", String(count)));
    button.querySelector("span").dataset.qaCount = "";
    return button;
  }

  function markedLine(mark, body) {
    const line = el("p");
    const badge = el("span", "qa-mark", mark);
    badge.setAttribute("aria-hidden", "true");
    line.append(badge, el("span", "", body));
    return line;
  }

  function answerNode(questionId, answer) {
    const item = el("li", `qa-a${answer.byTeam ? " is-official" : ""}`);
    item.dataset.qaAnswerItem = answer.id;
    item.append(markedLine("A", answer.body));
    const meta = el("p", "qa-meta");
    meta.append(el("strong", "", answer.author));
    if (answer.byTeam) {
      const badge = el("span", "qa-badge");
      badge.innerHTML = `${iconSvg("shield")} Nexthlon`;
      meta.append(" ", badge);
    }
    meta.append(` · ${when(answer.at)}`);
    if (signedIn) {
      meta.append(" · ", helpfulButton(questionId, answer.id, answer.helpful, answer.votedByMe));
    } else if (answer.helpful) {
      meta.append(` · ${answer.helpful} found this helpful`);
    }
    item.append(meta);
    return item;
  }

  function questionNode(question) {
    const item = el("li", "qa-entry");
    item.dataset.qaItem = question.id;
    const q = markedLine("Q", question.body);
    q.className = "qa-q";
    item.append(q);

    const meta = el("p", "qa-meta", `${question.author} · ${when(question.createdAt)}`);
    if (signedIn) {
      meta.append(" · ", helpfulButton(question.id, null, question.helpful, question.votedByMe));
    } else if (question.helpful) {
      meta.append(` · ${question.helpful} found this helpful`);
    }
    item.append(meta);

    if (question.answers.length) {
      const answers = el("ul", "qa-answers");
      question.answers.forEach(answer => answers.append(answerNode(question.id, answer)));
      item.append(answers);
    } else {
      const waiting = el("p", "qa-waiting muted");
      waiting.innerHTML = `${iconSvg("clock")} No answer yet.`;
      item.append(waiting);
    }

    if (signedIn) {
      const form = el("form", "qa-reply-form");
      form.dataset.qaReply = question.id;
      form.noValidate = true;
      const label = el("label", "sr-only", "Answer this question");
      label.htmlFor = `qa-reply-${question.id}`;
      const input = el("input");
      input.id = `qa-reply-${question.id}`;
      input.name = "body";
      input.maxLength = 1000;
      input.autocomplete = "off";
      input.placeholder = "Know the answer? Help another shopper";
      const button = el("button", "btn btn-ghost btn-sm", "Answer");
      button.type = "submit";
      form.append(label, input, button);
      item.append(form);
    }
    return item;
  }

  // Replaces one question's card in place, keeping its position in the list.
  function replaceQuestion(question) {
    const existing = list.querySelector(`[data-qa-item="${question.id}"]`);
    const fresh = questionNode(question);
    if (existing) existing.replaceWith(fresh);
    else list.prepend(fresh);
    if (emptyBox) emptyBox.hidden = true;
  }

  // ---------- Loading ----------

  let page = 1;
  let search = (searchForm && searchForm.elements.q.value.trim()) || "";

  async function load({ append = false } = {}) {
    const params = new URLSearchParams({ page: String(page) });
    if (search) params.set("q", search);
    if (errorBox) errorBox.hidden = true;
    try {
      const data = await Nx.api(`/api/products/${encodeURIComponent(productId)}/questions?${params}`);
      if (!append) list.textContent = "";
      data.questions.forEach(question => list.append(questionNode(question)));
      if (emptyBox) {
        emptyBox.hidden = data.total > 0;
        emptyBox.textContent = search
          ? `No question matches "${search}".`
          : "No questions yet. Be the first to ask about this product.";
      }
      if (moreButton) {
        moreButton.hidden = data.pagination.page >= data.pagination.pages;
        moreButton.dataset.nextPage = String(data.pagination.page + 1);
      }
      return data;
    } catch (error) {
      if (errorBox) errorBox.hidden = false;
      else Nx.toast(error.message, "error");
      return null;
    }
  }

  // ---------- Events ----------

  if (searchForm) {
    searchForm.addEventListener("submit", event => {
      event.preventDefault();
      search = searchForm.elements.q.value.trim();
      page = 1;
      load();
    });
  }

  if (moreButton) {
    moreButton.addEventListener("click", async () => {
      page = Number(moreButton.dataset.nextPage) || page + 1;
      Nx.busy(moreButton, true, "Loading…");
      await load({ append: true });
      Nx.busy(moreButton, false);
    });
  }

  const retry = section.querySelector("[data-qa-retry]");
  if (retry) retry.addEventListener("click", () => load());

  if (askOpen && askForm) {
    const showAsk = show => {
      askForm.hidden = !show;
      askOpen.setAttribute("aria-expanded", String(show));
      if (show) askForm.elements.body.focus();
    };
    askOpen.addEventListener("click", () => showAsk(askForm.hidden));
    const cancel = section.querySelector("[data-qa-ask-cancel]");
    if (cancel) cancel.addEventListener("click", () => { askForm.reset(); showAsk(false); });

    askForm.addEventListener("submit", async event => {
      event.preventDefault();
      const reply = await Nx.submitForm(askForm, {
        url: `/api/products/${encodeURIComponent(productId)}/questions`,
        busyLabel: "Posting…"
      });
      if (!reply) return;
      askForm.reset();
      showAsk(false);
      replaceQuestion(reply.question);
      Nx.toast(reply.message);
    });
  }

  // Answering, delegated so questions loaded later work too.
  section.addEventListener("submit", async event => {
    const form = event.target.closest("[data-qa-reply]");
    if (!form) return;
    event.preventDefault();
    const body = form.elements.body.value.trim();
    if (body.length < 2) {
      Nx.toast("Please write an answer.", "error");
      form.elements.body.focus();
      return;
    }
    const button = form.querySelector("button");
    Nx.busy(button, true, "Posting…");
    try {
      const reply = await Nx.api(`/api/questions/${encodeURIComponent(form.dataset.qaReply)}/answers`, { method: "POST", body: { body } });
      replaceQuestion(reply.question);
      Nx.toast(reply.message);
    } catch (error) {
      Nx.busy(button, false);
      Nx.toast(error.message, "error");
    }
  });

  // "Helpful" on a question or an answer. The server is the one keeping score; this only
  // redraws the card with what came back.
  section.addEventListener("click", async event => {
    const button = event.target instanceof Element ? event.target.closest("[data-qa-helpful]") : null;
    if (!button) return;
    button.disabled = true;
    try {
      const answerId = button.dataset.answerId || undefined;
      const reply = await Nx.api(`/api/questions/${encodeURIComponent(button.dataset.qaHelpful)}/helpful`, {
        method: "POST",
        body: answerId ? { answerId } : {}
      });
      replaceQuestion(reply.question);
    } catch (error) {
      button.disabled = false;
      Nx.toast(error.message, "error");
    }
  });
})();
