# Jdot Utilities — Master Conversion Sheet

Everything Jdot Utilities can do today, and everything it realistically *could* do
at this size and complexity. Each entry names the **engine** that powers it, so the
format list reflects what that engine genuinely handles — not a wish list.

**How to read a tool:** within one tool, any listed input converts to any listed
output, unless a note or an excluded-pair says otherwise.

**Legend**
- ✅ **Shipping** — built, tested, in the app now.
- 🟡 **Planned** — designed, engine chosen, not built yet.
- 💡 **Candidate** — plausible at this complexity; not yet committed.
- **Offline** — every tool runs entirely on your machine. "Bundled binary" = the
  engine ships inside the `.exe`; "installed" = detected on your system, not shipped.

---

## 1. Documents ✅ (+ 🟡 expansion)

**Engine now:** `marked` + `turndown` + `mammoth` + `html-to-docx` + Electron's
Chromium for PDF — pure JS, offline, no binary.

| From \ To | html | md | txt | pdf | docx |
|-----------|:----:|:--:|:---:|:---:|:----:|
| **md**    |  ✅  | —  | ✅  | ✅  | ✅   |
| **html**  |  —   | ✅ | ✅  | ✅  | ✅   |
| **docx**  |  ✅  | ✅ | ✅  | ✅  | —    |
| **txt**   |  ✅  | ✅ | —   | ✅  | ✅   |

Inputs: md, markdown, html, htm, docx, txt. Options: PDF page size (Letter/A4/Legal/
Tabloid), landscape. Same-format pairs (docx→docx, etc.) are intentionally hidden.

**🟡 Expansion — `pandoc` sidecar (~130 MB bundled).** One binary takes this from 6
formats to ~45 and writes *real* `.docx` (retiring `html-to-docx` + `mammoth`):
- **Adds inputs:** rst, latex/tex, org, asciidoc, epub, ipynb, docbook, mediawiki, textile, odt, rtf
- **Adds outputs:** rst, latex, org, asciidoc, epub, docbook, ipynb, rtf, odt, typst, fb2
- `pdf` stays output-only. `pdf → editable` belongs to the PDF tools (text/OCR), not here.

---

## 2. Office ✅

**Engine:** LibreOffice, **installed** (auto-detected; path set in Settings), not
bundled (~400 MB). Split into three families so only valid pairs are offered; each
converts within its family and to PDF.

| Family | Formats | + always |
|--------|---------|----------|
| **Word** ✅ | docx, doc, odt, rtf | → pdf |
| **Spreadsheets** ✅ | xlsx, xls, ods, csv | → pdf |
| **Presentations** ✅ | pptx, ppt, odp | → pdf |

**🟡 Add:** PDF/A export toggle (LibreOffice supports it) — see §4. **💡 Add:**
Writer → epub, Calc → tsv/html.

---

## 3. Images ✅ (+ 🟡 bmp/ico/raw)

**Engine:** `sharp` (prebuilt native, offline) + `heic-convert` for iPhone photos.

- **Inputs ✅:** png, jpg, jpeg, webp, avif, tiff, gif, svg, heic, heif
- **Outputs ✅:** png, jpg, jpeg, webp, avif, tiff, gif
- Any input → any output. SVG in is rasterized. Options: max width (resize), quality.
- **🟡 Add:** bmp (in/out), ico (out, multi-size), **raw** camera formats (cr2, nef, arw, dng) in.

---

## 4. PDF Toolkit ✅ (+ 🟡 Ghostscript)

The richest area — more operations than a format grid. All ✅ items are `pdf-lib`
(pure JS) or `pdfjs-dist` + `@napi-rs/canvas` (prebuilt native), fully offline.

| Tool | Flow | Engine | Status |
|------|------|--------|:------:|
| **Merge PDFs** | many pdf → 1 pdf | pdf-lib | ✅ |
| **Split PDF** | 1 pdf → many pdf (per-page / every-N / ranges) | pdf-lib | ✅ |
| **Rotate pages** | pdf → pdf (90/180/270, any range) | pdf-lib | ✅ |
| **Delete pages** | pdf → pdf | pdf-lib | ✅ |
| **Extract pages** | pdf → pdf | pdf-lib | ✅ |
| **Images → PDF** | many images → 1 pdf | sharp + pdf-lib | ✅ |
| **PDF → Images** | pdf → png/jpg per page (DPI, range) | pdfjs + canvas | ✅ |
| **PDF → Text** | pdf → txt (text layer) | pdfjs | ✅ |
| **PDF/A (archival)** | pdf → pdf/a-1b/2b/3b | **Ghostscript** (bundled, ~30 MB) | 🟡 **next** |
| **Compress / downsample** | pdf → smaller pdf | Ghostscript | 🟡 |
| **OCR scanned PDF** | image-pdf → searchable pdf / txt | `tesseract.js` (bundled lang data) | 🟡 |
| **Watermark / stamp** | pdf → pdf | pdf-lib | 💡 |
| **Encrypt / decrypt** | pdf ↔ pdf (password) | needs crypto-capable lib / qpdf | 💡 |
| **Reorder / N-up** | pdf → pdf | pdf-lib | 💡 |
| **Edit metadata** | pdf → pdf (title/author/…) | pdf-lib | 💡 |

> **PDF/A** can't come from pdf-lib (needs embedded fonts, ICC color profiles, XMP
> metadata). The chosen engine is a **bundled Ghostscript sidecar**, which also gives
> compression — one binary, two features. This is the next build step.

---

## 5. Audio 🟡 — `ffmpeg` sidecar (~80 MB bundled)

Any → any: **mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, alac, amr**.
Options: bitrate, sample rate, channels (mono/stereo). Wires the existing
hardware-acceleration setting where relevant.

## 6. Video 🟡 — `ffmpeg` sidecar (same binary as audio)

- **Inputs:** mp4, mkv, mov, webm, avi, flv, wmv, mpeg, mpg, m4v, 3gp, ts
- **Outputs (video):** mp4, mkv, mov, webm, avi, gif (animated)
- **Extract:** video → audio-only (mp3/wav/aac/…), video → frames (png/jpg), video → gif
- Options: resolution, bitrate/CRF, fps, trim, `-hwaccel`.

## 7. Ebooks 🟡 — `calibre` (`ebook-convert`) sidecar, installed

- **In:** epub, mobi, azw3, azw, fb2, lit, pdb, htmlz, docx, txt, html
- **Out:** epub, mobi, azw3, fb2, pdf, txt, htmlz, docx, rtf — effectively any → any.

## 8. Data 💡 — pure JS, offline, no binary

Any → any: **json, yaml, csv, tsv, xml, toml**. Flat formats (csv/tsv) flatten
nested structures on the boundary — a UI heads-up, not a blocker.

## 9. Archives 💡 — pure JS (`fflate`/`tar-stream`) or `7-Zip` sidecar

- **Create (collect):** files → zip / tar / tar.gz
- **Extract (explode):** zip / tar / tar.gz / 7z / rar → files

## 10. Vector & Trace 💡 — Inkscape + Potrace/VTracer sidecars

- **Vector ↔:** svg ↔ pdf, eps, ps, png, emf, wmf; ai/cdr in (Inkscape)
- **Raster → vector:** png/jpg/bmp → svg auto-trace (Potrace/VTracer)

## 11. 3D Mesh 💡 — `assimp` sidecar

Any mesh → any mesh: stl, obj, ply, gltf, glb, 3mf, fbx, dae, 3ds, x.
High-value for printing: **stl ↔ 3mf ↔ obj ↔ ply ↔ gltf**.

---

## Coverage & cost summary

| Area | Engine | Offline | Bundle cost | Status |
|------|--------|:-------:|:-----------:|:------:|
| Documents | JS + Electron | yes | — | ✅ |
| Documents (expanded) | pandoc | yes | ~130 MB | 🟡 |
| Office | LibreOffice | yes | installed (~400 MB) | ✅ |
| Images | sharp + heic-convert | yes | prebuilt native | ✅ |
| PDF toolkit (8 tools) | pdf-lib / pdfjs / canvas | yes | prebuilt native | ✅ |
| PDF/A + compress | Ghostscript | yes | ~30 MB | 🟡 next |
| OCR | tesseract.js | yes | ~15 MB + lang | 🟡 |
| Audio + Video | ffmpeg | yes | ~80 MB | 🟡 |
| Ebooks | calibre | yes | installed | 🟡 |
| Data | pure JS | yes | — | 💡 |
| Archives | fflate / 7-Zip | yes | small / ~2 MB | 💡 |
| Vector/Trace | Inkscape + Potrace | yes | large | 💡 |
| 3D Mesh | assimp | yes | ~10 MB | 💡 |

**Everything is offline** — no format ever needs the network. Pure-JS and
prebuilt-native tools ship with zero setup; sidecar tools follow the pattern in
`src/tools/_template.js` (drop the binary in `resources/bin/`, list it under
electron-builder `extraResources`). A "with all the fixings" build — pandoc +
ffmpeg + Ghostscript on top of what's shipping — lands around **420 MB**.
