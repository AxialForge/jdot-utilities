const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("api", {
  info: () => ipcRenderer.invoke("app:info"),
  listTools: () => ipcRenderer.invoke("tools:list"),

  pickFiles: () => ipcRenderer.invoke("files:pick"),
  pickFolder: () => ipcRenderer.invoke("folder:pick"),
  addFolderFiles: () => ipcRenderer.invoke("folder:listFiles"),
  reveal: (p) => ipcRenderer.invoke("path:reveal", p),

  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  locateOffice: () => ipcRenderer.invoke("office:locate"),
  pickOneFile: () => ipcRenderer.invoke("file:pickOne"),

  convert: (payload) => ipcRenderer.invoke("convert:run", payload),
  cancelConvert: (jobId) => ipcRenderer.invoke("convert:cancel", jobId),
  onStarted: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on("convert:started", h);
    return () => ipcRenderer.removeListener("convert:started", h);
  },
  onProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on("convert:progress", h);
    return () => ipcRenderer.removeListener("convert:progress", h);
  },
  onFileDone: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on("convert:fileDone", h);
    return () => ipcRenderer.removeListener("convert:fileDone", h);
  },

  // collect / explode utilities (merge, split, …) — one channel for both.
  runUtil: (payload) => ipcRenderer.invoke("util:run", payload),
  onUtilProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on("util:progress", h);
    return () => ipcRenderer.removeListener("util:progress", h);
  },

  pdfPageCount: (p) => ipcRenderer.invoke("pdf:pageCount", p),
  pdfInspect: (p) => ipcRenderer.invoke("pdf:inspect", p),

  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
