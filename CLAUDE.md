# Anvil — project guide for Claude Code

Anvil is a **local, offline desktop file converter** (Electron). No network, no
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
There is **no formal test runner yet.** Logic has been validated with throwaway
Node scripts that `require('./src/main/registry')` + `require('./src/main/convert')`
and run a tool over a temp file. Good first improvement: add a real test runner
(node:test or vitest) around the registry, convert orchestrator, and each tool.

## Architecture
- **Main process** (`src/main/`, CommonJS): Electron entry, IPC, and all the
  Node-side work. Conversions run here.
- **Renderer** (`src/renderer/index.html`): the entire UI in one self-contained
  file (inline CSS + vanilla JS, no build step). Talks to main only through the
  `window.api` bridge in `preload.js`. It **degrades gracefully**: opened in a
  plain browser (no `window.api`) it runs a "Preview" mode with in-memory state —
  that's how the UI is demoed outside Electron. Keep that fallback working.
- **Tools** (`src/tools/`): each file exports a descriptor (or an array of them).
  The registry auto-loads every `*.js` that isn't prefixed `_`.

### Directory map
```
src/
  config.js              Branding (APP_NAME etc.) in one place
  main/
    main.js              Electron entry; boots settings + hardware accel; all IPC
    preload.js           contextBridge -> window.api
    registry.js          Auto-discovers tools (accepts a descriptor OR an array)
    convert.js           Batch runner with concurrency limit + collision-safe naming
    settings.js          Persists to userData/settings.json (sync read at boot)
    fsutil.js            Folder walker (top-level or recursive), Electron-free/testable
    pdfops.js            PDF merge via pdf-lib
    office.js            LibreOffice locator + headless convert (unique profile per call)
  tools/
    _template.js         Copy to add a tool (documents the contract + sidecar pattern)
    image-convert.js     sharp + heic-convert
    document-convert.js  marked/turndown/mammoth/html-to-docx + Electron printToPDF
    office-convert.js    Word/Sheets/Slides families (array export) via office.js
  renderer/index.html    Whole UI: Convert / Merge PDF / Settings, 3 themes
docs/index.html          GitHub Pages landing page
.github/workflows/build.yml  Windows CI: tag v* -> builds .exe -> attaches to release
```

## Adding a tool (the core extension point)
Copy `src/tools/_template.js`, fill the descriptor, implement `convert()`, drop it
in `src/tools/`. Restart — the registry finds it and the UI renders itself from it.

Descriptor: `{ id, name, category, description, inputFormats[], outputFormats[],
options[], async convert({ inputPath, outputPath, outputFormat, options, onProgress }) }`.
- Every accepted input should convert to every listed output. If a family has
  invalid pairs (e.g. Office), **split into multiple descriptors** and export an
  **array** (see `office-convert.js`) so the UI only offers valid pairs.
- `convert()` writes the output file itself and throws on failure (message shown
  to the user). Call `onProgress(0..1)` when possible.
- Pure JS is preferred. For PDF output, render HTML via Electron
  (`webContents.printToPDF`) — see `document-convert.js`. For heavy formats, use a
  **bundled sidecar binary** (pattern documented at the bottom of `_template.js`).

## Current tools
- **Image** (`sharp` + `heic-convert`): in png/jpg/jpeg/webp/avif/tiff/gif/svg/heic/heif
  → out png/jpg/jpeg/webp/avif/tiff/gif. Options: max width, quality. (No bmp/ico.)
- **Document** (pure JS + Electron PDF): md/markdown/html/htm/docx/txt ↔
  html/md/txt/pdf/docx. Option: PDF page size.
- **Office** (LibreOffice, three families): Word (docx/doc/odt/rtf), Spreadsheets
  (xlsx/xls/ods/csv), Presentations (pptx/ppt/odp) — each within-family + → pdf.
- **Merge PDF** (`pdf-lib`): its own tab, not a registry tool — combine/reorder PDFs.

## Settings (`userData/settings.json`, via `settings:get`/`settings:set` IPC)
`theme` (light|grey|black), `defaultOutputDir`, `pdfPageSize`, `concurrency`,
`hardwareAcceleration` (auto|on|off, read at boot), `recurseFolders`,
`libreOfficePath` (override; null = auto-detect).

## Themes
Three: **light**, **grey** (default), **black**. Driven by CSS custom properties in
`[data-theme="…"]` blocks at the **top of `index.html`**; the accent is copper/amber
(deliberately not blue). To retheme, edit those token blocks only.

## Gotchas / constraints
- **sharp is native.** It's in `asarUnpack` (electron-builder.yml). Build the `.exe`
  **on Windows** (or the Windows CI runner) so the correct `@img/sharp-win32-x64`
  binary is fetched. Cross-building from Linux needs the win32 optional dep forced.
- **PDF output needs Chromium** (Electron `printToPDF`) — it can't run in plain
  `node`, so that path is only exercised inside the app.
- **Office needs LibreOffice installed** (not bundled — it's ~400 MB). `office.js`
  auto-detects it; `libreOfficePath` overrides. Each call uses a unique
  `-env:UserInstallation` profile so batch concurrency won't collide.
- **HEIC decode** goes through `heic-convert` because sharp's prebuilt libvips
  usually omits HEIF decode.

## Roadmap (unbuilt)
- `pandoc` sidecar → LaTeX, reStructuredText, AsciiDoc, Org, EPUB, ipynb…
- `calibre` → ebooks (epub/mobi/azw3/fb2).
- PDF toolkit: split, rotate, delete pages, pdf→images/text.
- Add back **bmp/ico** for images.
- Video/audio via bundled `ffmpeg` (wire the existing hardware-acceleration setting
  to `-hwaccel`).
- Publish `docs/` via GitHub Pages (Settings → Pages → main /docs).

## Release
Push a tag: `git tag v0.3.0 && git push origin v0.3.0` → GitHub Actions builds the
Windows `.exe` and attaches it to a Release. Replace `<you>` in `README.md` and
`docs/index.html` before publishing.
