// Draws an order's tax invoice as a PDF with pdfkit. Uses Noto Sans (assets/fonts) because the
// built-in PDF fonts cannot print the rupee sign.
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const { STORE } = require("../config/store");
const { formatPaise } = require("../utils/money");
const { STATUS_LABELS } = require("../utils/orderRules");

const FONT_DIR = path.join(__dirname, "..", "assets", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSans-Regular.ttf");
const BOLD = path.join(FONT_DIR, "NotoSans-Bold.ttf");
const INK = "#0a0a0b";      // obsidian
const MUTED = "#5c5c64";
const VOLT = "#d4ff3a";     // brand accent, used on the dark header band only

const dateText = value => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(value));

function invoiceNumber(order) {
  return order.orderId.replace(/^NX-/, "INV-");
}

// Writes the PDF to a stream (the HTTP response). Returns the document.
function writeInvoice(order, stream) {
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
    const nameHeight = doc.heightOfString(item.name, { width: cols[0].w - 12 });
    if (y + nameHeight + 20 > doc.page.height - 120) {
      doc.addPage();
      y = 60;
    }
    doc.fillColor(cancelled ? MUTED : INK);
    doc.text(item.name + (cancelled ? " (cancelled)" : ""), cols[0].x + 6, y, { width: cols[0].w - 12 });
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
    const h = doc.heightOfString(item.name, { width: width - 140 });
    if (y + h + 20 > doc.page.height - 100) {
      doc.addPage();
      y = 60;
    }
    doc.rect(left + 8, y, 12, 12).lineWidth(1).strokeColor(INK).stroke();
    doc.fillColor(INK).text(item.name, left + 60, y, { width: width - 140 });
    font("bold").text(String(item.quantity), right - 70, y, { width: 64, align: "right" });
    font("body");
    y += Math.max(h, 14) + 12;
    doc.moveTo(left, y - 6).lineTo(right, y - 6).lineWidth(0.5).strokeColor("#e4e4de").stroke();
  }
  font("body").fontSize(9).fillColor(MUTED).text("Check every item before sealing the box. Questions: " + STORE.supportEmail, left, doc.page.height - 80, { width, align: "center" });
  doc.end();
  return doc;
}

module.exports = { writeInvoice, writePackingSlip, invoiceNumber };
