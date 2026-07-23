# Jdot Utilities — Master Conversion Sheet

Everything Jdot Utilities can do today, and everything it realistically *could* do
at this size and complexity. Each entry names the **engine** that powers it, so the
format list reflects what that engine genuinely handles — not a wish list.

**How to read a tool:** within one tool, any listed input converts to any listed
output, unless a note or an excluded-pair says otherwise.

**Legend**
- **Shipping** — built, tested, in the app now.
- **Planned** — designed, engine chosen, not built yet.
- **Candidate** — plausible at this complexity; not yet committed.
- **Offline** — every tool runs entirely on your machine. "Bundled binary" = the
  engine ships inside the `.exe`; "installed" = detected on your system, not shipped.

---

## 1. Documents (shipping; planned expansion below)

**Engine now:** `marked` + `turndown` + `mammoth` + `html-to-docx` + Electron's
Chromium for PDF — pure JS, offline, no binary.

| From \ To | html | md | txt | pdf | docx |
|-----------|:----:|:--:|:---:|:---:|:----:|
| **md**    |  Shipping  | —  | Shipping  | Shipping  | Shipping   |
| **html**  |  —   | Shipping | Shipping  | Shipping  | Shipping   |
| **docx**  |  Shipping  | Shipping | Shipping  | Shipping  | —    |
| **txt**   |  Shipping  | Shipping | —   | Shipping  | Shipping   |

Inputs: md, markdown, html, htm, docx, txt. Options: PDF page size (Letter/A4/Legal/
Tabloid), landscape. Same-format pairs (docx→docx, etc.) are intentionally hidden.

**Planned expansion — `pandoc` sidecar (~130 MB bundled).** One binary takes this from 6
formats to ~45 and writes *real* `.docx` (retiring `html-to-docx` + `mammoth`):
- **Adds inputs:** rst, latex/tex, org, asciidoc, epub, ipynb, docbook, mediawiki, textile, odt, rtf
- **Adds outputs:** rst, latex, org, asciidoc, epub, docbook, ipynb, rtf, odt, typst, fb2
- `pdf` stays output-only. `pdf → editable` belongs to the PDF tools (text/OCR), not here.

---

## 2. Office (shipping)

**Engine:** LibreOffice, **installed** (auto-detected; path set in Settings), not
bundled (~400 MB). Split into three families so only valid pairs are offered; each
converts within its family and to PDF.

| Family | Formats | + always |
|--------|---------|----------|
| **Word** Shipping | docx, doc, odt, rtf | → pdf |
| **Spreadsheets** Shipping | xlsx, xls, ods, csv | → pdf |
| **Presentations** Shipping | pptx, ppt, odp | → pdf |

**Planned:** PDF/A export toggle (LibreOffice supports it) — see §4. **Candidate:**
Writer → epub, Calc → tsv/html.

---

## 3. Images (shipping; planned: raw)

**Engine:** `sharp` (prebuilt native, offline) + `heic-convert` for iPhone photos
+ our own BMP/ICO codecs (`src/main/bmp.js`, `src/main/ico.js`).

- **Inputs:** png, jpg, jpeg, webp, avif, tiff, gif, svg, heic, heif, bmp, ico
- **Outputs:** png, jpg, jpeg, webp, avif, tiff, gif, bmp, ico
- Any input → any output. SVG in is rasterized.
- **Options:** resize preset (4K / 1080p / 720p / web / thumbnail), custom max
  width (overrides the preset), quality, and the ICO size set.
- **ICO out** writes a real multi-resolution Windows icon — 16/32/48/256 by
  default, each frame a PNG — not a renamed image.
- **Why hand-written codecs:** the bundled libvips has no BMP or ICO support in
  either direction (there is no `magick` loader), so these can't be delegated to
  sharp. Writing them keeps the app dependency-free and offline.
- **Planned:** **raw** camera formats (cr2, nef, arw, dng) in.

---

## 4. PDF Toolkit (shipping)

The richest area — more operations than a format grid. All shipped items are `pdf-lib`
(pure JS) or `pdfjs-dist` + `@napi-rs/canvas` (prebuilt native), fully offline.

| Tool | Flow | Engine | Status |
|------|------|--------|:------:|
| **Merge PDFs** | many pdf → 1 pdf | pdf-lib | Shipping |
| **Split PDF** | 1 pdf → many pdf (per-page / every-N / ranges) | pdf-lib | Shipping |
| **Rotate pages** | pdf → pdf (90/180/270, any range) | pdf-lib | Shipping |
| **Delete pages** | pdf → pdf | pdf-lib | Shipping |
| **Extract pages** | pdf → pdf | pdf-lib | Shipping |
| **Images → PDF** | many images → 1 pdf | sharp + pdf-lib | Shipping |
| **PDF → Images** | pdf → png/jpg per page (DPI, range) | pdfjs + canvas | Shipping |
| **PDF → Text** | pdf → txt (text layer) | pdfjs | Shipping |
| **OCR → Text** | scanned pdf / image → txt | `tesseract.js` (bundled eng model) | Shipping |
| **Shrink PDF (built-in)** | pdf → smaller pdf, **no engine needed** (pages become images) | pdfjs + sharp + pdf-lib | Shipping |
| **Compress** | pdf → smaller pdf, text preserved (screen/ebook/printer) | Ghostscript | Shipping |
| **PDF/A (archival)** | pdf → pdf/a-1b/2b | Ghostscript | Shipping |
| **OCR → searchable PDF** | scanned pdf → pdf with a text layer | tesseract + pdf-lib | Planned |
| **Watermark / stamp** | pdf → pdf (diagonal text, any opacity) | pdf-lib | Shipping |
| **Edit metadata** | pdf → pdf (title/author/subject/keywords) | pdf-lib | Shipping |
| **Encrypt / decrypt** | pdf ↔ pdf (password) | needs crypto-capable lib / qpdf | Idea |
| **Reorder / N-up** | pdf → pdf | pdf-lib | Idea |

> **Two compressors, on purpose.** **Shrink PDF (built-in)** needs nothing
> installed and re-renders each page as an image — great for scans, but the text
> layer is lost. **Compress / PDF-A** uses Ghostscript to downsample images while
> leaving text as text, and also writes archival PDF/A. Its "Output" preset picks
> either a compression level or a PDF/A conformance level. It auto-detects an
> installed Ghostscript or uses a bundled copy (`resources/bin/`).

---

## 5. Audio (planned) — `ffmpeg` sidecar (~80 MB bundled)

Any → any: **mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, alac, amr**.
Options: bitrate, sample rate, channels (mono/stereo). Wires the existing
hardware-acceleration setting where relevant.

## 6. Video (planned) — `ffmpeg` sidecar (same binary as audio)

- **Inputs:** mp4, mkv, mov, webm, avi, flv, wmv, mpeg, mpg, m4v, 3gp, ts
- **Outputs (video):** mp4, mkv, mov, webm, avi, gif (animated)
- **Extract:** video → audio-only (mp3/wav/aac/…), video → frames (png/jpg), video → gif
- Options: resolution, bitrate/CRF, fps, trim, `-hwaccel`.

## 7. Ebooks (planned) — `calibre` (`ebook-convert`) sidecar, installed

- **In:** epub, mobi, azw3, azw, fb2, lit, pdb, htmlz, docx, txt, html
- **Out:** epub, mobi, azw3, fb2, pdf, txt, htmlz, docx, rtf — effectively any → any.

## 8. Data (shipping) — pure JS, offline, no binary

Any → any: **json, yaml, csv, tsv, xml**. Flat formats (csv/tsv) flatten
nested structures on the boundary — surfaced as a warning, not a blocker.
**Candidate:** toml.

## 9. Archives (candidate) — pure JS (`fflate`/`tar-stream`) or `7-Zip` sidecar

- **Create (collect):** files → zip / tar / tar.gz
- **Extract (explode):** zip / tar / tar.gz / 7z / rar → files

## 10. Vector & Trace (candidate) — Inkscape + Potrace/VTracer sidecars

- **Vector ↔:** svg ↔ pdf, eps, ps, png, emf, wmf; ai/cdr in (Inkscape)
- **Raster → vector:** png/jpg/bmp → svg auto-trace (Potrace/VTracer)

## 11. 3D Mesh (candidate) — `assimp` sidecar

Any mesh → any mesh: stl, obj, ply, gltf, glb, 3mf, fbx, dae, 3ds, x.
High-value for printing: **stl ↔ 3mf ↔ obj ↔ ply ↔ gltf**.

---

## Coverage & cost summary

| Area | Engine | Offline | Bundle cost | Status |
|------|--------|:-------:|:-----------:|:------:|
| Documents | JS + Electron | yes | — | Shipping |
| Documents (expanded) | pandoc | yes | ~130 MB | Planned |
| Office | LibreOffice | yes | installed (~400 MB) | Shipping |
| Images | sharp + heic-convert + own bmp/ico | yes | prebuilt native | Shipping |
| PDF toolkit (13 tools) | pdf-lib / pdfjs / canvas | yes | prebuilt native | Shipping |
| Shrink PDF (no engine) | pdfjs + sharp + pdf-lib | yes | — | Shipping |
| Compress + PDF/A | Ghostscript | yes | installed or ~30 MB bundled | Shipping |
| OCR | tesseract.js | yes | ~4 MB model bundled | Shipping |
| Data | pure JS | yes | — | Shipping |
| Audio + Video | ffmpeg | yes | ~80 MB | Planned |
| Ebooks | calibre | yes | installed | Planned |
| Archives | fflate / 7-Zip | yes | small / ~2 MB | Idea |
| Vector/Trace | Inkscape + Potrace | yes | large | Idea |
| 3D Mesh | assimp | yes | ~10 MB | Idea |

**Everything is offline** — no format ever needs the network. Pure-JS and
prebuilt-native tools ship with zero setup; sidecar tools follow the pattern in
`src/tools/_template.js` (drop the binary in `resources/bin/`, list it under
electron-builder `extraResources`). A "with all the fixings" build — pandoc +
ffmpeg + Ghostscript on top of what's shipping — lands around **420 MB**.
