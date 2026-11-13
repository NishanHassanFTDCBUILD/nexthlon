// A small load test with no extra packages: hits the store's busiest pages with many requests at
// once and prints requests per second and response times (median, p95, worst) for each.
//   node scripts/loadTest.js                       http://localhost:3000, 20 at a time, 10 seconds each
//   node scripts/loadTest.js http://localhost:3200 --concurrency 50 --seconds 15
//   node scripts/loadTest.js http://localhost:3200 --ramp 10,25,50,100,200 --path /
//       raises the number of visitors at once step by step on one page and reports the most this server
//       handles while 95% of answers stay under half a second (docs/SCALING.md uses that number).
// Only GET requests to public pages: it never signs in, adds to a cart or places an order, so it is safe
// to point at a staging copy. Do not point it at a live site you do not own.
const args = process.argv.slice(2);
const base = (args.find(arg => /^https?:\/\//.test(arg)) || "http://localhost:3000").replace(/\/$/, "");
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? Number(args[at + 1]) : fallback;
};
let concurrency = option("concurrency", 20);
const seconds = option("seconds", 10);
const textOption = name => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : "";
};
const ramp = textOption("ramp").split(",").map(Number).filter(n => n > 0);
const rampPath = textOption("path") || "/";
const P95_LIMIT_MS = 500;

async function firstProductPath() {
  const reply = await fetch(`${base}/api/products?limit=1`, { headers: { Accept: "application/json" } });
  const data = await reply.json();
  const slug = data.products && data.products[0] && data.products[0].slug;
  return slug ? `/products/${encodeURIComponent(slug)}` : null;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function run(path) {
  const times = [];
  let errors = 0;
  const until = Date.now() + seconds * 1000;
  const worker = async () => {
    while (Date.now() < until) {
      const started = performance.now();
      try {
        const reply = await fetch(base + path, { headers: { Accept: path.startsWith("/api/") ? "application/json" : "text/html" } });
        await reply.arrayBuffer();
        if (!reply.ok) errors += 1;
      } catch {
        errors += 1;
      }
      times.push(performance.now() - started);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  times.sort((a, b) => a - b);
  return {
    path,
    requests: times.length,
    perSecond: Math.round(times.length / seconds),
    median: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    worst: Math.round(times[times.length - 1] || 0),
    errors
  };
}

async function rampTest() {
  console.log(`Ramp test: ${base}${rampPath}, ${seconds}s per step, goal: 95% of answers under ${P95_LIMIT_MS}ms\n`);
  console.log("at once".padStart(8), "req/s".padStart(7), "median".padStart(8), "p95".padStart(7), "errors".padStart(7));
  let best = null;
  for (const step of ramp) {
    concurrency = step;
    const r = await run(rampPath);
    const ok = r.p95 <= P95_LIMIT_MS && r.errors === 0;
    console.log(String(step).padStart(8), String(r.perSecond).padStart(7), `${r.median}ms`.padStart(8), `${r.p95}ms`.padStart(7), String(r.errors).padStart(7), ok ? "" : "  over the limit");
    if (ok && (!best || r.perSecond > best.perSecond)) best = { ...r, step };
    if (!ok) break;
  }
  console.log(best
    ? `\nThis server handles about ${best.perSecond} requests a second on ${rampPath} (${best.step} at once, p95 ${best.p95}ms).`
    : "\nEven the first step was over the limit.");
}

(async () => {
  if (ramp.length) return rampTest();
  const product = await firstProductPath();
  const paths = ["/", "/products", "/products?q=shoes", "/api/products/search?q=run", product].filter(Boolean);
  console.log(`Load test: ${base}, ${concurrency} at a time, ${seconds}s per page\n`);
  console.log("page".padEnd(42), "req/s".padStart(6), "median".padStart(8), "p95".padStart(7), "worst".padStart(7), "errors".padStart(7));
  for (const path of paths) {
    const r = await run(path);
    console.log(r.path.padEnd(42), String(r.perSecond).padStart(6), `${r.median}ms`.padStart(8), `${r.p95}ms`.padStart(7), `${r.worst}ms`.padStart(7), String(r.errors).padStart(7));
  }
})().catch(error => {
  console.error("Load test failed:", error.message);
  process.exitCode = 1;
});
