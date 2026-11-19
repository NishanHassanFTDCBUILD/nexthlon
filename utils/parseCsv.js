const {HttpError} = require('./http');

// Bounded RFC-style CSV input, including quoted commas, escaped quotes and multiline notes.
function parseCsv(
  source,
  {maxBytes = 10000, maxRows = 101, maxColumns = 10} = {},
) {
  if (
    typeof source !== 'string' ||
    Buffer.byteLength(source, 'utf8') > maxBytes
  )
    throw new HttpError(400, 'Use a CSV file of 10 KB or less.');
  const input = source.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  let closed = false;
  const cell = () => {
    row.push(value);
    if (row.length > maxColumns)
      throw new HttpError(400, 'Too many CSV columns.');
    value = '';
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((item) => item.trim())) rows.push(row);
    if (rows.length > maxRows)
      throw new HttpError(400, 'Import up to 100 rows at a time.');
    row = [];
  };
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === ',') cell();
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      line();
    } else if (char === '"' && value === '' && !closed) quoted = true;
    else if (closed || char === '"')
      throw new HttpError(400, 'Invalid CSV quoting.');
    else value += char;
  }
  if (quoted) throw new HttpError(400, 'A quoted CSV field was not closed.');
  if (value || row.length || closed) line();
  return rows;
}

module.exports = {parseCsv};
