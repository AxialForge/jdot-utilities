// Pandoc sidecar tests. The format mapping and the tool descriptor are checked
// always; the real conversions run only when the bundled binary is present
// (resources/bin/pandoc.exe) and skip cleanly otherwise, like the Ghostscript
// tests — so `npm test` passes on a machine without pandoc, while CI (which
// fetches pandoc first) exercises the real thing.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  locatePandoc, hasPandoc, convertWithPandoc, runPandoc, readerFor, writerFor,
} = require("../src/main/pandoc");
const { loadTools, describe } = require("../src/main/registry");
const { runBatch } = require("../src/main/convert");

const HAVE = hasPandoc();
const real = { skip: HAVE ? false : "pandoc binary not present (resources/bin)" };

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-pandoc-"));
}

// A 1x1 PNG, for building a docx fixture that actually embeds an image.
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d494844520000000100000001080600000" +
  "01f15c4890000000a49444154789c6300010000050001" +
  "0d0a2db40000000049454e44ae426082",
  "hex"
);

// ── pure mapping (always) ──────────────────────────────────────
test("extensions map to pandoc reader/writer tokens", () => {
  assert.strictEqual(readerFor("md"), "markdown");
  assert.strictEqual(readerFor("tex"), "latex");
  assert.strictEqual(readerFor("DOCX"), "docx"); // case-insensitive
  assert.strictEqual(writerFor("tex"), "latex");
  assert.strictEqual(writerFor("adoc"), "asciidoc");
  assert.strictEqual(writerFor("md"), "markdown");
  assert.strictEqual(readerFor("xyz"), null);
  assert.strictEqual(writerFor("pdf"), null, "PDF is not a pandoc target here");
});

// ── the discovered tool (always) ───────────────────────────────
test("the Documents & Ebooks tool is discovered with the right shape", () => {
  const tools = loadTools();
  const t = tools.get("pandoc-convert");
  assert.ok(t, "pandoc-convert not discovered");
  const d = describe(t);
  assert.strictEqual(d.requiresEngine, null, "pandoc is bundled, not an optional engine");
  assert.ok(!d.outputFormats.includes("pdf"), "must not offer PDF");
  for (const f of ["docx", "epub", "tex", "adoc", "md"]) {
    assert.ok(d.outputFormats.includes(f), `should output ${f}`);
  }
  for (const f of ["docx", "epub", "ipynb", "md", "html"]) {
    assert.ok(d.inputFormats.includes(f), `should input ${f}`);
  }
  // Same-format no-ops are hidden.
  assert.deepStrictEqual(d.excludePairs.docx, ["docx"]);
});

// ── real conversions (only with the binary) ────────────────────
test("md round-trips through docx", real, async () => {
  const d = work();
  const md = path.join(d, "in.md");
  fs.writeFileSync(md, "# Heading\n\nHello **world**.\n\n- a\n- b\n");
  const docx = path.join(d, "out.docx");
  await convertWithPandoc({ pandocPath: locatePandoc(), inputPath: md, outputPath: docx, from: "md", to: "docx" });
  assert.ok(fs.existsSync(docx) && fs.statSync(docx).size > 0, "no docx produced");

  const back = path.join(d, "back.md");
  await convertWithPandoc({ pandocPath: locatePandoc(), inputPath: docx, outputPath: back, from: "docx", to: "md" });
  const text = fs.readFileSync(back, "utf8");
  assert.match(text, /Heading/);
  assert.match(text, /Hello/);
});

test("writes the ebook/markup targets", real, async () => {
  const d = work();
  const md = path.join(d, "in.md");
  fs.writeFileSync(md, "# Title\n\nBody text with a [link](https://example.com).\n");
  for (const [to, ext] of [["tex", "tex"], ["epub", "epub"], ["rst", "rst"], ["org", "org"], ["adoc", "adoc"]]) {
    const out = path.join(d, `out.${ext}`);
    await convertWithPandoc({ pandocPath: locatePandoc(), inputPath: md, outputPath: out, from: "md", to });
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0, `no ${to} output`);
  }
});

test("extracts embedded media when a container goes to a text format", real, async () => {
  const d = work();
  // Build a docx that genuinely embeds an image (fixture uses no --sandbox so
  // the local PNG is embedded; the app path always uses --sandbox).
  fs.writeFileSync(path.join(d, "img.png"), PNG_1x1);
  fs.writeFileSync(path.join(d, "doc.md"), "# Pic\n\n![p](img.png)\n");
  const docx = path.join(d, "doc.docx");
  await runPandoc(locatePandoc(), ["--from", "markdown", "--to", "docx", "-o", "doc.docx", "doc.md"], { cwd: d });

  const outMd = path.join(d, "doc-out.md");
  const { mediaDir } = await convertWithPandoc({ pandocPath: locatePandoc(), inputPath: docx, outputPath: outMd, from: "docx", to: "md" });
  assert.ok(mediaDir, "expected a media folder to be reported");
  const files = fs.readdirSync(path.join(d, mediaDir, "media"));
  assert.ok(files.some((f) => /\.png$/i.test(f)), "extracted image missing");
});

test("runs through the batch runner like any convert tool", real, async () => {
  const tools = loadTools();
  const d = work();
  const a = path.join(d, "a.md");
  const b = path.join(d, "b.md");
  fs.writeFileSync(a, "# A\n\nDoc A.\n");
  fs.writeFileSync(b, "# B\n\nDoc B.\n");
  const results = await runBatch({
    tool: tools.get("pandoc-convert"),
    files: [a, b],
    outputFormat: "docx",
    outputDir: d,
    options: {},
  });
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.ok(results.every((r) => fs.existsSync(r.outputPath) && /\.docx$/.test(r.outputPath)));
});

test("a remote image reference converts offline without error (sandbox)", real, async () => {
  // With --sandbox pandoc refuses to fetch the remote image (a warning, not an
  // error) and still produces the docx. Without --sandbox this same input makes
  // a real network request — which is exactly why the app always passes it.
  const d = work();
  const md = path.join(d, "r.md");
  fs.writeFileSync(md, "# R\n\n![x](https://raw.githubusercontent.com/x/y/main/z.png)\n");
  const out = path.join(d, "r.docx");
  await convertWithPandoc({ pandocPath: locatePandoc(), inputPath: md, outputPath: out, from: "md", to: "docx" });
  assert.ok(fs.existsSync(out), "should still produce output despite the unfetchable image");
});
