# Nexthlon mobile audit checklist

Run this before every release that touches pages, CSS or front-end JS. Each check says **how** to
test it, so anyone on the team can run it. The store must pass every line on the core pages:
home, product list, a product with several photos, cart, checkout, sign in, contact, and one
My Account page.

## How to test

- **Chrome DevTools device mode** (Ctrl+Shift+M) for sizes. Turn on "Show media queries" to see the
  breakpoints, and set the device type to "Mobile" so touch rules (`pointer: coarse`) apply.
- **One real phone** for the things emulators get wrong: Safari's address bar, the on-screen
  keyboard, notches, and how swipes feel. Use an iPhone and an Android phone if you can.
- **Lighthouse** (DevTools > Lighthouse, or `npx lighthouse <url>`) on Mobile and Desktop.
- **Keyboard only** (Tab, Shift+Tab, Enter, Space, Escape, arrow keys) for focus checks.

## Screen sizes to check

| Size | Stands in for | Look for |
|---|---|---|
| 320 × 640 | iPhone SE (1st gen), small Android | Nothing cut off, no sideways scroll, header fits |
| 375 × 812 | iPhone 12–15 mini, most phones | The everyday layout |
| 430 × 932 | iPhone Pro Max, large Android | Cards and rails don't look stretched |
| 812 × 375 | Any phone held sideways | Hero and sign-in form fit a short screen |
| 768 × 1024 | iPad portrait | Two-column pages switch over cleanly |
| 1024 × 768 | iPad landscape, small laptop | Header and filters don't wrap |
| 1440 × 900 | Laptop: the design width | The reference layout |
| 1920 × 1080 | Desktop monitor | Wider column (1600px), nothing floating |
| 2560 × 1440 | QHD, or 4K at 150% | Text 12.5% larger, 1840px column |

Breakpoints the CSS uses (documented in `public/css/tokens.css`): 420, 560, 720, 900, 1024, 1180,
1440, 1920, 2560, 3200.

## 1. Layout and overflow

- [ ] **No sideways scroll at any size.** In the console:
      `document.documentElement.scrollWidth > innerWidth` must be `false`. Swipe left and right on a
      real phone too: the page must not move.
- [ ] **Only rails scroll sideways**: product rails, category links, filter pills and photo thumbs.
      Each one snaps to an item and hides its scrollbar.
- [ ] **Side padding** is 16px on phones and grows with the screen (`--gutter`). Nothing touches the
      screen edge apart from full-bleed images.
- [ ] **Notch and home bar**: on an iPhone held sideways, nothing hides under the notch, and nothing
      fixed at the bottom (the product buy bar, toasts) sits under the home bar.
- [ ] **Long words** (product names, emails, order IDs) wrap or truncate and never push the layout
      wider.

## 2. Viewport height (the moving address bar)

- [ ] **Full-height sections use `dvh`/`svh`, with `vh` only as a fallback.** On a real phone,
      scroll so the address bar hides and shows: nothing should jump or leave a gap.
- [ ] **Pinned sections** (home hero, showroom, sport ring) use `svh`, so they never resize mid-scroll.
- [ ] **Phone held sideways (812 × 375)**: the home hero shows its headline, intro and buttons, and
      the sign-in form starts on the first screen.
- [ ] **Keyboard open**: on sign in, checkout and contact, the focused field scrolls into view above
      the keyboard and the page doesn't zoom in. Fields must be 16px or larger, or iOS zooms.

## 3. Touch

- [ ] **Every control is at least 44 × 44px to tap** (WCAG 2.5.5). Small icons get an invisible
      44px area on touch screens (see "Touch" in `components.css`). Check with the audit snippet below.
- [ ] **No stuck hover**: tap a product card, a button and a product photo icon, then lift your
      finger. Nothing stays lifted, zoomed or lit (see `@media (hover: none)` in `mobile.css`).
- [ ] **Press feedback**: cards and buttons shrink slightly while pressed.
- [ ] **Product photos**: swiping sideways changes the photo, a tap opens the full-screen viewer,
      a vertical drag scrolls the page, and pinch zoom still works.
- [ ] **Full-screen viewer**: pinch, double-tap and drag to zoom, swipe to change photo, and
      Escape or the X closes it.
- [ ] **Header**: hides when you scroll down, comes back when you scroll up, and the menu drawer
      opens, traps focus and closes with Escape or a tap outside.
- [ ] **No 300ms tap delay** (the viewport meta tag handles this; check it is still in `head.ejs`).

## 4. Text and readability

- [ ] **Body text is never under 12px on phones**. Labels may be 11px on tablets and up.
- [ ] **Text scales with the browser's text size**: set Chrome's font size to "Very large". Text
      grows and nothing overlaps or gets cut off (sizes are in `rem`).
- [ ] **Line length** stays under about 75 characters on wide screens.
- [ ] **Contrast** is at least 4.5:1 for normal text and 3:1 for large text. Check text that sits
      on photos and gradients by eye, because automated tools skip it.

## 5. Images and high-DPI screens

- [ ] **Product photos use `srcset`/`sizes`**: a 3× phone gets a sharp photo, a 1× laptop doesn't
      download the 2000px one. Check the Network tab.
- [ ] **Every `<img>` has `width` and `height`** (or an aspect-ratio box), so nothing jumps as it loads.
- [ ] **Icons are SVG** (`icons.svg`), so they stay sharp at any zoom.
- [ ] **Photos on the first screen** show as soon as they load (no fade-in delay), and the main
      product photo has `fetchpriority="high"`.

## 6. Motion

- [ ] **Reduced motion**: turn on "Reduce motion" in the OS, or in DevTools > Rendering > Emulate
      `prefers-reduced-motion`. No reveals, tilts, floating or count-ups. The 3D scenes show as one
      still frame. Every section is still readable.
- [ ] **Data saver and slow connections**: with Chrome's "Slow 4G" or Data Saver, the 3D scenes
      don't start and their still versions show.
- [ ] **Only `transform` and `opacity` animate** (no layout shifts). Check DevTools > Performance
      for long tasks while scrolling the home page.

## 7. Accessibility

- [ ] **Skip link**: the first Tab on any page shows "Skip to content", and Enter jumps to `<main>`.
- [ ] **Focus is always visible** and follows the reading order. No `tabindex` above 0.
- [ ] **One `<h1>` per page, no skipped heading levels**, and ids are unique.
- [ ] **Every field has a label**. Errors are linked with `aria-describedby`, the field gets
      `aria-invalid`, and focus moves to the first bad field.
- [ ] **Announcements**: adding to cart, applying a coupon and form errors are read out by a
      screen reader (VoiceOver on iPhone, TalkBack on Android). Toasts stay up while hovered or
      focused.
- [ ] **Dialogs** (menu drawer, address form, photo viewer, confirm) trap focus, close with Escape,
      and return focus to the button that opened them.

## 8. Performance (Lighthouse, Mobile)

- [ ] **Performance 90+, Accessibility 100, Best Practices 100, SEO 100** on home, product list and
      a product page. Run the dev server with `NODE_ENV=production` behind HTTPS for numbers that
      match the live site.
- [ ] **Largest Contentful Paint under 2.5s, Cumulative Layout Shift under 0.1, Total Blocking Time
      under 200ms.**
- [ ] **CSS and JS links carry `?v=<hash>`** and come back with
      `Cache-Control: public, max-age=31536000, immutable`.
- [ ] **Text is gzipped** (`Content-Encoding: gzip` on HTML, CSS and JS).

## Audit snippet

Paste into the DevTools console in device mode. It lists sideways overflow, tiny text and small
touch targets on the current page.

```js
(() => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest("[hidden],[aria-hidden=true],dialog:not([open])"); };
  const clipped = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; return false; };
  const label = e => `${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]}`;
  const all = [...document.querySelectorAll("body *")].filter(vis);
  console.table({
    sidewaysScroll: document.documentElement.scrollWidth > innerWidth,
    overflowing: all.filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !clipped(e) && getComputedStyle(e).position !== "fixed").slice(0, 5).map(label).join(", ") || "none",
    tinyText: all.filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !(e instanceof SVGElement) && parseFloat(getComputedStyle(e).fontSize) < 12).slice(0, 5).map(label).join(", ") || "none",
    smallTargets: matchMedia("(pointer: coarse)").matches
      ? [...document.querySelectorAll("a[href],button,select,summary")].filter(e => vis(e) && getComputedStyle(e).display !== "inline" && !e.closest(".product-name")).filter(e => {
          const r = e.getBoundingClientRect(); const b = getComputedStyle(e, "::before");
          const grow = b.content !== "none" && b.position === "absolute" ? Math.max(0, -parseFloat(b.top) || 0) * 2 : 0;
          return Math.min(r.width, r.height) + grow < 44;
        }).slice(0, 8).map(label).join(", ") || "none"
      : "switch device mode to Mobile first"
  });
})();
```
