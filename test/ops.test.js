const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runCollect, runExplode, freePath } = require("../src/main/ops");

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ops-"));
}
function touch(p, body = "x") {
  fs.writeFileSync(p, body);
  return p;
}

// ── freePath ───────────────────────────────────────────────────

test("freePath steps past existing files and reservations", () => {
  const d = work();
  touch(path.join(d, "page.pdf"));
  const reserved = new Set();
  const a = freePath(d, "page", "pdf", reserved);
  assert.strictEqual(path.basename(a), "page (1).pdf");
  const b = freePath(d, "page", "pdf", reserved);
  assert.strictEqual(path.basename(b), "page (2).pdf", "reservation not honored");
});

// ── runCollect ─────────────────────────────────────────────────

const catTool = {
  minInputs: 2,
  async run({ inputPaths, outputPath, onProgress }) {
    const parts = [];
    for (let i = 0; i < inputPaths.length; i += 1) {
      parts.push(fs.readFileSync(inputPaths[i], "utf8"));
      onProgress?.((i + 1) / inputPaths.length);
    }
    fs.writeFileSync(outputPath, parts.join(""));
    return { warnings: [], joined: inputPaths.length };
  },
};

test("runCollect writes the chosen output and passes info through", async () => {
  const d = work();
  const files = [touch(path.join(d, "a.txt"), "A"), touch(path.join(d, "b.txt"), "B")];
  const out = path.join(d, "joined.txt");
  const res = await runCollect({ tool: catTool, files, outputPath: out });

  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(fs.readFileSync(out, "utf8"), "AB");
  assert.strictEqual(res.joined, 2);
  assert.deepStrictEqual(res.outputs, [out]);
});

test("runCollect enforces minInputs", async () => {
  const d = work();
  const res = await runCollect({ tool: catTool, files: [touch(path.join(d, "a.txt"))], outputPath: path.join(d, "o.txt") });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /at least 2/);
});

test("runCollect refuses to overwrite one of its inputs", async () => {
  const d = work();
  const a = touch(path.join(d, "a.txt"), "A");
  const b = touch(path.join(d, "b.txt"), "B");
  const res = await runCollect({ tool: catTool, files: [a, b], outputPath: a });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /isn't one of the inputs/);
  assert.strictEqual(fs.readFileSync(a, "utf8"), "A", "input was clobbered");
});

test("runCollect reports a tool error instead of throwing", async () => {
  const d = work();
  const boom = { minInputs: 2, async run() { throw new Error("kaboom"); } };
  const files = [touch(path.join(d, "a.txt")), touch(path.join(d, "b.txt"))];
  const res = await runCollect({ tool: boom, files, outputPath: path.join(d, "o.txt") });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "kaboom");
});

test("runCollect surfaces cancellation", async () => {
  const d = work();
  const controller = new AbortController();
  const slow = {
    minInputs: 2,
    async run({ outputPath, signal }) {
      controller.abort();
      fs.writeFileSync(outputPath, "partial");
      assert.ok(signal.aborted);
    },
  };
  const files = [touch(path.join(d, "a.txt")), touch(path.join(d, "b.txt"))];
  const res = await runCollect({ tool: slow, files, outputPath: path.join(d, "o.txt"), signal: controller.signal });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.cancelled, true);
});

// ── runExplode ─────────────────────────────────────────────────

// Splits a text file into one output per line, naming them via allocate().
const lineSplitter = {
  async run({ inputPath, allocate, onProgress }) {
    const lines = fs.readFileSync(inputPath, "utf8").split(/\r?\n/).filter(Boolean);
    const outputs = [];
    lines.forEach((line, i) => {
      const p = allocate(String(i + 1).padStart(2, "0"), "txt");
      fs.writeFileSync(p, line);
      outputs.push(p);
      onProgress?.((i + 1) / lines.length);
    });
    return { outputs };
  },
};

test("runExplode writes many outputs into the target dir", async () => {
  const d = work();
  const src = touch(path.join(d, "poem.txt"), "one\ntwo\nthree\n");
  const outDir = path.join(d, "out");
  const res = await runExplode({ tool: lineSplitter, file: src, outputDir: outDir });

  assert.strictEqual(res.ok, true, JSON.stringify(res));
  assert.strictEqual(res.outputs.length, 3);
  for (const p of res.outputs) assert.ok(fs.existsSync(p), "missing " + p);
  const names = res.outputs.map((p) => path.basename(p)).sort();
  assert.deepStrictEqual(names, ["poem-01.txt", "poem-02.txt", "poem-03.txt"]);
});

test("runExplode creates the output dir if it does not exist", async () => {
  const d = work();
  const src = touch(path.join(d, "x.txt"), "a\nb\n");
  const nested = path.join(d, "deep", "nested", "here");
  const res = await runExplode({ tool: lineSplitter, file: src, outputDir: nested });
  assert.strictEqual(res.ok, true);
  assert.ok(fs.existsSync(nested));
});

test("runExplode allocate() avoids collisions across two runs into one dir", async () => {
  const d = work();
  const src = touch(path.join(d, "x.txt"), "a\nb\n");
  const outDir = path.join(d, "out");
  const first = await runExplode({ tool: lineSplitter, file: src, outputDir: outDir });
  const second = await runExplode({ tool: lineSplitter, file: src, outputDir: outDir });
  const all = [...first.outputs, ...second.outputs].map((p) => p.toLowerCase());
  assert.strictEqual(new Set(all).size, all.length, "second run clobbered the first");
});

test("runExplode fails clearly when the tool yields nothing", async () => {
  const d = work();
  const empty = { async run() { return { outputs: [] }; } };
  const res = await runExplode({ tool: empty, file: touch(path.join(d, "x.txt")), outputDir: d });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /no output/i);
});

test("runExplode reports a tool error instead of throwing", async () => {
  const d = work();
  const boom = { async run() { throw new Error("split failed"); } };
  const res = await runExplode({ tool: boom, file: touch(path.join(d, "x.txt")), outputDir: d });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, "split failed");
});
