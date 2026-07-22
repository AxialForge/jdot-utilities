const test = require("node:test");
const assert = require("node:assert");
const { loadTools, describe, validate, kindOf } = require("../src/main/registry");

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
    // convert kind implements convert(); collect/explode implement run().
    const impl = (t.kind || "convert") === "convert" ? t.convert : t.run;
    assert.strictEqual(typeof impl, "function", `${id} missing its handler`);
  }
});

// ── kinds ──────────────────────────────────────────────────────

test("kindOf defaults to convert and lowercases", () => {
  assert.strictEqual(kindOf({}), "convert");
  assert.strictEqual(kindOf({ kind: "Collect" }), "collect");
  assert.strictEqual(kindOf({ kind: "EXPLODE" }), "explode");
});

test("validate accepts a convert descriptor", () => {
  assert.strictEqual(
    validate({ id: "a", name: "A", inputFormats: ["x"], outputFormats: ["y"], convert() {} }),
    null
  );
});

test("validate accepts collect/explode descriptors that implement run()", () => {
  assert.strictEqual(
    validate({ id: "m", name: "M", kind: "collect", inputFormats: ["pdf"], outputFormats: ["pdf"], run() {} }),
    null
  );
  assert.strictEqual(
    validate({ id: "s", name: "S", kind: "explode", inputFormats: ["pdf"], outputFormats: ["pdf"], run() {} }),
    null
  );
});

test("validate rejects, with a reason, the ways a descriptor can be malformed", () => {
  const cases = [
    [{}, /missing id/],
    [{ id: "a" }, /missing name/],
    [{ id: "a", name: "A", inputFormats: [], outputFormats: ["y"], convert() {} }, /inputFormats/],
    [{ id: "a", name: "A", inputFormats: ["x"], outputFormats: [], convert() {} }, /outputFormats/],
    [{ id: "a", name: "A", kind: "frobnicate", inputFormats: ["x"], outputFormats: ["y"], run() {} }, /unknown kind/],
    [{ id: "a", name: "A", inputFormats: ["x"], outputFormats: ["y"] }, /needs a convert/],
    [{ id: "a", name: "A", kind: "collect", inputFormats: ["x"], outputFormats: ["y"] }, /needs a run/],
  ];
  for (const [desc, re] of cases) {
    const msg = validate(desc);
    assert.ok(msg && re.test(msg), `expected ${re} for ${JSON.stringify(desc)}, got ${msg}`);
  }
});

test("describe surfaces kind, ordered, minInputs and defaultName", () => {
  const merge = describe({
    id: "m", name: "Merge", kind: "collect", inputFormats: ["pdf"], outputFormats: ["pdf"],
    ordered: true, defaultName: "merged", run() {},
  });
  assert.strictEqual(merge.kind, "collect");
  assert.strictEqual(merge.ordered, true);
  assert.strictEqual(merge.minInputs, 2, "collect should default minInputs to 2");
  assert.strictEqual(merge.defaultName, "merged");

  const split = describe({
    id: "s", name: "Split", kind: "explode", inputFormats: ["pdf"], outputFormats: ["pdf"], run() {},
  });
  assert.strictEqual(split.kind, "explode");
  assert.strictEqual(split.minInputs, 1, "explode should default minInputs to 1");
  assert.strictEqual(split.ordered, false, "only collect is ordered");
});

test("pdf-merge is discovered as a collect tool", () => {
  const merge = loadTools().get("pdf-merge");
  assert.ok(merge, "pdf-merge.js was not auto-discovered");
  assert.strictEqual(kindOf(merge), "collect");
  const view = describe(merge);
  assert.strictEqual(view.ordered, true);
  assert.strictEqual(view.category, "PDF");
});
