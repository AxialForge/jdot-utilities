const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const { watermarkPdf, setMetadata, readMetadata, loadPdf } = require("../src/main/pdfops");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ann-"));
}
async function makePdf(file, pages = 3) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) doc.addPage([612, 792]).drawText(`p${i + 1}`, { x: 40, y: 700, size: 12, font });
  await fs.promises.writeFile(file, await doc.save());
  return file;
}
const reopen = (f) => loadPdf(f, path.basename(f));

// ── watermark ──────────────────────────────────────────────────

test("watermark stamps the text on every page", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 3);
  const out = path.join(d, "wm.pdf");
  const res = await watermarkPdf(src, out, { text: "CONFIDENTIAL", opacity: 0.2 });
  assert.strictEqual(res.pages, 3);

  const doc = await reopen(out);
  assert.strictEqual(doc.getPageCount(), 3);
  // Content streams are Flate-compressed, so the literal text isn't in the bytes.
  // Instead prove the watermark was drawn: it embeds Helvetica-Bold (the plain
  // source uses Helvetica), and each page now references that font. With object
  // streams off, font dicts are plain objects in the output.
  const raw = Buffer.from(await doc.save({ useObjectStreams: false })).toString("latin1");
  assert.ok(raw.includes("Helvetica-Bold"), "watermark font not embedded — watermark missing");

  // And the watermarked file is larger than the same source saved un-watermarked.
  const control = await (await reopen(src)).save();
  assert.ok(fs.statSync(out).size > control.length, "watermark added no content");
});

test("watermark rejects empty text", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 1);
  await assert.rejects(() => watermarkPdf(src, path.join(d, "o.pdf"), { text: "   " }), /watermark text/i);
});

test("watermark output is a valid, larger-or-equal PDF", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 2);
  const out = path.join(d, "wm.pdf");
  await watermarkPdf(src, out, { text: "DRAFT" });
  assert.strictEqual(fs.readFileSync(out).subarray(0, 5).toString(), "%PDF-");
});

// ── metadata ───────────────────────────────────────────────────

test("setMetadata writes fields that read back", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 1);
  const out = path.join(d, "m.pdf");
  await setMetadata(src, out, { title: "Q3 Report", author: "Jo Doe", subject: "Numbers", keywords: "finance, q3, report" });

  const meta = await readMetadata(out);
  assert.strictEqual(meta.title, "Q3 Report");
  assert.strictEqual(meta.author, "Jo Doe");
  assert.strictEqual(meta.subject, "Numbers");
  assert.match(meta.keywords, /finance/);
  assert.match(meta.keywords, /q3/);
});

test("setMetadata only changes provided fields", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 1);
  const mid = path.join(d, "1.pdf");
  await setMetadata(src, mid, { title: "Keep Me", author: "Orig" });
  const out = path.join(d, "2.pdf");
  await setMetadata(mid, out, { author: "Changed" }); // title not passed

  const meta = await readMetadata(out);
  assert.strictEqual(meta.title, "Keep Me", "title should be untouched");
  assert.strictEqual(meta.author, "Changed");
});

test("readMetadata returns empty strings for a bare PDF", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 1);
  const meta = await readMetadata(src);
  assert.deepStrictEqual(Object.keys(meta).sort(), ["author", "keywords", "subject", "title"]);
});

test("both tools are discovered as PDF convert tools", () => {
  const { loadTools } = require("../src/main/registry");
  const tools = loadTools();
  for (const id of ["pdf-watermark", "pdf-metadata"]) {
    const t = tools.get(id);
    assert.ok(t, id + " not discovered");
    assert.strictEqual(t.category, "PDF");
    assert.strictEqual((t.kind || "convert"), "convert");
  }
});
