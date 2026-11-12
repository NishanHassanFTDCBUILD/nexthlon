// Design tokens: colours, text sizes, durations and layers come only from public/css/tokens.css.
// Every other stylesheet uses var(--token). A translucent colour is written rgba(var(--white-rgb), 0.5):
// the colour is a token, the opacity is the only number. These tests fail on any new one-off value.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "public", "css");
const files = fs.readdirSync(DIR).filter(f => f.endsWith(".css") && f !== "tokens.css");
const tokens = fs.readFileSync(path.join(DIR, "tokens.css"), "utf8");

// Each declaration with its file and line, comments removed.
function declarations() {
  const out = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(DIR, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "));
    const re = /([-\w]+)\s*:\s*([^;{}]+)(?=[;}])/g; let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      out.push({ where: `${f}:${line}`, prop: m[1].toLowerCase(), value: m[2].trim() });
    }
  }
  return out;
}
const decls = declarations();
const report = list => list.map(d => `${d.where} ${d.prop}: ${d.value.slice(0, 80)}`).join("\n");

test("colours outside tokens.css are tokens (no hex, no rgb() with numbers)", () => {
  const bad = decls.filter(d => !/url\(/.test(d.value) && (/#[0-9a-f]{3,8}\b/i.test(d.value) || /rgba?\(\s*\d/.test(d.value)));
  assert.equal(bad.length, 0, `One-off colours:\n${report(bad)}`);
});

test("font sizes outside tokens.css are tokens", () => {
  const bad = decls.filter(d => (d.prop === "font-size" && /\d(px|rem|vw|vh)\b/.test(d.value.replace(/var\([^)]*\)/g, "")))
    || (d.prop === "font" && /(^|\s)\d+(\.\d+)?(px|rem)/.test(d.value.replace(/var\([^)]*\)/g, ""))));
  assert.equal(bad.length, 0, `One-off font sizes:\n${report(bad)}`);
});

test("durations outside tokens.css are tokens (zero and negative loop offsets allowed)", () => {
  const bad = decls.filter(d => /^(transition|animation)(-duration|-delay)?$/.test(d.prop))
    .filter(d => /(^|[\s,])\d*\.?\d+m?s\b/.test(d.value.replace(/var\([^)]*\)|calc\([^)]*\)/g, "").replace(/(^|[\s,])0m?s\b/g, "")));
  assert.equal(bad.length, 0, `One-off durations:\n${report(bad)}`);
});

test("easing outside tokens.css is a token", () => {
  const bad = decls.filter(d => /^(transition|animation)(-timing-function)?$/.test(d.prop))
    .filter(d => /cubic-bezier|(^|[\s,])(ease|ease-in|ease-out|ease-in-out|linear)(?=$|[\s,])/.test(d.value.replace(/var\([^)]*\)/g, "")));
  assert.equal(bad.length, 0, `One-off easings:\n${report(bad)}`);
});

test("z-index outside tokens.css is a token", () => {
  const bad = decls.filter(d => d.prop === "z-index" && /\d/.test(d.value.replace(/var\([^)]*\)/g, "")));
  assert.equal(bad.length, 0, `One-off z-index values:\n${report(bad)}`);
});

test("every token a stylesheet uses is defined", () => {
  const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  // Tokens a page sets for itself (inline styles, scripts, a component's own variables) are defined beside their use.
  for (const f of files) for (const m of fs.readFileSync(path.join(DIR, f), "utf8").matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
  const viewsAndScripts = ["views", "public/js"].map(d => path.join(__dirname, "..", d));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of viewsAndScripts.flatMap(walk)) for (const m of fs.readFileSync(file, "utf8").matchAll(/(--[\w-]+)\s*[:"']/g)) defined.add(m[1]);
  const missing = new Set();
  for (const d of decls) for (const m of d.value.matchAll(/var\((--[\w-]+)(\s*,)?/g)) if (!defined.has(m[1]) && !m[2]) missing.add(`${m[1]} (${d.where})`);
  assert.deepEqual([...missing], [], "Tokens used but never defined");
});

test("no text is smaller than 12px: the smallest text token is 12px", () => {
  const m = tokens.match(/--text-2xs:\s*([\d.]+)rem/);
  assert.ok(m && parseFloat(m[1]) * 16 >= 12, "--text-2xs must be at least 0.75rem (12px)");
});

test("interface durations stay between 150ms and 700ms", () => {
  for (const name of ["fast", "quick", "", "medium", "slow", "long", "slower"]) {
    const m = tokens.match(new RegExp(`--duration${name ? "-" + name : ""}:\\s*([\\d.]+)(m?s)`));
    assert.ok(m, `--duration${name ? "-" + name : ""} is defined`);
    const ms = m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
    assert.ok(ms >= 150 && ms <= 700, `--duration${name ? "-" + name : ""} is ${ms}ms`);
  }
});
