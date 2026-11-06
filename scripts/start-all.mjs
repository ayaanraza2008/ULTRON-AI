/**
 * ULTRON AI — Master One-Click System Launcher
 *
 * Boots the entire sovereign assistant ecosystem in a single unified process:
 * 1. Spawns ULTRON Core Server (REST API, WebSocket Gateway, Proactive Daemon) on port 10000
 * 2. Spawns ULTRON Web Living Core Proxy on port 3000 (connected to local core)
 * 3. Probes AI Providers (Ollama local, Groq, Gemini, OpenRouter)
 * 4. Opens default browser to the WebGL Living Core HUD (http://localhost:3000)
 * 5. Attaches the interactive Ultron Master Console to the terminal
 */

import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);

const CORE_PORT = process.env.PORT || 10000;
const UI_PORT = process.env.UI_PORT || 3000;

console.log("\x1b[36m\x1b[1m=== INITIATING ULTRON SOVEREIGN BOOTSTRAP ===\x1b[0m");

// 1. Spawn Backend Core Server
const coreEnv = {
  ...process.env,
  PORT: String(CORE_PORT),
  ULTRON_PROACTIVE_DAEMON_ENABLED: "true"
};

const coreProcess = spawn(process.execPath, [path.join(ROOT_DIR, "server.js")], {
  env: coreEnv,
  stdio: ["ignore", "pipe", "pipe"]
});

coreProcess.stdout.on("data", (chunk) => {
  const line = chunk.toString();
  if (line.includes("listening on port") || line.includes("Proactive") || line.includes("WebSocket")) {
    console.log(`\x1b[32m[ULTRON Core]\x1b[0m ${line.trim()}`);
  }
});

coreProcess.stderr.on("data", (chunk) => {
  const line = chunk.toString().trim();
  if (line && !line.includes("ExperimentalWarning")) {
    console.error(`\x1b[31m[ULTRON Core Error]\x1b[0m ${line}`);
  }
});

// 2. Spawn Web UI Proxy
const proxyEnv = {
  ...process.env,
  PORT: String(UI_PORT),
  UI_PORT: String(UI_PORT),
  CORE_API_ORIGIN: `http://127.0.0.1:${CORE_PORT}`
};

const proxyProcess = spawn(process.execPath, [path.join(ROOT_DIR, "core-ui-proxy.mjs")], {
  env: proxyEnv,
  stdio: ["ignore", "pipe", "pipe"]
});

proxyProcess.stdout.on("data", (chunk) => {
  const line = chunk.toString().trim();
  if (line) console.log(`\x1b[35m[ULTRON HUD Proxy]\x1b[0m ${line}`);
});

proxyProcess.stderr.on("data", (chunk) => {
  const line = chunk.toString().trim();
  if (line && !line.includes("ExperimentalWarning")) {
    console.error(`\x1b[31m[ULTRON HUD Error]\x1b[0m ${line}`);
  }
});

// Teardown Handler
function cleanShutdown() {
  console.log("\x1b[33m\n[ULTRON] Draining and shutting down child services...\x1b[0m");
  try { coreProcess.kill(); } catch {}
  try { proxyProcess.kill(); } catch {}
  process.exit(0);
}

process.on("SIGINT", cleanShutdown);
process.on("SIGTERM", cleanShutdown);

// Wait for Core to become ready
async function waitForCore(maxRetries = 20) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CORE_PORT}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const isReady = await waitForCore();
if (isReady) {
  console.log(`\x1b[32m✔ ULTRON Core Online at http://127.0.0.1:${CORE_PORT}\x1b[0m`);
  console.log(`\x1b[32m✔ Living HUD Web Interface Online at http://127.0.0.1:${UI_PORT}\x1b[0m`);

  // Optional: Auto-open browser HUD
  if (process.env.ULTRON_AUTO_OPEN_HUD !== "false") {
    const openCmd = process.platform === "win32" ? `start http://localhost:${UI_PORT}` : `open http://localhost:${UI_PORT}`;
    const { exec } = await import("node:child_process");
    exec(openCmd, () => {});
  }

  // Launch interactive console in the current terminal
  const { UltronConsole } = await import("./ultron-console.mjs");
  const consoleApp = new UltronConsole();
  consoleApp.start();
} else {
  console.warn("\x1b[33mULTRON Core startup slow; proceeding with console initialization...\x1b[0m");
  const { UltronConsole } = await import("./ultron-console.mjs");
  const consoleApp = new UltronConsole();
  consoleApp.start();
}
