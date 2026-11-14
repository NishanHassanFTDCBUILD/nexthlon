// Page transitions (C1): wired the way the browser needs them, and all of it stays
// behind "reduce motion". No database needed.
require("./helpers");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const motion = read("public/css/motion.css");

// The body of the first "@media (prefers-reduced-motion: no-preference) { ... }" block that contains `needle`.
function noPreferenceBlockWith(needle) {
  const re = /@media \(prefers-reduced-motion: no-preference\) \{/g;
  let match;
  while ((match = re.exec(motion))) {
    let depth = 1;
    let i = re.lastIndex;
    while (depth && i < motion.length) {
      if (motion[i] === "{") depth += 1;
      if (motion[i] === "}") depth -= 1;
      i += 1;
    }
    const body = motion.slice(re.lastIndex, i);
    if (body.includes(needle)) return body;
  }
  return null;
}

test("motion: page transitions run only without reduced motion, forward and back", () => {
  const block = noPreferenceBlockWith("@view-transition");
  assert.ok(block, "cross-document transitions live inside the no-preference block");
  assert.match(block, /@view-transition \{ navigation: auto; \}/);
  assert.match(block, /\.site-header \{ view-transition-name: site-header; \}/, "the header stays put");
  assert.match(block, /\.pdx-photo \{ view-transition-name: product-photo; \}/);
  assert.match(block, /:active-view-transition-type\(back\)::view-transition-old\(root\)/, "going back has its own motion");
  assert.match(block, /:active-view-transition-type\(back\)::view-transition-new\(root\)/);
});

test("motion: the arriving page decides its half before the first frame", () => {
  const head = read("views/partials/head.ejs");
  const tag = /<script src="<%= asset\('\/js\/page-reveal\.js'\) %>"><\/script>/.exec(head);
  assert.ok(tag, "page-reveal.js is in <head>");
  assert.doesNotMatch(tag[0], /defer|async|type="module"/, "not deferred: pagereveal fires before deferred scripts run");
  const script = read("public/js/page-reveal.js");
  assert.match(script, /addEventListener\("pagereveal"/);
  assert.match(script, /navigationType !== "traverse"/, "only history moves are turned round");
  assert.match(script, /types\.add\(back \? "back" : "forward"\)/);
  assert.match(script, /viewTransitionName = "product-photo"/, "the card takes the photo back");
  assert.match(script, /finished\.then\(clear, clear\)/, "and gives the name up afterwards, even when the browser cancels it");
  // The leaving side names the clicked card's photo.
  assert.match(read("public/js/app.js"), /addEventListener\("pageswap"/);
});
