const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { outputPathFor, runBatch } = require("../src/main/convert");

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-test-"));
}

test("outputPathFor: two sources targeting one name do not collide", () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, "report.md"), "x");
  fs.writeFileSync(path.join(d, "report.html"), "x");
  const reserved = new Set();

  const a = outputPathFor(path.join(d, "report.md"), "pdf", d, reserved);
  const b = outputPathFor(path.join(d, "report.html"), "pdf", d, reserved);

  assert.notStrictEqual(a, b, "both sources reserved the same output path");
  assert.strictEqual(path.basename(a), "report.pdf");
  assert.strictEqual(path.basename(b), "report (1).pdf");
});

test("outputPathFor: reservation is case-insensitive (Windows/macOS FS)", () => {
  const d = tmpdir();
  const reserved = new Set();
  outputPathFor(path.join(d, "Report.md"), "pdf", d, reserved);
  const second = outputPathFor(path.join(d, "REPORT.html"), "pdf", d, reserved);
  assert.strictEqual(path.basename(second), "REPORT (1).pdf");
});

test("outputPathFor: never returns the input path itself", () => {
  const d = tmpdir();
  const input = path.join(d, "notes.txt");
  fs.writeFileSync(input, "x");
  const out = outputPathFor(input, "txt", d, new Set());
  assert.notStrictEqual(path.resolve(out), path.resolve(input));
  assert.strictEqual(path.basename(out), "notes (1).txt");
});

test("outputPathFor: steps past files already on disk", () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, "a.md"), "x");
  fs.writeFileSync(path.join(d, "a.pdf"), "existing");
  fs.writeFileSync(path.join(d, "a (1).pdf"), "existing");
  const out = outputPathFor(path.join(d, "a.md"), "pdf", d, new Set());
  assert.strictEqual(path.basename(out), "a (2).pdf");
});

test("outputPathFor: works without a reserved set (single conversions)", () => {
  const d = tmpdir();
  fs.writeFileSync(path.join(d, "a.md"), "x");
  const out = outputPathFor(path.join(d, "a.md"), "pdf", d);
  assert.strictEqual(path.basename(out), "a.pdf");
});

// ── runBatch ───────────────────────────────────────────────────

const okTool = {
  async convert({ outputPath, onProgress }) {
    onProgress?.(0.5);
    await fs.promises.writeFile(outputPath, "done");
    onProgress?.(1);
  },
};

test("runBatch: writes one output per input, no overwrites", async () => {
  const d = tmpdir();
  const files = ["report.md", "report.html", "report.txt"].map((n) => {
    const p = path.join(d, n);
    fs.writeFileSync(p, "x");
    return p;
  });

  const results = await runBatch({ tool: okTool, files, outputFormat: "pdf", outputDir: d, concurrency: 3 });

  assert.strictEqual(results.length, 3);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  const outs = new Set(results.map((r) => r.outputPath.toLowerCase()));
  assert.strictEqual(outs.size, 3, "outputs collided");
  for (const r of results) assert.ok(fs.existsSync(r.outputPath));
});

test("runBatch: a failing file does not abort the rest", async () => {
  const d = tmpdir();
  const files = ["a.md", "bad.md", "c.md"].map((n) => {
    const p = path.join(d, n);
    fs.writeFileSync(p, "x");
    return p;
  });
  const tool = {
    async convert({ inputPath, outputPath }) {
      if (path.basename(inputPath) === "bad.md") throw new Error("boom");
      await fs.promises.writeFile(outputPath, "done");
    },
  };

  const results = await runBatch({ tool, files, outputFormat: "pdf", outputDir: d, concurrency: 1 });
  assert.deepStrictEqual(results.map((r) => r.ok), [true, false, true]);
  assert.strictEqual(results[1].error, "boom");
});

test("runBatch: cancelling stops further work and marks the rest cancelled", async () => {
  const d = tmpdir();
  const files = Array.from({ length: 20 }, (_, i) => {
    const p = path.join(d, `f${i}.md`);
    fs.writeFileSync(p, "x");
    return p;
  });

  const controller = new AbortController();
  let converted = 0;
  const tool = {
    async convert({ outputPath }) {
      converted += 1;
      if (converted === 3) controller.abort();
      await fs.promises.writeFile(outputPath, "done");
    },
  };

  const results = await runBatch({
    tool, files, outputFormat: "pdf", outputDir: d, concurrency: 1,
    signal: controller.signal,
  });

  assert.ok(converted < files.length, `converted everything despite cancel (${converted})`);
  const cancelled = results.filter((r) => r.cancelled);
  assert.ok(cancelled.length > 0, "nothing was marked cancelled");
  assert.strictEqual(results.length, files.length, "results array must stay dense");
  assert.ok(results.every((r) => r), "sparse result slot");
});

test("runBatch: passes options and the signal through to the tool", async () => {
  const d = tmpdir();
  const p = path.join(d, "a.md");
  fs.writeFileSync(p, "x");
  let seen = null;
  const tool = {
    async convert(args) {
      seen = args;
      await fs.promises.writeFile(args.outputPath, "d");
    },
  };
  const controller = new AbortController();
  await runBatch({
    tool, files: [p], outputFormat: "pdf", outputDir: d,
    options: { pageSize: "A4" }, signal: controller.signal,
  });
  assert.strictEqual(seen.options.pageSize, "A4");
  assert.strictEqual(seen.signal, controller.signal);
  assert.strictEqual(seen.outputFormat, "pdf");
});

test("runBatch: reports progress with index and name", async () => {
  const d = tmpdir();
  const p = path.join(d, "doc.md");
  fs.writeFileSync(p, "x");
  const seen = [];
  await runBatch({
    tool: okTool, files: [p], outputFormat: "pdf", outputDir: d,
    onProgress: (x) => seen.push(x),
  });
  assert.ok(seen.length >= 2);
  assert.strictEqual(seen[0].index, 0);
  assert.strictEqual(seen[0].name, "doc.md");
});

test("runBatch: empty file list resolves without error", async () => {
  const results = await runBatch({ tool: okTool, files: [], outputFormat: "pdf" });
  assert.deepStrictEqual(results, []);
});
