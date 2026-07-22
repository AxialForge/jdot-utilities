// Integration smoke test for the collect/explode path under Electron, exercising
// the same ops.js runners main.js calls (minus the dialogs).
//   npx electron test/electron-ops.js

const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");
const { PDFDocument, StandardFonts } = require("pdf-lib");

const { loadTools, kindOf } = require("../src/main/registry");
const { runCollect } = require("../src/main/ops");

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(["PASS", name]); }
  catch (err) { results.push(["FAIL", name, err.message]); }
}

async function makePdf(file, n) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i += 1) doc.addPage([200, 200]).drawText(`p${i}`, { x: 20, y: 100, size: 20, font });
  await fs.promises.writeFile(file, await doc.save());
  return file;
}

app.whenReady().then(async () => {
  const tools = loadTools();

  await check("pdf-merge is a discovered collect tool", async () => {
    const t = tools.get("pdf-merge");
    assert.ok(t, "not discovered");
    assert.strictEqual(kindOf(t), "collect");
  });

  await check("running pdf-merge through runCollect produces a merged PDF", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-eops-"));
    const a = await makePdf(path.join(d, "a.pdf"), 2);
    const b = await makePdf(path.join(d, "b.pdf"), 3);
    const out = path.join(d, "merged.pdf");

    const res = await runCollect({ tool: tools.get("pdf-merge"), files: [a, b], outputPath: out });
    assert.ok(res.ok, JSON.stringify(res));
    assert.strictEqual(res.pages, 5);
    assert.deepStrictEqual(res.outputs, [out]);
    assert.ok(fs.existsSync(out));

    const reopened = await PDFDocument.load(await fs.promises.readFile(out), { updateMetadata: false });
    assert.strictEqual(reopened.getPageCount(), 5);
  });

  await check("runCollect via pdf-merge refuses to overwrite an input", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-eops-"));
    const a = await makePdf(path.join(d, "a.pdf"), 1);
    const b = await makePdf(path.join(d, "b.pdf"), 1);
    const res = await runCollect({ tool: tools.get("pdf-merge"), files: [a, b], outputPath: a });
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /isn't one of the inputs/);
  });

  const failures = results.filter((r) => r[0] === "FAIL");
  console.log("\n── Electron ops smoke test ──");
  for (const [status, name, msg] of results) {
    console.log(`${status === "PASS" ? "  ok" : "FAIL"}  ${name}${msg ? "\n        " + msg : ""}`);
  }
  console.log(`\n${results.length - failures.length}/${results.length} passed\n`);
  app.exit(failures.length ? 1 : 0);
});
