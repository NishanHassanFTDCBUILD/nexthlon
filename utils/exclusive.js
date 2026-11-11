// Runs jobs that share a key one after another, so "count what was sent, then send" cannot be done by
// several requests at once (which would each see the same count and all send). Within one copy of the
// app this is exact; with several copies behind a load balancer the per-address rate limits and the
// per-account caps together still keep an inbox from being flooded, only a few more could slip through.
const tails = new Map();

function runExclusive(key, work) {
  const previous = tails.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(work);
  const tail = run.catch(() => {});
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}

module.exports = { runExclusive };
