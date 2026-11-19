// Photo editor for the admin product form: crop, rotate, flip, or swap in a different file.
// admin-products.js loads this file the first time an admin clicks "Edit" on a photo.
//
// Everything happens in the browser on a <canvas>. The result is a normal upload, so the server
// still checks the file and makes every size (400/800/1600/full) from it.
//
//   const result = await window.NxImageEditor.open({ url, file, label });
//   result is null (closed, or nothing changed) or { file, src } (src is a data: URL preview).
(function () {
  'use strict';

  const MAX_EDGE = 2000; // the server's "full" copy is at most 2000px wide or tall
  const MAX_BYTES = 2 * 1024 * 1024; // same limit as the upload
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MIN_CROP = 0.1; // the crop box is never smaller than 10% of the photo
  const SHARP_EDGE = 800; // below this the product page shows the photo soft
  const NUDGE = 0.02; // arrow keys move (or with Shift, resize) the box by 2%

  let dialog = null;
  let els = null;
  let state = null;
  let finish = null;

  function icon(name) {
    return `<svg class="i" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  }

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const reducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Building the dialog (once) ----------

  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'photo-editor';
    dialog.setAttribute('aria-labelledby', 'pe-title');
    dialog.setAttribute('aria-describedby', 'pe-help');
    dialog.innerHTML = `
      <div class="photo-editor-inner">
        <div class="dialog-head">
          <span class="photo-editor-badge">${icon('crop')}</span>
          <div>
            <h2 id="pe-title">Edit photo</h2>
            <p class="muted" id="pe-help">Drag the box or its corners to choose what shows. Shoppers see product photos as squares.</p>
          </div>
          <button type="button" class="icon-btn" data-pe-close aria-label="Close without saving">${icon('x')}</button>
        </div>

        <div class="photo-editor-stage" data-pe-stage>
          <div class="photo-editor-frame" data-pe-frame hidden>
            <canvas data-pe-canvas aria-hidden="true"></canvas>
            <div class="photo-crop" data-pe-crop tabindex="0" role="group" aria-roledescription="crop area"
                 aria-label="Crop area. Arrow keys move it. Shift and arrow keys change its size.">
              <span class="photo-crop-grid" aria-hidden="true"></span>
              <span class="photo-crop-handle" data-handle="nw" aria-hidden="true"></span>
              <span class="photo-crop-handle" data-handle="ne" aria-hidden="true"></span>
              <span class="photo-crop-handle" data-handle="sw" aria-hidden="true"></span>
              <span class="photo-crop-handle" data-handle="se" aria-hidden="true"></span>
            </div>
          </div>
          <p class="photo-editor-status" data-pe-status role="status"></p>
        </div>

        <div class="photo-editor-tools" data-pe-tools>
          <div class="segmented-radio" role="radiogroup" aria-label="Crop shape">
            <label><input type="radio" name="pe-aspect" value="square" checked><span>Square</span></label>
            <label><input type="radio" name="pe-aspect" value="original"><span>Original</span></label>
            <label><input type="radio" name="pe-aspect" value="free"><span>Free</span></label>
          </div>
          <div class="photo-editor-buttons">
            <button type="button" class="btn btn-ghost btn-sm" data-pe-rotate="-1">${icon('rotate-ccw')}<span>Left</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-pe-rotate="1">${icon('rotate-cw')}<span>Right</span></button>
            <button type="button" class="btn btn-ghost btn-sm" data-pe-flip aria-pressed="false">${icon('flip')}<span>Flip</span></button>
            <button type="button" class="link-btn" data-pe-reset>Reset</button>
          </div>
        </div>

        <div class="photo-editor-foot">
          <label class="btn btn-ghost btn-sm photo-editor-replace">
            <input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" data-pe-file>
            ${icon('replace')}<span>Replace photo</span>
          </label>
          <span class="photo-editor-size" data-pe-size aria-live="polite"></span>
          <div class="photo-editor-confirm">
            <button type="button" class="btn btn-ghost" data-pe-close>Cancel</button>
            <button type="button" class="btn btn-primary" data-pe-apply>Use this photo</button>
          </div>
        </div>
      </div>`;
    document.body.append(dialog);

    els = {
      frame: dialog.querySelector('[data-pe-frame]'),
      canvas: dialog.querySelector('[data-pe-canvas]'),
      crop: dialog.querySelector('[data-pe-crop]'),
      status: dialog.querySelector('[data-pe-status]'),
      tools: dialog.querySelector('[data-pe-tools]'),
      size: dialog.querySelector('[data-pe-size]'),
      flip: dialog.querySelector('[data-pe-flip]'),
      file: dialog.querySelector('[data-pe-file]'),
      apply: dialog.querySelector('[data-pe-apply]'),
      title: dialog.querySelector('#pe-title'),
    };

    dialog
      .querySelectorAll('[data-pe-close]')
      .forEach((button) => button.addEventListener('click', () => close(null)));
    // Esc closes a <dialog> by itself: treat it like Cancel.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(null);
    });
    dialog.querySelectorAll('input[name="pe-aspect"]').forEach((radio) =>
      radio.addEventListener('change', () => {
        state.aspect = radio.value;
        state.changed = true;
        fitCrop();
      }),
    );
    dialog.querySelectorAll('[data-pe-rotate]').forEach((button) =>
      button.addEventListener('click', () => {
        state.turns = (state.turns + Number(button.dataset.peRotate) + 4) % 4;
        state.changed = true;
        redraw(true);
      }),
    );
    els.flip.addEventListener('click', () => {
      state.flipped = !state.flipped;
      state.changed = true;
      redraw(true);
    });
    dialog.querySelector('[data-pe-reset]').addEventListener('click', () => {
      Object.assign(state, {
        turns: 0,
        flipped: false,
        aspect: 'square',
        changed: state.replaced,
      });
      setAspectRadio('square');
      redraw(true);
    });
    els.file.addEventListener('change', onReplace);
    els.apply.addEventListener('click', onApply);
    els.crop.addEventListener('pointerdown', onPointerDown);
    els.crop.addEventListener('keydown', onKey);
  }

  function setAspectRadio(value) {
    dialog.querySelector(`input[name="pe-aspect"][value="${value}"]`).checked =
      true;
  }

  // ---------- Loading a photo ----------

  function loadImage(src, crossOrigin) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The photo could not be opened.'));
      img.src = src;
    });
  }

  function readDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // createImageBitmap turns phone photos the right way up (EXIF). Older browsers fall back to <img>.
  async function fromFile(file) {
    if (window.createImageBitmap) {
      try {
        return await createImageBitmap(file, {imageOrientation: 'from-image'});
      } catch {
        /* fall through */
      }
    }
    return loadImage(await readDataUrl(file), false);
  }

  // A saved photo. Ask for the biggest copy, and for a fresh, CORS-enabled response: a copy the
  // browser cached for the thumbnail (without CORS) would otherwise lock the canvas.
  function fromUrl(url) {
    const address = new URL(url, window.location.href);
    if (address.hostname === 'images.unsplash.com')
      address.searchParams.set('w', String(MAX_EDGE));
    address.searchParams.set('nx-edit', Date.now().toString(36));
    const sameSite = address.origin === window.location.origin;
    return loadImage(address.href, !sameSite);
  }

  function showStatus(message, isError = false) {
    els.status.textContent = message;
    els.status.classList.toggle('is-error', isError);
    els.status.hidden = !message;
  }

  function setReady(ready) {
    els.frame.hidden = !ready;
    els.tools.classList.toggle('is-disabled', !ready);
    els.tools.querySelectorAll('button, input').forEach((control) => {
      control.disabled = !ready;
    });
    els.apply.disabled = !ready;
    if (!ready) els.size.textContent = '';
  }

  async function useSource(load, baseName) {
    setReady(false);
    showStatus('Opening the photo…');
    try {
      const source = await load();
      state.source = source;
      state.width = source.naturalWidth || source.width;
      state.height = source.naturalHeight || source.height;
      state.baseName = baseName;
      showStatus('');
      setReady(true);
      redraw(false);
      return true;
    } catch {
      showStatus(
        "This photo can't be opened for editing. Use “Replace photo” to pick the file again.",
        true,
      );
      return false;
    }
  }

  // ---------- Drawing ----------

  // Draws the photo turned and flipped into the canvas (at most MAX_EDGE on its long side).
  function redraw(animate) {
    const {source, width, height, turns, flipped} = state;
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const sideways = turns % 2 === 1;
    const canvas = els.canvas;
    canvas.width = sideways ? h : w;
    canvas.height = sideways ? w : h;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    if (flipped) ctx.scale(-1, 1);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, -w / 2, -h / 2, w, h);
    ctx.restore();

    els.flip.setAttribute('aria-pressed', String(flipped));
    fitCrop();
    if (animate && !reducedMotion()) {
      els.frame.classList.remove('is-turning');
      void els.frame.offsetWidth; // restart the animation
      els.frame.classList.add('is-turning');
    }
  }

  // Width / height of the crop box in pixels, or 0 for "free".
  function ratio() {
    if (state.aspect === 'square') return 1;
    if (state.aspect === 'original')
      return els.canvas.width / els.canvas.height;
    return 0;
  }

  // In 0–1 units, height = width × r keeps the chosen shape.
  function heightPerWidth(aspect) {
    return els.canvas.width / els.canvas.height / aspect;
  }

  // The biggest centred box of the chosen shape.
  function fitCrop() {
    const aspect = ratio();
    let w = 1;
    let h = 1;
    if (aspect) {
      h = heightPerWidth(aspect);
      if (h > 1) {
        w = 1 / h;
        h = 1;
      }
    }
    state.crop = {x: (1 - w) / 2, y: (1 - h) / 2, w, h};
    paintCrop();
  }

  // Pointer events already arrive about once per frame, so this paints straight away.
  function paintCrop() {
    const {x, y, w, h} = state.crop;
    const style = els.crop.style;
    style.left = `${x * 100}%`;
    style.top = `${y * 100}%`;
    style.width = `${w * 100}%`;
    style.height = `${h * 100}%`;
    const out = outputSize();
    const soft = Math.max(out.width, out.height) < SHARP_EDGE;
    els.size.textContent = `${out.width} × ${out.height} px${soft ? ' · small, may look soft' : ''}`;
    els.size.classList.toggle('is-warning', soft);
  }

  function outputSize() {
    const {x, y, w, h} = state.crop;
    const W = els.canvas.width;
    const H = els.canvas.height;
    const left = Math.round(x * W);
    const top = Math.round(y * H);
    return {
      left,
      top,
      width: Math.max(1, Math.min(W - left, Math.round(w * W))),
      height: Math.max(1, Math.min(H - top, Math.round(h * H))),
    };
  }

  // ---------- Moving and resizing the crop box ----------

  // Resizes from one corner, keeping the opposite corner still. px/py: the pointer, in 0–1 units.
  function resizeFrom(handle, start, px, py) {
    const east = handle.includes('e');
    const south = handle.includes('s');
    const ax = east ? start.x : start.x + start.w;
    const ay = south ? start.y : start.y + start.h;
    const spaceW = east ? 1 - ax : ax;
    const spaceH = south ? 1 - ay : ay;
    let w = Math.abs(px - ax);
    let h = Math.abs(py - ay);
    if ((east && px < ax) || (!east && px > ax)) w = 0;
    if ((south && py < ay) || (!south && py > ay)) h = 0;

    const aspect = ratio();
    if (aspect) {
      const r = heightPerWidth(aspect);
      w = Math.max(w, h / r, MIN_CROP, MIN_CROP / r);
      w = Math.min(w, spaceW, spaceH / r);
      h = w * r;
    } else {
      w = clamp(w, Math.min(MIN_CROP, spaceW), spaceW);
      h = clamp(h, Math.min(MIN_CROP, spaceH), spaceH);
    }
    state.crop = {x: east ? ax : ax - w, y: south ? ay : ay - h, w, h};
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.target.closest('[data-handle]');
    const rect = els.frame.getBoundingClientRect();
    const start = {...state.crop};
    const startX = event.clientX;
    const startY = event.clientY;
    els.crop.focus({preventScroll: true});
    els.crop.setPointerCapture(event.pointerId);
    els.crop.classList.add('is-dragging');

    const move = (moveEvent) => {
      if (handle) {
        const px = clamp((moveEvent.clientX - rect.left) / rect.width, 0, 1);
        const py = clamp((moveEvent.clientY - rect.top) / rect.height, 0, 1);
        resizeFrom(handle.dataset.handle, start, px, py);
      } else {
        const dx = (moveEvent.clientX - startX) / rect.width;
        const dy = (moveEvent.clientY - startY) / rect.height;
        state.crop = {
          ...start,
          x: clamp(start.x + dx, 0, 1 - start.w),
          y: clamp(start.y + dy, 0, 1 - start.h),
        };
      }
      state.changed = true;
      paintCrop();
    };
    const end = () => {
      els.crop.classList.remove('is-dragging');
      els.crop.removeEventListener('pointermove', move);
      els.crop.removeEventListener('pointerup', end);
      els.crop.removeEventListener('pointercancel', end);
    };
    els.crop.addEventListener('pointermove', move);
    els.crop.addEventListener('pointerup', end);
    els.crop.addEventListener('pointercancel', end);
  }

  const KEYS = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  function onKey(event) {
    const dir = KEYS[event.key];
    if (!dir) return;
    event.preventDefault();
    const crop = state.crop;
    if (event.shiftKey) {
      // Right/Down grow the box and Left/Up shrink it, from the bottom-right corner.
      const aspect = ratio();
      const delta = (dir[0] || dir[1]) * NUDGE;
      const dx = aspect ? delta : dir[0] * NUDGE;
      const dy = aspect ? delta * heightPerWidth(aspect) : dir[1] * NUDGE;
      resizeFrom('se', crop, crop.x + crop.w + dx, crop.y + crop.h + dy);
    } else {
      state.crop = {
        ...crop,
        x: clamp(crop.x + dir[0] * NUDGE, 0, 1 - crop.w),
        y: clamp(crop.y + dir[1] * NUDGE, 0, 1 - crop.h),
      };
    }
    state.changed = true;
    paintCrop();
  }

  // ---------- Replace and save ----------

  async function onReplace() {
    const file = els.file.files[0];
    els.file.value = '';
    if (!file) return;
    if (!TYPES.includes(file.type))
      return showStatus(`${file.name} is not a JPG, PNG or WEBP image.`, true);
    if (file.size > MAX_BYTES)
      return showStatus(`${file.name} is larger than 2 MB.`, true);
    Object.assign(state, {
      turns: 0,
      flipped: false,
      aspect: 'square',
      replaced: true,
      changed: true,
    });
    setAspectRadio('square');
    els.title.textContent = 'Replace photo';
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    if (await useSource(() => fromFile(file), base))
      els.crop.focus({preventScroll: true});
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  // WebP when the browser can make it (JPEG otherwise), shrunk until it fits the 2 MB upload limit.
  async function exportFile() {
    const area = outputSize();
    let scale = 1;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const out = document.createElement('canvas');
      out.width = Math.max(1, Math.round(area.width * scale));
      out.height = Math.max(1, Math.round(area.height * scale));
      const ctx = out.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        els.canvas,
        area.left,
        area.top,
        area.width,
        area.height,
        0,
        0,
        out.width,
        out.height,
      );

      let blob = await toBlob(out, 'image/webp', 0.9);
      if (!blob || blob.type !== 'image/webp') {
        // JPEG has no transparency: put the photo on white first.
        const flat = document.createElement('canvas');
        flat.width = out.width;
        flat.height = out.height;
        const flatCtx = flat.getContext('2d');
        flatCtx.fillStyle = '#fff';
        flatCtx.fillRect(0, 0, flat.width, flat.height);
        flatCtx.drawImage(out, 0, 0);
        blob = await toBlob(flat, 'image/jpeg', 0.88);
      }
      if (!blob)
        throw new Error(
          "This browser couldn't save the edited photo. Try again, or use “Replace photo” to upload it as it is.",
        );
      if (blob.size <= MAX_BYTES) {
        const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
        const name = `${state.baseName.replace(/[^\w-]+/g, '-').slice(0, 40) || 'photo'}-edited.${ext}`;
        return new File([blob], name, {type: blob.type});
      }
      scale *= 0.8;
    }
    throw new Error('The photo is still larger than 2 MB. Try a smaller crop.');
  }

  async function onApply() {
    if (!state.changed) return close(null);
    window.Nx && window.Nx.busy(els.apply, true, 'Saving…');
    try {
      const file = await exportFile();
      const src = await readDataUrl(file);
      close({file, src});
    } catch (error) {
      // A canvas "tainted" by a photo from another site without CORS can't be read back.
      const message =
        error && error.name === 'SecurityError'
          ? "This photo can't be edited here. Use “Replace photo” to pick the file again."
          : (error && error.message) ||
            "The photo couldn't be saved. Try again, or use “Replace photo” to upload it as it is.";
      showStatus(message, true);
    } finally {
      window.Nx && window.Nx.busy(els.apply, false);
    }
  }

  function close(result) {
    if (!finish) return;
    const done = finish;
    finish = null;
    if (state && state.source && typeof state.source.close === 'function')
      state.source.close();
    state = null;
    dialog.close();
    done(result);
  }

  // ---------- Public ----------

  function open({url = '', file = null, label = 'photo'} = {}) {
    if (!dialog) build();
    if (finish) close(null);
    state = {
      turns: 0,
      flipped: false,
      aspect: 'square',
      changed: false,
      replaced: false,
      crop: {x: 0, y: 0, w: 1, h: 1},
    };
    setAspectRadio('square');
    els.title.textContent = `Edit ${label.toLowerCase()}`;
    showStatus('');
    dialog.showModal();
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    const base = file ? file.name.replace(/\.[^.]+$/, '') : 'photo';
    useSource(file ? () => fromFile(file) : () => fromUrl(url), base).then(
      (ok) => {
        if (ok && state) els.crop.focus({preventScroll: true});
        else if (state) dialog.querySelector('.photo-editor-replace').focus();
      },
    );
    return result;
  }

  window.NxImageEditor = {open};
})();
