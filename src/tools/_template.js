/**
 * JDOT UTILITIES — TOOL TEMPLATE
 * ===================
 * To add a tool: copy this file, rename it (e.g. `audio-convert.js`), fill in the
 * descriptor, and implement `convert()`. Drop it in this folder. That's it —
 * the registry auto-discovers every *.js file here (except names starting with `_`)
 * and the UI renders itself from what you export. No rebuild, no wiring.
 *
 * A tool runs in Electron's MAIN process (full Node.js). You can use pure-JS
 * libraries (like the built-in image tool uses `jimp`), or shell out to a bundled
 * binary (see the FFMPEG SKETCH at the bottom for the offline sidecar pattern).
 */

module.exports = {
  // Stable unique id (used internally). Lowercase, no spaces.
  id: "example",

  // What the user sees.
  name: "Example Tool",
  category: "Other", // groups tools in the left rail: Image, Audio, Video, Document, Data, Other...
  description: "One line describing what this tool does, in the user's words.",

  // Input extensions this tool accepts (lowercase, no dot).
  inputFormats: ["foo"],

  // Output extensions this tool can produce.
  outputFormats: ["bar"],

  // Optional UI controls. Each becomes a form field; values arrive in convert() as `options`.
  // types: "number" | "text" | "select" | "boolean"
  options: [
    // { key: "quality", label: "Quality", type: "number", min: 1, max: 100, default: 90 },
    // { key: "mode",    label: "Mode",    type: "select", choices: ["fast","best"], default: "best" },
  ],

  /**
   * Do the conversion. Return nothing on success; throw an Error to report failure
   * (its message is shown to the user). Call onProgress(0..1) if you can.
   *
   * @param {object} ctx
   * @param {string} ctx.inputPath     absolute path to source file
   * @param {string} ctx.outputPath    absolute path to write (extension already set)
   * @param {string} ctx.outputFormat  chosen output extension (no dot)
   * @param {object} ctx.options       values from the `options` schema above
   * @param {(fraction:number)=>void} ctx.onProgress
   */
  async convert({ inputPath, outputPath, outputFormat, options, onProgress }) {
    throw new Error("Not implemented — this is the template.");
  },
};

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
