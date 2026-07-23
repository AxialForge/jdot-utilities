// Offline OCR (tesseract.js + bundled English model). Runs in plain node.
// The shared worker is terminated in an after() hook or `node --test` hangs.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const { ocrImage, ocrPdf, shutdown, tessdataDir } = require("../src/main/ocr");

const HAVE_MODEL = fs.existsSync(path.join(tessdataDir(), "eng.traineddata"));

test.after(async () => { await shutdown(); });

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ocrt-"));
}

// Render lines of text to a PNG the way a "scan" would look.
function textPng(file, lines) {
  const canvas = createCanvas(760, 60 + lines.length * 60);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000"; ctx.font = "40px Arial";
  lines.forEach((l, i) => ctx.fillText(l, 30, 60 + i * 60));
  fs.writeFileSync(file, canvas.toBuffer("image/png"));
  return file;
}

test("the ocr-text tool is discovered and accepts images + pdf", () => {
  const { loadTools } = require("../src/main/registry");
  const t = loadTools().get("ocr-text");
  assert.ok(t, "ocr-text not discovered");
  assert.ok(t.inputFormats.includes("pdf"));
  assert.ok(t.inputFormats.includes("png"));
  assert.deepStrictEqual(t.outputFormats, ["txt"]);
});

test("the English model is bundled", () => {
  assert.ok(HAVE_MODEL, "resources/tessdata/eng.traineddata is missing — OCR ships this");
});

test("ocrImage reads crisp text from an image", { skip: !HAVE_MODEL }, async () => {
  const d = work();
  const png = textPng(path.join(d, "a.png"), ["The quick brown fox", "jumps over 1234."]);
  const text = await ocrImage(png);
  assert.match(text, /quick brown fox/i, "got: " + JSON.stringify(text));
  assert.match(text, /1234/);
});

test("serialized OCR handles several images without colliding", { skip: !HAVE_MODEL }, async () => {
  const d = work();
  const a = textPng(path.join(d, "a.png"), ["Alpha wolf"]);
  const b = textPng(path.join(d, "b.png"), ["Bravo tango"]);
  const c = textPng(path.join(d, "c.png"), ["Charlie nine"]);
  const [ra, rb, rc] = await Promise.all([ocrImage(a), ocrImage(b), ocrImage(c)]);
  assert.match(ra, /Alpha/i);
  assert.match(rb, /Bravo/i);
  assert.match(rc, /Charlie/i);
});

test("ocrPdf rasterizes and reads each page", { skip: !HAVE_MODEL }, async () => {
  const d = work();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of ["Invoice Number 5501", "Total due 250 dollars"]) {
    const p = doc.addPage([612, 300]);
    p.drawRectangle({ x: 0, y: 0, width: 612, height: 300, color: rgb(1, 1, 1) });
    p.drawText(line, { x: 40, y: 150, size: 30, font, color: rgb(0, 0, 0) });
  }
  const src = path.join(d, "scan.pdf");
  fs.writeFileSync(src, await doc.save());

  const text = await ocrPdf(src, { dpi: 150 });
  assert.match(text, /Invoice Number 5501/i, "got: " + JSON.stringify(text));
  assert.match(text, /250 dollars/i);
});

test("ocrPdf can be cancelled", { skip: !HAVE_MODEL }, async () => {
  const d = work();
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]);
  const src = path.join(d, "x.pdf");
  fs.writeFileSync(src, await doc.save());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => ocrPdf(src, { signal: controller.signal }), /cancelled/i);
});
