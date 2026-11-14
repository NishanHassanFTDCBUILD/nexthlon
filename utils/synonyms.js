// Words shoppers use that the store doesn't (E4). A search for a key also finds the value words.
// Kept short and honest: only common Indian English alternatives for sports gear.
const SYNONYMS = Object.freeze({
  sneakers: ["shoes"],
  sneaker: ["shoe"],
  trainers: ["shoes"],
  soccer: ["football"],
  cricket: ["cricket"],
  jersey: ["tshirt", "shirt"],
  bike: ["cycling"],
  bicycle: ["cycling"],
  tent: ["camping"],
  dumbbell: ["dumbbells"],
  weights: ["dumbbells"],
  racquet: ["racket"],
  bottle: ["flask"],
  rucksack: ["backpack"],
  gloves: ["glove"]
});

// The query plus any synonym words, as one search string (never more than 8 extra words).
function expandQuery(query) {
  const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const extra = [];
  for (const word of words) {
    for (const alt of SYNONYMS[word] || []) if (!words.includes(alt) && extra.length < 8) extra.push(alt);
  }
  return extra.length ? `${words.join(" ")} ${extra.join(" ")}` : query;
}

module.exports = { SYNONYMS, expandQuery };
