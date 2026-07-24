// Offline guarantee smoke test. Must run under Electron, not node:
//   npx electron test/electron-offline.js
// Exits 0 on success, 1 on failure.
//
// The app's central promise is that it makes no network calls. The HTML->PDF
// path is the one place that promise can leak, because rendering runs real
// Chromium over a document the user did not write. `javascript: false` stops
// scripts from executing but does NOT stop the resource loader from fetching
// remote URLs named in markup, so before this was fixed, converting a document
// containing a hotlinked image quietly phoned home — a read receipt for whoever
// sent it. pdfrender.js now runs its pool in a session that refuses every
// non-local scheme.
//
// This has to run under Electron (it needs a real BrowserWindow and session),
// which is why it can't live in `npm test`.

const { app, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert");

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (err) {
    results.push(["FAIL", name, err.message]);
  }
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const { renderPdf, RENDER_PARTITION, shutdown } = require("../src/main/pdfrender");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-offline-"));

  // A real local image, reached through the injected <base href>.
  const sharp = require("sharp");
  const localPng = path.join(dir, "logo.png");
  await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 200, g: 30, b: 60 } } })
    .png()
    .toFile(localPng);

  // Watch the render session. pdfrender installs its block when it first builds
  // a window, so these observers only report what actually happened.
  const seen = [];
  const s = session.fromPartition(RENDER_PARTITION);
  s.webRequest.onCompleted((d) => seen.push({ url: d.url, loaded: true }));
  s.webRequest.onErrorOccurred((d) => seen.push({ url: d.url, loaded: false, error: d.error }));

  const html = `<!doctype html><html><head>
    <base href="file:///${dir.replace(/\\/g, "/")}/">
    <link rel="stylesheet" href="https://probe.invalid/remote.css">
    <style>body { background-image: url("https://probe.invalid/bg.png"); }</style>
    </head><body>
    <h1>offline check</h1>
    <img src="https://probe.invalid/tracker.png" width="10" height="10">
    <img src="logo.png" width="60" height="60">
    </body></html>`;

  const out = path.join(dir, "out.pdf");
  await renderPdf(html, out, { pageSize: "Letter" });

  await check("no remote resource is ever loaded", () => {
    const loadedRemote = seen.filter((r) => /^https?:/i.test(r.url) && r.loaded);
    assert.strictEqual(
      loadedRemote.length,
      0,
      `remote resources loaded: ${loadedRemote.map((r) => r.url).join(", ")}`
    );
  });

  await check("the remote requests were actually attempted and refused", () => {
    // Guards against the test passing for the wrong reason — e.g. the markup
    // being silently stripped upstream, which would make the block untested.
    const blocked = seen.filter((r) => /^https?:/i.test(r.url) && !r.loaded);
    assert.ok(blocked.length >= 3, `expected the css, img and background to be refused, saw ${blocked.length}`);
    for (const b of blocked) {
      assert.match(b.error || "", /BLOCKED_BY_CLIENT/, `${b.url} failed for the wrong reason: ${b.error}`);
    }
  });

  await check("local images still resolve through <base href>", () => {
    const local = seen.filter((r) => /logo\.png$/i.test(r.url) && r.loaded);
    assert.ok(local.length > 0, "the local image did not load — the block is too aggressive");
  });

  await check("the PDF is still produced", () => {
    assert.ok(fs.existsSync(out), "no PDF written");
    assert.strictEqual(fs.readFileSync(out).subarray(0, 5).toString(), "%PDF-");
    assert.ok(fs.statSync(out).size > 800, "PDF suspiciously small");
  });

  await check("the render pool does not use the app's default session", () => {
    // A block installed on the default session would affect the main window;
    // keeping the pool on its own partition is what prevents that.
    assert.notStrictEqual(s, session.defaultSession, "render pool shares the default session");
  });

  shutdown();
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

  console.log("\n── Electron offline smoke test ──");
  for (const [status, name, err] of results) {
    console.log(`  ${status === "PASS" ? "ok " : "FAIL"} ${name}${err ? " — " + err : ""}`);
  }
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  app.exit(failed ? 1 : 0);
});
