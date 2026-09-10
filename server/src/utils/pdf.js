import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const navy = "#244F6A";
const blue = "#2F6688";
const red = "#B51F2A";
const lightBlue = "#EEF4F8";
const border = "#C9D5DC";
const dark = "#243746";
const white = "#FFFFFF";
const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 42;
const contentWidth = pageWidth - margin * 2;
const footerTop = 752;
const footerBottom = 812;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.resolve(__dirname, "../../assets/micropay-logo.png");

export function money(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function safeDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function collectPdf(doc) {
  const chunks = [];
  doc.on("data", chunk => chunks.push(chunk));
  return new Promise(resolve => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

function drawFooter(doc) {
  const y = footerTop;
  doc.strokeColor(blue).lineWidth(1.2).moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();
  doc.strokeColor(red).lineWidth(2.2).moveTo(margin, y).lineTo(margin + 170, y).stroke();

  doc.fillColor(navy).font("Helvetica").fontSize(8.5)
    .text("+211 929 044 412", margin, y + 11, { width: 150, align: "center", lineBreak: false })
    .text("|", 198, y + 11, { width: 12, align: "center", lineBreak: false })
    .text("info@micropay.ltd", 214, y + 11, { width: 150, align: "center", lineBreak: false })
    .text("|", 372, y + 11, { width: 12, align: "center", lineBreak: false })
    .text("micropay.ltd", 389, y + 11, { width: 125, align: "center", lineBreak: false });

  doc.fillColor(dark).font("Helvetica").fontSize(8)
    .text("Platinum Building • Opposite Ritz Hotel • Juba, South Sudan", margin, y + 30, {
      width: contentWidth,
      align: "center",
      lineBreak: false,
    });
}

function drawHeader(doc, title, number, date, extra = {}) {
  // Exact supplied Micro Pay logo. The logo file contains the approved artwork and slogan.
  doc.image(logoPath, margin, 32, { fit: [185, 108], align: "left", valign: "top" });

  // Keep long receipt titles on a single dedicated line so they never wrap
  // into the metadata/header area. Quotation and Invoice retain their approved layout.
  const isReceipt = title === "OFFICIAL RECEIPT";
  const isExpense = title === "EXPENSE VOUCHER";
  const titleFontSize = isReceipt ? 19 : isExpense ? 19 : 25;
  const titleX = isReceipt ? 315 : 335;
  const titleY = isReceipt ? 45 : 40;
  const titleWidth = isReceipt ? 238 : 218;

  // Give every long document title its own fixed line. In particular,
  // EXPENSE VOUCHER must never wrap down into the document metadata.
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(titleFontSize)
    .text(title, titleX, titleY, {
      width: titleWidth,
      align: "right",
      lineBreak: false,
      height: 24,
    });

  let numberLabel = "Document No:";
  if (title === "QUOTATION") numberLabel = "Quotation No:";
  else if (title === "INVOICE") numberLabel = "Invoice No:";
  else if (title === "OFFICIAL RECEIPT") numberLabel = "Receipt No:";
  else if (title === "EXPENSE VOUCHER") numberLabel = "Expense Voucher No:";

  const rows = [[numberLabel, number], ["Date:", safeDate(date)]];
  if (extra.validUntil) rows.push(["Valid Until:", safeDate(extra.validUntil)]);
  if (extra.customer) rows.push(["Customer:", extra.customer]);

  // Start metadata below the title's reserved area.
  let y = isExpense ? 76 : 82;
  rows.forEach(([label, value]) => {
    doc.fillColor(dark).font("Helvetica-Bold").fontSize(8.5)
      .text(label, 345, y, { width: 90, align: "right", lineBreak: false });
    doc.font("Helvetica").text(value || "", 443, y, { width: 110, align: "right", lineBreak: false });
    y += 16;
  });

  doc.strokeColor(blue).lineWidth(1.2).moveTo(margin, 155).lineTo(pageWidth - margin, 155).stroke();
}

function drawCustomerBox(doc, customer, y = 176) {
  const x = margin, w = 300, h = 116;
  doc.fillColor(lightBlue).roundedRect(x, y, w, h, 5).fill();
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text("To:", x + 12, y + 12);
  doc.fontSize(13).text(customer?.name || "", x + 12, y + 31);
  doc.fillColor(dark).font("Helvetica").fontSize(8.5);
  if (customer?.contact_person) doc.text(`Attn:    ${customer.contact_person}`, x + 12, y + 55);
  if (customer?.phone) doc.text(`Tel:      ${customer.phone}`, x + 12, y + 70);
  if (customer?.email) doc.text(`Email:   ${customer.email}`, x + 12, y + 85);
  if (customer?.address) doc.text(`Address: ${customer.address}`, x + 12, y + 100, { width: w - 24 });
}

function drawItemsTable(doc, items, startY) {
  const x = margin;
  const widths = [36, 224, 62, 95, 94];
  const headers = ["No.", "Description", "Qty", "Unit Price (USD)", "Amount (USD)"];
  const headerH = 25;
  const rowH = 25;
  let y = startY;

  const drawHeader = () => {
    doc.fillColor(navy).rect(x, y, contentWidth, headerH).fill();
    let cx = x;
    headers.forEach((h, i) => {
      doc.fillColor(white).font("Helvetica-Bold").fontSize(8)
        .text(h, cx + 5, y + 8, { width: widths[i] - 10, align: i === 1 ? "left" : "center", lineBreak: false });
      cx += widths[i];
    });
    y += headerH;
  };

  drawHeader();
  const data = items?.length ? items : [{ description: "", quantity: "", unit_price: "", amount: "" }];
  data.forEach((item, i) => {
    if (y + rowH > footerTop - 18) {
      drawFooter(doc);
      doc.addPage();
      y = 55;
      drawHeader();
    }
    doc.fillColor(i % 2 ? "#F8FAFB" : white).rect(x, y, contentWidth, rowH).fill();
    doc.strokeColor(border).lineWidth(0.5).rect(x, y, contentWidth, rowH).stroke();
    const vals = [String(i + 1), item.description || "", item.quantity === "" ? "" : Number(item.quantity || 0).toFixed(3), item.unit_price === "" ? "" : money(item.unit_price), item.amount === "" ? "" : money(item.amount)];
    let cx = x;
    vals.forEach((v, j) => {
      doc.fillColor(dark).font("Helvetica").fontSize(8)
        .text(v, cx + 5, y + 8, { width: widths[j] - 10, align: j === 1 ? "left" : "right", lineBreak: false });
      cx += widths[j];
    });
    y += rowH;
  });
  return y;
}

function drawTotals(doc, totals, startY) {
  const x = 320, w = 233, rowH = 23;
  let y = startY;
  totals.forEach(([label, value], i) => {
    const isTotal = i === totals.length - 1;
    doc.fillColor(isTotal ? "#DDEEFF" : "#F7F9FA").rect(x, y, w, rowH).fill();
    doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, rowH).stroke();
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(isTotal ? 10 : 8.5)
      .text(label, x + 10, y + 7, { width: 105, lineBreak: false });
    doc.fillColor(dark).font("Helvetica-Bold").fontSize(isTotal ? 10 : 8.5)
      .text(money(value), x + 120, y + 7, { width: 100, align: "right", lineBreak: false });
    y += rowH;
  });
}

function drawSignature(doc, y) {
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("Micro Pay Company Limited", margin, y);
  doc.strokeColor(blue).lineWidth(0.8).moveTo(margin, y + 27).lineTo(200, y + 27).stroke();
  doc.fillColor(dark).font("Helvetica").fontSize(7.5).text("Authorized Signature", margin, y + 34);
}

function beginDocument(title, number, date, extra = {}) {
  const doc = new PDFDocument({ size: "A4", margin, bufferPages: false, autoFirstPage: true });
  const promise = collectPdf(doc);
  drawHeader(doc, title, number, date, extra);
  return { doc, promise };
}

export async function makeQuotationPdf({ quotation, customer, items }) {
  const { doc, promise } = beginDocument("QUOTATION", quotation.number, quotation.quote_date, { validUntil: quotation.valid_until });
  drawCustomerBox(doc, customer);

  const y = drawItemsTable(doc, items, 318);
  const notesY = y + 18;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("Notes:", margin, notesY);
  doc.fillColor(lightBlue).roundedRect(margin, notesY + 16, 270, 78, 5).fill();
  doc.fillColor(dark).font("Helvetica").fontSize(8.5).text(quotation.notes || "N/A", margin + 12, notesY + 30, { width: 246, height: 55 });
  drawTotals(doc, [["Subtotal:", quotation.subtotal], ["Discount:", quotation.discount], ["Tax:", quotation.tax], ["TOTAL (USD):", quotation.total]], notesY + 16);

  const termsY = notesY + 114;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("Terms and Conditions:", margin, termsY);
  doc.fillColor(dark).font("Helvetica").fontSize(8)
    .text("1. Prices are valid for the period specified above.", margin + 6, termsY + 18)
    .text("2. Payment terms: As agreed.", margin + 6, termsY + 33)
    .text("3. Delivery will be as per the agreed schedule.", margin + 6, termsY + 48)
    .text("4. This quotation is subject to our standard terms and conditions.", margin + 6, termsY + 63);
  doc.fontSize(8.5).text("We look forward to your favourable response.", margin, termsY + 94);
  drawSignature(doc, termsY + 126);

  drawFooter(doc);
  doc.end();
  return promise;
}

export async function makeInvoicePdf({ invoice, customer, items }) {
  const { doc, promise } = beginDocument("INVOICE", invoice.number, invoice.invoice_date, { customer: customer?.name });
  drawCustomerBox(doc, customer);
  const y = drawItemsTable(doc, items, 318);
  drawTotals(doc, [["Subtotal:", invoice.subtotal], ["Discount:", invoice.discount], ["Tax:", invoice.tax], ["TOTAL (USD):", invoice.total], ["PAID:", invoice.paid], ["BALANCE:", invoice.balance]], y + 18);
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text(`Payment Status: ${invoice.status || "ISSUED"}`, margin, y + 24);
  if (invoice.notes) {
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("Notes:", margin, y + 60);
    doc.fillColor(dark).font("Helvetica").fontSize(8.5).text(invoice.notes, margin, y + 76, { width: 250, height: 50 });
  }
  drawSignature(doc, 680);
  drawFooter(doc);
  doc.end();
  return promise;
}

export async function makeReceiptPdf({ payment, invoice, customer }) {
  const { doc, promise } = beginDocument("OFFICIAL RECEIPT", payment.receipt_number, payment.payment_date, { customer: customer?.name });
  drawCustomerBox(doc, customer, 176);

  const y = 318;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(10).text("PAYMENT DETAILS", margin, y);
  const rows = [
    ["Receipt No:", payment.receipt_number],
    ["Invoice No:", invoice.number],
    ["Payment Date:", safeDate(payment.payment_date)],
    ["Payment Method:", payment.method],
    ["Reference:", payment.reference || "N/A"],
  ];
  let ry = y + 24;
  rows.forEach(([label, value]) => {
    doc.fillColor(lightBlue).rect(margin, ry, 160, 23).fill();
    doc.strokeColor(border).lineWidth(0.5).rect(margin, ry, 511, 23).stroke();
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5).text(label, margin + 10, ry + 7, { width: 140 });
    doc.fillColor(dark).font("Helvetica").text(value || "", margin + 175, ry + 7, { width: 325 });
    ry += 23;
  });

  doc.fillColor("#DDEEFF").rect(margin, ry + 18, 511, 48).fill();
  doc.strokeColor(border).lineWidth(0.5).rect(margin, ry + 18, 511, 48).stroke();
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(12).text("AMOUNT RECEIVED (USD)", margin + 14, ry + 35);
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(14).text(money(payment.amount), 390, ry + 33, { width: 145, align: "right" });

  doc.fillColor(dark).font("Helvetica").fontSize(8.5)
    .text(`Invoice Total: USD ${money(invoice.total)}`, margin, ry + 88)
    .text(`Remaining Balance: USD ${money(invoice.balance)}`, margin, ry + 104);
  if (payment.notes) doc.text(`Notes: ${payment.notes}`, margin, ry + 122, { width: 470 });

  drawSignature(doc, 650);
  drawFooter(doc);
  doc.end();
  return promise;
}

export async function makePaymentVoucherPdf({ voucher }) {
  const { doc, promise } = beginDocument("PAYMENT VOUCHER", voucher.voucher_number, voucher.voucher_date);
  const x = margin;
  const w = contentWidth;
  let y = 176;

  doc.fillColor(navy).font("Helvetica-Bold").fontSize(10)
    .text("PAYMENT DETAILS", x, y, { lineBreak: false });
  y += 18;

  const detailRows = [
    ["Voucher No:", voucher.voucher_number || ""],
    ["Date:", safeDate(voucher.voucher_date)],
    ["Payee:", voucher.payee || ""],
    ["Payment Method:", voucher.payment_method || ""],
    ["Reference:", voucher.reference || "N/A"],
  ];

  detailRows.forEach(([label, value]) => {
    doc.fillColor(lightBlue).rect(x, y, 145, 23).fill();
    doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 23).stroke();
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5)
      .text(label, x + 10, y + 7, { width: 125, lineBreak: false });
    doc.fillColor(dark).font("Helvetica").fontSize(8.5)
      .text(String(value || ""), x + 160, y + 7, { width: w - 175, lineBreak: false });
    y += 23;
  });

  y += 12;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9)
    .text("Purpose", x, y, { lineBreak: false });
  y += 15;
  doc.fillColor(white).rect(x, y, w, 60).fill();
  doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 60).stroke();
  doc.fillColor(dark).font("Helvetica").fontSize(8.5)
    .text(String(voucher.purpose || ""), x + 12, y + 12, { width: w - 24, height: 38 });

  y += 76;
  doc.fillColor("#DDEEFF").rect(x, y, w, 48).fill();
  doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 48).stroke();
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(12)
    .text("AMOUNT (USD)", x + 14, y + 16, { lineBreak: false });
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(14)
    .text(money(voucher.amount), x + w - 175, y + 14, { width: 160, align: "right", lineBreak: false });

  if (voucher.notes) {
    y += 66;
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(9).text("Notes", x, y, { lineBreak: false });
    doc.fillColor(dark).font("Helvetica").fontSize(8.5).text(String(voucher.notes), x, y + 15, { width: w, height: 42 });
  }

  const sigY = Math.min(665, Math.max(y + 72, 620));
  drawSignature(doc, sigY);
  doc.fillColor(dark).font("Helvetica").fontSize(7.5)
    .text(`Prepared by: ${voucher.prepared_by || "________________"}`, margin, sigY + 48, { width: 240 })
    .text(`Checked/Approved by: ${voucher.approved_by || "________________"}`, 300, sigY + 48, { width: 253, align: "right" });
  drawFooter(doc);
  doc.end();
  return promise;
}

export async function makeExpenseVoucherPdf({ expense }) {
  const { doc, promise } = beginDocument("EXPENSE VOUCHER", expense.expense_number, expense.expense_date);

  // Keep the voucher compact and fully contained on one page for normal entries.
  const x = margin;
  const w = contentWidth;
  const labelW = 145;
  let y = 176;

  doc.fillColor(navy).font("Helvetica-Bold").fontSize(10)
    .text("EXPENSE DETAILS", x, y, { lineBreak: false });
  y += 18;

  const detailRows = [
    ["Expense No:", expense.expense_number || ""],
    ["Date:", safeDate(expense.expense_date)],
    ["Category:", expense.category || ""],
    ["Supplier / Payee:", expense.supplier || "N/A"],
    ["Payment Method:", expense.payment_method || "N/A"],
    ["Paid By:", expense.paid_by || "N/A"],
    ["Reference:", expense.reference || "N/A"],
  ];

  detailRows.forEach(([label, value]) => {
    doc.fillColor(lightBlue).rect(x, y, labelW, 23).fill();
    doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 23).stroke();
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(8.5)
      .text(label, x + 10, y + 7, { width: labelW - 18, lineBreak: false });
    doc.fillColor(dark).font("Helvetica").fontSize(8.5)
      .text(String(value || ""), x + labelW + 15, y + 7, {
        width: w - labelW - 25,
        lineBreak: false,
      });
    y += 23;
  });

  // Description block
  y += 12;
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(9)
    .text("Description", x, y, { lineBreak: false });
  y += 15;
  doc.fillColor(white).rect(x, y, w, 54).fill();
  doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 54).stroke();
  doc.fillColor(dark).font("Helvetica").fontSize(8.5)
    .text(String(expense.description || ""), x + 12, y + 12, {
      width: w - 24,
      height: 34,
    });

  // Amount block
  y += 70;
  doc.fillColor("#DDEEFF").rect(x, y, w, 48).fill();
  doc.strokeColor(border).lineWidth(0.5).rect(x, y, w, 48).stroke();
  doc.fillColor(navy).font("Helvetica-Bold").fontSize(12)
    .text("AMOUNT (USD)", x + 14, y + 16, { lineBreak: false });
  doc.fillColor(dark).font("Helvetica-Bold").fontSize(14)
    .text(money(expense.amount), x + w - 175, y + 14, {
      width: 160,
      align: "right",
      lineBreak: false,
    });

  // Notes, when present, remain above the signature and footer.
  if (expense.notes) {
    y += 66;
    doc.fillColor(navy).font("Helvetica-Bold").fontSize(9)
      .text("Notes", x, y, { lineBreak: false });
    doc.fillColor(dark).font("Helvetica").fontSize(8.5)
      .text(String(expense.notes), x, y + 15, { width: w, height: 45 });
  }

  drawSignature(doc, 665);
  drawFooter(doc);
  doc.end();
  return promise;
}

// Backwards-compatible generic PDF generator for any legacy caller.
export async function makePdf(title, metaLines, items = [], totals = []) {
  const { doc, promise } = beginDocument(title, "", new Date());
  let y = 190;
  doc.fillColor(dark).font("Helvetica").fontSize(9);
  metaLines.forEach(line => { doc.text(line, margin, y); y += 15; });
  if (items.length) y = drawItemsTable(doc, items, y + 12);
  if (totals.length) drawTotals(doc, totals, y + 18);
  drawFooter(doc);
  doc.end();
  return promise;
}
