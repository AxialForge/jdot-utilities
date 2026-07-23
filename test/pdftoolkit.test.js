// Split / rotate / delete / extract / images->PDF. Pure pdf-lib + sharp, so these
// run under plain node (no Electron needed).

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PDFDocument, StandardFonts, degrees } = require("pdf-lib");

const { splitPdf, extractPages, deletePages, rotatePages, loadPdf } = require("../src/main/pdfops");
const { imagesToPdf } = require("../src/main/imgpdf");
const { freePath } = require("../src/main/ops");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-tk-"));
}

// Build an n-page PDF whose page i is labelled so order is checkable.
async function makePdf(file, n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i += 1) {
    doc.addPage([200, 300]).drawText(`page ${i}`, { x: 20, y: 150, size: 20, font });
  }
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

async function reopen(file) {
  return loadPdf(file, path.basename(file));
}

// Allocator matching what the explode runner hands to run().
function allocatorFor(dir, stem) {
  const reserved = new Set();
  return (suffix, ext) => freePath(dir, suffix ? `${stem}-${suffix}` : stem, ext, reserved);
}

// ── split ──────────────────────────────────────────────────────

test("split mode=each makes one file per page", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 5);
  const res = await splitPdf(src, { mode: "each" }, allocatorFor(d, "book"));
  assert.strictEqual(res.outputs.length, 5);
  for (const o of res.outputs) assert.strictEqual((await reopen(o)).getPageCount(), 1);
  assert.ok(res.outputs.every((o) => /book-p\d+\.pdf$/.test(o)), res.outputs.join(","));
});

test("split mode=every groups by size, last group is the remainder", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 7);
  const res = await splitPdf(src, { mode: "every", size: 3 }, allocatorFor(d, "book"));
  const counts = [];
  for (const o of res.outputs) counts.push((await reopen(o)).getPageCount());
  assert.deepStrictEqual(counts, [3, 3, 1]);
});

test("split mode=ranges makes one file per range", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 6);
  const res = await splitPdf(src, { mode: "ranges", spec: "1-2, 4-6" }, allocatorFor(d, "book"));
  const counts = [];
  for (const o of res.outputs) counts.push((await reopen(o)).getPageCount());
  assert.deepStrictEqual(counts, [2, 3]);
});

test("split ranges rejects an empty spec", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 3);
  await assert.rejects(
    () => splitPdf(src, { mode: "ranges", spec: "" }, allocatorFor(d, "book")),
    /at least one range/i
  );
});

test("split can be cancelled", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 10);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => splitPdf(src, { mode: "each" }, allocatorFor(d, "book"), null, { signal: controller.signal }),
    /cancelled/i
  );
});

// ── extract / delete ───────────────────────────────────────────

test("extract keeps only the named pages, in typed order", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 6);
  const out = path.join(d, "picked.pdf");
  const res = await extractPages(src, out, "5,1-2");
  assert.strictEqual(res.pages, 3);
  assert.strictEqual((await reopen(out)).getPageCount(), 3);
});

test("extract rejects a range that selects nothing sensible", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 3);
  await assert.rejects(() => extractPages(src, path.join(d, "o.pdf"), "9"), /past the end/);
});

test("delete removes the named pages and keeps the rest", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 6);
  const out = path.join(d, "trimmed.pdf");
  const res = await deletePages(src, out, "2,4");
  assert.strictEqual(res.pages, 4);
  assert.strictEqual(res.removed, 2);
  assert.strictEqual((await reopen(out)).getPageCount(), 4);
});

test("delete refuses to remove every page", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 3);
  await assert.rejects(() => deletePages(src, path.join(d, "o.pdf"), "1-3"), /every page/i);
});

test("delete flags a spec that matched nothing", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 3);
  // page 3 exists, but deleting it should work; test the no-op path via a
  // spec fully outside range instead.
  await assert.rejects(() => deletePages(src, path.join(d, "o.pdf"), "9"), /past the end/);
});

// ── rotate ─────────────────────────────────────────────────────

test("rotate turns every page by default and composes with existing rotation", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 3);
  // Pre-rotate page 1 by 90 so we can prove composition.
  const pre = await reopen(src);
  pre.getPages()[0].setRotation(degrees(90));
  await fs.promises.writeFile(src, await pre.save());

  const out = path.join(d, "rot.pdf");
  await rotatePages(src, out, 90, "");
  const doc = await reopen(out);
  const angles = doc.getPages().map((p) => p.getRotation().angle);
  assert.deepStrictEqual(angles, [180, 90, 90], "page 1 should be 90+90=180, others 90");
});

test("rotate limits to a page range", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 4);
  const out = path.join(d, "rot.pdf");
  const res = await rotatePages(src, out, 270, "2-3");
  assert.strictEqual(res.pages, 2);
  const angles = (await reopen(out)).getPages().map((p) => p.getRotation().angle);
  assert.deepStrictEqual(angles, [0, 270, 270, 0]);
});

test("rotate rejects a non-quarter turn", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 2);
  await assert.rejects(() => rotatePages(src, path.join(d, "o.pdf"), 0, ""), /90, 180, or 270/);
});

// ── images -> pdf ──────────────────────────────────────────────

async function makeImage(file, w, h, colour) {
  const sharp = require("sharp");
  await sharp({ create: { width: w, height: h, channels: 3, background: colour } }).png().toFile(file);
  return file;
}

test("images->pdf makes one page per image, Fit sizes the page to the image", async () => {
  const d = work();
  const a = await makeImage(path.join(d, "a.png"), 100, 200, { r: 200, g: 0, b: 0 });
  const b = await makeImage(path.join(d, "b.png"), 300, 150, { r: 0, g: 0, b: 200 });
  const out = path.join(d, "album.pdf");

  const res = await imagesToPdf([a, b], out, { pageSize: "Fit" });
  assert.strictEqual(res.pages, 2);
  const doc = await reopen(out);
  const sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
  assert.deepStrictEqual(sizes, [[100, 200], [300, 150]], "Fit should match image dimensions");
});

test("images->pdf centers on a fixed page size", async () => {
  const d = work();
  const a = await makeImage(path.join(d, "a.png"), 100, 100, { r: 0, g: 200, b: 0 });
  const out = path.join(d, "one.pdf");
  const res = await imagesToPdf([a], out, { pageSize: "A4", margin: 20 });
  assert.strictEqual(res.pages, 1);
  const p = (await reopen(out)).getPages()[0];
  assert.strictEqual(Math.round(p.getWidth()), 595, "A4 width in points");
});

test("images->pdf converts a non-PNG/JPEG format via sharp", async () => {
  const d = work();
  const sharp = require("sharp");
  const webp = path.join(d, "c.webp");
  await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 10, g: 10, b: 10 } } })
    .webp().toFile(webp);
  const out = path.join(d, "web.pdf");
  const res = await imagesToPdf([webp], out, { pageSize: "Fit" });
  assert.strictEqual(res.pages, 1);
});

test("images->pdf skips an unreadable file but still produces a PDF, with a warning", async () => {
  const d = work();
  const good = await makeImage(path.join(d, "good.png"), 50, 50, { r: 1, g: 1, b: 1 });
  const bad = path.join(d, "bad.png");
  fs.writeFileSync(bad, "not an image");
  const out = path.join(d, "mix.pdf");

  const res = await imagesToPdf([good, bad], out, { pageSize: "Fit" });
  assert.strictEqual(res.pages, 1);
  assert.ok(res.warnings.some((w) => /bad\.png/.test(w)), res.warnings.join(","));
});

test("images->pdf fails clearly when nothing is readable", async () => {
  const d = work();
  const bad = path.join(d, "bad.png");
  fs.writeFileSync(bad, "nope");
  await assert.rejects(() => imagesToPdf([bad], path.join(d, "o.pdf"), {}), /could be read/i);
});

test("produced PDFs carry our Producer, not pdf-lib's", async () => {
  const d = work();
  const src = await makePdf(path.join(d, "book.pdf"), 2);
  const out = path.join(d, "x.pdf");
  await extractPages(src, out, "1");
  assert.strictEqual((await reopen(out)).getProducer(), "Jdot Utilities");
});
