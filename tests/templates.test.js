// Every EJS template compiles. Prettier and ESLint cannot read .ejs files, so a
// broken <% %> tag or a typo in the JavaScript inside one would otherwise only
// show up when someone opens that page. This catches it in `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ejs = require('ejs');

const viewsDir = path.join(__dirname, '..', 'views');

function templatesIn(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return templatesIn(full);
    return entry.name.endsWith('.ejs') ? [full] : [];
  });
}

const templates = templatesIn(viewsDir);

test('templates: the views folder has templates to check', () => {
  assert.ok(templates.length > 50, `found only ${templates.length}`);
});

for (const file of templates) {
  const name = path.relative(viewsDir, file).replace(/\\/g, '/');
  test(`templates: ${name} compiles`, () => {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() =>
      ejs.compile(source, {filename: file, views: [viewsDir]}),
    );
  });
}

test('templates: every include points at a template that exists', () => {
  const missing = [];
  for (const file of templates) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, target] of source.matchAll(/include\(\s*['"]([^'"]+)['"]/g)) {
      const fromHere = path.resolve(path.dirname(file), target);
      const fromRoot = path.resolve(viewsDir, target);
      const exists = [fromHere, fromRoot].some(
        (base) => fs.existsSync(base) || fs.existsSync(base + '.ejs'),
      );
      if (!exists)
        missing.push(`${path.relative(viewsDir, file)} -> ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});
