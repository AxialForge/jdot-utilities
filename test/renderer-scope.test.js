// Guards the renderer against a whole-app-killing startup crash.
//
// preload.js publishes the bridge with contextBridge.exposeInMainWorld("api"),
// which defines `api` as a NON-CONFIGURABLE property of the global object. The
// spec forbids a top-level `const`/`let` from shadowing such a property, so a
// global `const api = ...` throws
//     SyntaxError: Identifier 'api' has already been declared
// before a single statement runs — taking out the tool list, the version chip,
// and every click handler at once. That shipped in v0.7.0.
//
// It is invisible to ordinary UI testing: a plain browser has no window.api, so
// there is nothing to collide with and the page looks perfectly healthy. The
// only way to catch it is to recreate the collision, which is what this does.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RENDERER = path.join(__dirname, "..", "src", "renderer", "index.html");
const PRELOAD = path.join(__dirname, "..", "src", "main", "preload.js");

// Every name preload puts on the global object via contextBridge.
function exposedKeys() {
  const src = fs.readFileSync(PRELOAD, "utf8");
  const keys = [...src.matchAll(/exposeInMainWorld\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
  assert.ok(keys.length, "found no exposeInMainWorld call — has preload.js moved?");
  return keys;
}

// The renderer's inline script, which is the whole UI.
function rendererScript() {
  const html = fs.readFileSync(RENDERER, "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(blocks.length, "no inline <script> found in index.html");
  return blocks.reduce((a, b) => (b.length > a.length ? b : a));
}

test("preload exposes the bridge the renderer expects", () => {
  assert.ok(exposedKeys().includes("api"), "preload should still expose `api`");
});

test("the renderer script survives the contextBridge globals", () => {
  const code = rendererScript();

  for (const key of exposedKeys()) {
    // Recreate what contextBridge does: a non-configurable global property.
    const sandbox = {};
    const ctx = vm.createContext(sandbox);
    vm.runInContext(
      `Object.defineProperty(globalThis, ${JSON.stringify(key)}, ` +
        `{ value: {}, writable: false, enumerable: true, configurable: false });`,
      ctx
    );

    let err = null;
    try {
      vm.runInContext(code, ctx, { timeout: 5000 });
    } catch (e) {
      err = e;
    }

    // The script is expected to fail here — there is no DOM in this sandbox, so
    // it dies on `window`/`document`. That is fine and not what we're testing.
    // What must never happen is dying during global declaration instantiation,
    // which aborts the file before any statement runs.
    if (err) {
      assert.ok(
        !/has already been declared/i.test(err.message),
        `renderer collides with the "${key}" bridge and will not start: ${err.message}\n` +
          "Keep the script's declarations inside the wrapper function."
      );
      assert.notStrictEqual(
        err.constructor.name,
        "SyntaxError",
        `renderer failed to parse/instantiate: ${err.message}`
      );
    }
  }
});

test("the renderer declares nothing at global scope", () => {
  // The wrapper is what makes the app immune to this class of collision, for
  // every current and future bridge key. Verify it is actually in place rather
  // than trusting the name `api` specifically.
  const code = rendererScript();
  const sandbox = {};
  const ctx = vm.createContext(sandbox);
  try {
    vm.runInContext(code, ctx, { timeout: 5000 });
  } catch {
    // Expected: no DOM in the sandbox.
  }
  const leaked = Object.keys(sandbox);
  assert.deepStrictEqual(
    leaked,
    [],
    `renderer leaked ${leaked.length} global(s) (${leaked.slice(0, 5).join(", ")}…). ` +
      "Anything at global scope can collide with a contextBridge key and kill the script."
  );
});
