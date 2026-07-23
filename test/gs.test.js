// Ghostscript compress + PDF/A. These need Ghostscript present; when it isn't
// (e.g. a clean CI runner without it), the engine tests skip rather than fail —
// but the locator and tool-wiring tests always run.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const { locateGs, compressPdf, toPdfA } = require("../src/main/gs");

const GS = locateGs(null);
const gsMissing = !GS;

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-gs-"));
}
async function makePdf(file, pages = 6) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const p = doc.addPage([612, 792]);
    p.drawRectangle({ x: 40, y: 40, width: 520, height: 700, color: rgb(0.9, 0.92, 0.98) });
    p.drawText(`Page ${i + 1} — the quick brown fox.`, { x: 60, y: 720, size: 14, font });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}
const isPdf = (f) => fs.readFileSync(f).subarray(0, 5).toString() === "%PDF-";

test("locateGs finds an installed Ghostscript or returns null (no throw)", () => {
  const p = locateGs(null);
  assert.ok(p === null || (typeof p === "string" && fs.existsSync(p)));
});

test("locateGs honors an explicit override", () => {
  assert.strictEqual(locateGs("C:/definitely/not/here/gs.exe"), gsMissing ? null : GS,
    "a non-existent override should be ignored");
  if (GS) assert.strictEqual(locateGs(GS), GS, "a valid override should win");
});

test("the pdf-optimize tool is discovered and wired to Ghostscript", () => {
  const { loadTools } = require("../src/main/registry");
  const t = loadTools().get("pdf-optimize");
  assert.ok(t, "pdf-optimize not discovered");
  assert.strictEqual(t.category, "PDF");
  assert.ok(t.options[0].choices.some((c) => /PDF\/A/.test(c)), "no PDF/A preset");
  assert.ok(t.options[0].choices.some((c) => /Compress/.test(c)), "no Compress preset");
});

test("pdf-optimize gives a clear error when Ghostscript is absent", { skip: !gsMissing }, async () => {
  const { loadTools } = require("../src/main/registry");
  const t = loadTools().get("pdf-optimize");
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"));
  await assert.rejects(
    () => t.convert({ inputPath: src, outputPath: path.join(d, "o.pdf"), options: { preset: "Compress — balanced (ebook)" } }),
    /Ghostscript not found/
  );
});

test("compressPdf writes a valid PDF and reports sizes", { skip: gsMissing }, async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"));
  const out = path.join(d, "c.pdf");
  const res = await compressPdf(GS, src, out, { quality: "screen" });
  assert.ok(isPdf(out), "not a PDF");
  assert.strictEqual(typeof res.before, "number");
  assert.strictEqual(typeof res.after, "number");
});

test("toPdfA writes a PDF carrying a PDF/A conformance marker", { skip: gsMissing }, async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"));
  const out = path.join(d, "archive.pdf");
  await toPdfA(GS, src, out, { level: "pdfa-2b" });
  assert.ok(isPdf(out));
  const raw = fs.readFileSync(out, "latin1");
  assert.ok(/pdfaid/.test(raw) || raw.includes("PDF/A"), "no PDF/A metadata marker found");
});

test("pdf-optimize end-to-end: compress and archive both succeed", { skip: gsMissing }, async () => {
  const { loadTools } = require("../src/main/registry");
  const t = loadTools().get("pdf-optimize");
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"));

  const c = path.join(d, "c.pdf");
  await t.convert({ inputPath: src, outputPath: c, options: { preset: "Compress — small (screen)" } });
  assert.ok(isPdf(c));

  const a = path.join(d, "a-out.pdf");
  await t.convert({ inputPath: src, outputPath: a, options: { preset: "Archive — PDF/A-2b" } });
  assert.ok(isPdf(a));
  assert.ok(/pdfaid/.test(fs.readFileSync(a, "latin1")) || fs.readFileSync(a, "latin1").includes("PDF/A"));
});
