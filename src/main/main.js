const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { loadTools, describe, kindOf } = require("./registry");
const { runBatch } = require("./convert");
const { runCollect, runExplode } = require("./ops");
const { pageCount, inspect: inspectPdf } = require("./pdfops");
const { listFiles } = require("./fsutil");
const { locateSoffice } = require("./office");
const pdfrender = require("./pdfrender");
const settings = require("./settings");
const config = require("../config");
const { shouldDisableGpu, isPersistentSafeMode } = require("./gpu");

// ── Boot-time settings: decide hardware acceleration before app is ready ──
// Must happen before app is ready. Besides the stored setting, honor a no-UI
// escape hatch (--safe-mode / --disable-gpu / JDOT_DISABLE_GPU) so a user whose
// accelerated window is frozen can still launch a working, software-rendered one
// without needing to reach the (unreachable) Settings screen.
settings.setPath(app.getPath("userData"));
const boot = settings.readSync();
if (shouldDisableGpu({ setting: boot.hardwareAcceleration, argv: process.argv, env: process.env })) {
  app.disableHardwareAcceleration();
  // Remember an explicit escape-hatch launch so the next normal start stays safe.
  if (boot.hardwareAcceleration !== "off" &&
      isPersistentSafeMode({ argv: process.argv, env: process.env })) {
    settings.write({ hardwareAcceleration: "off" });
  }
}

let tools = new Map();
let mainWindow = null;

// ── GPU failure recovery ───────────────────────────────────────
// A crashing GPU process (or a window that hangs the instant it opens) is the
// classic cause of "the app launches but nothing is clickable". When it happens,
// fall back to software rendering permanently and relaunch, so the user gets a
// working window instead of a dead one. Guarded so it can't loop: it only fires
// while acceleration is still on, and only once.
const STARTUP_GRACE_MS = 12000;
let launchedAt = Date.now();
let recovering = false;

function fallbackToSoftwareRendering(reason) {
  if (recovering) return;
  if (settings.readSync().hardwareAcceleration === "off") return; // already software
  recovering = true;
  console.error(`GPU/renderer problem (${reason}); disabling hardware acceleration and restarting.`);
  settings.write({ hardwareAcceleration: "off" });
  app.relaunch();
  app.exit(0);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    backgroundColor: "#1b1c1e",
    title: `${config.APP_NAME} ${config.VERSION}`,
    icon: path.join(__dirname, "..", "..", "build", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  // A renderer that dies (GPU/compositor fault) or hangs right after opening is
  // the frozen-window symptom — recover into software rendering. The startup
  // grace window keeps a later, legitimate busy renderer from triggering it.
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    if (details.reason !== "clean-exit") {
      fallbackToSoftwareRendering("renderer-" + details.reason);
    }
  });
  mainWindow.on("unresponsive", () => {
    if (Date.now() - launchedAt < STARTUP_GRACE_MS) {
      fallbackToSoftwareRendering("unresponsive-at-startup");
    }
  });
}

app.whenReady().then(() => {
  tools = loadTools();
  launchedAt = Date.now();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// A GPU-process crash is the most direct signal that acceleration is unusable on
// this machine; fall back to software rendering and relaunch.
app.on("child-process-gone", (_e, details) => {
  if (details.type === "GPU" && details.reason !== "clean-exit") {
    fallbackToSoftwareRendering("gpu-" + details.reason);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Tear down the pooled render windows and the OCR worker so they don't keep us alive.
app.on("before-quit", () => {
  for (const job of jobs.values()) job.abort();
  pdfrender.shutdown();
  require("./ocr").shutdown();
});

// ── Info & tools ──────────────────────────────────────────────
ipcMain.handle("app:info", () => ({
  name: config.APP_NAME,
  tagline: config.TAGLINE,
  version: config.VERSION,
}));

ipcMain.handle("tools:list", () => [...tools.values()].map(describe));

// ── File / folder pickers ─────────────────────────────────────
ipcMain.handle("files:pick", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle("folder:pick", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  return res.canceled ? null : res.filePaths[0];
});

// List files (non-recursive) inside a folder — for batch "Add folder".
ipcMain.handle("folder:listFiles", async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (res.canceled) return [];
  const dir = res.filePaths[0];
  const { recurseFolders } = settings.readSync();
  return listFiles(dir, { recurse: recurseFolders });
});

ipcMain.handle("path:reveal", (_e, p) => {
  if (p) shell.showItemInFolder(p);
});

// Size and timestamps for the queue's sort control. One call for the whole list;
// a file that can't be stat'd still gets an entry so sorting stays stable.
ipcMain.handle("files:stat", (_e, paths) =>
  (Array.isArray(paths) ? paths : []).map((p) => {
    try {
      const s = fs.statSync(p);
      return { path: p, size: s.size, modified: s.mtimeMs, created: s.birthtimeMs || s.ctimeMs };
    } catch {
      return { path: p, size: null, modified: null, created: null };
    }
  })
);

// ── Settings ──────────────────────────────────────────────────
ipcMain.handle("settings:get", () => settings.readSync());
ipcMain.handle("settings:set", (_e, patch) => settings.write(patch || {}));

// Report whether LibreOffice can be found (for the Settings UI).
ipcMain.handle("office:locate", () => locateSoffice(settings.readSync().libreOfficePath));

// Report whether Ghostscript can be found (Compress / PDF-A).
ipcMain.handle("gs:locate", () => require("./gs").locateGs(settings.readSync().ghostscriptPath));

// Status of every optional external engine — drives the first-run notice and the
// per-tool warning, so a missing engine is visible before any work is started.
ipcMain.handle("engines:status", () => require("./engines").engineStatus(settings.readSync()));

// Open an engine's download page in the real browser. The app itself still makes
// no network calls; this hands the URL to the OS.
ipcMain.handle("engines:openDownload", (_e, id) => {
  const engine = require("./engines").ENGINES[id];
  if (engine) shell.openExternal(engine.url);
});

// Pick a single file (used to choose the LibreOffice binary).
ipcMain.handle("file:pickOne", async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ["openFile"] });
  return res.canceled ? null : res.filePaths[0];
});

// ── Conversion ────────────────────────────────────────────────
// In-flight jobs, so the renderer can cancel a long batch. Keyed by job id.
const jobs = new Map();
let nextJobId = 1;

ipcMain.handle("convert:run", async (event, payload) => {
  const { toolId, files, outputFormat, options, outputDir } = payload;
  const tool = tools.get(toolId);
  if (!tool) return { error: `Unknown tool: ${toolId}` };

  const { concurrency } = settings.readSync();
  const controller = new AbortController();
  const jobId = nextJobId++;
  jobs.set(jobId, controller);
  event.sender.send("convert:started", { jobId, total: files.length });

  try {
    const results = await runBatch({
      tool,
      files,
      outputFormat,
      options,
      outputDir,
      concurrency,
      signal: controller.signal,
      onProgress: (p) => event.sender.send("convert:progress", { ...p, jobId }),
      onFileDone: (r) => event.sender.send("convert:fileDone", { ...r, jobId }),
    });
    return { jobId, results, cancelled: controller.signal.aborted };
  } finally {
    jobs.delete(jobId);
  }
});

ipcMain.handle("convert:cancel", (_e, jobId) => {
  // No id = cancel everything in flight (used when the window is closing).
  if (jobId == null) {
    for (const c of jobs.values()) c.abort();
    return { cancelled: true };
  }
  const c = jobs.get(jobId);
  if (!c) return { cancelled: false };
  c.abort();
  return { cancelled: true };
});

// ── collect / explode utilities ───────────────────────────────
// One channel for both single-shot kinds. Adding a PDF utility is a file in
// src/tools/ — no new IPC, no new tab.

ipcMain.handle("util:run", async (event, payload) => {
  const { toolId, files, options, outputDir } = payload;
  const tool = tools.get(toolId);
  if (!tool) return { ok: false, error: `Unknown tool: ${toolId}` };

  const kind = kindOf(tool);
  const controller = new AbortController();
  const jobId = nextJobId++;
  jobs.set(jobId, controller);
  const onProgress = (p) => event.sender.send("util:progress", { ...p, jobId });
  event.sender.send("convert:started", { jobId, total: files?.length || 1 });

  try {
    if (kind === "collect") {
      const ext = (tool.outputFormats[0] || "out").toLowerCase();
      const save = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${tool.defaultName || tool.id}.${ext}`,
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
      });
      if (save.canceled) return { ok: false, canceled: true };
      return await runCollect({
        tool, files, outputPath: save.filePath, options, signal: controller.signal, onProgress,
      });
    }

    if (kind === "explode") {
      let dir = outputDir || settings.readSync().defaultOutputDir;
      if (!dir) {
        const pick = await dialog.showOpenDialog(mainWindow, {
          title: "Where should the output go?",
          properties: ["openDirectory", "createDirectory"],
        });
        if (pick.canceled) return { ok: false, canceled: true };
        dir = pick.filePaths[0];
      }
      return await runExplode({
        tool, file: files?.[0], outputDir: dir, options, signal: controller.signal, onProgress,
      });
    }

    return { ok: false, error: `"${toolId}" is a ${kind} tool — use convert:run.` };
  } finally {
    jobs.delete(jobId);
  }
});

// ── PDF helpers used by the file lists ────────────────────────
ipcMain.handle("pdf:pageCount", (_e, p) => pageCount(p));

// Page count plus a reason if the file can't be used (encrypted, corrupt, …).
ipcMain.handle("pdf:inspect", (_e, p) => inspectPdf(p));

// Page thumbnails for the visual page picker (Rotate / Delete / Extract).
ipcMain.handle("pdf:thumbs", async (_e, p, options) => {
  try {
    return await require("./pdfthumbs").pdfThumbnails(p, options || {});
  } catch (err) {
    return { error: err.message || String(err) };
  }
});
