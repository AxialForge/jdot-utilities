# JDot Utilities

**Local file conversion. No cloud, no account, no upload.**

JDot Utilities is a desktop file converter that runs entirely on your machine. Unlike
server-based converters, nothing is uploaded and no network is required — your
files never leave your computer. It's built around a **tool registry**, so
adding a new converter is a single file.

> Inspired by the layout of [ConvertX](https://github.com/C4illin/ConvertX),
> rebuilt as an offline desktop app instead of a self-hosted web server.

---

## Quick start (development)

```bash
git clone https://github.com/<you>/jdot-utilities.git
cd jdot-utilities
npm install
npm run dev
```

## Build the Windows .exe

```bash
npm install
npm run build:win        # NSIS installer + portable .exe in ./dist
# or just the portable single-file .exe:
npm run build:portable
```

The installer and portable executable land in `dist/`. Building a Windows `.exe`
is most reliable **on Windows**; cross-building from Linux/macOS is possible but
needs extra tooling.

*(Optional)* Drop a `build/icon.ico` (256×256 or larger) to brand the app;
otherwise a default icon is used.

---

## How it works

```
src/
  config.js            Branding in one place (rename the app here)
  main/
    main.js            Electron main process + IPC (boots settings, hardware accel)
    preload.js         Safe bridge exposed to the UI as window.api
    registry.js        Auto-discovers every tool in src/tools/
    convert.js         Batch runner with a concurrency limit
    settings.js        Persists preferences to userData/settings.json
    pdfops.js          PDF merge (pure JS, pdf-lib)
  tools/
    _template.js       Copy this to add a tool
    image-convert.js   Built-in image converter (pure JS, offline)
    document-convert.js  md/html/docx/txt <-> html/md/txt/pdf/docx (pure JS + Electron)
  renderer/
    index.html         The whole UI — self-contained (Convert / Merge PDF / Settings, 3 themes)
```

## Features

- **Three themes** — Light, Grey, Black (copper accent), switchable in Settings.
- **Tabs** — Convert, Merge PDF, and Settings.
- **Batch** — add files or a whole folder (optionally recursing into subfolders), handle 100+ at once with an overall
  progress bar and a configurable concurrency limit.
- **Merge PDF** — combine and reorder PDFs into one (not a conversion, its own tab).
- **Settings** — theme, default output folder, PDF page size, batch concurrency,
  and hardware acceleration; saved to disk.
- **Hardware acceleration** — GPU on/off/auto, applied at boot; used where
  supported (PDF rendering today, video later).

**Requirements:** Image, Document, PDF, and Merge are self-contained (`sharp`
ships prebuilt binaries, so they stay offline). The **Office** converter uses an
installed **LibreOffice** — JDot Utilities auto-detects it, or you can set the path in
Settings. Build the `.exe` **on Windows** so the correct `sharp` binary is
fetched automatically.

The UI is **data-driven**: the tool rail, the output-format list, and the option
fields are all generated from what each tool exports. There's no separate place
to register a tool — the registry finds it and the interface renders itself.

---

## Adding a tool

1. Copy `src/tools/_template.js` to `src/tools/your-tool.js`.
2. Fill in the descriptor (`id`, `name`, `category`, `inputFormats`,
   `outputFormats`, optional `options`).
3. Implement `async convert({ inputPath, outputPath, outputFormat, options, onProgress })`.
4. Restart the app. Done — it appears in the left rail automatically.

A tool can be **pure JavaScript** (like the built-in image tool, which uses
`jimp`) or it can **shell out to a bundled binary** for heavy formats:

```js
const { execFile } = require("node:child_process");
// ship ffmpeg.exe in resources/bin/ and enable `extraResources`
// in electron-builder.yml, then:
await new Promise((res, rej) => {
  const p = execFile(ffmpegPath, ["-y", "-i", inputPath, outputPath]);
  p.on("error", rej);
  p.on("exit", (c) => (c === 0 ? res() : rej(new Error("ffmpeg failed"))));
});
```

This keeps everything offline: the binary ships inside the app, so there's still
no network dependency at runtime.

### Tool ideas to add next
- **Audio/Video** via bundled `ffmpeg` (mp4/mkv/webm, mp3/wav/flac)
- **More documents** via bundled `pandoc` (LaTeX, reStructuredText, AsciiDoc,
  Org, EPUB…) and **ebooks** via calibre — the Office converter (Word / Sheets /
  Slides via LibreOffice) and image WebP/AVIF/HEIC already ship.
- **Data** (csv/json/yaml/xml) — pure JS, no binary needed
- **PDF** (merge/split/images) via a JS PDF library

---

## Design notes

JDot Utilities is styled as a precise instrument rather than a web page: a graphite
"workbench" with a single anodized-cyan accent, monospaced format chips and file
sizes, and a job queue that reads like a machine work order (input → output with
a status LED per file).

## License

MIT — see [LICENSE](LICENSE).
