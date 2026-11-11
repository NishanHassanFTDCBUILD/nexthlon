// Responsive product photos. Unsplash serves any width from the same address (the "w" setting),
// so a card can offer 400, 600 and 800 pixel versions and the browser downloads the smallest one
// that is sharp on that screen. Our own uploads exist in one size only, so they get no srcset.
// public/js/store.js has the same rule for cards drawn in the browser.

const UNSPLASH = /^https:\/\/images\.unsplash\.com\/[^?#]+\?/;
const CARD_WIDTHS = [400, 600, 800];
// Product cards: two across on phones, three across on laptops, about 340px on wide screens.
const CARD_SIZES = "(max-width: 720px) 50vw, (max-width: 1180px) 33vw, 340px";

function srcsetFor(url, widths = CARD_WIDTHS) {
  if (typeof url !== "string" || !UNSPLASH.test(url)) return "";
  return widths
    .map(width => {
      const sized = /([?&])w=\d+/.test(url) ? url.replace(/([?&])w=\d+/, `$1w=${width}`) : `${url}&w=${width}`;
      return `${sized} ${width}w`;
    })
    .join(", ");
}

// One width of an Unsplash photo (thumbnails); our own uploads are returned as they are.
function sizedUrl(url, width) {
  if (typeof url !== "string" || !UNSPLASH.test(url)) return url;
  return /([?&])w=\d+/.test(url) ? url.replace(/([?&])w=\d+/, `$1w=${width}`) : `${url}&w=${width}`;
}

module.exports = { srcsetFor, sizedUrl, CARD_WIDTHS, CARD_SIZES };
