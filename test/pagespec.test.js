const test = require("node:test");
const assert = require("node:assert");
const { parsePageSpec, pageIndices, complementIndices } = require("../src/main/pagespec");

test("single pages and lists", () => {
  assert.deepStrictEqual(parsePageSpec("1", 10), [1]);
  assert.deepStrictEqual(parsePageSpec("1,3,5", 10), [1, 3, 5]);
  assert.deepStrictEqual(parsePageSpec("5 3 1", 10), [1, 3, 5], "space-separated + sorted");
});

test("ranges are inclusive", () => {
  assert.deepStrictEqual(parsePageSpec("1-3", 10), [1, 2, 3]);
  assert.deepStrictEqual(parsePageSpec("2-2", 10), [2]);
});

test("open-ended ranges resolve against total", () => {
  assert.deepStrictEqual(parsePageSpec("8-", 10), [8, 9, 10]);
  assert.deepStrictEqual(parsePageSpec("-3", 10), [1, 2, 3]);
});

test("reversed ranges are normalized", () => {
  assert.deepStrictEqual(parsePageSpec("3-1", 10), [1, 2, 3]);
});

test("duplicates and overlaps collapse to a sorted unique set", () => {
  assert.deepStrictEqual(parsePageSpec("1-3, 2-4, 3", 10), [1, 2, 3, 4]);
});

test("mixed real-world spec", () => {
  assert.deepStrictEqual(parsePageSpec("1-3, 5, 8-", 10), [1, 2, 3, 5, 8, 9, 10]);
});

test("empty spec means all pages", () => {
  assert.deepStrictEqual(parsePageSpec("", 4), [1, 2, 3, 4]);
  assert.deepStrictEqual(parsePageSpec("   ", 3), [1, 2, 3]);
});

test("out-of-range numbers are an error, not clamped", () => {
  assert.throws(() => parsePageSpec("11", 10), /past the end/);
  assert.throws(() => parsePageSpec("5-20", 10), /past the end/);
  assert.throws(() => parsePageSpec("0", 10), /start at 1/);
});

test("garbage terms are rejected with the offending token", () => {
  assert.throws(() => parsePageSpec("1,abc,3", 10), /abc/);
  assert.throws(() => parsePageSpec("1--3", 10), /1--3/);
  assert.throws(() => parsePageSpec("-", 10), /"-"/);
});

test("open-ended range without a total is a clear error", () => {
  assert.throws(() => parsePageSpec("3-", undefined), /page count/i);
});

test("pageIndices returns 0-based indices", () => {
  assert.deepStrictEqual(pageIndices("1,3", 5), [0, 2]);
  assert.deepStrictEqual(pageIndices("2-4", 5), [1, 2, 3]);
});

test("complementIndices keeps everything not named (0-based)", () => {
  assert.deepStrictEqual(complementIndices("2", 4), [0, 2, 3]);
  assert.deepStrictEqual(complementIndices("1-2", 4), [2, 3]);
  assert.deepStrictEqual(complementIndices("1-4", 4), [], "deleting all leaves nothing");
});

test("single-page document edge cases", () => {
  assert.deepStrictEqual(parsePageSpec("1", 1), [1]);
  assert.throws(() => parsePageSpec("2", 1), /only 1 page\b/);
});
