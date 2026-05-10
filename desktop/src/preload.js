const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gdsAPI", {
  analyzeFile: (filepath) => ipcRenderer.invoke("gds:analyze", filepath),
  openDialog: () => ipcRenderer.invoke("gds:open-dialog"),
  getVersion: () => ipcRenderer.invoke("app:version"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),

  onResult: (cb) => ipcRenderer.on("gds:result", (_, data) => cb(data)),
  onError: (cb) => ipcRenderer.on("gds:error", (_, msg) => cb(msg)),
  onProgress: (cb) => ipcRenderer.on("gds:progress", (_, pct) => cb(pct)),
  onUpdateAvailable: (cb) => ipcRenderer.on("update:available", (_, v) => cb(v)),
  onUpdateDownloaded: (cb) => ipcRenderer.on("update:downloaded", (_, v) => cb(v)),
});
