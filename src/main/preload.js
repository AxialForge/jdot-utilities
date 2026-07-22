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

  pdfPageCount: (p) => ipcRenderer.invoke("pdf:pageCount", p),
  mergePdf: (payload) => ipcRenderer.invoke("pdf:merge", payload),
  onPdfProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on("pdf:progress", h);
    return () => ipcRenderer.removeListener("pdf:progress", h);
  },

  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
