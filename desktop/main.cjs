const { app, BrowserWindow, shell, session, Menu } = require("electron");
const path = require("node:path");

const PRODUCTION_URL = "https://ultron-ai-zvd7.onrender.com";
let mainWindow;
let allowedOrigin;
function getStartUrl() {
  const candidate = process.env.ULTRON_URL || PRODUCTION_URL;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("ULTRON_URL must use HTTPS except for localhost development.");
  }
  allowedOrigin = parsed.origin;
  return parsed.toString();
}
function isTrustedUrl(value) {
  try { return new URL(value).origin === allowedOrigin; } catch { return false; }
}
function createWindow() {
  const startUrl = getStartUrl();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: "#080b12",
    title: "ULTRON AI",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    }
  });
  mainWindow.webContents.on("will-attach-webview", event => event.preventDefault());
  mainWindow.on("closed", () => { mainWindow = null; });
  mainWindow.loadURL(startUrl);
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = webContents.getURL();
    const mediaTypes = Array.isArray(details && details.mediaTypes) ? details.mediaTypes : [];
    const audioOnly = permission === "media" && mediaTypes.includes("audio") && !mediaTypes.includes("video");
    callback(Boolean(isTrustedUrl(requestingUrl) && audioOnly));
  });
  const menu = Menu.buildFromTemplate([
    { label: "ULTRON", submenu: [
      { label: "Reload", accelerator: "Ctrl+R", click: () => mainWindow && mainWindow.webContents.reload() },
      { label: "Open in browser", click: () => shell.openExternal(PRODUCTION_URL).catch(() => {}) },
      { type: "separator" },
      { role: "quit", label: "Quit ULTRON" }
    ] },
    { label: "View", submenu: [
      { role: "toggleDevTools", accelerator: "Ctrl+Shift+I" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" }
    ] }
  ]);
  Menu.setApplicationMenu(menu);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error("ULTRON desktop startup failed:", error.message);
  app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", event => event.preventDefault());
  contents.on("will-navigate", (event, url) => {
    if (contents === mainWindow?.webContents && !isTrustedUrl(url)) event.preventDefault();
  });
});
