// PDF-output smoke test. Must run under Electron, not node:
//   npx electron test/electron-pdf.js
// Exits 0 on success, 1 on failure, and prints a summary either way.
//
// Covers what test/document-convert.test.js cannot: htmlToPdf via the pooled
// offscreen windows, relative-asset resolution through <base href>, and that a
// concurrent batch reuses the pool instead of spawning a window per file.

const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const tool = require("../src/tools/document-convert");
const pdfrender = require("../src/main/pdfrender");
const { runBatch } = require("../src/main/convert");

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err.message]);
  }
}

// A PNG small enough to inline: 2x2 red square.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR42mP8z8Dwn4GBgYkBBjAAAB0EAwWk4YtIAAAAAElFTkSuQmCC",
  "base64"
);

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-epdf-"));
}

const isPdf = (p) => fs.readFileSync(p).subarray(0, 5).toString() === "%PDF-";

app.whenReady().then(async () => {
  await check("md -> pdf produces a valid PDF", async () => {
    const d = work();
    const src = path.join(d, "a.md");
    fs.writeFileSync(src, "# Title\n\nBody paragraph with **bold**.\n");
    const out = path.join(d, "a.pdf");
    await tool.convert({ inputPath: src, outputPath: out, outputFormat: "pdf", options: {} });
    assert.ok(fs.existsSync(out), "no output file");
    assert.ok(isPdf(out), "output is not a PDF");
    assert.ok(fs.statSync(out).size > 800, "PDF suspiciously small: " + fs.statSync(out).size);
  });

  await check("html -> pdf resolves a relative image via <base href>", async () => {
    const d = work();
    // A real 240x240 raster, so an embedded copy is unmistakable in the output.
    // sharp is already a dependency; no fixture file needed.
    const sharp = require("sharp");
    await sharp({
      create: { width: 240, height: 240, channels: 3, background: { r: 220, g: 40, b: 40 } },
    }).png().toFile(path.join(d, "logo.png"));

    const src = path.join(d, "page.html");
    fs.writeFileSync(src, '<h1>With image</h1><img src="logo.png" width="240">');
    const withImg = path.join(d, "with.pdf");
    await tool.convert({ inputPath: src, outputPath: withImg, outputFormat: "pdf", options: {} });

    const src2 = path.join(d, "page2.html");
    fs.writeFileSync(src2, '<h1>With image</h1><img src="missing.png" width="240">');
    const without = path.join(d, "without.pdf");
    await tool.convert({ inputPath: src2, outputPath: without, outputFormat: "pdf", options: {} });

    assert.ok(isPdf(withImg) && isPdf(without));

    // Presence of an image XObject alone proves nothing: Chromium embeds a 14x16
    // broken-image placeholder icon when a src fails to load. Match on the actual
    // dimensions of the raster we created instead.
    const dimsOf = (f) =>
      [...fs.readFileSync(f, "latin1").matchAll(/\/Width\s+(\d+)[\s\S]{0,120}?\/Height\s+(\d+)/g)]
        .map((m) => `${m[1]}x${m[2]}`);

    const got = dimsOf(withImg);
    const control = dimsOf(without);
    assert.ok(
      got.includes("240x240"),
      `relative <img> did not resolve — embedded images were ${JSON.stringify(got)}`
    );
    assert.ok(
      !control.includes("240x240"),
      "control PDF embedded the image too; test cannot distinguish"
    );
  });

  await check("pageSize and landscape reach printToPDF", async () => {
    const d = work();
    const src = path.join(d, "a.md");
    fs.writeFileSync(src, "# Orientation test\n");
    const p = path.join(d, "p.pdf");
    const l = path.join(d, "l.pdf");
    await tool.convert({ inputPath: src, outputPath: p, outputFormat: "pdf", options: { pageSize: "A4" } });
    await tool.convert({ inputPath: src, outputPath: l, outputFormat: "pdf", options: { pageSize: "A4", landscape: true } });

    // Read the first /MediaBox of each and compare aspect.
    const boxOf = (f) => {
      const m = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(fs.readFileSync(f, "latin1"));
      assert.ok(m, "no MediaBox in " + path.basename(f));
      return { w: Number(m[1]), h: Number(m[2]) };
    };
    const pb = boxOf(p);
    const lb = boxOf(l);
    assert.ok(pb.h > pb.w, `portrait not portrait: ${JSON.stringify(pb)}`);
    assert.ok(lb.w > lb.h, `landscape not landscape: ${JSON.stringify(lb)}`);
  });

  await check("a 12-file batch reuses the window pool", async () => {
    const { BrowserWindow } = require("electron");
    const d = work();
    const files = Array.from({ length: 12 }, (_, i) => {
      const p = path.join(d, `f${i}.md`);
      fs.writeFileSync(p, `# Doc ${i}\n\nSome body text for document ${i}.\n`);
      return p;
    });

    const before = BrowserWindow.getAllWindows().length;
    let peak = before;
    const timer = setInterval(() => {
      peak = Math.max(peak, BrowserWindow.getAllWindows().length);
    }, 5);

    const res = await runBatch({
      tool, files, outputFormat: "pdf", outputDir: d, concurrency: 4,
    });
    clearInterval(timer);

    const failed = res.filter((r) => !r.ok);
    assert.strictEqual(failed.length, 0, "failures: " + JSON.stringify(failed.slice(0, 3)));
    for (const r of res) assert.ok(isPdf(r.outputPath), "bad PDF: " + r.outputPath);

    const added = peak - before;
    assert.ok(
      added <= pdfrender.POOL_SIZE,
      `pool leaked: peak added ${added} windows for 12 files (POOL_SIZE=${pdfrender.POOL_SIZE})`
    );
  });

  await check("outputs in one batch never collide", async () => {
    const d = work();
    // Three different sources that all want report.pdf.
    fs.writeFileSync(path.join(d, "report.md"), "# From markdown\n");
    fs.writeFileSync(path.join(d, "report.html"), "<h1>From html</h1>");
    fs.writeFileSync(path.join(d, "report.txt"), "From text");
    const files = ["report.md", "report.html", "report.txt"].map((f) => path.join(d, f));

    const res = await runBatch({ tool, files, outputFormat: "pdf", outputDir: d, concurrency: 3 });
    assert.ok(res.every((r) => r.ok), JSON.stringify(res));
    const outs = new Set(res.map((r) => r.outputPath.toLowerCase()));
    assert.strictEqual(outs.size, 3, "outputs collided: " + [...outs].join(", "));
    for (const r of res) assert.ok(isPdf(r.outputPath));
  });

  pdfrender.shutdown();

  const failures = results.filter((r) => r[0] === "FAIL");
  console.log("\n── Electron PDF smoke test ──");
  for (const [status, name, msg] of results) {
    console.log(`${status === "PASS" ? "  ok" : "FAIL"}  ${name}${msg ? "\n        " + msg : ""}`);
  }
  console.log(`\n${results.length - failures.length}/${results.length} passed\n`);
  app.exit(failures.length ? 1 : 0);
});
