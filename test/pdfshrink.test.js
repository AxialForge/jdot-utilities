const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { shrinkPdf, clampDpi, clampQuality } = require("../src/main/pdfshrink");
const tool = require("../src/tools/pdf-shrink");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-shrink-"));
}

// A detailed but *photo-like* image stored at maximum quality — the "phone scan"
// case this tool exists for. Deterministic, so the test can't flake.
//
// Deliberately smooth rather than high-frequency noise: pixel-level noise is
// pathological for JPEG (and uniquely bad for greyscale, whose luma channel
// isn't subsampled), so testing against it would measure an artificial worst
// case instead of the real workload.
async function busyJpeg(size = 2400) {
  const raw = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      raw[i] = 128 + Math.round(100 * Math.sin(x / 40));
      raw[i + 1] = 128 + Math.round(100 * Math.cos(y / 55));
      raw[i + 2] = 128 + Math.round(80 * Math.sin((x + y) / 70));
    }
  }
  return sharp(raw, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

async function scanPdf(file, pages = 2) {
  const jpeg = await busyJpeg();
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpeg);
  for (let i = 0; i < pages; i += 1) {
    const p = doc.addPage([612, 792]);
    p.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

async function textPdf(file, pages = 1) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    doc.addPage([612, 792]).drawText(`page ${i + 1}`, { x: 40, y: 700, size: 12, font });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

// ── the engine ─────────────────────────────────────────────────

test("shrinks an image-heavy PDF substantially", async () => {
  const d = work();
  const src = await scanPdf(path.join(d, "scan.pdf"), 2);
  const out = path.join(d, "small.pdf");

  const res = await shrinkPdf(src, out, { dpi: 72, quality: 0.45, grayscale: true });

  assert.strictEqual(res.shrunk, true, "should have shrunk a big scanned PDF");
  assert.strictEqual(res.pages, 2);
  assert.ok(res.after < res.before, `expected ${res.after} < ${res.before}`);
  assert.ok(res.after < res.before * 0.5, "a 72 DPI grey pass should at least halve it");
  assert.strictEqual(fs.readFileSync(out).subarray(0, 5).toString(), "%PDF-");
});

test("keeps page count and physical page size", async () => {
  const d = work();
  const src = await scanPdf(path.join(d, "scan.pdf"), 3);
  const out = path.join(d, "small.pdf");
  await shrinkPdf(src, out, { dpi: 100, quality: 0.5 });

  const doc = await PDFDocument.load(fs.readFileSync(out), { updateMetadata: false });
  assert.strictEqual(doc.getPageCount(), 3);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 612) < 1, `width drifted: ${width}`);
  assert.ok(Math.abs(height - 792) < 1, `height drifted: ${height}`);
});

test("falls back to the original when rasterizing would make it bigger", async () => {
  const d = work();
  const src = await textPdf(path.join(d, "text.pdf"), 1);
  const out = path.join(d, "out.pdf");

  const res = await shrinkPdf(src, out, { dpi: 200, quality: 0.8 });

  assert.strictEqual(res.shrunk, false, "a tiny text PDF cannot be beaten by rasterizing");
  assert.strictEqual(res.after, res.before);
  assert.strictEqual(fs.statSync(out).size, fs.statSync(src).size, "output should be a copy of the original");
});

test("skipIfLarger:false writes the rasterized file even when bigger", async () => {
  const d = work();
  const src = await textPdf(path.join(d, "text.pdf"), 1);
  const out = path.join(d, "out.pdf");

  const res = await shrinkPdf(src, out, { dpi: 200, quality: 0.8, skipIfLarger: false });
  assert.strictEqual(res.shrunk, true);
  assert.ok(fs.statSync(out).size > fs.statSync(src).size, "explicitly asked for the raster version");
});

test("grayscale produces a smaller file than colour at equal settings", async () => {
  const d = work();
  const src = await scanPdf(path.join(d, "scan.pdf"), 1);
  const colour = path.join(d, "c.pdf");
  const grey = path.join(d, "g.pdf");

  const a = await shrinkPdf(src, colour, { dpi: 100, quality: 0.6, grayscale: false });
  const b = await shrinkPdf(src, grey, { dpi: 100, quality: 0.6, grayscale: true });
  assert.ok(b.after < a.after, `grey ${b.after} should beat colour ${a.after}`);
});

test("rejects a file that isn't a PDF", async () => {
  const d = work();
  const bad = path.join(d, "bad.pdf");
  fs.writeFileSync(bad, "definitely not a pdf");
  await assert.rejects(() => shrinkPdf(bad, path.join(d, "o.pdf"), {}), /not a readable PDF/i);
});

test("honours an abort signal", async () => {
  const d = work();
  const src = await scanPdf(path.join(d, "scan.pdf"), 3);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    () => shrinkPdf(src, path.join(d, "o.pdf"), {}, null, { signal: c.signal }),
    /cancel/i
  );
});

test("DPI and quality are clamped to sane ranges", () => {
  assert.strictEqual(clampDpi(5), 36);
  assert.strictEqual(clampDpi(9999), 300);
  assert.strictEqual(clampDpi(150), 150);
  assert.strictEqual(clampQuality(0), 0.6, "0 is falsy -> default");
  assert.strictEqual(clampQuality(5), 0.95);
  assert.strictEqual(clampQuality(0.05), 0.2);
});

// ── the tool ───────────────────────────────────────────────────

test("tool is discovered as a PDF convert tool", () => {
  const { loadTools } = require("../src/main/registry");
  const t = loadTools().get("pdf-shrink");
  assert.ok(t, "pdf-shrink not discovered");
  assert.strictEqual(t.category, "PDF");
  assert.strictEqual(t.kind, "convert");
  assert.deepStrictEqual(t.inputFormats, ["pdf"]);
});

test("tool needs no Ghostscript and shrinks through its preset", async () => {
  const d = work();
  const src = await scanPdf(path.join(d, "scan.pdf"), 1);
  const out = path.join(d, "out.pdf");

  await tool.convert({
    inputPath: src,
    outputPath: out,
    outputFormat: "pdf",
    options: { preset: "Smallest (72 DPI, grey)", skipIfLarger: true },
  });

  assert.ok(fs.statSync(out).size < fs.statSync(src).size, "preset should shrink the scan");
});
