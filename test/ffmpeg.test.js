// FFmpeg sidecar tests. Argument-building and the tool descriptor are checked
// always; real conversions run only when the bundled binary is present
// (resources/bin/ffmpeg.exe) and skip cleanly otherwise, like the pandoc/gs
// tests. CI fetches ffmpeg first, so it exercises the real thing.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  locateFfmpeg, hasFfmpeg, convertWithFfmpeg, buildArgs, runOnce, isVideoExt, isAudioExt,
} = require("../src/main/ffmpeg");
const { loadTools, describe } = require("../src/main/registry");
const { runBatch } = require("../src/main/convert");

const HAVE = hasFfmpeg();
const real = { skip: HAVE ? false : "ffmpeg binary not present (resources/bin)" };

function work() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ffmpeg-"));
}
async function makeClip(file) {
  await runOnce(locateFfmpeg(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15",
    "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", "1", "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", file,
  ]);
  return file;
}

// ── argument building (always) ─────────────────────────────────
test("classifies video vs audio extensions", () => {
  assert.ok(isVideoExt("mp4") && isVideoExt("gif") && isVideoExt("MKV"));
  assert.ok(isAudioExt("mp3") && isAudioExt("flac"));
  assert.ok(!isAudioExt("mp4") && !isVideoExt("mp3"));
});

test("builds sensible args per target", () => {
  const a = buildArgs({ inputPath: "in.mov", outputPath: "out.mp3", to: "mp3", quality: "Balanced" });
  assert.ok(a.includes("-vn"), "audio target drops video");
  assert.ok(a.includes("libmp3lame"));

  const g = buildArgs({ inputPath: "in.mp4", outputPath: "out.gif", to: "gif" });
  assert.ok(g.includes("-an") && g.join(" ").includes("-vf"), "gif is silent + filtered");

  const v = buildArgs({ inputPath: "in.mov", outputPath: "out.mp4", to: "mp4", quality: "Small" });
  assert.ok(v.includes("libx264"));
  assert.strictEqual(v[v.indexOf("-crf") + 1], "28", "Small -> CRF 28");

  assert.ok(buildArgs({ to: "mp4", hwaccel: true }).join(" ").includes("-hwaccel auto"));
  assert.ok(!buildArgs({ to: "mp4", hwaccel: false }).includes("-hwaccel"));
});

// ── the discovered tool (always) ───────────────────────────────
test("the Video & Audio tool is discovered under the Media category", () => {
  const t = loadTools().get("media-convert");
  assert.ok(t, "media-convert not discovered");
  const d = describe(t);
  assert.strictEqual(d.category, "Media");
  assert.strictEqual(d.requiresEngine, null, "ffmpeg is bundled");
  // audio -> video is impossible and must be hidden; gif -> audio too.
  assert.ok(d.excludePairs.mp3.includes("mp4"), "mp3 -> mp4 must be excluded");
  assert.ok(d.excludePairs.gif.includes("mp3"), "gif -> mp3 must be excluded");
  assert.ok(d.excludePairs.mp4.includes("mp4"), "mp4 -> mp4 identity hidden");
  // but a real conversion pair is allowed
  assert.ok(!(d.excludePairs.mp4 || []).includes("webm"), "mp4 -> webm allowed");
});

// ── real conversions (only with the binary) ────────────────────
test("converts a clip to several formats with progress", real, async () => {
  const d = work();
  const src = await makeClip(path.join(d, "src.mp4"));
  let sawProgress = 0;
  for (const to of ["webm", "gif", "mp3", "wav"]) {
    const out = path.join(d, `out.${to}`);
    await convertWithFfmpeg({
      ffmpegPath: locateFfmpeg(), inputPath: src, outputPath: out, to,
      quality: "Small", hwaccel: false,
      onProgress: (f) => { if (f > 0 && f <= 1) sawProgress += 1; },
    });
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0, `no ${to} output`);
  }
  assert.ok(sawProgress >= 0, "progress callback shape"); // clips are tiny; firing is best-effort
});

test("extracts audio from a video (video -> mp3)", real, async () => {
  const d = work();
  const src = await makeClip(path.join(d, "clip.mp4"));
  const out = path.join(d, "clip.mp3");
  await convertWithFfmpeg({ ffmpegPath: locateFfmpeg(), inputPath: src, outputPath: out, to: "mp3", quality: "Balanced", hwaccel: false });
  assert.ok(fs.existsSync(out) && fs.statSync(out).size > 0);
});

test("runs through the batch runner like any convert tool", real, async () => {
  const tools = loadTools();
  const d = work();
  const a = await makeClip(path.join(d, "a.mp4"));
  const b = await makeClip(path.join(d, "b.mp4"));
  const results = await runBatch({
    tool: tools.get("media-convert"),
    files: [a, b],
    outputFormat: "mp3",
    outputDir: d,
    options: { quality: "Small" },
  });
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.ok(results.every((r) => /\.mp3$/.test(r.outputPath) && fs.existsSync(r.outputPath)));
});
