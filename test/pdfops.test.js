const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const { mergePdfs, pageCount, inspect } = require("../src/main/pdfops");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-pdf-"));
}

// Build a small PDF with `n` pages, each labelled, so page order is verifiable.
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

test("merge combines page counts in order", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 2, "A");
  const b = await makePdf(path.join(d, "b.pdf"), 3, "B");
  const out = path.join(d, "merged.pdf");

  const res = await mergePdfs([a, b], out);

  assert.strictEqual(res.pages, 5);
  assert.deepStrictEqual(res.sources, [
    { file: "a.pdf", pages: 2 },
    { file: "b.pdf", pages: 3 },
  ]);
  assert.ok(fs.existsSync(out));
  const reopened = await PDFDocument.load(await fs.promises.readFile(out));
  assert.strictEqual(reopened.getPageCount(), 5);
});

test("merge respects the given order", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  const b = await makePdf(path.join(d, "b.pdf"), 1, "B");
  const res = await mergePdfs([b, a], path.join(d, "m.pdf"));
  assert.deepStrictEqual(res.sources.map((s) => s.file), ["b.pdf", "a.pdf"]);
});

test("merge sets a producer and returns no spurious warnings for plain PDFs", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  const b = await makePdf(path.join(d, "b.pdf"), 1, "B");
  const out = path.join(d, "m.pdf");
  const res = await mergePdfs([a, b], out);

  assert.deepStrictEqual(res.warnings, [], "unexpected warnings: " + res.warnings);
  // updateMetadata:false is required to read what is actually on disk — pdf-lib's
  // constructor restamps Producer with its own name otherwise.
  const doc = await PDFDocument.load(await fs.promises.readFile(out), { updateMetadata: false });
  assert.strictEqual(doc.getProducer(), "Jdot Utilities");
});

test("opening a PDF does not rewrite the author's metadata", async () => {
  const d = work();
  const src = path.join(d, "authored.pdf");
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.setProducer("Acme Typesetter 4.2");
  doc.setCreator("Jo Doe");
  await fs.promises.writeFile(src, await doc.save());

  // loadPdf must not restamp. Read back through the same guarded path.
  const { loadPdf } = require("../src/main/pdfops");
  const opened = await loadPdf(src, "authored.pdf");
  assert.strictEqual(opened.getProducer(), "Acme Typesetter 4.2");
  assert.strictEqual(opened.getCreator(), "Jo Doe");
});

test("merge warns that form fields are flattened", async () => {
  const d = work();
  // A PDF with an AcroForm: a single text field.
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const form = doc.getForm();
  form.createTextField("who").addToPage(page, { x: 20, y: 100, width: 200, height: 24 });
  const withForm = path.join(d, "form.pdf");
  await fs.promises.writeFile(withForm, await doc.save());

  const plain = await makePdf(path.join(d, "plain.pdf"), 1, "P");
  const res = await mergePdfs([withForm, plain], path.join(d, "m.pdf"));

  assert.ok(
    res.warnings.some((w) => /form field/i.test(w)),
    "no form warning: " + JSON.stringify(res.warnings)
  );
});

test("merge refuses fewer than two inputs", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  await assert.rejects(() => mergePdfs([a], path.join(d, "m.pdf")), /at least two/i);
  await assert.rejects(() => mergePdfs([], path.join(d, "m.pdf")), /at least two/i);
});

test("merge names the offending file when one input is not a PDF", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  const junk = path.join(d, "notes.pdf");
  fs.writeFileSync(junk, "I am plainly not a PDF");

  await assert.rejects(
    () => mergePdfs([a, junk], path.join(d, "m.pdf")),
    (err) => {
      assert.match(err.message, /notes\.pdf/, err.message);
      assert.match(err.message, /not a PDF/i, err.message);
      return true;
    }
  );
});

test("merge reports a missing file clearly", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 1, "A");
  await assert.rejects(
    () => mergePdfs([a, path.join(d, "gone.pdf")], path.join(d, "m.pdf")),
    /gone\.pdf.*cannot read/i
  );
});

test("merge can be cancelled mid-run", async () => {
  const d = work();
  const files = [];
  for (let i = 0; i < 5; i += 1) files.push(await makePdf(path.join(d, `f${i}.pdf`), 1, "F"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => mergePdfs(files, path.join(d, "m.pdf"), null, { signal: controller.signal }),
    /cancelled/i
  );
});

test("pageCount returns a number for a real PDF and null otherwise", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 4, "A");
  assert.strictEqual(await pageCount(a), 4);

  const junk = path.join(d, "junk.pdf");
  fs.writeFileSync(junk, "nope");
  assert.strictEqual(await pageCount(junk), null);
  assert.strictEqual(await pageCount(path.join(d, "missing.pdf")), null);
});

test("inspect explains why a file is unusable instead of returning null", async () => {
  const d = work();
  const a = await makePdf(path.join(d, "a.pdf"), 2, "A");
  assert.deepStrictEqual(await inspect(a), { pages: 2, error: null });

  const junk = path.join(d, "junk.pdf");
  fs.writeFileSync(junk, "nope");
  const bad = await inspect(junk);
  assert.strictEqual(bad.pages, null);
  assert.match(bad.error, /not a PDF/i);
});
