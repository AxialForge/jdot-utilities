<div align="center">
  <img src="src/renderer/assets/wordmark.png" alt="Jdot Utilities" width="280">

  ### Local file utilities — conversion, PDF tools, and more.
  **No cloud. No account. No upload. Your files never leave your computer.**

  <sub>A single Windows app that bundles many file utilities behind one clean, offline interface.</sub>
</div>

---

## What is it?

**Jdot Utilities** is an offline desktop app (Windows `.exe`) for the everyday file
chores that usually send you to a sketchy upload-your-file website: converting
documents and images, and a full set of PDF tools. Everything runs **on your
machine** — there is no server, no account, and no network call at runtime.

It's built around a **tool registry**: every utility is one self-describing file,
and the interface builds itself from what those files declare. Adding a new
converter doesn't touch the UI.

> Inspired by the idea of all-in-one converters like
> [ConvertX](https://github.com/C4illin/ConvertX), but its own independent
> project — a native offline desktop app rather than a self-hosted web server.

---

## Highlights

- 🔒 **Fully offline & private.** No telemetry, no uploads, no accounts. Verifiable — there are no network calls in the code.
- 🏠 **Drop-and-go.** The Convert tab's **Home** landing auto-detects a dropped file's type and routes it to the right tool.
- 📄 **Real PDF toolkit** — merge, split, rotate, delete/extract pages, images→PDF, PDF→images, PDF→text. Eight tools, all offline.
- 🔁 **Document conversion** — Markdown, HTML, Word (`.docx`), plain text, and PDF, any-to-any.
- 🖼 **Image conversion** — PNG, JPG, WebP, AVIF, TIFF, GIF, plus HEIC/HEIF (iPhone photos), with resize and quality.
- 📊 **Office** (via installed LibreOffice) — Word, spreadsheet, and presentation families, each to PDF.
- 🧭 **All Tools tab** — every capability as a simple card: what it does and its formats, one click to open.
- ⚡ **Batch** — drop 100+ files, per-file progress, a concurrency limit, and cancel.
- 🎨 **Three themes** — Light, Grey, Black, with the brand-blue accent.

👉 **Full capability list — current and planned — is in [FORMATS.md](FORMATS.md).**

---

## Install

**Users:** grab the latest `.exe` from the
[Releases](https://github.com/AxialForge/jdot-utilities/releases) page — either the
installer or the single-file portable build. No setup, no dependencies.

Some tools are optional:
- **Office** conversions need [LibreOffice](https://www.libreoffice.org/) installed
  (auto-detected; path configurable in Settings). Everything else is self-contained.

---

## Run from source (development)

```bash
git clone https://github.com/AxialForge/jdot-utilities.git
cd jdot-utilities
npm install
npm run dev
```

> **Node 18+** is required. `npm install` fetches the prebuilt native binaries
> (`sharp`, `@napi-rs/canvas`). If a postinstall is blocked on npm 11+, run
> `npm approve-scripts electron` once.

### Build the Windows `.exe`

```bash
npm run build:win        # NSIS installer + portable .exe -> ./dist
npm run build:portable   # single-file portable .exe only
```

Build **on Windows** (or the Windows CI runner) so the correct native binaries are
fetched. The app icon comes from `build/icon.ico`.

### Tests

```bash
npm test                          # ~115 unit/integration tests (plain Node)
npx electron test/electron-pdf.js # PDF-output checks (needs Chromium)
npx electron test/electron-ops.js # collect/explode tools end-to-end
```

---

## How it works

The heart of the app is a **tool registry** and three "kinds" that describe how a
utility moves files. That's all the UI and the runners need — everything else is
the tool's own business.

| Kind | Flow | Examples |
|------|------|----------|
| `convert` | N in → N out (one output per input) | Image, Document, Rotate/Delete/Extract, PDF→Text |
| `collect` | N in → 1 out | Merge PDFs, Images→PDF |
| `explode` | 1 in → N out | Split PDF, PDF→Images |

A tool is a single file in `src/tools/` that exports a descriptor and its handler.
The registry auto-discovers it; the rail, format list, and option fields render
themselves from what it declares. **No central switchboard to edit.**

```
src/
  config.js              Branding in one place (rename the app here)
  main/                  Electron main process (CommonJS) — IPC + all Node-side work
    registry.js          Auto-discovers tools; validates the three kinds
    convert.js           Batch runner: concurrency, cancel, collision-safe naming
    ops.js               Runners for collect (N→1) and explode (1→N)
    pdfops.js            PDF merge/split/rotate/delete/extract (pdf-lib)
    pdftext.js pdfraster.js   PDF → text / images (pdfjs + @napi-rs/canvas)
    imgpdf.js htmlutil.js pagespec.js pdfrender.js  …supporting engines
    office.js            LibreOffice locator + headless convert
  tools/                 One file per utility (auto-discovered)
  renderer/index.html    The entire UI — self-contained, no build step
```

For the full developer guide (architecture, gotchas, how PDF metadata is handled,
the ESM-pdfjs wrinkle, etc.) see **[CLAUDE.md](CLAUDE.md)**.

---

## Adding a tool

1. Copy `src/tools/_template.js` to `src/tools/your-tool.js`.
2. Fill in the descriptor: `id`, `name`, `category`, `kind`, `inputFormats`,
   `outputFormats`, optional `options` and `excludePairs`.
3. Implement `convert()` (for `convert`) or `run()` (for `collect`/`explode`).
4. Restart. It appears in the right tab automatically (PDF-category tools go to
   **PDF Tools**, everything else to **Convert**).

A tool can be **pure JavaScript**, use a **prebuilt native module** (like `sharp`),
or **shell out to a bundled binary** (the `ffmpeg`/`pandoc` sidecar pattern is
documented in `_template.js`). Either way it stays offline — the binary ships
inside the app.

---

## Roadmap

Next up: **PDF/A + compression** via a bundled Ghostscript sidecar, then **OCR**
for scanned PDFs, then **audio/video** via `ffmpeg` and **more document formats**
via `pandoc`. The complete plan, with the engine and bundle cost for each, is in
**[FORMATS.md](FORMATS.md)**.

---

## Privacy

Jdot Utilities makes **no network requests** at runtime. Your files are read and
written locally and nothing is ever transmitted. It works with the network cable
unplugged, by design.

## License

MIT — see [LICENSE](LICENSE).
