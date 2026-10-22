const { contextBridge, ipcRenderer } = require("electron");

// Expose only narrow, allowlisted actions. The main process validates the sender
// origin and displays a native confirmation before touching local resources.
contextBridge.exposeInMainWorld("ultronDesktop", Object.freeze({
  platform: process.platform,
  companionVersion: "0.2.0",
  getSystemInfo: () => ipcRenderer.invoke("ultron:local-action", { action: "getSystemInfo" }),
  readTextFile: () => ipcRenderer.invoke("ultron:local-action", { action: "readTextFile" }),
  saveTextFile: (content) => ipcRenderer.invoke("ultron:local-action", { action: "saveTextFile", content: String(content ?? "") }),
  openExternalUrl: (url) => ipcRenderer.invoke("ultron:local-action", { action: "openExternalUrl", url: String(url ?? "") })
}));
