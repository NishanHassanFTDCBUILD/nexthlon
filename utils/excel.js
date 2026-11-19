// Excel (.xlsx) exports with exceljs, streamed to the response.
// columns: [{ header, key, width, type: "money" | "date" | "number" | "text" }]
// Money arrives in paise and is written as rupees with a ₹ number format.
// Text that a spreadsheet would treat as a formula gets a leading apostrophe (as in the CSV).
const ExcelJS = require('exceljs');

const FORMULA_START = /^[=+\-@\t\r]/;

async function sendWorkbook(res, {filename, sheet, columns, rows}) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: res,
    useStyles: true,
  });
  workbook.creator = 'Nexthlon';
  workbook.created = new Date();
  const ws = workbook.addWorksheet(sheet, {
    views: [{state: 'frozen', ySplit: 1}],
  });
  ws.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width || 16,
    style:
      col.type === 'money'
        ? {numFmt: '₹#,##0.00'}
        : col.type === 'date'
          ? {numFmt: 'dd mmm yyyy hh:mm'}
          : {},
  }));
  ws.getRow(1).font = {bold: true};
  ws.getRow(1).commit();
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  for await (const row of rows) {
    const values = {};
    for (const col of columns) {
      let value = row[col.key];
      if (col.type === 'money') value = Number(value || 0) / 100;
      else if (col.type === 'date') value = value ? new Date(value) : null;
      else if (typeof value === 'string' && FORMULA_START.test(value))
        value = `'${value}`;
      values[col.key] = value === undefined ? null : value;
    }
    ws.addRow(values).commit();
  }
  ws.commit();
  await workbook.commit();
}

module.exports = {sendWorkbook};
