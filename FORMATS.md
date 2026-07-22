# Anvil — Format & Conversion Reference

How to read this: **within a tool, any listed input converts to any listed output**
unless a note says otherwise. Each planned tool names the engine that would power
it, so the format list reflects what that engine genuinely handles — not a wish list.

---

## Shipping now

### Image Converter — engine: `sharp` + `heic-convert` (offline)

- **Inputs:** png, jpg, jpeg, webp, avif, tiff, gif, svg, heic, heif
- **Outputs:** png, jpg, jpeg, webp, avif, tiff, gif

Any input converts to any output. SVG in is rasterized; HEIC/HEIF (iPhone photos)
decode via `heic-convert`. Options: max width (resize), quality (JPEG/WebP/AVIF).
`sharp` ships prebuilt binaries so it stays offline — it just adds a build step
when packaging. (bmp/ico aren't covered by sharp; ico output can be added later.)

### Document Converter — engines: `marked` + `turndown` + `mammoth` + Electron (pure JS, offline)

No pandoc or LibreOffice binary required; PDF is rendered by Electron's built-in
Chromium. Any input converts to any output:

| From \ To | html | md | txt | pdf | docx |
|-----------|:----:|:--:|:---:|:---:|:----:|
| **md**    |  ✓   | —  |  ✓  |  ✓  |  ✓   |
| **html**  |  —   | ✓  |  ✓  |  ✓  |  ✓   |
| **docx**  |  ✓   | ✓  |  ✓  |  ✓  |  —   |
| **txt**   |  ✓   | ✓  |  —  |  ✓  |  ✓   |

Inputs: md, markdown, html, htm, docx, txt. Option: PDF page size (Letter / A4 / Legal / Tabloid).

### Office Converter — engine: LibreOffice (installed, not bundled)

Uses an installed LibreOffice (auto-detected; path configurable in Settings).
Split into three families so only valid pairs are offered — each converts within
its family and to PDF:

- **Word:** docx, doc, odt, rtf → pdf, docx, odt, rtf
- **Spreadsheets:** xlsx, xls, ods, csv → pdf, xlsx, ods, csv
- **Presentations:** pptx, ppt, odp → pdf, pptx, odp

Everything below is the remaining build-out.

---

## Planned tools

### 1. Image Converter (expanded) — engine: `sharp` or ImageMagick sidecar
Upgrades the built-in tool to modern/wide formats.

- **Inputs:** png, jpg, jpeg, webp, gif, bmp, tiff, avif, heic, heif, svg, ico, raw (camera)
- **Outputs:** png, jpg, jpeg, webp, gif, bmp, tiff, avif, heif, ico, pdf
- **Notes:** any raster in → any raster out. `svg` in is rasterized. `pdf` out wraps one image per page.

### 2. Audio Converter — engine: `ffmpeg` sidecar
- **Formats (any → any):** mp3, wav, flac, aac, m4a, ogg, opus, wma, aiff, alac, amr
- **Options worth exposing:** bitrate, sample rate, channels (mono/stereo).

### 3. Video Converter — engine: `ffmpeg` sidecar
- **Inputs:** mp4, mkv, mov, webm, avi, flv, wmv, mpeg, mpg, m4v, 3gp, ts
- **Outputs (video):** mp4, mkv, mov, webm, avi, gif (animated)
- **Outputs (extract audio):** mp3, wav, aac, flac, m4a, opus
- **Notes:** any container → any container; video → animated gif; video → audio-only.

### 4. Document Converter — engines: `pandoc` (markup) + LibreOffice headless (office)
Two engines because they cover different directions.

**Pandoc (markup / text):**
- **Inputs:** md, markdown, html, docx, odt, rtf, latex/tex, epub, rst, org, ipynb
- **Outputs:** md, html, docx, odt, rtf, latex, pdf, epub, pptx, txt

**LibreOffice (office ↔ office, office → pdf):**
- docx ↔ doc ↔ odt ↔ rtf ↔ txt
- xlsx ↔ xls ↔ ods ↔ csv
- pptx ↔ ppt ↔ odp
- any of the above → **pdf**

- **Notes:** `pdf` is **output-only** here. `pdf → docx/editable` is unreliable and belongs in the PDF tool via text extraction/OCR, not this one.

### 5. Ebook Converter — engine: `calibre` (`ebook-convert`) sidecar
- **Inputs:** epub, mobi, azw3, azw, fb2, lit, pdb, htmlz, docx, txt, html
- **Outputs:** epub, mobi, azw3, fb2, pdf, txt, htmlz, docx, rtf
- **Notes:** effectively any → any; calibre is permissive.

### 6. Data Converter — pure JS (no binary, fully offline)
- **Formats (any → any):** json, yaml, csv, tsv, xml, toml
- **Notes:** csv/tsv are flat/tabular, so nested json/yaml/xml collapses or nests on the boundary — worth a heads-up in the UI, not a blocker.

### 7. PDF Toolkit — engines: JS PDF libs + `poppler`/Ghostscript sidecar
More operations than a format grid:

- **pdf → images:** png, jpg, tiff (one file per page)
- **images → pdf:** png, jpg, tiff, bmp, webp → single pdf
- **pdf → txt:** text extraction (OCR path optional via `tesseract`)
- **pdf ⨯ pdf:** merge, split, rotate, delete pages

### 8. Vector & Trace — engines: Inkscape + Potrace/VTracer
- **Inkscape (vector ↔ vector/raster):** svg ↔ pdf, eps, ps, png, emf, wmf; ai/cdr in
- **Potrace / VTracer (raster → vector):** png, jpg, bmp → svg (auto-trace)

### 9. 3D Mesh Converter — engine: `assimp` sidecar
- **Inputs:** stl, obj, ply, gltf, glb, 3mf, fbx, dae, 3ds, x
- **Outputs:** stl, obj, ply, gltf, glb, 3mf, dae, x
- **Notes:** any mesh → any mesh. The high-value pairs for slicing/printing are
  **stl ↔ 3mf ↔ obj ↔ ply ↔ gltf**.

---

## Quick coverage summary

| Tool | Engine | # in | # out | Offline binary needed? |
|------|--------|:----:|:-----:|:----------------------:|
| Image (built-in) | jimp | 5 | 5 | No |
| Image (expanded) | sharp / ImageMagick | 13 | 11 | Yes (or sharp: no) |
| Audio | ffmpeg | 11 | 11 | Yes |
| Video | ffmpeg | 12 | 11 | Yes |
| Documents (md/html/docx/txt/pdf) | JS + Electron | 6 | 5 | **No** |
| Office (xlsx/pptx/odt/doc/rtf) | LibreOffice | ~10 | ~5 | Yes |
| Ebooks | calibre | 11 | 9 | Yes |
| Data | pure JS | 6 | 6 | No |
| PDF | poppler / JS | — | — | Partly |
| Vector/Trace | Inkscape + Potrace | ~10 | ~10 | Yes |
| 3D Mesh | assimp | 10 | 8 | Yes |

The two pure-JS tools (Data, and the current Image tool) need **no** bundled
binary, so they stay trivially offline. Everything else follows the sidecar
pattern in `_template.js`: ship the binary in `resources/bin/`, still no network.
