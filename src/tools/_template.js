/**
 * JDOT UTILITIES — TOOL TEMPLATE
 * ==============================
 * To add a utility: copy this file, rename it (e.g. `audio-convert.js`), fill in
 * the descriptor, and implement its handler. Drop it in this folder. That's it —
 * the registry auto-discovers every *.js here (except names starting with `_`)
 * and the UI renders itself from what you export. No rebuild, no wiring.
 *
 * A utility runs in Electron's MAIN process (full Node.js). Use pure-JS libraries,
 * or shell out to a bundled binary (see the FFMPEG SKETCH for the sidecar pattern).
 *
 * THREE KINDS — pick by how files flow, declared with `kind`:
 *
 *   kind: "convert"  (default)  N in -> N out, one output per input.
 *                    Implements convert().  Batch runner handles concurrency,
 *                    cancel, and collision-safe naming for you.  Examples: image,
 *                    document, office converters.
 *
 *   kind: "collect"             N in -> 1 out.  Implements run(); the app asks the
 *                    user where to save.  Set `ordered:true` for reorderable input.
 *                    Examples: merge PDFs, images -> one PDF, zip.
 *
 *   kind: "explode"            1 in -> N out.  Implements run(); the app picks an
 *                    output folder and hands you allocate() to name outputs.
 *                    Examples: split PDF, PDF -> images, unzip.
 *
 * The convert example is below; collect and explode skeletons follow it.
 */

module.exports = {
  // Stable unique id (used internally). Lowercase, no spaces.
  id: "example",

  // kind: "convert" is the default and may be omitted.
  name: "Example Tool",
  category: "Other", // groups tools in the left rail: Image, Document, PDF, Audio, Video, Data, Other…
  description: "One line describing what this tool does, in the user's words.",

  inputFormats: ["foo"], // extensions accepted (lowercase, no dot)
  outputFormats: ["bar"], // extensions produced

  // Optional: hide specific input->output pairs the UI would otherwise offer.
  // excludePairs: { foo: ["foo"] },  // e.g. never offer foo -> foo

  // Optional UI controls. Each becomes a form field; values arrive as `options`.
  // types: "number" | "text" | "select" | "boolean"
  options: [
    // { key: "quality", label: "Quality", type: "number", min: 1, max: 100, default: 90 },
    // { key: "mode",    label: "Mode",    type: "select", choices: ["fast","best"], default: "best" },
    // { key: "flatten", label: "Flatten", type: "boolean", default: false },
  ],

  /**
   * kind:"convert" — do one file. Return nothing on success; throw an Error to
   * report failure (its message is shown to the user). Call onProgress(0..1).
   *
   * @param {object} ctx
   * @param {string} ctx.inputPath     absolute path to source file
   * @param {string} ctx.outputPath    absolute path to write (extension already set)
   * @param {string} ctx.outputFormat  chosen output extension (no dot)
   * @param {object} ctx.options       values from the `options` schema above
   * @param {AbortSignal} ctx.signal   check `.aborted` in long loops and bail
   * @param {(fraction:number)=>void} ctx.onProgress
   */
  async convert({ inputPath, outputPath, outputFormat, options, signal, onProgress }) {
    throw new Error("Not implemented — this is the template.");
  },
};

/*
 * ── COLLECT SKELETON (N in -> 1 out) ─────────────────────────────────────────
 *
 *   module.exports = {
 *     id: "images-to-pdf",
 *     name: "Images → PDF",
 *     kind: "collect",
 *     category: "PDF",
 *     description: "Combine images into a single PDF, one image per page.",
 *     inputFormats: ["png", "jpg", "jpeg"],
 *     outputFormats: ["pdf"],
 *     ordered: true,       // page order = list order; UI shows reorder arrows
 *     minInputs: 1,        // collect defaults to 2; images->pdf is happy with 1
 *     defaultName: "images",
 *     options: [],
 *
 *     // The app has already picked outputPath (save dialog) and guarantees it is
 *     // not one of the inputs. Return any info you want shown; `warnings: [...]`
 *     // is surfaced to the user after a successful run.
 *     async run({ inputPaths, outputPath, options, signal, onProgress }) {
 *       // ...write outputPath...
 *       return { warnings: [] };
 *     },
 *   };
 *
 * ── EXPLODE SKELETON (1 in -> N out) ─────────────────────────────────────────
 *
 *   module.exports = {
 *     id: "pdf-split",
 *     name: "Split PDF",
 *     kind: "explode",
 *     category: "PDF",
 *     description: "Split a PDF into one file per page.",
 *     inputFormats: ["pdf"],
 *     outputFormats: ["pdf"],
 *     options: [],
 *
 *     // outputDir is chosen by the app. Use allocate(suffix, ext) to get a
 *     // collision-safe path (named "<stem>-<suffix>.<ext>"). Return the outputs.
 *     async run({ inputPath, outputDir, allocate, options, signal, onProgress }) {
 *       const outputs = [];
 *       // for each page: const p = allocate("p" + n, "pdf"); ...write p...; outputs.push(p);
 *       return { outputs };
 *     },
 *   };
 */

/*
 * ── FFMPEG SKETCH (offline sidecar pattern) ──────────────────────────────────
 * For heavy converters, bundle the binary and call it. This stays 100% offline
 * because the binary ships inside the app.
 *
 *   const { execFile } = require("node:child_process");
 *   const { binPath }  = require("../main/bin"); // resolves bundled binaries
 *
 *   async convert({ inputPath, outputPath, onProgress }) {
 *     const ffmpeg = binPath("ffmpeg");         // e.g. resources/bin/ffmpeg.exe
 *     await new Promise((resolve, reject) => {
 *       const p = execFile(ffmpeg, ["-y", "-i", inputPath, outputPath]);
 *       p.on("error", reject);
 *       p.on("exit", (code) => code === 0 ? resolve() : reject(new Error("ffmpeg failed")));
 *     });
 *   }
 *
 * Then add ffmpeg.exe to resources/bin/ and list it under electron-builder's
 * `extraResources` so it lands next to the app. See README → "Adding a tool".
 */
