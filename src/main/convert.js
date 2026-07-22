// Runs a tool over a batch of files with a concurrency limit, reporting
// per-file completion so the UI can update a 100+ item queue and overall bar.

const fs = require("node:fs");
const path = require("node:path");

function outputPathFor(inputPath, outputFormat, outputDir) {
  const dir = outputDir || path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  let candidate = path.join(dir, `${base}.${outputFormat}`);
  let n = 1;
  while (fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(inputPath)) {
    candidate = path.join(dir, `${base} (${n}).${outputFormat}`);
    n += 1;
  }
  return candidate;
}

async function runBatch({
  tool,
  files,
  outputFormat,
  options,
  outputDir,
  concurrency = 4,
  onProgress, // ({ index, name, fraction })
  onFileDone, // (result)
}) {
  const results = new Array(files.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= files.length) return;

      const inputPath = files[i];
      const name = path.basename(inputPath);
      try {
        const outputPath = outputPathFor(inputPath, outputFormat, outputDir);
        await tool.convert({
          inputPath,
          outputPath,
          outputFormat,
          options: options || {},
          onProgress: (fraction) => onProgress?.({ index: i, name, fraction }),
        });
        results[i] = { index: i, name, ok: true, outputPath };
      } catch (err) {
        results[i] = { index: i, name, ok: false, error: err.message || String(err) };
      }
      onFileDone?.(results[i]);
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, files.length || 1));
  await Promise.all(Array.from({ length: lanes }, worker));
  return results;
}

module.exports = { runBatch, outputPathFor };
