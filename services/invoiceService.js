// Draws an order's tax invoice as a PDF with pdfkit. Uses Noto Sans (assets/fonts) because the
// built-in PDF fonts cannot print the rupee sign.
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { STORE } = require("../config/store");
const { formatPaise } = require("../utils/money");
const { STATUS_LABELS } = require("../utils/orderRules");
const { STATE_CODES, amountInWords } = require("../utils/gst");
const { HttpError } = require("../utils/http");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const BOLD = path.join(FONT_DIR, "NotoSans-Bold.ttf");
const INK = "#0a0a0b";      // obsidian
const MUTED = "#5c5c64";
const VOLT = "#d4ff3a";     // brand accent, used on the dark header band only

const dateText = value => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));

// "Trail Runner (Size 9 · Red)" for an item bought in a size or colour.
const itemName = item => (item.option ? `${item.name} (${item.option})` : item.name);

// A GST invoice exists once the order has a real invoice number (services/gstService.js).
const hasGstInvoice = order => Boolean(order.gst && order.gst.invoiceNo && !order.gst.invoiceNo.startsWith("pending:"));

function invoiceNumber(order) {
  return hasGstInvoice(order) ? order.gst.invoiceNo : order.orderId.replace(/^NX-/, "INV-");
}

// A file name for a document number ("NX/26-27/000123" -> "NX-26-27-000123.pdf").
const fileNameFor = number => `${String(number).replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

// Writes the invoice PDF to a stream (the HTTP response). Returns the document.
// Orders with GST (placed after B4) get the GST tax invoice; older orders keep the simple one.
function writeInvoice(order, stream) {
  if (hasGstInvoice(order)) return writeGstDocument(order, null, stream);
  return writeSimpleInvoice(order, stream);
}

// An order with GST but no invoice number yet (an online payment still to arrive) has no invoice.
function assertInvoiceReady(order) {
  if (order.gst && !hasGstInvoice(order)) throw new HttpError(409, "The invoice is issued once the payment for this order arrives.");
}

// One of an order's credit notes by its position ("0", "1", ...), or a 404.
function findCreditNote(order, index) {
  const at = /^\d{1,3}$/.test(String(index)) ? Number(index) : -1;
  const note = (order.creditNotes || [])[at];
  if (!note || !hasGstInvoice(order) || String(note.number).startsWith("pending:")) throw new HttpError(404, "Credit note not found.");
  return note;
}

// A credit note PDF (one of order.creditNotes).
function writeCreditNote(order, note, stream) {
  return writeGstDocument(order, note, stream);
}

// The invoice of an order from before GST invoices: prices including tax, no tax split.
function writeSimpleInvoice(order, stream) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Invoice ${invoiceNumber(order)}`, Author: STORE.brandName } });
  const hasFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);
  if (hasFonts) {
    doc.registerFont("body", REGULAR);
    doc.registerFont("bold", BOLD);
  }
  const font = name => doc.font(hasFonts ? name : name === "bold" ? "Helvetica-Bold" : "Helvetica");
  const money = paise => (hasFonts ? formatPaise(paise) : formatPaise(paise).replace("₹", "Rs. "));
  doc.pipe(stream);

  const left = 48;
  const right = doc.page.width - 48;
  const width = right - left;

  // Header band
  doc.rect(0, 0, doc.page.width, 92).fill(INK);
  font("bold").fontSize(24).fillColor("#ffffff").text("NEXTHLON", left, 30);
  font("body").fontSize(9).fillColor(VOLT).text("PERFORMANCE GEAR", left, 58);
  font("bold").fontSize(16).fillColor("#ffffff").text("Tax invoice", left, 32, { width, align: "right" });
  font("body").fontSize(9).fillColor("#d4d4cd").text(invoiceNumber(order), left, 56, { width, align: "right" });

  // Seller, buyer and order details
  let y = 116;
  font("bold").fontSize(9).fillColor(MUTED).text("SOLD BY", left, y);
  font("bold").fontSize(9).text("DELIVER TO", left + width / 3, y);
  font("bold").fontSize(9).text("ORDER", left + (2 * width) / 3, y);
  y += 14;
  font("body").fontSize(9.5).fillColor(INK);
  doc.text(`${STORE.legalName}\n${STORE.address}\nGSTIN: ${STORE.gstin}`, left, y, { width: width / 3 - 12 });
  const a = order.address;
  doc.text([a.fullName, a.line1, a.line2, a.landmark, `${a.city}, ${a.state} ${a.pincode}`, `Phone: +91 ${a.phone}`].filter(Boolean).join("\n"), left + width / 3, y, { width: width / 3 - 12 });
  doc.text([
    `Order: ${order.orderId}`,
    `Date: ${dateText(order.createdAt)}`,
    `Payment: ${order.paymentMethod === "cod" ? "Cash on Delivery" : order.paymentMethod === "wallet" ? "Nexthlon wallet" : "Online (Razorpay)"}`,
    `Status: ${STATUS_LABELS[order.orderStatus] || order.orderStatus}`
  ].join("\n"), left + (2 * width) / 3, y, { width: width / 3 });

  // Items table
  y = Math.max(doc.y, y + 60) + 24;
  const cols = [
    { label: "Item", x: left, w: width * 0.46, align: "left" },
    { label: "Qty", x: left + width * 0.46, w: width * 0.1, align: "right" },
    { label: "M.R.P.", x: left + width * 0.56, w: width * 0.14, align: "right" },
    { label: "Price", x: left + width * 0.7, w: width * 0.14, align: "right" },
    { label: "Amount", x: left + width * 0.84, w: width * 0.16, align: "right" }
  ];
  doc.rect(left, y, width, 22).fill("#efefea");
  font("bold").fontSize(9).fillColor(INK);
  cols.forEach(col => doc.text(col.label, col.x + 6, y + 6, { width: col.w - 12, align: col.align }));
  y += 28;
  font("body").fontSize(9.5);
  for (const item of order.items) {
    const cancelled = item.status === "cancelled";
    const name = itemName(item);
    const nameHeight = doc.heightOfString(name, { width: cols[0].w - 12 });
    if (y + nameHeight + 20 > doc.page.height - 120) {
      doc.addPage();
      y = 60;
    }
    doc.fillColor(cancelled ? MUTED : INK);
    doc.text(name + (cancelled ? " (cancelled)" : ""), cols[0].x + 6, y, { width: cols[0].w - 12 });
    doc.text(String(item.quantity), cols[1].x + 6, y, { width: cols[1].w - 12, align: "right" });
    doc.text(money(item.mrp), cols[2].x + 6, y, { width: cols[2].w - 12, align: "right" });
    doc.text(money(item.price), cols[3].x + 6, y, { width: cols[3].w - 12, align: "right" });
    doc.text(money(item.lineTotal), cols[4].x + 6, y, { width: cols[4].w - 12, align: "right" });
    y += Math.max(nameHeight, 12) + 10;
    doc.moveTo(left, y - 5).lineTo(right, y - 5).lineWidth(0.5).strokeColor("#e4e4de").stroke();
  }

  // Totals
  y += 8;
  const rows = [
    ["M.R.P. total", money(order.mrpTotal)],
    ["Discount on M.R.P.", `- ${money(order.discount)}`],
    ...(order.couponDiscount ? [[`Coupon ${order.couponCode}`, `- ${money(order.couponDiscount)}`]] : []),
    ["Delivery fee", order.deliveryFee ? money(order.deliveryFee) : "Free"],
    ...(order.walletUsed ? [["Paid from wallet", `- ${money(order.walletUsed)}`]] : []),
    ...(order.refundedAmount ? [["Refunded", `- ${money(order.refundedAmount)}`]] : [])
  ];
  const labelX = left + width * 0.5;
  const labelW = width * 0.32;
  const valueX = left + width * 0.82;
  const valueW = width * 0.18;
  font("body").fontSize(10).fillColor(INK);
  for (const [label, value] of rows) {
    doc.text(label, labelX, y, { width: labelW });
    doc.text(value, valueX, y, { width: valueW, align: "right" });
    y += 18;
  }
  doc.moveTo(labelX, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
  y += 8;
  font("bold").fontSize(12).text(order.paymentMethod === "cod" ? "Amount payable" : "Total paid", labelX, y, { width: labelW });
  doc.text(money(order.total), valueX - 20, y, { width: valueW + 20, align: "right" });

  // Footer
  font("body").fontSize(8.5).fillColor(MUTED).text(
    `Prices include GST. This is a computer-generated invoice and needs no signature. Questions? ${STORE.supportEmail} · ${STORE.supportPhone}`,
    left, doc.page.height - 80, { width, align: "center" }
  );
  doc.end();
  return doc;
}

// ---------- GST tax invoice and credit note ----------
// One layout for both. note === null: the tax invoice as issued (every line, as sold). A note: the credit
// note for the lines it covers, against the invoice. Under the composition scheme the document is a
// "Bill of supply" and shows no tax.
function writeGstDocument(order, note, stream) {
  const gst = order.gst;
  const composition = gst.scheme === "composition";
  const isNote = Boolean(note);
  const title = isNote ? "Credit note" : composition ? "Bill of supply" : "Tax invoice";
  const number = isNote ? note.number : gst.invoiceNo;
  const doc = new PDFDocument({ size: "A4", margin: 40, info: { Title: `${title} ${number}`, Author: STORE.brandName } });
  const hasFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);
  if (hasFonts) {
    doc.registerFont("body", REGULAR);
    doc.registerFont("bold", BOLD);
  }
  const font = name => doc.font(hasFonts ? name : name === "bold" ? "Helvetica-Bold" : "Helvetica");
  const money = paise => (hasFonts ? formatPaise(paise || 0) : formatPaise(paise || 0).replace("₹", "Rs. "));
  const plain = paise => (Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  doc.pipe(stream);

  const left = 40;
  const right = doc.page.width - 40;
  const width = right - left;
  const code = state => (STATE_CODES[state] ? `${state} (${STATE_CODES[state]})` : state || "");

  // Header band
  doc.rect(0, 0, doc.page.width, 86).fill(INK);
  font("bold").fontSize(22).fillColor("#ffffff").text("NEXTHLON", left, 26);
  font("body").fontSize(8.5).fillColor(VOLT).text("PERFORMANCE GEAR", left, 52);
  font("bold").fontSize(15).fillColor("#ffffff").text(title.toUpperCase(), left, 24, { width, align: "right" });
  font("body").fontSize(9).fillColor("#d4d4cd").text(`No. ${number}`, left, 46, { width, align: "right" });
  doc.text(`Date: ${dateText(isNote ? note.date : gst.invoiceDate || order.createdAt)}`, left, 60, { width, align: "right" });

  // Seller, buyer, and the order
  let y = 104;
  const third = width / 3;
  font("bold").fontSize(8).fillColor(MUTED);
  doc.text("SOLD BY", left, y);
  doc.text("BILL TO / SHIP TO", left + third, y);
  doc.text(isNote ? "AGAINST INVOICE" : "ORDER", left + 2 * third, y);
  y += 12;
  font("body").fontSize(8.5).fillColor(INK);
  doc.text([STORE.legalName, STORE.address, `GSTIN: ${gst.sellerGstin || STORE.gstin}`, `State: ${code(gst.sellerState)}`].join("\n"), left, y, { width: third - 10 });
  const a = order.address;
  doc.text([a.fullName, a.line1, a.line2, a.landmark, `${a.city}, ${a.state} ${a.pincode}`, `Phone: +91 ${a.phone}`, `Place of supply: ${code(gst.placeOfSupply)}`].filter(Boolean).join("\n"), left + third, y, { width: third - 10 });
  const orderLines = isNote
    ? [`Invoice: ${gst.invoiceNo}`, `Invoice date: ${dateText(gst.invoiceDate || order.createdAt)}`, `Order: ${order.orderId}`, `Reason: ${note.reason || "Returned or cancelled"}`]
    : [`Order: ${order.orderId}`, `Order date: ${dateText(order.createdAt)}`, `Payment: ${order.paymentMethod === "cod" ? "Cash on Delivery" : order.paymentMethod === "wallet" ? "Nexthlon wallet" : "Online (Razorpay)"}`, "Reverse charge: No"];
  doc.text(orderLines.join("\n"), left + 2 * third, y, { width: third });

  // The lines: as invoiced, or the ones this credit note takes back.
  const rows = isNote
    ? note.lines.map(line => ({ name: line.name, hsn: line.hsn, quantity: line.quantity, ...line }))
    : order.items.map(item => ({ name: itemName(item), hsn: item.tax ? item.tax.hsn : "", quantity: item.quantity, unit: item.price, ...(item.tax || {}) }));
  const delivery = isNote ? note.delivery : gst.delivery;
  if (delivery) rows.push({ name: "Delivery charge", ...delivery, hsn: delivery.hsn || "9965", quantity: 1 });

  const intra = !gst.interstate;
  const cols = composition
    ? [["#", 0.05, "left"], ["Item", 0.47, "left"], ["HSN", 0.1, "left"], ["Qty", 0.08, "right"], ["Amount (₹)", 0.3, "right"]]
    : intra
      ? [["#", 0.04, "left"], ["Item", 0.28, "left"], ["HSN", 0.08, "left"], ["Qty", 0.05, "right"], ["Taxable (₹)", 0.12, "right"], ["Rate", 0.06, "right"], ["CGST (₹)", 0.11, "right"], ["SGST (₹)", 0.11, "right"], ["Total (₹)", 0.15, "right"]]
      : [["#", 0.04, "left"], ["Item", 0.34, "left"], ["HSN", 0.08, "left"], ["Qty", 0.05, "right"], ["Taxable (₹)", 0.14, "right"], ["Rate", 0.06, "right"], ["IGST (₹)", 0.13, "right"], ["Total (₹)", 0.16, "right"]];
  let x = left;
  const layout = cols.map(([label, share, align]) => {
    const col = { label: hasFonts ? label : label.replace("₹", "Rs."), x, w: width * share, align };
    x += col.w;
    return col;
  });
  const cell = (index, value, rowY, options = {}) => doc.text(String(value), layout[index].x + 4, rowY, { width: layout[index].w - 8, align: layout[index].align, ...options });

  y = Math.max(doc.y, y + 84) + 18;
  doc.rect(left, y, width, 20).fill("#efefea");
  font("bold").fontSize(7.5).fillColor(INK);
  layout.forEach((col, index) => cell(index, col.label, y + 6));
  y += 26;
  font("body").fontSize(8.5);
  rows.forEach((row, index) => {
    const sub = [];
    if (row.unit && !isNote) sub.push(`${money(row.unit)} each`);
    if (row.discount) sub.push(`coupon share ${money(row.discount)}`);
    const item = !isNote && index < order.items.length ? order.items[index] : null;
    if (item && ["cancelled", "returned"].includes(item.status)) sub.push(`${item.status} (see credit note)`);
    const nameW = layout[1].w - 8;
    const nameH = doc.heightOfString(row.name, { width: nameW });
    doc.fontSize(7.5);
    const subH = sub.length ? doc.heightOfString(sub.join(" · "), { width: nameW }) + 1 : 0;
    doc.fontSize(8.5);
    const height = nameH + subH;
    if (y + height + 16 > doc.page.height - 190) {
      doc.addPage();
      y = 50;
    }
    doc.fillColor(INK);
    cell(0, index + 1, y);
    cell(1, row.name, y);
    if (sub.length) {
      doc.fillColor(MUTED).fontSize(7.5).text(sub.join(" · "), layout[1].x + 4, y + nameH + 1, { width: nameW });
      doc.fillColor(INK).fontSize(8.5);
    }
    cell(2, row.hsn || "", y);
    cell(3, row.quantity || 1, y);
    if (composition) {
      cell(4, plain(row.value), y);
    } else {
      cell(4, plain(row.taxable), y);
      cell(5, `${row.rate}%`, y);
      if (intra) {
        cell(6, plain(row.cgst), y);
        cell(7, plain(row.sgst), y);
        cell(8, plain(row.value), y);
      } else {
        cell(6, plain(row.igst), y);
        cell(7, plain(row.value), y);
      }
    }
    y += Math.max(height, 11) + 8;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor("#e4e4de").stroke();
  });

  // Totals
  const sums = isNote ? note : gst;
  const totals = composition
    ? [["Total", money(sums.value)]]
    : [
      ["Taxable value", money(sums.taxable)],
      ...(intra ? [["CGST", money(sums.cgst)], ["SGST", money(sums.sgst)]] : [["IGST", money(sums.igst)]]),
      [isNote ? "Credit note total" : "Invoice total", money(sums.value)]
    ];
  if (!isNote && order.walletUsed) totals.push(["Paid from the Nexthlon wallet", `- ${money(order.walletUsed)}`]);
  // After a credit note the amount due changed, so the invoice only shows what it was issued for.
  if (!isNote && !(order.creditNotes || []).length) totals.push([order.paymentMethod === "cod" && order.paymentStatus !== "paid" ? "To pay on delivery" : "Paid", money(sums.value - (order.walletUsed || 0))]);
  y += 6;
  const labelX = left + width * 0.5;
  const valueX = left + width * 0.78;
  totals.forEach(([label, value], index) => {
    const strong = label === "Invoice total" || label === "Credit note total" || label === "Total";
    font(strong ? "bold" : "body").fontSize(strong ? 10.5 : 9).fillColor(INK);
    if (strong) {
      y += 4;
      doc.moveTo(labelX, y - 3).lineTo(right, y - 3).lineWidth(1).strokeColor(INK).stroke();
      y += 4;
    }
    doc.text(label, labelX, y, { width: width * 0.28 });
    doc.text(value, valueX, y, { width: width * 0.22, align: "right" });
    y += strong ? 18 : 15;
    if (index === totals.length - 1) y += 2;
  });
  font("body").fontSize(8.5).fillColor(MUTED).text(`Amount in words: ${amountInWords(sums.value)}`, left, y + 4, { width });
  y = doc.y + 6;
  if (!isNote && (order.creditNotes || []).length) {
    doc.text(`Credit notes against this invoice: ${order.creditNotes.map(n => n.number).join(", ")}`, left, y, { width });
    y = doc.y + 6;
  }

  // Signature and footer
  const footY = doc.page.height - 150;
  font("bold").fontSize(9).fillColor(INK).text(`For ${STORE.legalName}`, left, footY, { width, align: "right" });
  font("body").fontSize(8).fillColor(MUTED).text("Authorised signatory", left, footY + 34, { width, align: "right" });
  doc.fontSize(7.5).text(
    [
      composition ? "Composition taxable person, not eligible to collect tax on supplies." : "Prices include GST. Tax is not payable on reverse charge.",
      "This is a computer-generated document and needs no physical signature.",
      `Questions? ${STORE.supportEmail} · ${STORE.supportPhone}`
    ].join("  "),
    left, doc.page.height - 82, { width, align: "center" }
  );
  doc.end();
  return doc;
}

// A packing slip for the warehouse: what goes in the box and where it goes. No prices.
function writePackingSlip(order, stream) {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: `Packing slip ${order.orderId}`, Author: STORE.brandName } });
  const hasFonts = fs.existsSync(REGULAR) && fs.existsSync(BOLD);
  if (hasFonts) {
    doc.registerFont("body", REGULAR);
    doc.registerFont("bold", BOLD);
  }
  const font = name => doc.font(hasFonts ? name : name === "bold" ? "Helvetica-Bold" : "Helvetica");
  doc.pipe(stream);
  const left = 48;
  const right = doc.page.width - 48;
  const width = right - left;

  doc.rect(0, 0, doc.page.width, 80).fill(INK);
  font("bold").fontSize(22).fillColor("#ffffff").text("NEXTHLON", left, 26);
  font("bold").fontSize(16).fillColor(VOLT).text("Packing slip", left, 30, { width, align: "right" });
  font("body").fontSize(9).fillColor("#d4d4cd").text(order.orderId, left, 52, { width, align: "right" });

  let y = 104;
  const a = order.address;
  font("bold").fontSize(9).fillColor(MUTED).text("SHIP TO", left, y);
  font("bold").fontSize(9).text("ORDER", left + width / 2, y);
  y += 14;
  font("body").fontSize(11).fillColor(INK);
  doc.text([a.fullName, a.line1, a.line2, a.landmark ? `Near ${a.landmark}` : "", `${a.city}, ${a.state} ${a.pincode}`, `Phone: +91 ${a.phone}`].filter(Boolean).join("\n"), left, y, { width: width / 2 - 12 });
  const shipment = (order.shipments || [])[order.shipments.length - 1];
  doc.text([
    `Order: ${order.orderId}`,
    `Placed: ${dateText(order.createdAt)}`,
    `Payment: ${order.paymentMethod === "cod" ? `Cash on Delivery: collect ${formatPaise(order.total).replace("₹", hasFonts ? "₹" : "Rs. ")}` : "Prepaid"}`,
    shipment ? `Courier: ${shipment.courier} · ${shipment.trackingNumber}` : ""
  ].filter(Boolean).join("\n"), left + width / 2, y, { width: width / 2 });

  y = Math.max(doc.y, y + 70) + 24;
  doc.rect(left, y, width, 22).fill("#efefea");
  font("bold").fontSize(9).fillColor(INK);
  doc.text("Packed", left + 6, y + 6, { width: 50 });
  doc.text("Item", left + 60, y + 6, { width: width - 140 });
  doc.text("Qty", right - 70, y + 6, { width: 64, align: "right" });
  y += 30;
  font("body").fontSize(10.5);
  for (const item of order.items.filter(line => line.status !== "cancelled")) {
    // The warehouse needs the size and SKU to pick the right box.
    const name = itemName(item) + (item.sku ? ` · SKU ${item.sku}` : "");
    const h = doc.heightOfString(name, { width: width - 140 });
    if (y + h + 20 > doc.page.height - 100) {
      doc.addPage();
      y = 60;
    }
    doc.rect(left + 8, y, 12, 12).lineWidth(1).strokeColor(INK).stroke();
    doc.fillColor(INK).text(name, left + 60, y, { width: width - 140 });
    font("bold").text(String(item.quantity), right - 70, y, { width: 64, align: "right" });
    font("body");
    y += Math.max(h, 14) + 12;
    doc.moveTo(left, y - 6).lineTo(right, y - 6).lineWidth(0.5).strokeColor("#e4e4de").stroke();
  }
  font("body").fontSize(9).fillColor(MUTED).text("Check every item before sealing the box. Questions: " + STORE.supportEmail, left, doc.page.height - 80, { width, align: "center" });
  doc.end();
  return doc;
}

module.exports = { writeInvoice, writeCreditNote, findCreditNote, assertInvoiceReady, writePackingSlip, invoiceNumber, hasGstInvoice, fileNameFor };
