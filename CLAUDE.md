# Jdot Utilities — project guide for Claude Code

Jdot Utilities is a **local, offline desktop file converter** (Electron). No network, no
account, no upload — files never leave the machine. Packaged as a Windows `.exe`.
Built around a **tool registry** so adding a converter is one self-describing file.

## Non-negotiables (don't regress these)
- **Fully offline.** No network calls at runtime, no telemetry, no accounts.
- **Extensible by one file.** A tool is auto-discovered from `src/tools/`; never
  add a central switchboard the user has to edit.
- **Ships as a Windows `.exe`** via electron-builder (NSIS + portable).
- Prefer **pure-JS / prebuilt-binary** engines over anything needing a network.

## Commands
```bash
npm install            # installs deps (sharp, mammoth, marked, turndown, html-to-docx, pdf-lib, heic-convert)
npm run dev            # run the app (electron .)
npm run build:win      # NSIS installer + portable .exe -> dist/
npm run build:portable # single-file portable .exe
```
```bash
npm test               # node:test suite (184 tests, plain node — no Electron)
npm run test:pdf       # Electron-hosted PDF smoke test (5 checks)
```
Requires **Node 22+** (the test script's `node --test` glob needs 21+).
Two layers, because the PDF path needs Chromium:
- `npm test` (184 cases) covers `htmlutil`, `convert`, `ops`, `pdfops`,
  `pdfshrink`, `bmp`/`ico`, `engines`, the registry (incl. kinds/validation),
  and every non-PDF `document-convert` path. Runs in plain node.
- Electron-hosted smoke tests (run directly): `npx electron test/electron-pdf.js`
  (PDF output, pooled windows, `<base href>`, orientation) and
  `npx electron test/electron-ops.js` (collect/explode via the discovered tools).
  `npm run test:pdf` runs the first. **Anything touching PDF output or Electron
  APIs goes here** — it cannot be covered by `npm test`.

## Architecture
- **Main process** (`src/main/`, CommonJS): Electron entry, IPC, and all the
  Node-side work. Conversions run here.
- **Renderer** (`src/renderer/index.html`): the entire UI in one self-contained
  file (inline CSS + vanilla JS, no build step). Talks to main only through the
  `window.api` bridge in `preload.js`. It **degrades gracefully**: opened in a
  plain browser (no `window.api`) it runs a "Preview" mode with in-memory state —
  that's how the UI is demoed outside Electron. Keep that fallback working.
- **Tools/utilities** (`src/tools/`): each file exports a descriptor (or an array
  of them). The registry auto-loads every `*.js` that isn't prefixed `_`.

### Two utility tabs (Convert / PDF Tools)
The top bar has two utility sections plus Settings. Membership is data-driven:
a tool with `category === "PDF"` shows under **PDF Tools**, everything else under
**Convert**. Both share one stage; switching tabs just retargets the rail
(`showTab`/`renderRail` in `index.html`). Add a PDF tool and it lands in the PDF
tab automatically — no wiring.

### Utility kinds (the core abstraction)
A descriptor declares a `kind` that says how files flow. This is what lets a PDF
toolkit (merge, split, extract…) be one file each instead of hardcoded tabs:
- **`convert`** (default) — N in → N out. Implements `convert()`. Driven by
  `convert.js` (`runBatch`): concurrency, cancel, collision-safe naming.
- **`collect`** — N in → 1 out (merge, images→PDF, zip). Implements `run()`.
  `ordered:true` makes the input list reorderable. Driven by `ops.js` `runCollect`.
- **`explode`** — 1 in → N out (split, PDF→images, unzip). Implements `run()`,
  gets `allocate(suffix, ext)` for collision-safe output names. `ops.js` `runExplode`.

All three go through **one IPC surface**: `convert:run` for converters,
`util:run` for collect/explode. Merge PDF is `src/tools/pdf-merge.js` — an ordinary
discovered `collect` tool, not a special case.

### Directory map
```
src/
  config.js              Branding (APP_NAME etc.) in one place
  main/
    main.js              Electron entry; boots settings + hardware accel; all IPC
    preload.js           contextBridge -> window.api
    registry.js          Auto-discovers tools (accepts a descriptor OR an array)
    convert.js           Batch runner: concurrency, cancel (AbortSignal), collision-safe naming
    settings.js          Persists to userData/settings.json (sync read at boot)
    fsutil.js            Folder walker (top-level or recursive), Electron-free/testable
    ops.js               Runners for collect (N->1) and explode (1->N) kinds
    pagespec.js          Parse "1-3,5,8-" page ranges (shared by split/delete/extract)
    htmlutil.js          HTML normalization: strip <style>/<script>, <base href>, text extraction
    pdfrender.js         HTML -> PDF via a POOL of offscreen Electron windows
    pdfops.js            PDF merge/split/rotate/delete/extract/inspect via pdf-lib
    imgpdf.js            Images -> one PDF (sharp normalizes, pdf-lib assembles)
    pdfjs.js             Shared pdfjs-dist loader (dynamic import of the ESM build)
    pdftext.js           PDF -> text (pdfjs text layer; flags scanned/image-only PDFs)
    pdfraster.js         PDF -> images (pdfjs render onto @napi-rs/canvas)
    ocr.js               OCR via tesseract.js (offline eng model; serialized worker)
    dataconv.js          JSON/YAML/CSV/TSV/XML conversion (pure JS)
    gs.js                Ghostscript locator + compress / PDF-A
    office.js            LibreOffice locator + headless convert (unique profile per call)
    engines.js           The optional external engines in one place (status + download URLs)
    pdfshrink.js         Ghostscript-free PDF compression (pdfjs render -> JPEG -> pdf-lib)
    bmp.js  ico.js       Hand-written BMP and ICO codecs (libvips supports neither)
  tools/
    _template.js         Copy to add a tool (documents the contract + sidecar pattern)
    image-convert.js     sharp + heic-convert
    document-convert.js  marked/turndown/mammoth/html-to-docx + Electron printToPDF
    office-convert.js    Word/Sheets/Slides families (array export) via office.js
    pdf-merge.js         Merge PDFs (collect)
    pdf-split.js         Split PDF: per-page / every-N / ranges (explode)
    pdf-pages.js         Rotate / Delete / Extract pages (three convert tools, one file)
    images-to-pdf.js     Images -> one PDF (collect, ordered)
    pdf-to-images.js     PDF -> PNG/JPG, one per page (explode)
    pdf-to-text.js       PDF -> txt (convert)
  renderer/index.html    Whole UI: Convert / PDF Tools / Settings, kind-aware stage
  renderer/assets/       Brand: logo.png (topbar), wordmark.png, logo-32.png
build/icon.ico           App/window icon (electron-builder buildResources)
docs/index.html          GitHub Pages landing page
.github/workflows/build.yml  Windows CI: tag v* -> builds .exe -> attaches to release
```

## Adding a tool (the core extension point)
Copy `src/tools/_template.js`, fill the descriptor, implement `convert()`, drop it
in `src/tools/`. Restart — the registry finds it and the UI renders itself from it.

Descriptor: `{ id, name, category, description, inputFormats[], outputFormats[],
excludePairs{}, options[],
async convert({ inputPath, outputPath, outputFormat, options, signal, onProgress }) }`.
- The default assumption is that every input converts to every output. Two ways to
  express exceptions:
  - **`excludePairs: { md: ["md"] }`** — hides individual pairs from the UI. Use for
    a few holes in an otherwise full matrix (e.g. same-format no-ops).
  - **Split into multiple descriptors** and export an **array** (see
    `office-convert.js`) when a family has whole groups of invalid pairs.
- `options[]` entry types: `select` (with `choices`), `number` (`min`/`max`),
  `boolean` (renders a checkbox), `text`.
- `signal` is an `AbortSignal`. Long-running tools should check `signal.aborted`
  and bail; the batch runner already refuses to start new files after a cancel.
- `convert()` writes the output file itself and throws on failure (message shown
  to the user). Call `onProgress(0..1)` when possible.
- Pure JS is preferred. For PDF output, render HTML via Electron
  (`webContents.printToPDF`) — see `document-convert.js`. For heavy formats, use a
  **bundled sidecar binary** (pattern documented at the bottom of `_template.js`).

## Current tools
- **Image** (`sharp` + `heic-convert` + our own `bmp.js`/`ico.js`): in
  png/jpg/jpeg/webp/avif/tiff/gif/svg/heic/heif/bmp/ico → out
  png/jpg/jpeg/webp/avif/tiff/gif/bmp/ico. Options: resize preset, custom max
  width, quality, ICO size set.
- **Document** (pure JS + Electron PDF): md/markdown/html/htm/docx/txt ↔
  html/md/txt/pdf/docx. Option: PDF page size.
- **Office** (LibreOffice, three families): Word (docx/doc/odt/rtf), Spreadsheets
  (xlsx/xls/ods/csv), Presentations (pptx/ppt/odp) — each within-family + → pdf.
- **PDF toolkit** (offline, auto-discovered tools):
  - Merge PDFs (collect), Images → PDF (collect, sharp + pdf-lib)
  - Split PDF (explode): per-page / every-N / custom ranges
  - Rotate / Delete / Extract pages (convert, so they batch across files)
  - PDF → Images (explode, pdfjs + `@napi-rs/canvas`): PNG/JPG per page, DPI + range
  - PDF → Text (convert, pdfjs text layer; flags scanned PDFs that need OCR)

## Settings (`userData/settings.json`, via `settings:get`/`settings:set` IPC)
`theme` (light|grey|black), `defaultOutputDir`, `pdfPageSize`, `concurrency`,
`hardwareAcceleration` (auto|on|off, read at boot), `recurseFolders`,
`libreOfficePath` / `ghostscriptPath` (overrides; null = auto-detect),
`hideEngineNotice` (dismissed the missing-engine banner).

## Themes
Three: **light**, **grey** (default), **black**. Driven by CSS custom properties in
`[data-theme="…"]` blocks at the **top of `index.html`**; the accent is the brand
**royal blue** (matches the logo): `#3b74f0` on the dark themes, `#1e50e5` on light.
To retheme, edit those token blocks only — all accent colour is confined to them.

## Gotchas / constraints
- **Two native modules: `sharp` and `@napi-rs/canvas`.** Both ship prebuilt
  binaries and are in `asarUnpack` (electron-builder.yml). Build the `.exe` **on
  Windows** (or the Windows CI runner) so the correct win32-x64 binaries are
  fetched. Cross-building from Linux needs the win32 optional deps forced.
- **pdfjs-dist v6 is ESM-only.** It's pulled in with a cached dynamic `import()`
  from `src/main/pdfjs.js`; don't `require()` it. Its font/cMap "urls" must use
  forward slashes with a trailing `/` (pdfjs rejects a Windows `\`) — `pdfjs.js`
  handles that. Text extraction is pure JS; rendering needs `@napi-rs/canvas`.
- **OCR ships its model.** `resources/tessdata/eng.traineddata` (~4 MB) is committed
  and shipped via `extraResources`; `ocr.js` reads it locally so OCR is offline —
  never point tesseract.js at a CDN. `tesseract.js` + `tesseract.js-core` are in
  `asarUnpack` (wasm core + worker load from disk). One worker, calls serialized.
- **Ghostscript is optional.** `gs.js` resolves a bundled binary (`resources/bin/`),
  then an installed one, then the `ghostscriptPath` setting. Absent → the tool
  throws a clear message; its tests skip. Compress/PDF-A is `pdf-optimize`.
  `pdf-shrink` covers plain compression with **nothing installed**.
- **A tool that shells out must declare `requiresEngine`** ("libreoffice" /
  "ghostscript"). `engines.js` owns the list; `registry.describe()` drops unknown
  ids. That declaration is the *only* thing driving the startup banner and the
  per-tool warning — never hardcode an engine check in the renderer.
- **`sharp` here has no BMP or ICO support, in either direction** (no `magick`
  loader — verified against the prebuilt binary, don't assume the docs). Both
  formats route through `bmp.js` / `ico.js`. An ICO frame can be a PNG *or* a
  headerless BMP whose stored height is doubled by a trailing 1-bit mask;
  `ico.js` handles both.
- **`pdfshrink.js` encodes every page with sharp, never `canvas.toBuffer`.**
  Mixing the two means two JPEG encoders whose quality scales disagree, so the
  same `quality` produced very different files depending on the greyscale
  toggle — and greyscale could come out *larger* than colour.
- **Select options must apply their declared `default`.** `renderOptions` sets
  `inp.value = opt.default`; without it a `select` silently lands on its first
  choice, which is how Compress/PDF-A ended up defaulting to `screen` rather
  than the intended `ebook`.
- **Third native/asset deps:** `sharp`, `@napi-rs/canvas`, and the tesseract wasm
  are all `asarUnpack`. Bumping any needs a Windows build so the win32 binary matches.
- **PDF output needs Chromium** (Electron `printToPDF`) — it can't run in plain
  `node`, so `pdfrender.js` is lazy-required and only `npm run test:pdf` covers it.
- **Anything that turns HTML into another format must call
  `htmlutil.stripNonContent()` first.** Turndown and tag-stripping text extraction
  both emit `<style>`/`<script>` *contents* as body text, so skipping it dumps the
  stylesheet and the JavaScript into the `.md`/`.txt` output. This was a real bug.
- **HTML intermediates need `<base href>`** (`htmlutil.wrapDocument` adds it) or
  relative `<img>`/`<link>` in the source resolve against the temp dir and vanish.
- **`PDFDocument.load()` defaults to `updateMetadata: true`**, which rewrites
  Producer and ModificationDate the instant a file is opened. `pdfops.loadPdf()`
  passes `false`. Use `loadPdf()` rather than calling pdf-lib directly, or
  in-place PDF operations will silently restamp the user's metadata.
- **`ignoreEncryption` does not decrypt.** It only skips the check, yielding
  garbage pages. `loadPdf()` rejects encrypted input with a clear message instead.
- **Office needs LibreOffice installed** (not bundled — it's ~400 MB). `office.js`
  auto-detects it; `libreOfficePath` overrides. Each call uses a unique
  `-env:UserInstallation` profile so batch concurrency won't collide.
- **HEIC decode** goes through `heic-convert` because sharp's prebuilt libvips
  usually omits HEIF decode.

## Roadmap (unbuilt)
Smaller PDF follow-ons now that the engine is in place:
- **PDF → single image montage/contact sheet**, **reorder pages**, **N-up**.

Bigger engines (sidecar pattern in `_template.js` / `office.js`):
- **Bundle LibreOffice** (~400 MB) so Office needs no install: `office.js` should
  prefer a bundled path, then the detected one. Needs a CI download step, and
  can't be verified locally without LibreOffice present.
- **Auto-update** via `electron-updater` against GitHub Releases.
- `pandoc` sidecar → LaTeX, reStructuredText, AsciiDoc, Org, EPUB, ipynb… (also
  replaces `html-to-docx` + `mammoth` with real `.docx` I/O). **Chosen; deferred.**
- `calibre` → ebooks (epub/mobi/azw3/fb2).
- Video/audio via bundled `ffmpeg` (wire the existing hardware-acceleration setting
  to `-hwaccel`).

Smaller:
- **encrypt/decrypt** (needs a crypto-capable lib; pdf-lib writes but doesn't
  password-protect).
- Publish `docs/` via GitHub Pages (Settings → Pages → main /docs).

## Release
Push a tag: `git tag v0.3.0 && git push origin v0.3.0` → GitHub Actions builds the
Windows `.exe` and attaches it to a Release. Replace `<you>` in `README.md` and
`docs/index.html` before publishing.
