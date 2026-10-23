import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureGeoSleuthRuntime } from "./bootstrap-geo-sleuth.mjs";

await ensureGeoSleuthRuntime();
const localBin = path.join(os.homedir(), ".local", "bin");
const env = { ...process.env, PATH: localBin + path.delimiter + (process.env.PATH || "") };
const uvPath = path.join(localBin, process.platform === "win32" ? "uv.exe" : "uv");
if (existsSync(uvPath)) env.GEO_SLEUTH_UV_BIN = uvPath;

const child = spawn(process.execPath, ["server.js"], { env, stdio: "inherit" });
child.on("error", error => {
  console.error("ULTRON server process failed to start:", error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
