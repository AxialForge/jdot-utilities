const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { loadTools, describe } = require("./registry");
const { runBatch } = require("./convert");
const { mergePdfs, pageCount } = require("./pdfops");
const { listFiles } = require("./fsutil");
const { locateSoffice } = require("./office");
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
ipcMain.handle("convert:run", async (event, payload) => {
  const { toolId, files, outputFormat, options, outputDir } = payload;
  const tool = tools.get(toolId);
  if (!tool) return { error: `Unknown tool: ${toolId}` };
  const { concurrency } = settings.readSync();
  const results = await runBatch({
    tool,
    files,
    outputFormat,
    options,
    outputDir,
    concurrency,
    onProgress: (p) => event.sender.send("convert:progress", p),
    onFileDone: (r) => event.sender.send("convert:fileDone", r),
  });
  return { results };
});

// ── PDF operations ────────────────────────────────────────────
ipcMain.handle("pdf:pageCount", (_e, p) => pageCount(p));

ipcMain.handle("pdf:merge", async (event, { files, defaultName }) => {
  const save = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || "merged.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (save.canceled) return { canceled: true };
  try {
    const res = await mergePdfs(files, save.filePath, (frac) =>
      event.sender.send("pdf:progress", frac)
    );
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
