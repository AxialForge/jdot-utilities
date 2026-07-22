// Runners for the non-batch utility kinds. `convert.js` handles kind:"convert"
// (N in -> N out); this handles the two single-shot shapes:
//
//   collect   N files in  -> 1 file out   (merge, images->PDF, zip)
//   explode   1 file  in  -> N files out  (split, PDF->images, unzip)
//
// Both normalize to the same result shape as runBatch's caller expects, so the
// IPC layer and the UI can treat all three kinds uniformly.

const fs = require("node:fs");
const path = require("node:path");

/** Non-colliding path for a file that is about to be written. */
function freePath(dir, stem, ext, reserved) {
  const key = (p) => path.resolve(p).toLowerCase();
  let candidate = path.join(dir, `${stem}.${ext}`);
  let n = 1;
  while (fs.existsSync(candidate) || reserved?.has(key(candidate))) {
    candidate = path.join(dir, `${stem} (${n}).${ext}`);
    n += 1;
  }
  reserved?.add(key(candidate));
  return candidate;
}

/**
 * N inputs -> a single output the caller has already chosen (via a save dialog).
 */
async function runCollect({ tool, files, outputPath, options, signal, onProgress }) {
  const min = Number.isInteger(tool.minInputs) ? tool.minInputs : 2;
  if (!Array.isArray(files) || files.length < min) {
    return { ok: false, error: `This needs at least ${min} files.` };
  }

  // Writing the output over one of the inputs would destroy a source file.
  const target = path.resolve(outputPath).toLowerCase();
  if (files.some((f) => path.resolve(f).toLowerCase() === target)) {
    return { ok: false, error: "Choose an output file that isn't one of the inputs." };
  }

  try {
    const info = await tool.run({
      inputPaths: files,
      outputPath,
      options: options || {},
      signal,
      onProgress: (fraction) => onProgress?.({ fraction }),
    });
    if (signal?.aborted) return { ok: false, cancelled: true, error: "Cancelled" };
    return { ok: true, outputPath, outputs: [outputPath], ...(info || {}) };
  } catch (err) {
    const cancelled = signal?.aborted || err?.name === "AbortError";
    return {
      ok: false,
      cancelled: cancelled || undefined,
      error: cancelled ? "Cancelled" : err.message || String(err),
    };
  }
}

/**
 * One input -> many outputs written into `outputDir`.
 *
 * The tool names its own outputs (page numbering, frame numbering, archive
 * members) so it is handed a directory and a collision-safe allocator rather than
 * a fixed path.
 */
async function runExplode({ tool, file, outputDir, options, signal, onProgress }) {
  if (!file) return { ok: false, error: "Pick a file first." };

  const dir = outputDir || path.dirname(file);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (err) {
    return { ok: false, error: `Cannot write to ${dir}: ${err.code || err.message}` };
  }

  const reserved = new Set();
  const stem = path.basename(file, path.extname(file));

  try {
    const info = await tool.run({
      inputPath: file,
      outputDir: dir,
      // Tools call this instead of building paths themselves, so two runs into the
      // same folder never clobber each other's output.
      allocate: (suffix, ext) => freePath(dir, suffix ? `${stem}-${suffix}` : stem, ext, reserved),
      options: options || {},
      signal,
      onProgress: (fraction) => onProgress?.({ fraction }),
    });
    if (signal?.aborted) return { ok: false, cancelled: true, error: "Cancelled" };

    const outputs = Array.isArray(info?.outputs) ? info.outputs : [];
    if (!outputs.length) return { ok: false, error: "The tool produced no output." };
    return { ok: true, outputs, outputDir: dir, ...info };
  } catch (err) {
    const cancelled = signal?.aborted || err?.name === "AbortError";
    return {
      ok: false,
      cancelled: cancelled || undefined,
      error: cancelled ? "Cancelled" : err.message || String(err),
    };
  }
}

module.exports = { runCollect, runExplode, freePath };
