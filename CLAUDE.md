# Jdot Utilities — project guide for Claude Code

Jdot Utilities is a **local, offline desktop file converter** (Electron). No network, no
account, no upload — files never leave the machine. Packaged as a Windows `.exe`.
Built around a **tool registry** so adding a converter is one self-describing file.

## Non-negotiables (don't regress these)
- **Offline by default; one disclosed exception.** No telemetry, no accounts, and
  **nothing** contacts the network on its own. The single exception is the manual
  updater (`src/main/updater.js`), which hits GitHub **only** when the user clicks
  Settings → Check for updates. There is deliberately no launch check, no
  interval, and no auto-download/auto-install. Do not add any automatic network
  call — the whole product promise depends on it.
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
  (PDF output, pooled windows, `<base href>`, orientation, Word→PDF color+B&W),
  `npx electron test/electron-ops.js` (collect/explode via the discovered tools),
  and `npx electron test/electron-offline.js` (the render pool makes no remote
  requests). `npm run test:pdf` runs the first. **Anything touching PDF output or
  Electron APIs goes here** — it cannot be covered by `npm test`. **CI runs all
  three** on every push and gates releases on them — a v1.0.0 crash slipped
  through precisely because it once didn't.

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

**Convert-then-merge** (the "Merge all into one PDF" checkbox) is a batch-level
feature, *not* a tool: a `convert` tool is inherently N-in→N-out, so combining
its outputs can't live inside `convert()`. The `convert:run` handler converts
every file to PDF first, then — only when the target is PDF and ≥2 files
succeeded — calls `convert.mergeConvertedPdfs()` and **deletes the per-file
intermediates**. A merge failure or <2 successes leaves the individual PDFs in
place, so a convert is never lost to a failed merge. `mergeConvertedPdfs` is
node-tested (`test/mergeconvert.test.js`); the full md→pdf→merge path is covered
under Electron in `test/electron-ops.js`.

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
    pdfrender.js         HTML -> PDF, and Word (.docx) -> PDF, via POOLs of offscreen Electron windows
    pdfops.js            PDF merge/split/rotate/delete/extract/inspect via pdf-lib
    imgpdf.js            Images -> one PDF (sharp normalizes, pdf-lib assembles)
    pdfjs.js             Shared pdfjs-dist loader (dynamic import of the ESM build)
    pdftext.js           PDF -> text (pdfjs text layer; flags scanned/image-only PDFs)
    pdfraster.js         PDF -> images (pdfjs render onto @napi-rs/canvas)
    ocr.js               OCR via tesseract.js (offline eng model; serialized worker)
    dataconv.js          JSON/YAML/CSV/TSV/XML conversion (pure JS)
    gs.js                Ghostscript locator + compress / PDF-A
    office.js            LibreOffice locator + headless convert (unique profile per call)
    pandoc.js            Bundled pandoc sidecar: locate + run. ALWAYS --sandbox (offline)
    engines.js           The optional external engines in one place (status + download URLs)
    pdfshrink.js         Ghostscript-free PDF compression (pdfjs render -> JPEG -> pdf-lib)
    bmp.js  ico.js       Hand-written BMP and ICO codecs (libvips supports neither)
  tools/
    _template.js         Copy to add a tool (documents the contract + sidecar pattern)
    image-convert.js     sharp + heic-convert
    document-convert.js  marked/turndown/mammoth/html-to-docx + Electron printToPDF
    office-convert.js    Word/Sheets/Slides families (array export) via office.js
    pandoc-convert.js    Documents & Ebooks: docx/odt/epub/tex/rst/org/adoc/html/md/ipynb via pandoc.js
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
  html/md/txt/pdf/docx. Options: PDF page size, landscape, colour (Color / B&W).
  **Word → PDF is a dedicated high-fidelity path** (docx-preview, offline, no
  LibreOffice) — a true 1:1 render; the other targets still use mammoth.
- **Office** (LibreOffice, three families): Word (docx/doc/odt/rtf), Spreadsheets
  (xlsx/xls/ods/csv), Presentations (pptx/ppt/odp) — each within-family + → pdf.
- **Documents & Ebooks** (`pandoc-convert.js`, bundled pandoc): converts between
  md, html, docx, odt, epub, latex (.tex), rst, org, asciidoc (.adoc) and ipynb.
  Bundled (no install), fully offline via `--sandbox`. **No PDF** — pandoc→PDF
  needs a multi-GB LaTeX install and the app already makes PDFs.
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
- **pandoc MUST run with `--sandbox` — it is the offline guarantee, not a
  nicety.** Verified against the shipped binary: without `--sandbox`, pandoc
  fetches remote resources named in a document (e.g. an `<img src="https://…">`
  while writing docx/epub) — a real outbound request, the same class of silent
  egress the HTML→PDF path had to block. `--sandbox` restricts pandoc's IO to the
  input files on the command line: no network, no reading arbitrary local files.
  The cost is that images referenced as *separate local files* aren't embedded;
  images already inside a container (docx/odt/epub) survive rich→rich and are
  written out via `--extract-media` on rich→text. Never drop `--sandbox` to "fix"
  a missing image. `test/pandoc.test.js` covers this.
- **pandoc is bundled (resources/bin/pandoc.exe), not an optional engine.** It's
  ~222 MB unpacked (a ~40 MB download); CI fetches a **pinned, checksum-verified**
  version into `resources/bin` before tests+build (`build.yml`), and it's shipped
  via `extraResources` (`to: bin`). The binary is **never committed**
  (`resources/bin/.gitignore`). `pandoc.js` resolves it from
  `process.resourcesPath/bin` when packaged, the project's `resources/bin` when
  run from source (so `npm test` uses it too), then PATH. Because it's bundled,
  `pandoc-convert` declares **no** `requiresEngine` — no badge, no install prompt.
  Bumping the pinned version means updating both the URL and the SHA in
  `build.yml`.
- **A tool that shells out must declare `requiresEngine`** ("libreoffice" /
  "ghostscript"). `engines.js` owns the list; `registry.describe()` drops unknown
  ids. That declaration is the *only* thing driving the startup banner, the
  per-tool warning, and the **tool-list / catalog availability badges** (a tool
  whose engine is missing is dimmed with a "!" and links to its Settings row) —
  never hardcode an engine check in the renderer. `refreshEngines()` repaints the
  rail and catalog so a just-installed engine drops its badge.
- **`engineStatus()` must surface `winget` as a boolean.** The renderer gates its
  one-click *Install* button on `e.winget && CAN_INSTALL`. For a long time
  `engineStatus` didn't include `winget` at all, so the field was `undefined` and
  the Install button (LibreOffice's, the only winget-backed engine) **never
  appeared** even when winget was present. The status object exposes
  `winget: Boolean(e.winget)` (a boolean, never the package id — the id stays
  server-side so the install target can't be steered from the UI), plus
  `downloadHint`/`sizeHint`. `test/engines.test.js` locks the boolean + hint.
- **`sharp` here has no BMP or ICO support, in either direction** (no `magick`
  loader — verified against the prebuilt binary, don't assume the docs). Both
  formats route through `bmp.js` / `ico.js`. An ICO frame can be a PNG *or* a
  headerless BMP whose stored height is doubled by a trailing 1-bit mask;
  `ico.js` handles both.
- **`pdfshrink.js` encodes every page with sharp, never `canvas.toBuffer`.**
  Mixing the two means two JPEG encoders whose quality scales disagree, so the
  same `quality` produced very different files depending on the greyscale
  toggle — and greyscale could come out *larger* than colour.
- **The renderer's whole script lives inside a wrapper function — never unwrap
  it, and never add code at global scope.** `preload.js` exposes the bridge via
  `contextBridge.exposeInMainWorld("api")`, which makes `api` a
  **non-configurable** global property. A top-level `const api` (or any bridge
  key) is then a SyntaxError — *"Identifier 'api' has already been declared"* —
  that rejects the entire script before line 1, so the app opens with an empty
  tool rail, a blank version chip, and no working buttons. This shipped in
  v0.7.0. **Preview mode cannot catch it**: a plain browser has no `window.api`,
  so nothing collides and the page looks fine. `test/renderer-scope.test.js`
  recreates the collision in a `vm` context and asserts no globals leak.
  **Corollary: verifying the UI in the browser pane is not sufficient evidence
  that the packaged app boots — run `npx electron . --enable-logging` and read
  the renderer console.**
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
- **`javascript: false` does NOT make a BrowserWindow offline.** It stops script
  *execution* only; Chromium's resource loader still fetches remote URLs named in
  markup (`<img>`, `<link>`, CSS `url()`). `pdfrender.js` therefore runs its pool
  in a **private session that cancels every non-local scheme** — that block is
  the only thing keeping the "no network calls" promise for HTML→PDF. Never
  remove it, and never move the pool onto the default session (that would apply
  the block to the main window). `test/electron-offline.js` proves remote
  requests are refused *and* that local `<img>` still resolves.
- **Never release a pooled render window while a navigation is in flight.**
  `renderPdf` must `await win.loadURL("about:blank")` before `release(win)`. It
  used to fire-and-forget, so the next job's `loadFile()` raced the parking
  navigation — survivable on Electron 32, a hard process crash on 43. It passed
  at concurrency 1–3 and died at 4, i.e. exactly when a window is first reused.
- **Electron 43+ has no install script**; the binary self-downloads on first
  `npx electron` run. The old `allowScripts: { "electron@32.3.3": true }` entry
  is dead weight — but note npm's `allowScripts` needs an exact `name@version`,
  a bare package name silently does nothing.
- **Office needs LibreOffice installed** (not bundled — it's ~400 MB). It can be
  installed from inside the app via **winget** (`engines.js`), which keeps all
  download/verification in Microsoft's client — the app never fetches a binary.
  Ghostscript has no winget package, so it only ever gets a download link. `office.js`
  auto-detects it; `libreOfficePath` overrides. Each call uses a unique
  `-env:UserInstallation` profile so batch concurrency won't collide.
  **That profile must be a real file URL** — build it with `pathToFileURL()`,
  never `"file://" + dir`. The naive form yields `file://C:\Users\...` on Windows
  (two slashes, backslashes), LibreOffice rejects it, and **every** Office
  conversion fails while looking like a LibreOffice problem. Fixed in v0.8.0;
  `test/office.test.js` asserts the URL shape even when LibreOffice is absent.
- **The updater (`updater.js`) is manual-only and lazy-loaded.** `require("electron-updater")`
  reads `app.getVersion()` at import, so it can only be required inside Electron —
  it is loaded inside `configure()`, never at module scope, so the pure version
  comparator stays testable in plain `node` and `npm test` needs no Electron. In
  dev (unpacked) electron-updater silently no-ops and fires **no event**, which
  would hang the UI on "Checking…", so `check()` guards on `isUpdaterActive()`
  and reports a friendly message instead. `autoDownload`/`autoInstallOnAppQuit`
  are both **false** — nothing fetches or installs without a click.
- **The updater reports in its own panel line (`#updStatus`), never the footer
  status bar (`#status`).** The footer is the app's global status ("Ready",
  "Converting…", "Done") and every writer there leaves a legitimate *final*
  message. The update check's real result comes back asynchronously through
  `onUpdateStatus` → `#updStatus`, so writing "Checking for updates…" to the
  footer left it **stuck there forever** with nothing to clear it (shipped in
  v1.2.0, fixed in v1.2.1). Give updater feedback via `wireUpdates`' local
  `set()` helper; don't call `setStatus()` from the update flow.
- **Artifact names must be space-free** (`electron-builder.yml` sets
  `artifactName: ${name}-${version}-...`). With a space, the on-disk file,
  the URL in `latest.yml` (hyphenated), and the uploaded GitHub asset (spaces →
  dots) all disagree, and the updater's download 404s. CI uploads `latest.yml` +
  `*.blockmap` alongside the `.exe` or the updater has nothing to read.
- **The renderer's script is inside a wrapper function, so its internals cannot be
  reached from a devtools console or `executeJavaScript`.** Test its pure logic by
  lifting the function source out of `index.html` and running it in a `vm` (see
  `test/pagepicker.test.js`) rather than keeping a second copy that will drift.
- **HEIC decode** goes through `heic-convert` because sharp's prebuilt libvips
  usually omits HEIF decode.
- **Word → PDF must NOT go through mammoth.** mammoth (used for docx → md/txt/html)
  is a *semantic* converter: it discards table borders, column widths, cell fills,
  fonts, and rotated text — so a form-style .docx collapsed into an unrecognisable
  blob. docx → pdf instead uses **docx-preview** (pure JS, reads the real OOXML)
  rendered in an offscreen Electron window, then `printToPDF` — a genuine 1:1
  conversion, still fully offline and needing no LibreOffice. `renderDocxPdf` in
  `pdfrender.js` owns it; on any parse failure it falls back to the mammoth
  intermediate so the conversion never hard-fails. **Fidelity was validated by
  rendering the real user document; don't "simplify" it back onto the mammoth
  path.**
- **Word → PDF paginates from the .docx's own `w:pgSz`, not the page-size option.**
  `parseDocxPageSize` reads the section width/height (twips ÷ 1440 = inches;
  orientation is already baked into w:w/w:h) and emits an `@page` rule, printed
  with `preferCSSPageSize:true`. Using the UI's Letter/A4 option instead would
  clip or re-paginate the document. The pageSize/landscape options only apply to
  the md/html/txt → pdf paths.
- **Two render pools, not one.** `pdfrender.js` runs `htmlPool` (javascript:**false**,
  for untrusted converted HTML) and `docxPool` (javascript:**true**, because
  docx-preview must execute). Both use the same private offline session that
  cancels every non-local request, so enabling JS changes nothing about the
  offline promise (`test/electron-offline.js` still passes). **Do not render docx
  by creating a window per file and destroying it** — on Electron 43 destroying a
  window and immediately creating another in that session deadlocks the second
  (reproduced: first docx converts, the next hangs forever). Reuse a pooled window
  and park it on `about:blank` (awaited) before `release`, exactly like the HTML
  pool.
- **The B&W ("Black & White") PDF option is a CSS `filter:grayscale(100%)` on
  `<html>`**, applied at print time with `printBackground:true`. Any CSS filter
  makes Chromium **rasterise** the page, so a greyscale PDF is much larger than the
  vector colour one and its text is no longer selectable — that's expected and
  fine for B&W printing, not a bug. `docx-preview`/`jszip` are pure JS and stay in
  the asar; `pdfrender.js` reads their browser builds with `fs` (works inside asar)
  and inlines them into the render page, escaping any `</script` in the source.

## Roadmap (unbuilt)
Smaller PDF follow-ons now that the engine is in place:
- **PDF → single image montage/contact sheet**, **reorder pages**, **N-up**.

Bigger engines (sidecar pattern in `_template.js` / `office.js`):
- **Bundle LibreOffice** (~400 MB) so Office needs no install: `office.js` should
  prefer a bundled path, then the detected one. Needs a CI download step, and
  can't be verified locally without LibreOffice present.
- **Auto-update** via `electron-updater` against GitHub Releases.
- ~~`pandoc` sidecar → LaTeX, RST, AsciiDoc, Org, EPUB, ipynb…~~ **DONE (v2.0.0)**
  — `pandoc-convert.js` + `pandoc.js`, bundled, `--sandbox` offline. It does *not*
  replace `mammoth`/`html-to-docx` in Document Converter (kept separate, per the
  "new tool" decision); a future pass could route docx writing through it.
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
