const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { loadTools, describe } = require("./registry");
const { runBatch } = require("./convert");
const { mergePdfs, pageCount, inspect: inspectPdf } = require("./pdfops");
const { listFiles } = require("./fsutil");
const { locateSoffice } = require("./office");
const pdfrender = require("./pdfrender");
const settings = require("./settings");
const config = require("../config");

// ── Boot-time settings: decide hardware acceleration before app is ready ──
settings.setPath(app.getPath("userData"));
const boot = settings.readSync();
if (boot.hardwareAcceleration === "off") {
  app.disableHardwareAcceleration();
}

let tools = new Map();
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 580,
    backgroundColor: "#1b1c1e",
    title: config.APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  tools = loadTools();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Tear down the pooled offscreen render windows so they don't keep us alive.
app.on("before-quit", () => {
  for (const job of jobs.values()) job.abort();
  pdfrender.shutdown();
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

// ── Settings ──────────────────────────────────────────────────
ipcMain.handle("settings:get", () => settings.readSync());
ipcMain.handle("settings:set", (_e, patch) => settings.write(patch || {}));

// Report whether LibreOffice can be found (for the Settings UI).
ipcMain.handle("office:locate", () => locateSoffice(settings.readSync().libreOfficePath));

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

// ── PDF operations ────────────────────────────────────────────
ipcMain.handle("pdf:pageCount", (_e, p) => pageCount(p));

// Page count plus a reason if the file can't be merged (encrypted, corrupt, …).
ipcMain.handle("pdf:inspect", (_e, p) => inspectPdf(p));

ipcMain.handle("pdf:merge", async (event, { files, defaultName }) => {
  const save = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "merged.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (save.canceled) return { canceled: true };

  // Refuse to write the output over one of the inputs — pdf-lib has already read
  // them, but the user would still lose a source file.
  const target = path.resolve(save.filePath).toLowerCase();
  if (files.some((f) => path.resolve(f).toLowerCase() === target)) {
    return { ok: false, error: "Choose an output file that isn't one of the inputs." };
  }

  const controller = new AbortController();
  const jobId = nextJobId++;
  jobs.set(jobId, controller);
  try {
    const res = await mergePdfs(
      files,
      save.filePath,
      (frac) => event.sender.send("pdf:progress", frac),
      { signal: controller.signal }
    );
    return { ok: true, jobId, ...res };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    jobs.delete(jobId);
  }
});
