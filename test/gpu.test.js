const test = require("node:test");
const assert = require("node:assert");
const { shouldDisableGpu, isPersistentSafeMode } = require("../src/main/gpu");

test("acceleration stays on for the default 'auto' setting", () => {
  assert.strictEqual(shouldDisableGpu({ setting: "auto", argv: [], env: {} }), false);
  assert.strictEqual(shouldDisableGpu({ setting: "on", argv: [], env: {} }), false);
});

test("the stored 'off' setting disables acceleration", () => {
  assert.strictEqual(shouldDisableGpu({ setting: "off", argv: [], env: {} }), true);
});

test("no-UI escape hatches disable acceleration regardless of the setting", () => {
  const on = "auto";
  assert.strictEqual(shouldDisableGpu({ setting: on, argv: ["--safe-mode"] }), true);
  assert.strictEqual(shouldDisableGpu({ setting: on, argv: ["--disable-gpu"] }), true);
  assert.strictEqual(shouldDisableGpu({ setting: on, argv: [], env: { JDOT_DISABLE_GPU: "1" } }), true);
});

test("unrelated flags/env do not disable acceleration", () => {
  assert.strictEqual(shouldDisableGpu({ setting: "auto", argv: ["--foo", "file.pdf"], env: { PATH: "/x" } }), false);
});

test("shouldDisableGpu tolerates being called with no arguments", () => {
  assert.strictEqual(shouldDisableGpu(), false);
  assert.strictEqual(shouldDisableGpu({}), false);
});

test("--safe-mode and the env var are persistent; --disable-gpu is a one-off", () => {
  assert.strictEqual(isPersistentSafeMode({ argv: ["--safe-mode"] }), true);
  assert.strictEqual(isPersistentSafeMode({ argv: [], env: { JDOT_DISABLE_GPU: "1" } }), true);
  assert.strictEqual(isPersistentSafeMode({ argv: ["--disable-gpu"] }), false);
  assert.strictEqual(isPersistentSafeMode({}), false);
});
