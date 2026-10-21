const { contextBridge } = require("electron");

// Intentionally expose no Node.js, shell, filesystem, or arbitrary IPC APIs.
contextBridge.exposeInMainWorld("ultronDesktop", Object.freeze({
  platform: process.platform,
  companionVersion: "0.1.0"
}));
