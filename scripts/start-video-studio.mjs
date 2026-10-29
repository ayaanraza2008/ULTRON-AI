import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../server.js";

function parseEnvFile(contents) {
  const parsed = {};
  for (const line of String(contents || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    parsed[match[1]] = value;
  }
  return parsed;
}
export async function loadLocalEnvironment({ env = process.env, projectRoot = process.cwd() } = {}) {
  const file = path.join(projectRoot, ".env");
  let local = {};
  try { local = parseEnvFile(await readFile(file, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  return { ...local, ...env, ULTRON_VIDEO_STUDIO_LOCAL_MODE: env.ULTRON_VIDEO_STUDIO_LOCAL_MODE || "true" };
}
export function startLocalStudio({ env, logger = console } = {}) {
  const port = Number(env.PORT) || 10000;
  const app = createApp({ env, logger });
  // Local mode intentionally binds only to loopback. Do not expose it through LAN/tunnels.
  const server = app.listen(port, "127.0.0.1", () => {
    logger.info?.("ULTRON Video Studio ready at http://127.0.0.1:" + port + "/studio");
    logger.info?.("Project data directory: " + (env.ULTRON_VIDEO_STUDIO_DIR || path.join(process.cwd(), ".local", "video-studio")));
  });
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    logger.info?.("Stopping local Video Studio (" + signal + ").");
    server.close(error => {
      if (error) {
        logger.error?.("Could not close local Video Studio cleanly.");
        process.exitCode = 1;
      }
    });
  };
  return { server, stop };
}
const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === path.resolve(fileURLToPath(import.meta.url))) {
  const env = await loadLocalEnvironment();
  const studio = startLocalStudio({ env });
  process.once("SIGINT", () => studio.stop("SIGINT"));
  process.once("SIGTERM", () => studio.stop("SIGTERM"));
}
