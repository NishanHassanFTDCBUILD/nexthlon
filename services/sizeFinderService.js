// "Find my size": foot length in centimetres to a shoe size. A standard adult chart (EU, UK and US),
// read from the nearest row. It is an estimate: the brand's own chart is always the final word.
const CHART = [
  // [foot length cm, EU, UK, US]
  [22.0, 35, 2, 3],
  [22.7, 36, 3, 4],
  [23.3, 37, 4, 5],
  [24.0, 38, 5, 6],
  [24.7, 39, 6, 7],
  [25.3, 40, 7, 8],
  [26.0, 41, 8, 9],
  [26.7, 42, 9, 10],
  [27.3, 43, 10, 11],
  [28.0, 44, 11, 12],
  [28.7, 45, 12, 13],
  [29.3, 46, 13, 14],
  [30.0, 47, 14, 15],
];
const MIN_CM = CHART[0][0];
const MAX_CM = CHART[CHART.length - 1][0];

// Returns {footCm, eu, uk, us} for a length between the chart's ends; throws for anything else.
function sizeFor(value) {
  const cm = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(cm) || cm < MIN_CM || cm > MAX_CM)
    throw Object.assign(
      new Error(
        `Enter your foot length in centimetres, between ${MIN_CM} and ${MAX_CM}.`,
      ),
      {status: 400},
    );
  let best = CHART[0];
  for (const row of CHART) {
    if (Math.abs(row[0] - cm) < Math.abs(best[0] - cm)) best = row;
  }
  return {footCm: cm, eu: best[1], uk: best[2], us: best[3]};
}

module.exports = {sizeFor, MIN_CM, MAX_CM};
