// The page picker converts between a typed range ("1-3, 5") and a set of
// selected pages, in both directions. Getting it wrong silently deletes or keeps
// the wrong pages, so it needs real coverage.
//
// The renderer is a single no-build HTML file whose script is wrapped in a
// function, so these helpers can't be imported and can't be reached from a
// console. Rather than keep a second copy here (which would drift from the one
// that actually ships), the functions are lifted out of index.html and run as-is.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER = path.join(__dirname, "..", "src", "renderer", "index.html");

function loadHelpers() {
  const html = fs.readFileSync(RENDERER, "utf8");
  // Grab each function declaration by name, brace-matching to its end.
  const pick = (name) => {
    const start = html.indexOf(`function ${name}(`);
    assert.notStrictEqual(start, -1, `${name}() not found in index.html — was it renamed?`);
    let i = html.indexOf("{", start);
    let depth = 0;
    for (let j = i; j < html.length; j += 1) {
      if (html[j] === "{") depth += 1;
      else if (html[j] === "}") {
        depth -= 1;
        if (depth === 0) return html.slice(start, j + 1);
      }
    }
    throw new Error(`unbalanced braces reading ${name}()`);
  };

  const ctx = vm.createContext({});
  vm.runInContext(`${pick("specToSet")}\n${pick("setToSpec")}\n`, ctx);
  return {
    specToSet: (s, total) => vm.runInContext("specToSet", ctx)(s, total),
    setToSpec: (set) => vm.runInContext("setToSpec", ctx)(set),
  };
}

const { specToSet, setToSpec } = loadHelpers();
const asArray = (s, total = 10) => [...specToSet(s, total)].sort((a, b) => a - b);

// ── spec -> selection ──────────────────────────────────────────

test("parses single pages and ranges", () => {
  assert.deepStrictEqual(asArray("1"), [1]);
  assert.deepStrictEqual(asArray("1-3"), [1, 2, 3]);
  assert.deepStrictEqual(asArray("1-3,5"), [1, 2, 3, 5]);
  assert.deepStrictEqual(asArray("2, 4 , 6"), [2, 4, 6], "whitespace should not matter");
});

test("an open-ended range runs to the last page", () => {
  assert.deepStrictEqual(asArray("7-", 9), [7, 8, 9]);
});

test("a backwards range is read as the range the user meant", () => {
  assert.deepStrictEqual(asArray("5-3"), [3, 4, 5]);
});

test("pages outside the document are ignored", () => {
  assert.deepStrictEqual(asArray("3,99", 5), [3], "page 99 of a 5-page file isn't real");
  assert.deepStrictEqual(asArray("0,1", 5), [1], "there is no page 0");
  assert.deepStrictEqual(asArray("4-99", 5), [4, 5], "a range clamps to the end");
});

test("junk and half-typed input yield no selection rather than throwing", () => {
  for (const bad of ["", "   ", ",,,", "abc", "-", "1-,", null, undefined]) {
    assert.doesNotThrow(() => specToSet(bad, 10), `threw on ${JSON.stringify(bad)}`);
  }
  assert.deepStrictEqual(asArray("abc"), []);
  // Mid-typing "12-" must not be read as page 12 only.
  assert.deepStrictEqual(asArray("8-", 10), [8, 9, 10]);
});

test("duplicates and overlaps collapse", () => {
  assert.deepStrictEqual(asArray("1,1,2-3,3"), [1, 2, 3]);
});

// ── selection -> spec ──────────────────────────────────────────

test("collapses consecutive pages into ranges", () => {
  assert.strictEqual(setToSpec(new Set([1, 2, 3])), "1-3");
  assert.strictEqual(setToSpec(new Set([1, 2, 3, 5])), "1-3, 5");
  assert.strictEqual(setToSpec(new Set([2, 4, 6])), "2, 4, 6");
  assert.strictEqual(setToSpec(new Set([1, 2, 5, 6, 7, 10])), "1-2, 5-7, 10");
});

test("handles empty and single selections", () => {
  assert.strictEqual(setToSpec(new Set()), "");
  assert.strictEqual(setToSpec(new Set([4])), "4");
});

test("out-of-order clicks still produce an ordered spec", () => {
  // Clicking pages 5, 1, 3, 2 inserts in that order; the field must read "1-3, 5".
  assert.strictEqual(setToSpec(new Set([5, 1, 3, 2])), "1-3, 5");
});

// ── round trip ─────────────────────────────────────────────────

test("selection survives a round trip through the text field", () => {
  const cases = [[1], [1, 2, 3], [1, 3, 5, 7], [2, 3, 4, 9, 10], [10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]];
  for (const pages of cases) {
    const spec = setToSpec(new Set(pages));
    assert.deepStrictEqual(asArray(spec, 10), pages, `round trip failed for ${spec}`);
  }
});

test("every subset of a small document round-trips exactly", () => {
  // Exhaustive over 6 pages: 64 subsets, so no edge case hides.
  const total = 6;
  for (let mask = 0; mask < 1 << total; mask += 1) {
    const pages = [];
    for (let b = 0; b < total; b += 1) if (mask & (1 << b)) pages.push(b + 1);
    const spec = setToSpec(new Set(pages));
    assert.deepStrictEqual(asArray(spec, total), pages, `mask ${mask} -> "${spec}"`);
  }
});
