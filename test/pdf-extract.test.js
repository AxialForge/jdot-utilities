// PDF -> text and PDF -> images. Both run in plain node (pdfjs + @napi-rs/canvas),
// so they live in the main `npm test` suite.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const { pdfToText, itemsToText } = require("../src/main/pdftext");
const { rasterizePdf, clampScale } = require("../src/main/pdfraster");
const { freePath } = require("../src/main/ops");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ex-"));
}

// A PDF whose page i carries a known line of text and a coloured block.
async function makeTextPdf(file, pageLines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const line of pageLines) {
    const page = doc.addPage([300, 200]);
    page.drawRectangle({ x: 10, y: 150, width: 120, height: 30, color: rgb(0.85, 0.1, 0.1) });
    page.drawText(line, { x: 20, y: 100, size: 16, font });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

// A PDF with no text layer (just a filled rectangle), i.e. a "scanned" page.
async function makeImageOnlyPdf(file) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  page.drawRectangle({ x: 0, y: 0, width: 200, height: 200, color: rgb(0.2, 0.5, 0.9) });
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

function allocatorFor(dir, stem) {
  const reserved = new Set();
  return (suffix, ext) => freePath(dir, suffix ? `${stem}-${suffix}` : stem, ext, reserved);
}

// ── text extraction ────────────────────────────────────────────

test("itemsToText joins runs and honors end-of-line flags", () => {
  const items = [
    { str: "Hello ", hasEOL: false },
    { str: "world", hasEOL: true },
    { str: "next line", hasEOL: true },
  ];
  assert.strictEqual(itemsToText(items), "Hello world\nnext line");
});

test("pdfToText pulls the text from every page", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["Alpha one", "Bravo two", "Charlie three"]);
  const out = path.join(d, "doc.txt");
  const res = await pdfToText(src, out, {});

  assert.strictEqual(res.pages, 3);
  assert.strictEqual(res.empty, false);
  const text = fs.readFileSync(out, "utf8");
  assert.ok(text.includes("Alpha one"), text);
  assert.ok(text.includes("Bravo two"), text);
  assert.ok(text.includes("Charlie three"), text);
});

test("pdfToText can insert a form-feed page break", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["Page A", "Page B"]);
  const out = path.join(d, "doc.txt");
  await pdfToText(src, out, { pageBreaks: true });
  assert.ok(fs.readFileSync(out, "utf8").includes("\f"), "no form-feed between pages");
});

test("pdfToText flags an image-only PDF instead of writing a silent empty file", async () => {
  const d = work();
  const src = await makeImageOnlyPdf(path.join(d, "scan.pdf"));
  const out = path.join(d, "scan.txt");
  const res = await pdfToText(src, out, {});
  assert.strictEqual(res.empty, true);
  assert.ok(res.warnings.some((w) => /OCR/i.test(w)), res.warnings.join(","));
});

test("pdfToText rejects a non-PDF clearly", async () => {
  const d = work();
  const junk = path.join(d, "x.pdf");
  fs.writeFileSync(junk, "not a pdf");
  await assert.rejects(() => pdfToText(junk, path.join(d, "o.txt"), {}), /not a readable PDF/i);
});

test("pdfToText can be cancelled", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["a", "b", "c", "d"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => pdfToText(src, path.join(d, "o.txt"), {}, null, { signal: controller.signal }),
    /cancelled/i
  );
});

// ── rasterization ──────────────────────────────────────────────

test("clampScale maps DPI to a bounded scale", () => {
  assert.strictEqual(clampScale(72), 1);
  assert.strictEqual(clampScale(144), 2);
  assert.strictEqual(clampScale(1), 0.5, "floor");
  assert.strictEqual(clampScale(100000), 6, "ceiling");
  assert.strictEqual(clampScale(undefined), 150 / 72, "default 150 DPI");
});

const PNG_MAGIC = "89504e470d0a1a0a";
const JPG_MAGIC = "ffd8ff";

test("rasterizePdf writes one PNG per page at the requested DPI", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["one", "two", "three"]);
  const res = await rasterizePdf(src, { format: "png", dpi: 72 }, allocatorFor(d, "doc"));

  assert.strictEqual(res.outputs.length, 3);
  for (const p of res.outputs) {
    const head = fs.readFileSync(p).subarray(0, 8).toString("hex");
    assert.strictEqual(head, PNG_MAGIC, "not a PNG: " + p);
  }
  // 72 DPI => scale 1 => a 300x200 page renders at 300x200.
  assert.ok(res.outputs.every((p) => /doc-p\d+\.png$/.test(p)), res.outputs.join(","));
});

test("rasterizePdf honors JPG format", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["only"]);
  const res = await rasterizePdf(src, { format: "jpg", dpi: 96 }, allocatorFor(d, "doc"));
  assert.strictEqual(res.outputs.length, 1);
  const head = fs.readFileSync(res.outputs[0]).subarray(0, 3).toString("hex");
  assert.strictEqual(head, JPG_MAGIC, "not a JPEG");
});

test("rasterizePdf limits to a page range", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["p1", "p2", "p3", "p4", "p5"]);
  const res = await rasterizePdf(src, { format: "png", dpi: 72, pages: "2,4-5" }, allocatorFor(d, "doc"));
  assert.strictEqual(res.outputs.length, 3);
  const names = res.outputs.map((p) => path.basename(p)).sort();
  assert.deepStrictEqual(names, ["doc-p2.png", "doc-p4.png", "doc-p5.png"]);
});

test("rasterizePdf actually paints content (not a blank canvas)", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["visible"]);
  const res = await rasterizePdf(src, { format: "png", dpi: 96 }, allocatorFor(d, "doc"));
  // A blank 300x200@scale png would be tiny; a painted one is substantially bigger.
  const size = fs.statSync(res.outputs[0]).size;
  assert.ok(size > 400, "suspiciously small render (" + size + " bytes)");
});

test("rasterizePdf rejects a non-PDF clearly", async () => {
  const d = work();
  const junk = path.join(d, "x.pdf");
  fs.writeFileSync(junk, "nope");
  await assert.rejects(
    () => rasterizePdf(junk, { format: "png" }, allocatorFor(d, "x")),
    /not a readable PDF/i
  );
});

test("rasterizePdf can be cancelled between pages", async () => {
  const d = work();
  const src = await makeTextPdf(path.join(d, "doc.pdf"), ["a", "b", "c", "d", "e"]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => rasterizePdf(src, { format: "png", dpi: 72 }, allocatorFor(d, "doc"), null, { signal: controller.signal }),
    /cancelled/i
  );
});
