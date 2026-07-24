# Changelog

All notable changes to Jdot Utilities. Dates are YYYY-MM-DD.

## 1.1.0 — 2026-07-24

- **Drag to reorder** in Merge PDFs and Images → PDF. Grab a file by the grip and
  drop it where you want; a line shows where it will land. The up/down buttons
  are still there for single steps and for keyboard use.
- **CI now runs the Electron tests too.** The v1.0.0 pre-release crash (any batch
  of four or more documents) got through because the automated build only ran the
  plain-Node suite. The three Electron-hosted suites — PDF output, the render
  pool, and the network-egress block — now run on every push and gate every
  release, so that class of bug can't reach a build again. Fixed a stray typo in
  the queue markup found along the way.

## 1.0.0 — 2026-07-24

First stable release. This one is mostly about trust: an outside code review
found two serious problems, both are fixed and covered by tests, and the app now
tells you the truth about its own state rather than assuming.

### Security and correctness

- **The offline promise was leaking, and now doesn't.** Converting a document to
  PDF renders it in a hidden browser window with JavaScript disabled — but that
  never stopped the renderer from *fetching* remote images, stylesheets, or CSS
  backgrounds named in the file. A document with a hotlinked image quietly made
  real network requests, which told whoever sent it that you opened the file.
  Confirmed with a live test (three requests went out), then fixed by running the
  render pool in a session that refuses every non-local address. A permanent test
  now asserts the requests are attempted and refused, and that local images still
  work so the block isn't over-broad.
- **Updated the browser engine.** The app was on Electron 32, which stopped
  receiving security fixes in March 2025. It is now on 43, the current release.
- **Fixed a crash that would have hit every large batch.** The upgrade exposed a
  latent bug: converting **four or more documents at once** killed the app
  outright. A pooled window was handed to the next job while still navigating
  away from the previous one. It passed at one, two, and three files and died at
  four — squarely in normal use.
- Raised a memory guard on image loading rather than leaving it switched off,
  stopped LibreOffice conversions leaking temp folders on every run, and turned
  off XML entity expansion when reading data files.

### Getting the optional extras

- **One-click install for LibreOffice.** If it isn't found, the app offers to
  install it through Windows Package Manager — Windows does the downloading and
  verifies the signature; the app never fetches or runs an installer itself, and
  only ever acts on an explicit click. Offered on first launch and on the tool
  that needs it.
- Ghostscript has no Windows Package Manager entry, so it gets a link to the
  official download page instead of a button that couldn't work. **Shrink PDF
  needs neither** and is the reason compression works with nothing installed.
- Both now show a status light, so you can see at a glance what's present.

### Knowing what the app is doing

- **Hardware acceleration status light.** The setting says what you *asked for*;
  the light says what's actually happening. A blocked driver, a virtual machine,
  or a crash-triggered fallback all leave the setting reading "auto" while
  everything quietly renders in software — now you can see the difference.
- **Ask where to save.** With no default output folder set, every run opens a
  Save dialog instead of scattering files next to their sources. On by default,
  and switchable in Settings.

## 0.8.0 — 2026-07-23

A working-with-PDFs release: see the pages you're operating on, understand what
the options do, and know what actually happened.

### Fix: Office conversion never worked on Windows
Word, spreadsheet, and presentation conversions failed on every Windows machine,
even with LibreOffice correctly installed. The private profile passed to
LibreOffice was built by gluing `file://` onto a Windows path, producing
`file://C:\Users\...` — wrong URL form and backslashes — which LibreOffice
rejects, so every conversion errored out. Now built with `pathToFileURL()`.
Verified end to end against a real LibreOffice install, including two
conversions running at once.

### Page picker for Rotate, Delete, and Extract
- These tools now show **thumbnails of every page**, and you pick pages by
  clicking instead of typing numbers blind.
- **Rotate** previews the turn live — the thumbnails rotate as you change the
  angle, so you can see the result before running it.
- **Delete** marks pages in red; **Extract** marks kept pages in green.
- Select all / Clear / Invert, and the range field and the thumbnails stay in
  sync in both directions — type `1-3, 5` and those pages highlight, or click
  pages and the field fills itself in.

### Merge PDFs: reorder controls fixed, and sorting added
- The up/down buttons were scattered across the row because the layout reserved
  fewer columns than the row actually used. They're now a proper paired control
  in a fixed position down the whole list.
- New **Sort** control for the file list: name A-Z / Z-A, file type, date
  modified, date created, and size — plus reverse. Sorting is natural-order, so
  `page2` comes before `page10` rather than after it.

### Clearer options and results
- **Compress / PDF-A** and **Shrink PDF** now explain each preset as you select
  it — what it does, roughly what quality to expect, and when not to use it
  (including that PDF/A usually makes files *bigger*).
- **Shrink PDF** reports the actual result per file — `4.2 MB to 780 KB (81%
  smaller)` — or says plainly when it kept the original because shrinking would
  not have helped.

### Tests
- 217 tests, up from 193. Includes an exhaustive check that every possible page
  selection survives the round trip through the range field.

## 0.7.2 — 2026-07-23

**This is the release that actually fixes 0.7.0. Use this one.**

### Fix: the app opened with no tools and nothing responded to clicks
This was the real cause of the dead window, and 0.7.1 did not address it.

- The page script declared `const api` at its top level, while `preload.js`
  publishes the bridge as a non-configurable global of the same name. JavaScript
  forbids a top-level `const` from shadowing such a property, so the **entire**
  page script was rejected before its first line ran — no tool list, no version
  number, no click handlers. The window still drew because the layout is plain
  markup, which made a dead script look like a broken UI.
- The script is now wrapped in a function, where its names are local and cannot
  collide with this or any future bridge key.
- Added a regression test that recreates the bridge as a non-configurable global
  and runs the real page script against it. It fails on the 0.7.0/0.7.1 code and
  passes now. A second test asserts the page leaks no globals at all, so this
  cannot come back under a different name.

Why the release testing missed it: the fault only exists when the bridge is
present. Opened in a plain browser there is no bridge, nothing collides, and the
page behaves perfectly — which is exactly what had been checked. Verifying the
UI in a browser is no longer treated as evidence that the packaged app starts.

## 0.7.1 — 2026-07-23

A hardening release for machines where the app opened but froze. It is worth
keeping, but on its own it did **not** fix the 0.7.0 startup failure — see 0.7.2.

### Fix: window opens but nothing is clickable (GPU / hardware acceleration)
- On some Windows machines — outdated or broken GPU drivers, virtual machines, or
  remote-desktop sessions — an accelerated window could open but never become
  interactive. The app now detects a GPU-process crash, a renderer crash, or a
  window that hangs at startup, and automatically restarts itself with hardware
  acceleration turned off so you get a working window instead of a dead one.
- Added a no-UI escape hatch for a frozen first run: launch with `--safe-mode`
  (or set the `JDOT_DISABLE_GPU=1` environment variable) to force software
  rendering without having to reach the Settings screen. The choice is remembered,
  and you can switch it back under **Settings → Performance → Hardware
  acceleration**.

## 0.7.0 — 2026-07-22

Three additions that all pull in the same direction: **fewer reasons to install
anything else**, and **saying so clearly when something is missing**.

### Shrink PDF (built-in) — compression with no Ghostscript
- A new PDF tool that makes files smaller using nothing but what ships in the
  app. Best on the files people actually need to shrink: scans, phone-photo
  PDFs, image-heavy exports.
- Four presets from "Smallest (72 DPI, grey)" to "High quality (200 DPI)".
- The trade-off is stated in the tool itself: pages become images, so text stops
  being selectable. **Compress / PDF-A** (Ghostscript) remains the choice when
  the text layer has to survive.
- If rasterizing would make a file *bigger* — which happens with text-only PDFs
  — it keeps the original instead. On by default, and switchable.

### BMP and Windows ICO
- The Image Converter now reads **and** writes `bmp` and `ico`.
- ICO output writes a real multi-resolution icon (16 / 32 / 48 / 256 by default),
  so it works as an actual Windows app icon rather than a renamed PNG.
- Both codecs are written from scratch in the app: the bundled image library has
  no BMP or ICO support at all, and this avoids adding a dependency for it.
- Added **resize presets** (4K / 1080p / 720p / web / thumbnail) next to the
  existing custom width, which still overrides them.

### Missing-engine check
- Two tools need external software (Office needs LibreOffice, Compress / PDF-A
  needs Ghostscript). Previously that only surfaced as a failure *after* picking
  files and pressing Convert.
- The app now checks at startup and shows one dismissible banner if either is
  absent, and marks the affected tool itself with a note and a download link.
- A tool declares its own requirement (`requiresEngine`), so this stays
  data-driven — no list to maintain as tools are added.

### Fixed
- **Dropdown options ignored their declared default** and always selected the
  first choice. This meant **Compress / PDF-A silently defaulted to "screen"**
  (the most aggressive, lowest-quality setting) instead of the intended
  "balanced (ebook)".
- Greyscale PDF shrinking encoded each page as JPEG **twice**, which softened
  the image and could make the output larger than the colour version. Both paths
  now share one encoder, so the quality setting means the same thing either way.

### Tests
- 184 tests, up from 150.

## 0.6.0 — 2026-07-22

- **Watermark PDF** — stamp diagonal text (DRAFT, CONFIDENTIAL, …) across every
  page, with adjustable opacity. Pure pdf-lib, offline.
- **Edit PDF Info** — set a PDF's title, author, subject, and keywords.
- The PDF Tools tab is now 12 tools.

## 0.5.1 — 2026-07-22

- Removed all emojis from the app and the docs — plain, professional text throughout.
- The version now shows as a chip next to the app name in the toolbar, and in the
  window title (`Jdot Utilities 0.5.1`) — easier to tell builds apart.
- Added a persistent note that files are temporary and nothing is saved or
  remembered after the app closes.

## 0.5.0 — 2026-07-22

The first public release under [AxialForge](https://github.com/AxialForge). A
complete offline utility app: document, image, and data conversion plus a
ten-tool PDF suite — everything runs on your machine, nothing is uploaded.

### Everything the app converts (as of 0.5.0)

**Documents** — md · html · docx · txt → html · md · txt · pdf · docx (pure JS + Chromium for PDF)
**Images** — png · jpg · webp · avif · tiff · gif · svg · heic · heif → png · jpg · webp · avif · tiff · gif (sharp)
**Data** — json · yaml · csv · tsv · xml, any-to-any (pure JS)
**Office** — Word (docx·doc·odt·rtf), Spreadsheets (xlsx·xls·ods·csv), Presentations (pptx·ppt·odp), each → pdf (LibreOffice)

**PDF toolkit (10 tools):**
- Merge PDFs — many → one
- Split PDF — one → many (per-page / every-N / custom ranges)
- Rotate pages — 90/180/270°, any range
- Delete pages · Extract pages
- Images → PDF — many images → one PDF
- PDF → Images — png/jpg per page, DPI + range
- PDF → Text — extract the text layer
- **OCR → Text** — read scanned PDFs and images with offline OCR (bundled English model)
- **Compress / PDF-A** — shrink a PDF, or convert to archival PDF/A (Ghostscript)

### Added in 0.5.0
- **OCR → Text** (tesseract.js) — fully offline; the English model ships in the app.
- **Compress / PDF-A** (Ghostscript sidecar) — compression is opt-in via the output preset.
- **Data Converter** — JSON / YAML / CSV / TSV / XML with real CSV parsing and nested-data handling.
- **Home landing** on the Convert tab — drop any file, it auto-detects and routes.
- **All Tools** catalog tab — every capability as a card.
- **CI release automation** — pushing a `v*` tag builds and publishes the `.exe`.
- **Code-signing hooks** — set `CSC_LINK` / `CSC_KEY_PASSWORD` to sign (unsigned otherwise).
- Settings: LibreOffice **and** Ghostscript detection, each with a path override.

### Earlier work folded into 0.5.0
- Renamed from **Anvil** to **Jdot Utilities**; brand icons and blue theme.
- Generalized the tool registry to three **kinds** (`convert` / `collect` / `explode`),
  so PDF operations that aren't 1-to-1 became ordinary one-file tools.
- Split the UI into **Convert** and **PDF Tools** tabs.
- Hardened the document path (no more `<style>`/`<script>` leaking into md/txt output,
  collision-safe batch naming, relative-asset resolution, cancellable batches) and
  the PDF merge (encryption-aware, preserves author metadata, warns on dropped form
  fields). Added the full test suite (143 tests) it previously lacked.

### Requirements
- **OCR** and everything except Office/Compress are self-contained.
- **Office** needs LibreOffice installed; **Compress / PDF-A** needs Ghostscript
  (installed or bundled). Both auto-detect; paths are configurable in Settings.
