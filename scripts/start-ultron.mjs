import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGeoSleuthRuntime } from "./bootstrap-geo-sleuth.mjs";

export function launchUltron({ spawnImpl = spawn, processObject = process, env = process.env, projectRoot = process.cwd(), logError = console.error } = {}) {
  const localBin = path.join(os.homedir(), ".local", "bin");
  const childEnv = { ...env, PATH: localBin + path.delimiter + (env.PATH || "") };
  const uvPath = path.join(localBin, process.platform === "win32" ? "uv.exe" : "uv");
  if (existsSync(uvPath)) childEnv.GEO_SLEUTH_UV_BIN = uvPath;

  const child = spawnImpl(processObject.execPath || process.execPath, [path.join(projectRoot, "server.js")], { env: childEnv, stdio: "inherit" });
  let shutdownSignal = null;

  // Render sends SIGTERM during deploy/shutdown. Forward it to the API child and
  // let the server finish its in-flight work before this launcher exits.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    processObject.on(signal, () => {
      if (shutdownSignal) return;
      shutdownSignal = signal;
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    });
  }

  child.on("error", error => {
    logError("ULTRON server process failed to start:", String(error?.message || error).slice(0, 300));
    processObject.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal && !shutdownSignal) {
      // Preserve abnormal child termination when the parent did not initiate shutdown.
      processObject.kill(processObject.pid, signal);
      return;
    }
    processObject.exitCode = Number.isInteger(code) ? code : (shutdownSignal && signal === shutdownSignal ? 0 : 1);
  });
  return child;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  await ensureGeoSleuthRuntime();
  launchUltron();
}
