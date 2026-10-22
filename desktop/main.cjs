const { app, BrowserWindow, shell, session, Menu, ipcMain, dialog } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

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
const MAX_LOCAL_TEXT_BYTES = 1_000_000;
const LOCAL_ACTIONS = new Set(["readTextFile", "saveTextFile", "openExternalUrl", "getSystemInfo", "runDiagnostic"]);
const DIAGNOSTICS = Object.freeze({
  systemSummary: { label: "System summary", description: "Read basic OS and memory information. No files or network data are read." },
  nodeVersion: { label: "Node.js version", description: "Run the fixed command node --version (no shell and no user-supplied arguments)." },
  gitVersion: { label: "Git version", description: "Run the fixed command git --version (no shell and no user-supplied arguments)." },
  pythonVersion: { label: "Python version", description: "Run the fixed command python --version (no shell and no user-supplied arguments)." }
});

function isTrustedIpcSender(event) {
  try {
    return Boolean(mainWindow && event.sender === mainWindow.webContents && isTrustedUrl(event.senderFrame?.url || event.sender.getURL()));
  } catch { return false; }
}

async function confirmLocalAction(action, detail) {
  const copy = {
    readTextFile: { title: "Allow ULTRON to read a file?", message: "ULTRON will read the text file you select. If you then submit its contents to the AI, that text may be sent to your configured AI provider.", detail },
    saveTextFile: { title: "Allow ULTRON to save a file?", message: "ULTRON will save text to a location you choose.", detail },
    openExternalUrl: { title: "Open this link?", message: "ULTRON wants to open this HTTPS link in your default browser.", detail },
    getSystemInfo: { title: "Share basic PC information?", message: "ULTRON will receive only the OS platform and architecture, not your username or file paths.", detail },
    runDiagnostic: { title: "Run an allowlisted local diagnostic?", message: "ULTRON will run only a predefined read-only diagnostic. No arbitrary commands or shell scripts are accepted.", detail }
  }[action];
  const answer = await dialog.showMessageBox(mainWindow, {
    type: "warning", buttons: ["Cancel", "Allow once"], defaultId: 0, cancelId: 0,
    title: copy.title, message: copy.message, detail: String(detail || "").slice(0, 500), noLink: true
  });
  return answer.response === 1;
}

ipcMain.handle("ultron:local-action", async (event, request) => {
  if (!isTrustedIpcSender(event)) throw new Error("Untrusted ULTRON window.");
  const action = typeof request?.action === "string" ? request.action : "";
  if (!LOCAL_ACTIONS.has(action)) throw new Error("This local action is not allowlisted.");
  if (action === "getSystemInfo") {
    if (!await confirmLocalAction(action, "Share basic system information with the current ULTRON window?")) return { cancelled: true };
    return { platform: process.platform, architecture: process.arch, companionVersion: "0.2.0" };
  }
  if (action === "runDiagnostic") {
    const diagnostic = typeof request?.diagnostic === "string" ? request.diagnostic : "";
    const spec = DIAGNOSTICS[diagnostic];
    if (!spec) throw new Error("This diagnostic is not allowlisted.");
    if (!await confirmLocalAction(action, spec.label + ": " + spec.description)) return { cancelled: true };
    if (diagnostic === "systemSummary") {
      return {
        diagnostic, label: spec.label,
        result: { platform: process.platform, architecture: process.arch, release: os.release(), totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem(), cpuCount: os.cpus().length },
        execution: "local-read-only"
      };
    }
    const commands = {
      nodeVersion: { command: process.execPath, args: ["--version"] },
      gitVersion: { command: process.platform === "win32" ? "git.exe" : "git", args: ["--version"] },
      pythonVersion: { command: process.platform === "win32" ? "python.exe" : "python3", args: ["--version"] }
    };
    try {
      const result = await execFileAsync(commands[diagnostic].command, commands[diagnostic].args, {
        timeout: 5000, windowsHide: true, shell: false, maxBuffer: 16 * 1024
      });
      return { diagnostic, label: spec.label, result: String(result.stdout || result.stderr || "").trim().slice(0, 2000), execution: "local-read-only" };
    } catch (error) {
      const missing = error.code === "ENOENT";
      return { diagnostic, label: spec.label, error: missing ? "Tool is not installed or not on PATH." : "Diagnostic failed or timed out.", execution: "local-read-only" };
    }
  }
  if (action === "readTextFile") {
    if (!await confirmLocalAction(action, "Choose a text, Markdown, CSV, JSON, or log file. Maximum 1 MB.")) return { cancelled: true };
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "Choose a text file for ULTRON",
      properties: ["openFile"],
      filters: [{ name: "Text files", extensions: ["txt", "md", "csv", "json", "log"] }]
    });
    if (picked.canceled || !picked.filePaths[0]) return { cancelled: true };
    const stat = await fs.stat(picked.filePaths[0]);
    if (!stat.isFile() || stat.size > MAX_LOCAL_TEXT_BYTES) throw new Error("Selected file must be a regular file under 1 MB.");
    const content = await fs.readFile(picked.filePaths[0], "utf8");
    return { name: path.basename(picked.filePaths[0]), content, warning: "Untrusted file text. Review it before sending to an AI provider." };
  }
  if (action === "saveTextFile") {
    const content = typeof request?.content === "string" ? request.content : "";
    if (content.length > MAX_LOCAL_TEXT_BYTES) throw new Error("Text to save must be under 1 MB.");
    if (!await confirmLocalAction(action, "Save " + content.length + " characters to a file you choose?")) return { cancelled: true };
    const picked = await dialog.showSaveDialog(mainWindow, { title: "Save text from ULTRON", defaultPath: "ultron-notes.txt" });
    if (picked.canceled || !picked.filePath) return { cancelled: true };
    await fs.writeFile(picked.filePath, content, { encoding: "utf8", flag: "wx" }).catch(async error => {
      if (error.code !== "EEXIST") throw error;
      const overwrite = await dialog.showMessageBox(mainWindow, { type: "warning", buttons: ["Cancel", "Overwrite"], defaultId: 0, cancelId: 0, message: "This file already exists. Overwrite it?" });
      if (overwrite.response !== 1) throw new Error("Save cancelled.");
      await fs.writeFile(picked.filePath, content, { encoding: "utf8" });
    });
    return { saved: true, name: path.basename(picked.filePath) };
  }
  if (action === "openExternalUrl") {
    let target;
    try { target = new URL(String(request?.url || "")); } catch { throw new Error("A valid HTTPS URL is required."); }
    if (target.protocol !== "https:") throw new Error("Only HTTPS links may be opened.");
    if (!await confirmLocalAction(action, target.toString())) return { cancelled: true };
    await shell.openExternal(target.toString());
    return { opened: true, host: target.host };
  }
  throw new Error("Unsupported local action.");
});

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
