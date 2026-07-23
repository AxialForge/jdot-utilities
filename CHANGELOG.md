# Changelog

All notable changes to Jdot Utilities. Dates are YYYY-MM-DD.

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
