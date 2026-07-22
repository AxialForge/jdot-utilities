// Runs a tool over a batch of files with a concurrency limit, reporting
// per-file completion so the UI can update a 100+ item queue and overall bar.

const fs = require("node:fs");
const path = require("node:path");

/**
 * Pick a free output path for `inputPath`.
 *
 * `reserved` is a Set of paths already claimed by in-flight conversions in this
 * batch. Without it, two workers running concurrently both see the target name as
 * free on disk (nothing is written until convert() returns) and pick the same
 * path — so `report.md` and `report.html` both became `report.pdf` and one
 * silently overwrote the other. Names are compared case-insensitively because
 * Windows and macOS filesystems are.
 */
function outputPathFor(inputPath, outputFormat, outputDir, reserved) {
  const dir = outputDir || path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const key = (p) => path.resolve(p).toLowerCase();

  const taken = (p) => {
    if (reserved && reserved.has(key(p))) return true;
    // Never overwrite the input itself (e.g. a .txt -> .txt no-op).
    if (key(p) === key(inputPath)) return true;
    return fs.existsSync(p);
  };

  let candidate = path.join(dir, `${base}.${outputFormat}`);
  let n = 1;
  while (taken(candidate)) {
    candidate = path.join(dir, `${base} (${n}).${outputFormat}`);
    n += 1;
  }
  reserved?.add(key(candidate));
  return candidate;
}

async function runBatch({
  tool,
  files,
  outputFormat,
  options,
  outputDir,
  concurrency = 4,
  signal, // optional AbortSignal — stops handing out new work
  onProgress, // ({ index, name, fraction })
  onFileDone, // (result)
}) {
  const results = new Array(files.length);
  const reserved = new Set();
  let next = 0;

  const isCancel = (err) =>
    signal?.aborted || err?.name === "AbortError" || err?.name === "CancelledError";

  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= files.length) return;

      const inputPath = files[i];
      const name = path.basename(inputPath);

      // Drain the rest of the queue as cancelled rather than converting it.
      if (signal?.aborted) {
        results[i] = { index: i, name, ok: false, cancelled: true, error: "Cancelled" };
        onFileDone?.(results[i]);
        continue;
      }

      try {
        const outputPath = outputPathFor(inputPath, outputFormat, outputDir, reserved);
        await tool.convert({
          inputPath,
          outputPath,
          outputFormat,
          options: options || {},
          signal,
          onProgress: (fraction) => onProgress?.({ index: i, name, fraction }),
        });
        results[i] = { index: i, name, ok: true, outputPath };
      } catch (err) {
        const cancelled = isCancel(err);
        results[i] = {
          index: i,
          name,
          ok: false,
          cancelled: cancelled || undefined,
          error: cancelled ? "Cancelled" : err.message || String(err),
        };
      }
      onFileDone?.(results[i]);
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, files.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}

module.exports = { runBatch, outputPathFor };
