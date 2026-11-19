// Guest order tracking: asks the server for a safe summary of one order and draws it.
// Everything from the server is shown with textContent, never as HTML.
(function () {
  'use strict';

  const form = document.querySelector('[data-track-form]');
  const result = document.querySelector('[data-track-result]');
  if (!form || !result) return;

  const fmt = (value) =>
    value
      ? new Date(value).toLocaleString('en-IN', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : '';
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function draw(order) {
    result.replaceChildren();
    const head = el('div', 'track-head');
    head.append(
      el('p', 'section-kicker', 'Order ' + order.orderId),
      el('h2', 'track-status', order.statusLabel),
      el(
        'p',
        'muted',
        'Placed ' +
          fmt(order.placedAt) +
          ' · ' +
          order.itemCount +
          (order.itemCount === 1 ? ' item' : ' items'),
      ),
    );
    result.append(head);

    if (order.shipments.length) {
      const list = el('div', 'track-shipments');
      order.shipments.forEach((s) => {
        const box = el('article', 'track-shipment');
        box.append(
          el('h3', '', s.courier + ' · ' + s.trackingNumber),
          el(
            'p',
            'muted',
            (s.status || 'Booked') +
              (s.expectedAt ? ' · expected by ' + fmt(s.expectedAt) : ''),
          ),
        );
        if (s.events.length) {
          const ol = el('ol', 'track-events');
          s.events.forEach((e) => {
            const li = el('li');
            li.append(
              el('strong', '', e.status),
              document.createTextNode(
                (e.location ? ' · ' + e.location : '') + ' · ' + fmt(e.at),
              ),
            );
            ol.append(li);
          });
          box.append(ol);
        }
        list.append(box);
      });
      result.append(list);
    }

    if (order.timeline.length) {
      const history = el('section', 'track-history');
      history.append(el('h3', '', 'History'));
      const ul = el('ol', 'track-events');
      order.timeline.forEach((h) => {
        const li = el('li');
        li.append(
          el('strong', '', h.status),
          document.createTextNode(
            (h.note ? ' · ' + h.note : '') + ' · ' + fmt(h.at),
          ),
        );
        ul.append(li);
      });
      history.append(ul);
      result.append(history);
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const alert = form.querySelector('[data-form-alert]');
    alert.textContent = '';
    Nx.busy(button, true, 'Checking…');
    try {
      const order = await Nx.api('/api/orders/track', {
        method: 'POST',
        body: {
          orderId: form.elements.orderId.value,
          phone: form.elements.phone.value,
        },
      });
      draw(order);
    } catch (error) {
      result.replaceChildren();
      alert.textContent = error.message;
    } finally {
      Nx.busy(button, false);
    }
  });
})();
