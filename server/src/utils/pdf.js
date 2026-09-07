import PDFDocument from "pdfkit";

const navy = "#244F6A";
const blue = "#2F6688";
const red = "#B51F2A";

function header(doc) {
  doc.fillColor(blue).font("Helvetica-Bold").fontSize(16)
    .text("MICRO PAY COMPANY LIMITED", 50, 38);
  doc.fillColor(red).font("Helvetica").fontSize(8)
    .text("General Supply | Oil & Gas | Construction | ICT Solutions | Supply Chain Solutions", 50, 61);
  doc.strokeColor(blue).lineWidth(1.5).moveTo(50, 77).lineTo(545, 77).stroke();
}

function footer(doc) {
  const y = 770;
  doc.save();
  doc.rect(0, y, 595, 72).fill(navy);
  doc.fillColor("white").fontSize(8)
    .text("+211 929 044 412  |  info@micropay.ltd  |  micropay.ltd", 50, y + 20, { width: 495, align: "center" })
    .text("Platinum Building  •  Opposite Ritz Hotel  •  Juba, South Sudan", 50, y + 38, { width: 495, align: "center" });
  doc.restore();
}

export function makePdf(title, metaLines, items = [], totals = []) {
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];
  doc.on("data", c => chunks.push(c));
  const promise = new Promise(resolve => doc.on("end", () => resolve(Buffer.concat(chunks))));
  header(doc);
  doc.fillColor(blue).font("Helvetica-Bold").fontSize(20).text(title, { align: "center", marginTop: 20 });
  doc.moveDown(0.5);
  doc.fillColor("#222").font("Helvetica").fontSize(9);
  metaLines.forEach(x => doc.text(x));
  doc.moveDown(1);

  if (items.length) {
    doc.fillColor(navy).rect(50, doc.y, 495, 22).fill();
    doc.fillColor("white").font("Helvetica-Bold").fontSize(8)
      .text("Description", 58, doc.y + 7)
      .text("Qty", 350, doc.y + 7)
      .text("Unit Price", 395, doc.y + 7)
      .text("Amount", 480, doc.y + 7);
    doc.moveDown(1.3);
    items.forEach((x, i) => {
      const y = doc.y;
      if (i % 2) doc.fillColor("#F3F6F8").rect(50, y - 3, 495, 21).fill();
      doc.fillColor("#222").font("Helvetica").fontSize(8)
        .text(x.description, 58, y)
        .text(String(x.quantity), 350, y)
        .text(Number(x.unit_price).toFixed(2), 395, y)
        .text(Number(x.amount).toFixed(2), 480, y);
      doc.moveDown(1.25);
    });
  }

  doc.moveDown(0.7);
  totals.forEach(([label, value]) => {
    doc.fillColor(label === "TOTAL" || label === "BALANCE" ? red : "#222")
      .font(label === "TOTAL" || label === "BALANCE" ? "Helvetica-Bold" : "Helvetica")
      .fontSize(9).text(`${label}: ${Number(value).toFixed(2)}`, { align: "right" });
  });
  footer(doc);
  doc.end();
  return promise;
}
