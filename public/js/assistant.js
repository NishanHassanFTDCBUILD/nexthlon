// Shopping assistant: a small chat panel. The shopper types a question, the server answers it
// (POST /api/assistant/message), and the reply shows text, product cards and links. Everything is
// built with textContent, never innerHTML, so a typed question cannot inject markup.
(function () {
  'use strict';

  const panel = document.getElementById('assistant-panel');
  const openButton = document.querySelector('[data-assistant-open]');
  if (!panel || !openButton) return;

  const log = panel.querySelector('[data-assistant-log]');
  const form = panel.querySelector('[data-assistant-form]');
  const input = panel.querySelector('#assistant-input');
  const closeButton = panel.querySelector('[data-assistant-close]');
  let busy = false;

  const money = (paise) =>
    '₹' + Math.round(paise / 100).toLocaleString('en-IN');

  function bubble(text, who) {
    const p = document.createElement('p');
    p.className = 'assistant-bubble ' + (who === 'you' ? 'is-you' : 'is-bot');
    p.textContent = text;
    log.appendChild(p);
    return p;
  }

  function productCard(product) {
    const a = document.createElement('a');
    a.className = 'assistant-product';
    a.href = '/products/' + encodeURIComponent(product.slug);
    if (product.image) {
      const img = document.createElement('img');
      img.src = product.image;
      img.alt = '';
      img.width = 56;
      img.height = 56;
      img.loading = 'lazy';
      a.appendChild(img);
    }
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = product.name;
    const price = document.createElement('span');
    price.className = 'assistant-price';
    price.textContent =
      money(product.price) + (product.inStock ? '' : ' · sold out');
    text.append(name, price);
    a.appendChild(text);
    return a;
  }

  function linkChip(link) {
    const a = document.createElement('a');
    a.className = 'assistant-link';
    a.href = link.href;
    a.textContent = link.label;
    return a;
  }

  function showReply(reply) {
    const bot = bubble(reply.reply, 'bot');
    if (reply.products && reply.products.length) {
      const wrap = document.createElement('div');
      wrap.className = 'assistant-products';
      reply.products.forEach((p) => wrap.appendChild(productCard(p)));
      bot.after(wrap);
    }
    if (reply.links && reply.links.length) {
      const wrap = document.createElement('div');
      wrap.className = 'assistant-links';
      reply.links.forEach((l) => wrap.appendChild(linkChip(l)));
      log.appendChild(wrap);
    }
    log.scrollTop = log.scrollHeight;
  }

  async function ask(text) {
    busy = true;
    form.querySelector('button').disabled = true;
    try {
      const response = await fetch('/api/assistant/message', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: text}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(
          data.message || 'Something went wrong. Please try again.',
        );
      showReply(data);
    } catch (error) {
      bubble(error.message, 'bot');
    } finally {
      busy = false;
      form.querySelector('button').disabled = false;
      log.scrollTop = log.scrollHeight;
    }
  }

  function setOpen(open) {
    panel.hidden = !open;
    openButton.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  }

  openButton.addEventListener('click', () => setOpen(panel.hidden));
  closeButton.addEventListener('click', () => {
    setOpen(false);
    openButton.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      setOpen(false);
      openButton.focus();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    bubble(text, 'you');
    input.value = '';
    ask(text);
  });
})();
