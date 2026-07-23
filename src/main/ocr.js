// OCR (optical character recognition) via tesseract.js — fully offline. The
// English model ships in resources/tessdata (no CDN fetch). Handles image files
// directly, and scanned PDFs by rasterizing each page then reading it.
//
// One shared worker, and all recognize() calls are serialized through a promise
// chain: a tesseract worker processes one image at a time, and the batch runner
// may hand us several files at once, so we queue them rather than collide.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createWorker } = require("tesseract.js");

function tessdataDir() {
  // Packaged app: resources/tessdata (electron-builder extraResources).
  if (process.resourcesPath) {
    const p = path.join(process.resourcesPath, "tessdata");
    if (fs.existsSync(path.join(p, "eng.traineddata"))) return p;
  }
  // Dev / tests: repo-root resources/tessdata.
  return path.join(__dirname, "..", "..", "resources", "tessdata");
}

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      langPath: tessdataDir(),
      gzip: false, // our eng.traineddata is uncompressed
      cacheMethod: "none", // never write/fetch a cache — stay offline & read-only
      logger: () => {},
    }).catch((err) => {
      workerPromise = null; // let a later call retry instead of caching the failure
      throw err;
    });
  }
  return workerPromise;
}

let chain = Promise.resolve();
/** Recognize one image file → text. Serialized across all callers. */
async function ocrImage(imagePath) {
  const worker = await getWorker();
  const run = chain.then(() => worker.recognize(imagePath));
  chain = run.then(() => {}, () => {}); // keep the queue alive past errors
  const { data } = await run;
  return data.text || "";
}

/** Scanned PDF → text: rasterize each page, OCR it, join with page breaks. */
async function ocrPdf(pdfPath, { dpi = 200, onProgress, signal } = {}) {
  const { rasterizePdf } = require("./pdfraster");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jdot-ocrpdf-"));
  try {
    // Rasterize is ~half the work; OCR is the other (slower) half.
    const { outputs } = await rasterizePdf(
      pdfPath,
      { format: "png", dpi },
      (suffix, ext) => path.join(tmp, `${suffix}.${ext}`),
      (f) => onProgress?.(f * 0.4),
      { signal }
    );
    const parts = [];
    for (let i = 0; i < outputs.length; i += 1) {
      if (signal?.aborted) throw new Error("Cancelled");
      parts.push(await ocrImage(outputs[i]));
      onProgress?.(0.4 + ((i + 1) / outputs.length) * 0.6);
    }
    return parts.join("\n\f\n").trim();
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

async function shutdown() {
  if (!workerPromise) return;
  try { const w = await workerPromise; await w.terminate(); } catch {}
  workerPromise = null;
}

module.exports = { ocrImage, ocrPdf, shutdown, tessdataDir };
