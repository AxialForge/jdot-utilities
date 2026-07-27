// Tests for mergeConvertedPdfs — the batch-level helper behind the "Merge into
// one PDF" convert option. It takes a runBatch result array, concatenates the
// successful per-file PDF outputs in order, and reports which intermediates it
// folded in (so the caller can delete them).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const { mergeConvertedPdfs } = require("../src/main/convert");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-mergeconv-"));
}

async function makePdf(file, n, label) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i += 1) {
    const page = doc.addPage([300, 200]);
    page.drawText(`${label}-${i}`, { x: 20, y: 100, size: 24, font });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

// Shape a runBatch-style result row.
const ok = (p) => ({ ok: true, outputPath: p });
const fail = (name) => ({ ok: false, name, error: "boom" });

test("merges successful outputs in queue order and reports the inputs", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 2, "A");
  const b = await makePdf(path.join(d, "b.pdf"), 3, "B");
  const out = path.join(d, "merged.pdf");

  const res = await mergeConvertedPdfs({ results: [ok(a), ok(b)], outputPath: out });

  assert.strictEqual(res.pages, 5);
  assert.strictEqual(res.merged, 2);
  assert.deepStrictEqual(res.inputs, [a, b]); // order preserved for deletion
  assert.ok(fs.existsSync(out));
  const reopened = await PDFDocument.load(await fs.promises.readFile(out));
  assert.strictEqual(reopened.getPageCount(), 5);
});

test("skips failed conversions but merges the rest", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  const c = await makePdf(path.join(d, "c.pdf"), 4, "C");
  const out = path.join(d, "merged.pdf");

  // a ok, b failed, c ok — the failed row must not appear in inputs.
  const res = await mergeConvertedPdfs({
    results: [ok(a), fail("b.docx"), ok(c)],
    outputPath: out,
  });

  assert.strictEqual(res.merged, 2);
  assert.strictEqual(res.pages, 5);
  assert.deepStrictEqual(res.inputs, [a, c]);
});

test("returns null when fewer than two outputs succeeded (nothing to merge)", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");

  assert.strictEqual(await mergeConvertedPdfs({ results: [ok(a), fail("b.docx")], outputPath: path.join(d, "m.pdf") }), null);
  assert.strictEqual(await mergeConvertedPdfs({ results: [], outputPath: path.join(d, "m.pdf") }), null);
  // A null/garbage result array must not throw.
  assert.strictEqual(await mergeConvertedPdfs({ results: null, outputPath: path.join(d, "m.pdf") }), null);
});
