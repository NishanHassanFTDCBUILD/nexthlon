// CSV without a library. Every cell is quoted, and text that a spreadsheet would treat as a
// formula (starting with =, +, -, @, a tab or a carriage return) gets a leading apostrophe, so
// an exported customer name like "=HYPERLINK(...)" can never run in Excel or Sheets.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '""';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const row = values => `${values.map(cell).join(",")}\r\n`;

module.exports = { cell, row };
