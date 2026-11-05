// Admin products: list filters, list/unlist toggle, and the add/edit form with its photo manager.
(function () {
  "use strict";

  const MAX_IMAGES = 4;
  const MAX_BYTES = 2 * 1024 * 1024;
  const TYPES = ["image/jpeg", "image/png", "image/webp"];
  const STATUS = {
    active: { label: "Active", pill: "pill-green" },
    unlisted: { label: "Unlisted", pill: "pill-grey" },
    out: { label: "Out of stock", pill: "pill-red" }
  };

  function iconSvg(name) {
    return `<svg class="i i-xs" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  }

  // ---------- List page ----------
  const filterForm = document.querySelector("[data-admin-filters]");
  if (filterForm) {
    const results = document.querySelector("[data-results]");
    filterForm.addEventListener("submit", () => results && results.classList.add("is-loading"));
    filterForm.querySelectorAll("[data-auto-submit-field]").forEach(field => {
      field.addEventListener("change", () => filterForm.requestSubmit());
    });
    window.addEventListener("pageshow", () => results && results.classList.remove("is-loading"));
  }

  document.querySelectorAll("[data-toggle-listing]").forEach(button => {
    button.addEventListener("click", async () => {
      const listed = button.dataset.listed === "true";
      const name = button.dataset.name;
      const confirmed = await Nx.confirm({
        title: listed ? `Unlist ${name}?` : `List ${name} again?`,
        message: listed
          ? "Shoppers will no longer see it, and it shows as unavailable in carts. It stays here, so you can list it again any time."
          : "It will be visible in the store again straight away.",
        confirmLabel: listed ? "Unlist product" : "List product",
        tone: listed ? "danger" : "primary"
      });
      if (!confirmed) return;

      Nx.busy(button, true, listed ? "Unlisting…" : "Listing…");
      try {
        const result = await Nx.api(`/api/admin/products/${encodeURIComponent(button.dataset.toggleListing)}/listing`, {
          method: "PATCH",
          body: { isListed: !listed }
        });
        Nx.busy(button, false);
        const product = result.product;
        const row = button.closest("tr");
        const status = row.querySelector("[data-status]");
        status.textContent = STATUS[product.status].label;
        status.className = `pill ${STATUS[product.status].pill}`;
        row.classList.toggle("is-unlisted", !product.isListed);
        button.dataset.listed = String(product.isListed);
        button.textContent = product.isListed ? "Unlist" : "List";
        button.setAttribute("aria-label", `${product.isListed ? "Unlist" : "List"} ${name}`);
        button.className = `btn btn-sm ${product.isListed ? "btn-danger-soft" : "btn-secondary"}`;
        Nx.toast(result.message);
      } catch (error) {
        Nx.busy(button, false);
        Nx.toast(error.message, "error");
      }
    });
  });

  // ---------- Add / edit form ----------
  const form = document.querySelector("[data-product-form]");
  if (!form) return;

  // Live discount preview. The server works out the real value when saving.
  const priceInput = form.querySelector("[data-price]");
  const mrpInput = form.querySelector("[data-mrp]");
  const preview = form.querySelector("[data-discount-preview]");
  function updateDiscount() {
    const price = Number(priceInput.value);
    const mrp = Number(mrpInput.value);
    if (!price || !mrp) preview.textContent = "—";
    else if (mrp < price) preview.textContent = "M.R.P. is lower than the price";
    else preview.textContent = mrp > price ? `${Math.round(((mrp - price) / mrp) * 100)}% off` : "No discount";
  }
  priceInput.addEventListener("input", updateDiscount);
  mrpInput.addEventListener("input", updateDiscount);
  updateDiscount();

  // Photo manager. Each item is a photo already saved ("kept") or a file picked just now ("new").
  const manager = form.querySelector("[data-image-manager]");
  const tiles = manager.querySelector("[data-image-tiles]");
  const input = manager.querySelector("[data-image-input]");
  const addTile = manager.querySelector("[data-image-add]");
  const countLabel = manager.querySelector("[data-image-count]");
  const imageError = form.querySelector('[data-error-for="images"]');
  let nextId = 0;
  const items = JSON.parse(manager.dataset.existing || "[]").map(url => ({ id: nextId++, kind: "kept", url, src: url }));
  let mainId = items.length ? items[0].id : null;

  function showImageError(message) {
    imageError.textContent = message;
  }

  function render() {
    tiles.textContent = "";
    if (!items.some(item => item.id === mainId)) mainId = items.length ? items[0].id : null;
    items.forEach((item, index) => {
      const li = document.createElement("li");
      li.className = `image-tile${item.id === mainId ? " is-main" : ""}`;
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = `Photo ${index + 1}`;
      img.width = 160;
      img.height = 160;
      li.append(img);

      const bar = document.createElement("div");
      bar.className = "image-tile-bar";
      if (item.id === mainId) {
        const badge = document.createElement("span");
        badge.className = "image-main-badge";
        badge.innerHTML = `${iconSvg("check")} Main photo`;
        bar.append(badge);
      } else {
        const makeMain = document.createElement("button");
        makeMain.type = "button";
        makeMain.className = "link-btn";
        makeMain.textContent = "Make main";
        makeMain.setAttribute("aria-label", `Make photo ${index + 1} the main photo`);
        makeMain.addEventListener("click", () => {
          mainId = item.id;
          render();
        });
        bar.append(makeMain);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "icon-btn icon-btn-sm image-remove";
      remove.setAttribute("aria-label", `Remove photo ${index + 1}`);
      remove.innerHTML = iconSvg("trash");
      remove.addEventListener("click", () => {
        items.splice(items.indexOf(item), 1);
        showImageError("");
        render();
      });
      bar.append(remove);
      li.append(bar);
      tiles.append(li);
    });
    addTile.hidden = items.length >= MAX_IMAGES;
    countLabel.textContent = `${items.length} of ${MAX_IMAGES} added`;
  }

  // Previews use data: URLs, which the Content Security Policy already allows for images.
  function readPreview(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  input.addEventListener("change", async () => {
    const files = [...input.files];
    input.value = "";
    showImageError("");
    for (const file of files) {
      if (items.length >= MAX_IMAGES) {
        showImageError(`A product can have up to ${MAX_IMAGES} photos.`);
        break;
      }
      if (!TYPES.includes(file.type)) {
        showImageError(`${file.name} is not a JPG, PNG or WEBP image.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        showImageError(`${file.name} is larger than 2 MB.`);
        continue;
      }
      try {
        items.push({ id: nextId++, kind: "new", file, src: await readPreview(file) });
      } catch {
        showImageError(`${file.name} could not be read.`);
      }
    }
    render();
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    // Everything is checked on the server, which reports every problem at once (photos included).
    const data = new FormData();
    for (const name of ["name", "description", "category", "brand", "price", "mrp", "offerPercent", "stock"]) {
      data.append(name, form.elements[name].value);
    }
    const kept = items.filter(item => item.kind === "kept");
    const fresh = items.filter(item => item.kind === "new");
    data.append("keepImages", JSON.stringify(kept.map(item => item.url)));
    fresh.forEach(item => data.append("images", item.file, item.file.name));
    const main = items.find(item => item.id === mainId);
    if (main) data.append("mainImage", main.kind === "kept" ? main.url : `new:${fresh.indexOf(main)}`);

    const result = await Nx.submitForm(form, {
      url: form.dataset.endpoint,
      method: form.dataset.method,
      body: data,
      busyLabel: "Saving…"
    });
    if (result) {
      Nx.flash(result.message);
      window.location.assign(`${document.body.dataset.adminPath}/products`);
    }
  });

  render();
})();
