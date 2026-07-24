const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts, degrees } = require("pdf-lib");
const { pdfThumbnails } = require("../src/main/pdfthumbs");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-thumb-"));
}

async function makePdf(file, pages = 4, opts = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1) {
    const p = doc.addPage(opts.size || [612, 792]);
    p.drawText(`page ${i + 1}`, { x: 40, y: 700, size: 36, font });
    if (opts.rotate) p.setRotation(degrees(opts.rotate));
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

test("renders one thumbnail per page as a data URL", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 4);

  const res = await pdfThumbnails(src, { width: 100 });

  assert.strictEqual(res.total, 4);
  assert.strictEqual(res.thumbs.length, 4);
  assert.strictEqual(res.truncated, false);
  assert.deepStrictEqual(res.thumbs.map((t) => t.page), [1, 2, 3, 4]);
  for (const t of res.thumbs) {
    assert.match(t.url, /^data:image\/jpeg;base64,/, "thumb should be an inline JPEG");
    assert.ok(t.url.length > 200, "thumb looks empty");
    assert.ok(Math.abs(t.w - 100) <= 1, `width should track the request, got ${t.w}`);
    assert.ok(t.h > t.w, "portrait page should be taller than wide");
  }
});

test("honours the page limit and reports truncation", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 9);

  const res = await pdfThumbnails(src, { width: 60, limit: 4 });
  assert.strictEqual(res.total, 9, "total is the real page count, not the rendered count");
  assert.strictEqual(res.thumbs.length, 4);
  assert.strictEqual(res.truncated, true);
});

test("can start partway through a long document", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 8);

  const res = await pdfThumbnails(src, { width: 60, limit: 3, from: 5 });
  assert.deepStrictEqual(res.thumbs.map((t) => t.page), [5, 6, 7]);
  assert.strictEqual(res.from, 5);
});

test("a landscape page comes back wider than tall", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "wide.pdf"), 1, { size: [792, 612] });
  const [t] = (await pdfThumbnails(src, { width: 120 })).thumbs;
  assert.ok(t.w > t.h, `expected landscape, got ${t.w}x${t.h}`);
});

test("an existing page rotation is applied, so the thumbnail matches the viewer", async () => {
  const d = work();
  // A portrait page rotated 90 degrees should render landscape.
  const src = await makePdf(path.join(d, "rot.pdf"), 1, { rotate: 90 });
  const [t] = (await pdfThumbnails(src, { width: 120 })).thumbs;
  assert.strictEqual(t.rotation, 90);
  assert.ok(t.w > t.h, `rotated page should render landscape, got ${t.w}x${t.h}`);
});

test("width is clamped to something sane", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 1);
  const tiny = (await pdfThumbnails(src, { width: 1 })).thumbs[0];
  const huge = (await pdfThumbnails(src, { width: 99999 })).thumbs[0];
  assert.ok(tiny.w >= 40, `too small: ${tiny.w}`);
  assert.ok(huge.w <= 400, `too large: ${huge.w}`);
});

test("rejects a file that isn't a PDF", async () => {
  const d = work();
  const bad = path.join(d, "bad.pdf");
  fs.writeFileSync(bad, "not a pdf at all");
  await assert.rejects(() => pdfThumbnails(bad, {}), /not a readable PDF/i);
});

test("stops early when aborted", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "a.pdf"), 6);
  const c = new AbortController();
  c.abort();
  const res = await pdfThumbnails(src, { width: 60 }, { signal: c.signal });
  assert.strictEqual(res.thumbs.length, 0, "aborted before rendering anything");
});
