const test = require("node:test");
const assert = require("node:assert");
const { loadTools, describe } = require("../src/main/registry");

test("every tool in src/tools loads and is valid", () => {
  const tools = loadTools();
  assert.ok(tools.size >= 4, `only ${tools.size} tools loaded`);
  assert.ok(tools.has("document-convert"));
  assert.ok(tools.has("image-convert"));
});

test("describe() strips convert() and yields a JSON-safe view", () => {
  const tool = loadTools().get("document-convert");
  const view = describe(tool);
  assert.strictEqual(typeof view.convert, "undefined", "convert() leaked to the renderer");
  assert.doesNotThrow(() => JSON.stringify(view));
  assert.strictEqual(view.id, "document-convert");
  assert.ok(view.category);
});

test("describe() lowercases every format", () => {
  const view = describe({
    id: "t", name: "T", inputFormats: ["MD", "HtMl"], outputFormats: ["PDF"], convert() {},
  });
  assert.deepStrictEqual(view.inputFormats, ["md", "html"]);
  assert.deepStrictEqual(view.outputFormats, ["pdf"]);
});

test("describe() normalizes excludePairs and defaults it to {}", () => {
  const withPairs = describe({
    id: "t", name: "T", inputFormats: ["MD"], outputFormats: ["MD"],
    excludePairs: { MD: ["MD"] }, convert() {},
  });
  assert.deepStrictEqual(withPairs.excludePairs, { md: ["md"] });

  const without = describe({
    id: "u", name: "U", inputFormats: ["a"], outputFormats: ["b"], convert() {},
  });
  assert.deepStrictEqual(without.excludePairs, {});
});

test("describe() ignores a malformed excludePairs rather than crashing", () => {
  for (const bad of [null, "nope", 42, { md: "not-an-array" }]) {
    const view = describe({
      id: "t", name: "T", inputFormats: ["md"], outputFormats: ["pdf"],
      excludePairs: bad, convert() {},
    });
    assert.strictEqual(typeof view.excludePairs, "object");
  }
});

test("document-convert declares its same-format pairs as excluded", () => {
  const view = describe(loadTools().get("document-convert"));
  for (const f of ["md", "html", "txt", "docx"]) {
    assert.ok(view.excludePairs[f]?.includes(f), `${f} -> ${f} is still offered`);
  }
});

test("no two tools share an id, and every tool has a non-empty format list", () => {
  const tools = loadTools();
  for (const [id, t] of tools) {
    assert.strictEqual(t.id, id);
    assert.ok(t.inputFormats.length > 0, `${id} has no inputs`);
    assert.ok(t.outputFormats.length > 0, `${id} has no outputs`);
    assert.strictEqual(typeof t.convert, "function");
  }
});
