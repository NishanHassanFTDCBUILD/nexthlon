// Responsive product photos.
//
// Two kinds of photo can show up in the shop:
//   Unsplash   (the sample products) serves any width from the same address through its "w" setting.
//   Our own    uploads. Each upload is saved as a "full" copy plus smaller WebP copies next to it
//              (services/imageService.js):
//                .../products/<id>-full.webp   up to 2000px: the product page zoom and full-screen viewer
//                .../products/<id>-1600.webp   large screens, high-density phones
//                .../products/<id>-800.webp    product page, home sections
//                .../products/<id>-400.webp    product cards
//                .../products/<id>-200.webp    thumbnails
//              The stored address is the "-full.webp" one, and every other size is worked out from it by
//              changing the ending, so this works the same on local disk and on a CDN, with no lookup.
//              Photos uploaded before this existed ("/uploads/products/<id>.jpg") have no small copies and are
//              shown as they are, until "npm run images:migrate" creates them.
// public/js/store.js and public/js/product.js apply the same rules to cards drawn in the browser.

const UNSPLASH = /^https:\/\/images\.unsplash\.com\/[^?#]+\?/;
const CARD_WIDTHS = [400, 600, 800];
// Product cards: two across on phones, three across on laptops, about 340px on wide screens.
const CARD_SIZES = '(max-width: 720px) 50vw, (max-width: 1180px) 33vw, 340px';

// The sizes we generate, and the ones product cards offer the browser to choose from.
const VARIANT_WIDTHS = [200, 400, 800, 1600];
const OWN_CARD_WIDTHS = [400, 800, 1600];
// "<anything>/products/<32 hex>-full.webp": the first part is the address without "-full.webp".
const OWN_FULL = /^(.*\/products\/[a-f0-9]{32})-full\.webp$/;

// The address of one size of our own photo, or null when the photo is not one of the new ones.
function variantUrl(url, width) {
  const match = typeof url === 'string' ? OWN_FULL.exec(url) : null;
  return match ? `${match[1]}-${width}.webp` : null;
}

function unsplashWidth(url, width) {
  return /([?&])w=\d+/.test(url)
    ? url.replace(/([?&])w=\d+/, `$1w=${width}`)
    : `${url}&w=${width}`;
}

function srcsetFor(url, widths = CARD_WIDTHS) {
  if (typeof url !== 'string') return '';
  if (OWN_FULL.test(url))
    return OWN_CARD_WIDTHS.map(
      (width) => `${variantUrl(url, width)} ${width}w`,
    ).join(', ');
  if (!UNSPLASH.test(url)) return '';
  return widths
    .map((width) => `${unsplashWidth(url, width)} ${width}w`)
    .join(', ');
}

// One size of a photo, for a place that always shows it small (a cart row, an order line, a thumbnail):
// the smallest copy that is at least this wide (so it stays sharp), or the photo itself when none fits.
// Photos that are neither Unsplash nor one of the new uploads come back unchanged.
function sizedUrl(url, width) {
  if (typeof url !== 'string') return url;
  if (OWN_FULL.test(url)) {
    const size = VARIANT_WIDTHS.find((candidate) => candidate >= width);
    return size ? variantUrl(url, size) : url;
  }
  return UNSPLASH.test(url) ? unsplashWidth(url, width) : url;
}

// The product page's big photo: one of our own photos is offered at 800 and 1600px (the browser picks), with
// the 1600 copy as the fallback; anything else is used as it is. The full-size file is kept for the zoom.
function gallerySource(url) {
  if (typeof url === 'string' && OWN_FULL.test(url)) {
    return {
      src: variantUrl(url, 1600),
      srcset: [800, 1600]
        .map((width) => `${variantUrl(url, width)} ${width}w`)
        .join(', '),
    };
  }
  return {src: url, srcset: ''};
}

module.exports = {
  srcsetFor,
  sizedUrl,
  gallerySource,
  variantUrl,
  VARIANT_WIDTHS,
  OWN_CARD_WIDTHS,
  CARD_WIDTHS,
  CARD_SIZES,
  OWN_FULL,
};
