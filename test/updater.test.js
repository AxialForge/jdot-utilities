// Version comparison for the manual updater. The download/install path can only
// be exercised against two real published builds, but the comparator is pure and
// is where an off-by-one silently offers the wrong build — so it gets thorough
// coverage here. Requiring the module also proves it loads without an Electron
// runtime (it must not touch autoUpdater at import time).

const test = require("node:test");
const assert = require("node:assert");
const { compareVersions, isNewer, parseVersion } = require("../src/main/updater");

test("the module loads outside Electron without side effects", () => {
  // If configure()/autoUpdater ran at import, requiring this in plain node would
  // throw. It didn't (we got here), so just assert the surface is intact.
  assert.strictEqual(typeof compareVersions, "function");
  assert.strictEqual(typeof isNewer, "function");
});

test("parseVersion tolerates a leading v, missing parts, and junk", () => {
  assert.deepStrictEqual(parseVersion("1.2.3").nums, [1, 2, 3]);
  assert.deepStrictEqual(parseVersion("v1.2.3").nums, [1, 2, 3]);
  assert.deepStrictEqual(parseVersion("1.2").nums, [1, 2, 0]);
  assert.deepStrictEqual(parseVersion("2").nums, [2, 0, 0]);
  assert.deepStrictEqual(parseVersion("").nums, [0, 0, 0]);
  assert.deepStrictEqual(parseVersion(null).nums, [0, 0, 0]);
  assert.strictEqual(parseVersion("1.2.3-beta.4").pre, "beta.4");
});

test("orders by major, then minor, then patch", () => {
  assert.strictEqual(compareVersions("2.0.0", "1.9.9"), 1);
  assert.strictEqual(compareVersions("1.2.0", "1.1.9"), 1);
  assert.strictEqual(compareVersions("1.1.2", "1.1.1"), 1);
  assert.strictEqual(compareVersions("1.1.1", "1.1.2"), -1);
  assert.strictEqual(compareVersions("1.1.1", "1.1.1"), 0);
});

test("does not fall for numeric string ordering (10 > 9)", () => {
  // The classic bug: "1.10.0" sorts before "1.9.0" as strings. It must not here.
  assert.strictEqual(compareVersions("1.10.0", "1.9.0"), 1);
  assert.strictEqual(compareVersions("1.9.0", "1.10.0"), -1);
  assert.strictEqual(compareVersions("2.0.0", "1.100.100"), 1);
});

test("a leading v on either side doesn't matter", () => {
  assert.strictEqual(compareVersions("v1.2.0", "1.1.0"), 1);
  assert.strictEqual(compareVersions("1.2.0", "v1.2.0"), 0);
});

test("a pre-release is lower than its final release", () => {
  assert.strictEqual(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.strictEqual(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.strictEqual(compareVersions("1.0.0-alpha", "1.0.0-beta"), -1);
});

test("isNewer only reports a strictly greater version", () => {
  assert.strictEqual(isNewer("1.1.2", "1.1.1"), true, "patch bump is newer");
  assert.strictEqual(isNewer("1.1.1", "1.1.1"), false, "same is not newer");
  assert.strictEqual(isNewer("1.1.0", "1.1.1"), false, "older is not newer");
  // The guard this exists for: a feed offering an older or equal build must be
  // rejected, so the app never 'updates' backwards.
  assert.strictEqual(isNewer("1.0.0", "1.1.1"), false, "must refuse a downgrade");
});

test("realistic release progression is strictly increasing", () => {
  const releases = ["0.5.0", "0.5.1", "0.6.0", "0.7.0", "0.7.1", "0.7.2", "0.8.0", "1.0.0", "1.1.0", "1.1.1"];
  for (let i = 1; i < releases.length; i += 1) {
    assert.strictEqual(
      compareVersions(releases[i], releases[i - 1]),
      1,
      `${releases[i]} should be newer than ${releases[i - 1]}`
    );
  }
});
