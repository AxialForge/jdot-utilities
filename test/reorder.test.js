// Drag-to-reorder moves an item from one index to another. The index bookkeeping
// after the splice-removal is easy to get subtly wrong (off by one when dragging
// downward), so the real moveJobTo from index.html is lifted out and exercised
// rather than re-implemented here.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER = path.join(__dirname, "..", "src", "renderer", "index.html");

// Run the real moveJobTo against a plain array standing in for C.jobs.
function loadMover() {
  const html = fs.readFileSync(RENDERER, "utf8");
  const start = html.indexOf("function moveJobTo(");
  assert.notStrictEqual(start, -1, "moveJobTo not found — was it renamed?");
  let depth = 0, end = -1;
  for (let j = html.indexOf("{", start); j < html.length; j += 1) {
    if (html[j] === "{") depth += 1;
    else if (html[j] === "}") { depth -= 1; if (depth === 0) { end = j + 1; break; } }
  }
  const src = html.slice(start, end);

  const ctx = vm.createContext({ C: null, renderQueue() {} });
  vm.runInContext(src, ctx);
  const move = vm.runInContext("moveJobTo", ctx);

  return (arr, from, to) => {
    ctx.C = { jobs: arr };
    move(from, to);
    return ctx.C.jobs;
  };
}
const move = loadMover();
const ids = (arr) => arr.map((x) => x.id ?? x);

test("drag downward lands the item after the drop target", () => {
  // [A B C D], drag A (0) to below C: drop index 3 -> [B C A D]
  assert.deepStrictEqual(ids(move(["A", "B", "C", "D"], 0, 3)), ["B", "C", "A", "D"]);
});

test("drag upward lands the item before the drop target", () => {
  // [A B C D], drag D (3) to above B: drop index 1 -> [A D B C]
  assert.deepStrictEqual(ids(move(["A", "B", "C", "D"], 3, 1)), ["A", "D", "B", "C"]);
});

test("drag to the very top", () => {
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 2, 0)), ["C", "A", "B"]);
});

test("drag to the very bottom", () => {
  // dropping past the last element -> index 3 on a 3-item list
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 0, 3)), ["B", "C", "A"]);
});

test("dropping an item back onto itself is a no-op", () => {
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 1, 1)), ["A", "B", "C"]);
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 1, 2)), ["A", "B", "C"], "just below itself = no move");
});

test("adjacent swaps both directions", () => {
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 0, 2)), ["B", "A", "C"], "A down one");
  assert.deepStrictEqual(ids(move(["A", "B", "C"], 2, 1)), ["A", "C", "B"], "C up one");
});

test("out-of-range indices are ignored, list unchanged", () => {
  assert.deepStrictEqual(ids(move(["A", "B"], 5, 0)), ["A", "B"]);
  assert.deepStrictEqual(ids(move(["A", "B"], -1, 0)), ["A", "B"]);
});

test("no element is ever lost or duplicated, over every from/to pair", () => {
  const base = ["A", "B", "C", "D", "E"];
  for (let from = 0; from < base.length; from += 1) {
    for (let to = 0; to <= base.length; to += 1) {
      const out = move(base.slice(), from, to);
      assert.strictEqual(out.length, base.length, `length changed for ${from}->${to}`);
      assert.deepStrictEqual([...out].sort(), [...base].sort(), `set changed for ${from}->${to}`);
    }
  }
});
