// Spelling help for search: "shoees" finds shoes, "raket" finds rackets, "addidas" finds Adidas.
// Plain functions with no database, so they are easy to test. productService gives them the store's own
// words (product names, brands, categories), so a correction is always a word the store really uses.

// Damerau-Levenshtein distance (a swapped pair of letters counts as one mistake), giving up as soon as
// it is certainly above max. Returns max + 1 for "too far".
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous2 = null;
  let previous = Array.from({length: b.length + 1}, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + cost,
      );
      if (
        previous2 &&
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, previous2[j - 2] + 1);
      }
      row.push(value);
      best = Math.min(best, value);
    }
    if (best > max) return max + 1;
    previous2 = previous;
    previous = row;
  }
  return previous[b.length];
}

// How many mistakes a word of this length may have: none for short words (they would match too much),
// one up to six letters, two beyond.
const allowedFor = (word) => (word.length < 4 ? 0 : word.length <= 6 ? 1 : 2);

// The store's words, lower case, from any texts (names, brands, category names). Words under 3 letters
// and pure numbers are left out.
function vocabularyFrom(texts) {
  const words = new Set();
  texts.forEach((text) => {
    String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .forEach((word) => {
        if (word.length >= 3 && !/^\d+$/.test(word)) words.add(word);
      });
  });
  return [...words];
}

// The query with each misspelt word replaced by the closest store word, or null when nothing changes.
// A word the store already uses, a number, or a word with no close match is kept as typed. Ties go to
// the word that starts with the same letter, then the shorter word.
function correctQuery(query, vocabulary) {
  const known = new Set(vocabulary);
  const words = String(query || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  let changed = false;
  const fixed = words.map((word) => {
    const max = allowedFor(word);
    if (!max || known.has(word) || /^\d+$/.test(word) || /[^a-z0-9]/.test(word))
      return word;
    let best = null;
    for (const candidate of vocabulary) {
      const distance = editDistance(word, candidate, max);
      if (distance > max) continue;
      const better =
        !best ||
        distance < best.distance ||
        (distance === best.distance &&
          (candidate[0] === word[0]) > (best.word[0] === word[0])) ||
        (distance === best.distance &&
          (candidate[0] === word[0]) === (best.word[0] === word[0]) &&
          candidate.length < best.word.length);
      if (better) best = {word: candidate, distance};
    }
    if (!best) return word;
    changed = true;
    return best.word;
  });
  return changed ? fixed.join(' ') : null;
}

module.exports = {editDistance, correctQuery, vocabularyFrom};
