// Exercises every non-PDF document path. PDF output needs Chromium and is
// covered by test/pdfrender.electron.js instead.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const tool = require("../src/tools/document-convert");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-doc-"));
}

async function convert(inputPath, format, dir, options) {
  const out = path.join(dir, "out." + format);
  await tool.convert({ inputPath, outputPath: out, outputFormat: format, options: options || {} });
  return out;
}

// A perfectly ordinary web page: stylesheet, script, title, relative image.
const PAGE = `<!doctype html><html><head><title>Q3 Report</title>
<style>.hero{color:#c00;font-weight:700}</style>
<script>window.analytics=function(){console.log("tracking")}</script>
</head><body><h1 class="hero">Q3 Report</h1><p>Revenue rose 12%.</p>
<img src="chart.png"></body></html>`;

test("html -> md does not leak CSS or JavaScript into the body", async () => {
  const d = work();
  const src = path.join(d, "q3.html");
  fs.writeFileSync(src, PAGE);
  const md = fs.readFileSync(await convert(src, "md", d), "utf8");

  assert.ok(!md.includes("font-weight"), "CSS leaked:\n" + md);
  assert.ok(!md.includes(".hero{"), "CSS selector leaked:\n" + md);
  assert.ok(!md.includes("analytics"), "JS leaked:\n" + md);
  assert.ok(!md.includes("tracking"), "JS leaked:\n" + md);
  assert.match(md, /^#\s+Q3 Report/m, "heading missing:\n" + md);
  assert.ok(md.includes("Revenue rose 12%"));
});

test("html -> txt does not leak CSS or JavaScript into the body", async () => {
  const d = work();
  const src = path.join(d, "q3.html");
  fs.writeFileSync(src, PAGE);
  const txt = fs.readFileSync(await convert(src, "txt", d), "utf8");

  assert.ok(!txt.includes("font-weight"), "CSS leaked:\n" + txt);
  assert.ok(!txt.includes("analytics"), "JS leaked:\n" + txt);
  assert.ok(txt.includes("Q3 Report"));
  assert.ok(txt.includes("Revenue rose 12%"));
});

test("markdown with embedded <script> does not leak it", async () => {
  const d = work();
  const src = path.join(d, "evil.md");
  fs.writeFileSync(src, "# Title\n\n<script>steal()</script>\n\nBody text.\n");
  const md = fs.readFileSync(await convert(src, "txt", d), "utf8");
  assert.ok(!md.includes("steal"), "raw HTML script survived:\n" + md);
  assert.ok(md.includes("Body text"));
});

test("html -> html keeps a base href so relative images still resolve", async () => {
  const d = work();
  const srcdir = path.join(d, "site");
  fs.mkdirSync(srcdir);
  const src = path.join(srcdir, "page.html");
  fs.writeFileSync(src, PAGE);

  const html = fs.readFileSync(await convert(src, "html", d), "utf8");
  assert.match(html, /<base href="file:\/\/\/[^"]+\/">/, "no <base> tag:\n" + html.slice(0, 400));
  assert.ok(html.includes('<img src="chart.png">'), "image reference lost");
  // The title is preserved deliberately, not leaked as body text.
  assert.ok(html.includes("<title>Q3 Report</title>"));
});

test("md -> html -> md round-trips cleanly", async () => {
  const d = work();
  const src = path.join(d, "in.md");
  fs.writeFileSync(src, "# Heading One\n\nSome **bold** body text.\n\n- item a\n- item b\n");

  const html = await convert(src, "html", d);
  const back = path.join(d, "back.md");
  await tool.convert({ inputPath: html, outputPath: back, outputFormat: "md", options: {} });
  const md = fs.readFileSync(back, "utf8");

  assert.ok(!md.includes("font-family"), "app's own stylesheet leaked on round-trip:\n" + md);
  assert.match(md, /^#\s+Heading One/m);
  assert.ok(md.includes("**bold**"));
  assert.ok(/[-*]\s+item a/.test(md), md);
});

test("txt -> txt is not offered, and txt passes through byte-identical", async () => {
  assert.ok(tool.excludePairs.txt.includes("txt"), "txt->txt should be excluded");

  const d = work();
  const src = path.join(d, "notes.txt");
  const body = "line one\r\nline two\n\ttabbed\n";
  fs.writeFileSync(src, body);
  const out = await convert(src, "txt", d); // still works if invoked directly
  assert.strictEqual(fs.readFileSync(out, "utf8"), body, "plain text was mangled");
});

test("excludePairs hides every same-format pair", () => {
  for (const f of ["md", "html", "txt", "docx"]) {
    assert.ok(tool.excludePairs[f]?.includes(f), `${f} -> ${f} not excluded`);
  }
});

test("txt -> html escapes markup instead of executing it", async () => {
  const d = work();
  const src = path.join(d, "raw.txt");
  fs.writeFileSync(src, '<script>alert(1)</script> & <b>not bold</b>');
  const html = fs.readFileSync(await convert(src, "html", d), "utf8");
  assert.ok(!html.includes("<script>alert(1)</script>"), "unescaped script in output");
  assert.ok(html.includes("&lt;script&gt;"), html);
  assert.ok(html.includes("&amp;"));
});

test("md -> docx produces a real Word document with styles and tables", async () => {
  const d = work();
  const src = path.join(d, "s.md");
  fs.writeFileSync(src, "# Heading One\n\nSome **bold** text.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  const docx = await convert(src, "docx", d);

  const bytes = fs.readFileSync(docx);
  assert.ok(bytes.length > 1000, "suspiciously small docx");
  assert.strictEqual(bytes.subarray(0, 2).toString(), "PK", "not a zip container");

  const zip = path.join(d, "s.zip");
  fs.copyFileSync(docx, zip);
  const ex = path.join(d, "x");
  execFileSync("powershell", ["-NoProfile", "-Command",
    `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${ex}' -Force`]);
  const xml = fs.readFileSync(path.join(ex, "word", "document.xml"), "utf8");

  assert.ok(!/font-family:system-ui|max-width:46rem/.test(xml), "stylesheet leaked into docx");
  assert.match(xml, /w:pStyle w:val="Heading/i, "heading is not a real Word style");
  assert.match(xml, /<w:tbl>/, "table was lost");
  const text = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
  assert.ok(text.includes("Heading One"), text);
  assert.ok(text.includes("bold"), text);
});

test("unsupported input and output formats fail with a clear message", async () => {
  const d = work();
  const src = path.join(d, "thing.xyz");
  fs.writeFileSync(src, "x");
  await assert.rejects(
    () => convert(src, "md", d),
    /Unsupported input: \.xyz/
  );

  const ok = path.join(d, "a.md");
  fs.writeFileSync(ok, "# x");
  await assert.rejects(
    () => convert(ok, "epub", d),
    /Unsupported output: \.epub/
  );
});

test("progress is reported and ends at 1", async () => {
  const d = work();
  const src = path.join(d, "a.md");
  fs.writeFileSync(src, "# x");
  const seen = [];
  await tool.convert({
    inputPath: src, outputPath: path.join(d, "a.html"),
    outputFormat: "html", options: {}, onProgress: (f) => seen.push(f),
  });
  assert.ok(seen.length >= 2, "no progress reported");
  assert.strictEqual(seen.at(-1), 1);
});
