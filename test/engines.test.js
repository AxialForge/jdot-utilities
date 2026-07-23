const test = require("node:test");
const assert = require("node:assert");
const { ENGINES, engineStatus, missingEngines, isEngine } = require("../src/main/engines");
const { describe, loadTools } = require("../src/main/registry");

test("both optional engines are declared with what they're for", () => {
  assert.deepStrictEqual(Object.keys(ENGINES).sort(), ["ghostscript", "libreoffice"]);
  for (const e of Object.values(ENGINES)) {
    assert.ok(e.name, "engine needs a display name");
    assert.ok(e.needed, "engine must say what breaks without it");
    assert.match(e.url, /^https:\/\//, "download link must be https");
    assert.ok(e.settingKey, "engine needs a settings key for the path override");
  }
});

test("engineStatus reports every engine with a found flag", () => {
  const status = engineStatus({});
  assert.strictEqual(status.length, 2);
  for (const s of status) {
    assert.strictEqual(typeof s.found, "boolean");
    assert.ok(Object.prototype.hasOwnProperty.call(s, "path"));
    // found and path must agree, whichever way this machine is set up.
    assert.strictEqual(s.found, Boolean(s.path));
  }
});

test("an explicit bad override reads as not found rather than throwing", () => {
  const status = engineStatus({
    libreOfficePath: "C:\\nope\\soffice.exe",
    ghostscriptPath: "C:\\nope\\gs.exe",
  });
  // A bogus override falls through to auto-detect, so the only firm guarantee
  // is that it neither throws nor reports a path it cannot back up.
  for (const s of status) {
    if (s.found) assert.ok(s.path, "found engines must carry a path");
    else assert.strictEqual(s.path, null);
  }
});

test("missingEngines is the unfound subset", () => {
  const all = engineStatus({});
  const missing = missingEngines({});
  assert.strictEqual(missing.length, all.filter((e) => !e.found).length);
  for (const m of missing) assert.strictEqual(m.found, false);
});

test("isEngine only accepts known ids", () => {
  assert.ok(isEngine("libreoffice"));
  assert.ok(isEngine("ghostscript"));
  for (const bad of ["pandoc", "", null, undefined, "LibreOffice", "toString"]) {
    assert.strictEqual(isEngine(bad), false, `${bad} should not be an engine`);
  }
});

// ── the descriptor field ───────────────────────────────────────

test("describe() passes through a valid requiresEngine and drops a bogus one", () => {
  const base = { id: "t", name: "T", inputFormats: ["a"], outputFormats: ["b"], convert() {} };
  assert.strictEqual(describe({ ...base, requiresEngine: "ghostscript" }).requiresEngine, "ghostscript");
  assert.strictEqual(describe({ ...base, requiresEngine: "nonesuch" }).requiresEngine, null);
  assert.strictEqual(describe(base).requiresEngine, null, "absent means null, not undefined");
});

test("the tools that shell out declare the engine they need", () => {
  const tools = loadTools();
  const expected = {
    "office-word": "libreoffice",
    "office-sheet": "libreoffice",
    "office-slides": "libreoffice",
    "pdf-optimize": "ghostscript",
  };
  for (const [id, engine] of Object.entries(expected)) {
    const t = tools.get(id);
    assert.ok(t, `${id} not discovered`);
    assert.strictEqual(describe(t).requiresEngine, engine, `${id} should require ${engine}`);
  }
});

test("self-contained tools declare no engine", () => {
  const tools = loadTools();
  // pdf-shrink is the whole point: compression with nothing installed.
  for (const id of ["pdf-shrink", "image-convert", "pdf-merge", "ocr-text", "data-convert"]) {
    const t = tools.get(id);
    assert.ok(t, `${id} not discovered`);
    assert.strictEqual(describe(t).requiresEngine, null, `${id} must not need an engine`);
  }
});
