// Admin dashboard: hand-drawn SVG charts (no library), KPI count-up, top-products tabs, quick
// restock and clickable order rows. Charts take their colours from CSS classes (theme tokens), so
// they follow light and dark mode. Each chart has a tooltip on hover and with the arrow keys, and
// a data table under it. Motion is light and happens once: bars and lines draw in, numbers count
// up. With "reduce motion" everything simply appears. Redrawn (without motion) on resize.
(function () {
  'use strict';

  const Pages = window.NxPages;
  if (!Pages || !Pages.define) return;
  const NS = 'http://www.w3.org/2000/svg';
  const reduced = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const STATUS_CLASS = {
    placed: 'c1',
    confirmed: 'c2',
    shipped: 'c3',
    out_for_delivery: 'c4',
    delivered: 'ok',
    cancelled: 'bad',
    return_requested: 'warn',
    returned: 'c8',
  };
  const PAYMENT_CLASS = {razorpay: 'c1', wallet: 'c3', cod: 'c2'};

  // ---------- Small helpers ----------
  function svgEl(tag, attrs = {}, parent = null) {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs))
      node.setAttribute(key, String(value));
    if (parent) parent.append(node);
    return node;
  }
  const money = (paise) => Nx.formatPrice(paise);
  // Short money for axes: ₹950, ₹12.5k, ₹3.2L, ₹1.1Cr (Indian units).
  function shortMoney(paise) {
    const r = paise / 100;
    if (r >= 1e7) return `₹${(r / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
    if (r >= 1e5) return `₹${(r / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
    if (r >= 1e3) return `₹${(r / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
    return `₹${Math.round(r)}`;
  }
  // A round axis maximum (1, 2, 5 × 10^n) at or above the value.
  function niceMax(value) {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value);
    return step * power;
  }
  // An axis maximum for counts: whole-number steps (so labels are 0, 3, 6, 9, 12, never 7.5).
  const countMax = (value, ticks) =>
    Math.max(1, Math.ceil(niceMax(value / ticks))) * ticks;
  const clampText = (text, max) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;

  // A tooltip box inside a chart container, placed near (x, y) and kept inside it.
  function tooltip(container) {
    const tip = document.createElement('div');
    tip.className = 'dash-tip';
    tip.hidden = true;
    tip.setAttribute('role', 'status');
    tip.setAttribute('aria-live', 'polite');
    container.append(tip);
    return {
      show(lines, x, y) {
        tip.textContent = '';
        lines.forEach((line, i) => {
          const row = document.createElement(i ? 'span' : 'strong');
          row.textContent = line;
          tip.append(row);
        });
        tip.hidden = false;
        const box = container.getBoundingClientRect();
        const width = tip.offsetWidth;
        const height = tip.offsetHeight;
        tip.style.left = `${Math.min(Math.max(4, x - width / 2), box.width - width - 4)}px`;
        tip.style.top = `${y - height - 10 < 0 ? y + 14 : y - height - 10}px`;
      },
      hide() {
        tip.hidden = true;
      },
    };
  }

  // Shared keyboard reading: left/right (or up/down) move through the points; Escape hides.
  function keyboard(container, count, onIndex, onLeave, signal) {
    let index = -1;
    container.addEventListener(
      'keydown',
      (event) => {
        const next = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[
          event.key
        ];
        if (next && count()) {
          event.preventDefault();
          index =
            index < 0
              ? next > 0
                ? 0
                : count() - 1
              : (index + next + count()) % count();
          onIndex(index);
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          index = -1;
          onLeave();
        }
      },
      {signal},
    );
    container.addEventListener(
      'blur',
      () => {
        index = -1;
        onLeave();
      },
      {signal},
    );
    return {
      set(i) {
        index = i;
      },
    };
  }

  // Animations run once per page view (never again on resize).
  function grow(nodes, from = 'bottom') {
    if (reduced()) return;
    nodes.forEach((node, i) => {
      node.style.transformBox = 'fill-box';
      node.style.transformOrigin =
        from === 'left' ? 'left center' : 'center bottom';
      node.animate(
        [
          {transform: from === 'left' ? 'scaleX(0)' : 'scaleY(0)'},
          {transform: 'none'},
        ],
        {
          duration: 520,
          delay: Math.min(i * 22, 400),
          easing: 'cubic-bezier(.2,.8,.2,1)',
          fill: 'backwards',
        },
      );
    });
  }
  function drawLine(path) {
    if (reduced() || !path.getTotalLength) return;
    const length = path.getTotalLength();
    path.animate(
      [
        {strokeDasharray: `${length}`, strokeDashoffset: length},
        {strokeDasharray: `${length}`, strokeDashoffset: 0},
      ],
      {duration: 900, easing: 'cubic-bezier(.3,.7,.2,1)'},
    );
  }

  // ---------- Charts ----------
  // Line (revenue, left axis) over bars (orders, right axis).
  function timelineChart(el, data, animate, signal) {
    const width = el.clientWidth;
    const height = el.clientHeight || 280;
    const pad = {l: 58, r: 40, t: 14, b: 30};
    const plotW = Math.max(10, width - pad.l - pad.r);
    const plotH = height - pad.t - pad.b;
    const n = data.length;
    const band = plotW / Math.max(n, 1);
    // At least a ₹1,000 axis: with no sales yet, a 1-paisa axis printed "₹0" on every line.
    const maxRevenue = niceMax(Math.max(...data.map((d) => d.revenue), 100000));
    const maxOrders = countMax(Math.max(...data.map((d) => d.orders), 0), 4);
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + plotH - (plotH * i) / 4;
      svgEl(
        'line',
        {x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'dash-grid'},
        svg,
      );
      svgEl(
        'text',
        {x: pad.l - 8, y: y + 4, 'text-anchor': 'end', class: 'dash-axis'},
        svg,
      ).textContent = shortMoney((maxRevenue * i) / 4);
      svgEl(
        'text',
        {x: width - pad.r + 8, y: y + 4, class: 'dash-axis'},
        svg,
      ).textContent = String(Math.round((maxOrders * i) / 4));
    }
    const every = Math.max(
      1,
      Math.ceil(n / Math.max(2, Math.floor(plotW / 64))),
    );
    const bars = [];
    data.forEach((d, i) => {
      const barW = Math.max(2, Math.min(28, band * 0.56));
      const h = (d.orders / maxOrders) * plotH;
      if (h > 0)
        bars.push(
          svgEl(
            'rect',
            {
              x: pad.l + band * i + (band - barW) / 2,
              y: pad.t + plotH - h,
              width: barW,
              height: h,
              rx: Math.min(4, barW / 3),
              class: 'dash-bar-orders',
            },
            svg,
          ),
        );
      if (i % every === 0)
        svgEl(
          'text',
          {
            x: pad.l + band * i + band / 2,
            y: height - 9,
            'text-anchor': 'middle',
            class: 'dash-axis',
          },
          svg,
        ).textContent = d.label;
    });
    const points = data.map((d, i) => [
      pad.l + band * i + band / 2,
      pad.t + plotH - (d.revenue / maxRevenue) * plotH,
    ]);
    const linePath = points
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join('');
    if (points.length) {
      svgEl(
        'path',
        {
          d: `${linePath}L${points[points.length - 1][0]},${pad.t + plotH}L${points[0][0]},${pad.t + plotH}Z`,
          class: 'dash-area',
        },
        svg,
      );
    }
    const line = svgEl('path', {d: linePath, class: 'dash-line'}, svg);
    const guide = svgEl(
      'line',
      {y1: pad.t, y2: pad.t + plotH, class: 'dash-guide', visibility: 'hidden'},
      svg,
    );
    const dot = svgEl(
      'circle',
      {r: 5, class: 'dash-line-dot', visibility: 'hidden'},
      svg,
    );
    el.replaceChildren(svg);
    const tip = tooltip(el);
    const show = (i) => {
      const [x, y] = points[i];
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', x);
      dot.setAttribute('cy', y);
      dot.setAttribute('visibility', 'visible');
      tip.show(
        [
          data[i].label,
          `Revenue ${money(data[i].revenue)}`,
          `${data[i].orders} ${data[i].orders === 1 ? 'order' : 'orders'}`,
        ],
        x,
        y,
      );
    };
    const hide = () => {
      guide.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hide();
    };
    const keys = keyboard(el, () => n, show, hide, signal);
    svg.addEventListener(
      'pointermove',
      (event) => {
        const x = event.clientX - svg.getBoundingClientRect().left - pad.l;
        const i = Math.min(n - 1, Math.max(0, Math.floor(x / band)));
        if (n) {
          keys.set(i);
          show(i);
        }
      },
      {signal},
    );
    svg.addEventListener('pointerleave', hide, {signal});
    if (animate) {
      grow(bars);
      drawLine(line);
    }
  }

  // Stacked bars: new (bottom) and returning (top) customers' orders per bucket.
  function stackedChart(el, data, animate, signal) {
    const width = el.clientWidth;
    const height = el.clientHeight || 220;
    const pad = {l: 34, r: 8, t: 10, b: 28};
    const plotW = Math.max(10, width - pad.l - pad.r);
    const plotH = height - pad.t - pad.b;
    const n = data.length;
    const band = plotW / Math.max(n, 1);
    const max = countMax(
      Math.max(...data.map((d) => d.newCustomers + d.returning), 0),
      3,
    );
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + plotH - (plotH * i) / 3;
      svgEl(
        'line',
        {x1: pad.l, x2: width - pad.r, y1: y, y2: y, class: 'dash-grid'},
        svg,
      );
      svgEl(
        'text',
        {x: pad.l - 6, y: y + 4, 'text-anchor': 'end', class: 'dash-axis'},
        svg,
      ).textContent = String(Math.round((max * i) / 3));
    }
    const every = Math.max(
      1,
      Math.ceil(n / Math.max(2, Math.floor(plotW / 56))),
    );
    const groups = [];
    data.forEach((d, i) => {
      const barW = Math.max(2, Math.min(22, band * 0.6));
      const x = pad.l + band * i + (band - barW) / 2;
      const hNew = (d.newCustomers / max) * plotH;
      const hRet = (d.returning / max) * plotH;
      if (hNew + hRet > 0) {
        const g = svgEl('g', {}, svg);
        if (hNew)
          svgEl(
            'rect',
            {
              x,
              y: pad.t + plotH - hNew,
              width: barW,
              height: hNew,
              class: 'dash-bar-new',
            },
            g,
          );
        if (hRet)
          svgEl(
            'rect',
            {
              x,
              y: pad.t + plotH - hNew - hRet,
              width: barW,
              height: hRet,
              class: 'dash-bar-ret',
            },
            g,
          );
        groups.push(g);
      }
      if (i % every === 0)
        svgEl(
          'text',
          {
            x: pad.l + band * i + band / 2,
            y: height - 9,
            'text-anchor': 'middle',
            class: 'dash-axis',
          },
          svg,
        ).textContent = d.label;
    });
    const guide = svgEl(
      'rect',
      {
        y: pad.t,
        height: plotH,
        width: band,
        class: 'dash-band',
        visibility: 'hidden',
      },
      svg,
    );
    svg.prepend(guide);
    el.replaceChildren(svg);
    const tip = tooltip(el);
    const show = (i) => {
      guide.setAttribute('x', pad.l + band * i);
      guide.setAttribute('visibility', 'visible');
      const top =
        pad.t +
        plotH -
        ((data[i].newCustomers + data[i].returning) / max) * plotH;
      tip.show(
        [
          data[i].label,
          `New customers: ${data[i].newCustomers}`,
          `Returning: ${data[i].returning}`,
        ],
        pad.l + band * i + band / 2,
        top,
      );
    };
    const hide = () => {
      guide.setAttribute('visibility', 'hidden');
      tip.hide();
    };
    const keys = keyboard(el, () => n, show, hide, signal);
    svg.addEventListener(
      'pointermove',
      (event) => {
        const i = Math.min(
          n - 1,
          Math.max(
            0,
            Math.floor(
              (event.clientX - svg.getBoundingClientRect().left - pad.l) / band,
            ),
          ),
        );
        if (n) {
          keys.set(i);
          show(i);
        }
      },
      {signal},
    );
    svg.addEventListener('pointerleave', hide, {signal});
    if (animate) grow(groups);
  }

  // A donut with a legend; the centre shows the total or the hovered slice.
  function donutChart(el, items, unit, animate, signal) {
    const total = items.reduce((sum, item) => sum + item.value, 0);
    el.replaceChildren();
    if (!total) {
      const empty = document.createElement('p');
      empty.className = 'muted dash-empty';
      empty.textContent = 'No orders in this period.';
      el.append(empty);
      return;
    }
    const size = 168;
    const r = 64;
    const c = 2 * Math.PI * r;
    const wrap = document.createElement('div');
    wrap.className = 'dash-donut';
    const svg = svgEl('svg', {
      width: size,
      height: size,
      viewBox: `0 0 ${size} ${size}`,
      'aria-hidden': 'true',
    });
    svgEl(
      'circle',
      {cx: size / 2, cy: size / 2, r, class: 'dash-donut-track'},
      svg,
    );
    const ring = svgEl(
      'g',
      {transform: `rotate(-90 ${size / 2} ${size / 2})`},
      svg,
    );
    const centreValue = svgEl(
      'text',
      {
        x: size / 2,
        y: size / 2,
        'text-anchor': 'middle',
        class: 'dash-donut-value',
      },
      svg,
    );
    const centreLabel = svgEl(
      'text',
      {
        x: size / 2,
        y: size / 2 + 18,
        'text-anchor': 'middle',
        class: 'dash-donut-label',
      },
      svg,
    );
    const legend = document.createElement('ul');
    legend.className = 'dash-donut-legend';
    let offset = 0;
    const slices = items.map((item, i) => {
      const length = (item.value / total) * c;
      const gap = items.length > 1 ? Math.min(2, length / 3) : 0;
      const slice = svgEl(
        'circle',
        {
          cx: size / 2,
          cy: size / 2,
          r,
          class: `dash-slice dash-${item.cls}`,
          'stroke-dasharray': `${Math.max(0, length - gap)} ${c}`,
          'stroke-dashoffset': -offset,
        },
        ring,
      );
      offset += length;
      const li = document.createElement('li');
      li.innerHTML = `<i class="dash-key dash-${item.cls}"></i>`;
      const name = document.createElement('span');
      name.textContent = item.label;
      const value = document.createElement('strong');
      value.textContent = `${item.value} · ${Math.round((item.value / total) * 100)}%`;
      li.append(name, value);
      li.dataset.index = String(i);
      legend.append(li);
      return {slice, li, length, gap};
    });
    const showTotal = () => {
      centreValue.textContent = String(total);
      centreLabel.textContent = unit;
      slices.forEach((s) => {
        s.slice.classList.remove('is-dim');
        s.li.classList.remove('is-active');
      });
    };
    const show = (i) => {
      centreValue.textContent = String(items[i].value);
      centreLabel.textContent = clampText(items[i].label, 18);
      slices.forEach((s, j) => {
        s.slice.classList.toggle('is-dim', j !== i);
        s.li.classList.toggle('is-active', j === i);
      });
    };
    showTotal();
    wrap.append(svg, legend);
    el.append(wrap);
    const keys = keyboard(el, () => items.length, show, showTotal, signal);
    slices.forEach((s, i) => {
      s.slice.addEventListener(
        'pointerenter',
        () => {
          keys.set(i);
          show(i);
        },
        {signal},
      );
      s.li.addEventListener(
        'pointerenter',
        () => {
          keys.set(i);
          show(i);
        },
        {signal},
      );
    });
    wrap.addEventListener('pointerleave', showTotal, {signal});
    if (animate && !reduced()) {
      slices.forEach((s) =>
        s.slice.animate(
          [
            {strokeDasharray: `0 ${c}`},
            {strokeDasharray: `${Math.max(0, s.length - s.gap)} ${c}`},
          ],
          {duration: 700, easing: 'cubic-bezier(.3,.7,.2,1)'},
        ),
      );
    }
  }

  // Horizontal bars with labels above each bar (sales by category).
  function hbarChart(el, items, animate, signal) {
    el.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted dash-empty';
      empty.textContent = 'No sales in this period.';
      el.append(empty);
      return;
    }
    const width = el.clientWidth;
    const row = 40;
    const height = items.length * row + 4;
    const max = Math.max(...items.map((item) => item.revenue), 1);
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    const bars = [];
    const rows = items.map((item, i) => {
      const y = i * row;
      const band = svgEl(
        'rect',
        {x: 0, y, width, height: row, class: 'dash-band', visibility: 'hidden'},
        svg,
      );
      svgEl('text', {x: 0, y: y + 14, class: 'dash-label'}, svg).textContent =
        clampText(item.name, 30);
      svgEl(
        'text',
        {
          x: width,
          y: y + 14,
          'text-anchor': 'end',
          class: 'dash-label dash-label-strong',
        },
        svg,
      ).textContent = money(item.revenue);
      svgEl(
        'rect',
        {x: 0, y: y + 21, width, height: 8, rx: 4, class: 'dash-track'},
        svg,
      );
      bars.push(
        svgEl(
          'rect',
          {
            x: 0,
            y: y + 21,
            width: Math.max(4, (item.revenue / max) * width),
            height: 8,
            rx: 4,
            class: 'dash-bar-cat',
          },
          svg,
        ),
      );
      return band;
    });
    el.append(svg);
    const tip = tooltip(el);
    const show = (i) => {
      rows.forEach((band, j) =>
        band.setAttribute('visibility', j === i ? 'visible' : 'hidden'),
      );
      tip.show(
        [items[i].name, money(items[i].revenue), `${items[i].units} units`],
        Math.min(width - 60, (items[i].revenue / max) * width),
        i * row + 18,
      );
    };
    const hide = () => {
      rows.forEach((band) => band.setAttribute('visibility', 'hidden'));
      tip.hide();
    };
    const keys = keyboard(el, () => items.length, show, hide, signal);
    svg.addEventListener(
      'pointermove',
      (event) => {
        const i = Math.min(
          items.length - 1,
          Math.max(
            0,
            Math.floor((event.clientY - svg.getBoundingClientRect().top) / row),
          ),
        );
        keys.set(i);
        show(i);
      },
      {signal},
    );
    svg.addEventListener('pointerleave', hide, {signal});
    if (animate) grow(bars, 'left');
  }

  // Day of week × hour of day; darker volt = more orders.
  function heatmapChart(el, grid, animate, signal) {
    const width = el.clientWidth;
    const labelW = 36;
    const cell = Math.max(8, (width - labelW) / 24);
    const cellH = Math.min(26, Math.max(14, cell));
    const height = cellH * 7 + 22;
    const max = Math.max(...grid.flat(), 1);
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    const cells = [];
    grid.forEach((rowValues, d) => {
      svgEl(
        'text',
        {x: 0, y: d * cellH + cellH / 2 + 4, class: 'dash-axis'},
        svg,
      ).textContent = DAYS[d];
      rowValues.forEach((count, h) => {
        const rect = svgEl(
          'rect',
          {
            x: labelW + h * cell + 1,
            y: d * cellH + 1,
            width: Math.max(1, cell - 2),
            height: cellH - 2,
            rx: 3,
            class: count ? 'dash-heat' : 'dash-heat-zero',
          },
          svg,
        );
        if (count) rect.style.fillOpacity = String(0.18 + 0.82 * (count / max));
        cells.push({rect, d, h, count});
      });
    });
    [0, 6, 12, 18, 23].forEach((h) => {
      svgEl(
        'text',
        {
          x: labelW + h * cell + cell / 2,
          y: height - 6,
          'text-anchor': 'middle',
          class: 'dash-axis',
        },
        svg,
      ).textContent = `${h}h`;
    });
    const outline = svgEl(
      'rect',
      {
        width: Math.max(1, cell - 2),
        height: cellH - 2,
        rx: 3,
        class: 'dash-heat-focus',
        visibility: 'hidden',
      },
      svg,
    );
    el.replaceChildren(svg);
    const tip = tooltip(el);
    const show = (i) => {
      const {d, h, count, rect} = cells[i];
      outline.setAttribute('x', rect.getAttribute('x'));
      outline.setAttribute('y', rect.getAttribute('y'));
      outline.setAttribute('visibility', 'visible');
      tip.show(
        [
          `${DAYS[d]} ${String(h).padStart(2, '0')}:00 to ${String((h + 1) % 24).padStart(2, '0')}:00`,
          `${count} ${count === 1 ? 'order' : 'orders'}`,
        ],
        labelW + h * cell + cell / 2,
        d * cellH,
      );
    };
    const hide = () => {
      outline.setAttribute('visibility', 'hidden');
      tip.hide();
    };
    let index = -1;
    el.addEventListener(
      'keydown',
      (event) => {
        const move = {
          ArrowRight: 1,
          ArrowLeft: -1,
          ArrowDown: 24,
          ArrowUp: -24,
        }[event.key];
        if (move) {
          event.preventDefault();
          index = index < 0 ? 0 : (index + move + cells.length) % cells.length;
          show(index);
        } else if (event.key === 'Escape') {
          index = -1;
          hide();
        }
      },
      {signal},
    );
    el.addEventListener('blur', hide, {signal});
    svg.addEventListener(
      'pointermove',
      (event) => {
        const box = svg.getBoundingClientRect();
        const h = Math.floor((event.clientX - box.left - labelW) / cell);
        const d = Math.floor((event.clientY - box.top) / cellH);
        if (h >= 0 && h < 24 && d >= 0 && d < 7) {
          index = d * 24 + h;
          show(index);
        } else hide();
      },
      {signal},
    );
    svg.addEventListener('pointerleave', hide, {signal});
    if (animate && !reduced()) {
      cells
        .filter((c) => c.count)
        .forEach((c) =>
          c.rect.animate([{opacity: 0}, {opacity: 1}], {
            duration: 500,
            delay: (c.d * 24 + c.h) * 4,
            fill: 'backwards',
          }),
        );
    }
  }

  // KPI sparkline: a small line with a soft area.
  function sparkline(el, values) {
    const width = el.clientWidth || 120;
    const height = 34;
    el.replaceChildren();
    if (values.length < 2) return;
    const max = Math.max(...values);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const points = values.map((v, i) => [
      (i / (values.length - 1)) * width,
      height - 3 - ((v - min) / span) * (height - 6),
    ]);
    const svg = svgEl('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      'aria-hidden': 'true',
    });
    const d = points
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
      .join('');
    svgEl(
      'path',
      {d: `${d}L${width},${height}L0,${height}Z`, class: 'dash-spark-area'},
      svg,
    );
    svgEl('path', {d, class: 'dash-spark-line'}, svg);
    el.append(svg);
  }

  // KPI numbers count up once.
  function countUp(root) {
    if (reduced()) return;
    root.querySelectorAll('[data-count]').forEach((node) => {
      const target = Number(node.dataset.count) || 0;
      const format = node.dataset.format;
      const final = node.textContent;
      if (!target) return;
      const show = (v) => {
        node.textContent =
          format === 'money'
            ? money(Math.round(v))
            : format === 'percent'
              ? `${v.toFixed(1)}%`
              : Math.round(v).toLocaleString('en-IN');
      };
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / 900);
        if (!node.isConnected) return;
        if (t >= 1) {
          node.textContent = final;
          return;
        }
        show(target * (1 - Math.pow(1 - t, 3)));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  // ---------- The dashboard section ----------
  Pages.define('admin-dashboard', (root, signal) => {
    const holder = root.querySelector('[data-dashboard]');
    if (!holder) return;
    let data;
    try {
      data = JSON.parse(holder.dataset.dashboard);
    } catch {
      return;
    }
    const {charts, statusLabels, paymentLabels} = data;
    const chartEls = {};
    root.querySelectorAll('[data-chart]').forEach((el) => {
      chartEls[el.dataset.chart] = el;
    });

    function render(animate) {
      // Each chart gets its own listeners; a redraw replaces them.
      if (render.controller) render.controller.abort();
      const local = new AbortController();
      render.controller = local;
      signal.addEventListener('abort', () => local.abort(), {once: true});
      const s = local.signal;
      if (chartEls.timeline)
        timelineChart(chartEls.timeline, charts.timeline, animate, s);
      if (chartEls.newReturning)
        stackedChart(chartEls.newReturning, charts.newReturning, animate, s);
      if (chartEls.statuses)
        donutChart(
          chartEls.statuses,
          charts.statuses.map((st) => ({
            label: statusLabels[st.key] || st.key,
            value: st.count,
            cls: STATUS_CLASS[st.key] || 'c8',
          })),
          'orders',
          animate,
          s,
        );
      if (chartEls.payments)
        donutChart(
          chartEls.payments,
          charts.payments.map((p) => ({
            label: paymentLabels[p.key] || p.key,
            value: p.count,
            cls: PAYMENT_CLASS[p.key] || 'c4',
          })),
          'orders',
          animate,
          s,
        );
      if (chartEls.categories)
        hbarChart(chartEls.categories, charts.categories, animate, s);
      if (chartEls.heatmap)
        heatmapChart(chartEls.heatmap, charts.heatmap, animate, s);
      data.kpis.forEach((k) => {
        const el = root.querySelector(`[data-spark="${k.key}"]`);
        if (el) sparkline(el, k.spark);
      });
    }
    render(true);
    countUp(root);

    // Redraw (without motion) when the width changes.
    let lastWidth = root.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (Math.abs(root.clientWidth - lastWidth) < 8) return;
      lastWidth = root.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => render(false));
    });
    observer.observe(root);

    // Top products: Revenue / Units tabs (arrow keys too).
    const tabs = [...root.querySelectorAll('[data-dash-tab]')];
    const selectTab = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        root.querySelector(`#${t.getAttribute('aria-controls')}`).hidden = !on;
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => selectTab(tab), {signal});
      tab.addEventListener(
        'keydown',
        (event) => {
          const move = {ArrowRight: 1, ArrowLeft: -1}[event.key];
          if (!move) return;
          const next = tabs[(i + move + tabs.length) % tabs.length];
          selectTab(next);
          next.focus();
        },
        {signal},
      );
    });

    // Recent orders: the whole row opens the order.
    root.addEventListener(
      'click',
      (event) => {
        const row = event.target.closest('tr[data-row-href]');
        if (!row || event.target.closest('a, button')) return;
        if (window.NxNav) window.NxNav.go(row.dataset.rowHref);
        else window.location.assign(row.dataset.rowHref);
      },
      {signal},
    );

    // Quick restock.
    root.addEventListener(
      'submit',
      async (event) => {
        const form = event.target.closest('[data-restock]');
        if (!form) return;
        event.preventDefault();
        if (form.dataset.pending === 'true') return;
        const input = form.elements.add;
        const add = Number(input.value);
        if (!Number.isInteger(add) || add < 1 || add > 10000) {
          Nx.toast('Enter how many units to add (1 to 10,000).', 'error');
          input.focus();
          return;
        }
        const button = form.querySelector('button');
        if (form.dataset.requestUnits !== String(add)) {
          form.dataset.requestId = window.crypto.randomUUID();
          form.dataset.requestUnits = String(add);
        }
        form.dataset.pending = 'true';
        Nx.busy(button, true, 'Saving…');
        try {
          const reply = await Nx.api(
            `/api/admin/products/${encodeURIComponent(form.dataset.restock)}/stock`,
            {method: 'PATCH', body: {add, requestId: form.dataset.requestId}},
          );
          const label = form.closest('li').querySelector('[data-stock-label]');
          label.textContent = `${reply.product.stock} in stock`;
          label.className = 'pill pill-green';
          input.value = '';
          delete form.dataset.requestId;
          delete form.dataset.requestUnits;
          Nx.toast(reply.message);
        } catch (error) {
          Nx.toast(error.message, 'error');
        } finally {
          delete form.dataset.pending;
          Nx.busy(button, false);
        }
      },
      {signal},
    );

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
  // ---------- The analytics section ----------
  // The same hand-drawn charts as the dashboard, over the range and grouping the admin picked.
  Pages.define('admin-analytics', (root, signal) => {
    const holder = root.querySelector('[data-analytics]');
    if (!holder) return;
    let data;
    try {
      data = JSON.parse(holder.dataset.analytics);
    } catch {
      return;
    }
    const chartEls = {};
    root.querySelectorAll('[data-chart]').forEach((el) => {
      chartEls[el.dataset.chart] = el;
    });

    function render(animate) {
      // Each redraw replaces the previous chart listeners.
      if (render.controller) render.controller.abort();
      const local = new AbortController();
      render.controller = local;
      signal.addEventListener('abort', () => local.abort(), {once: true});
      const s = local.signal;
      if (chartEls.timeline)
        timelineChart(chartEls.timeline, data.timeline, animate, s);
      if (chartEls.newReturning)
        stackedChart(chartEls.newReturning, data.newReturning, animate, s);
      if (chartEls.categories)
        hbarChart(chartEls.categories, data.categories, animate, s);
      if (chartEls.payments) {
        donutChart(
          chartEls.payments,
          data.payments.map((p) => ({
            label: data.paymentLabels[p.key] || p.key,
            value: p.count,
            cls: PAYMENT_CLASS[p.key] || 'c4',
          })),
          'orders',
          animate,
          s,
        );
      }
    }
    render(true);
    // Trend lines in the headline cards (the same series as the chart).
    Object.entries(data.sparks || {}).forEach(([key, values]) => {
      const el = root.querySelector(`[data-spark="${key}"]`);
      if (el) sparkline(el, values);
    });

    // Redraw (without motion) when the width changes.
    let lastWidth = root.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (Math.abs(root.clientWidth - lastWidth) < 8) return;
      lastWidth = root.clientWidth;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => render(false));
    });
    observer.observe(root);

    // Top products: Revenue / Units tabs (arrow keys too).
    const tabs = [...root.querySelectorAll('[data-dash-tab]')];
    const selectTab = (tab) => {
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
        root.querySelector(`#${t.getAttribute('aria-controls')}`).hidden = !on;
      });
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => selectTab(tab), {signal});
      tab.addEventListener(
        'keydown',
        (event) => {
          const move = {ArrowRight: 1, ArrowLeft: -1}[event.key];
          if (!move) return;
          const next = tabs[(i + move + tabs.length) % tabs.length];
          selectTab(next);
          next.focus();
        },
        {signal},
      );
    });

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
})();
