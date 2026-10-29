import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGeoSleuthRuntime } from "./bootstrap-geo-sleuth.mjs";
import { runModelProviderSmoke } from "./model-provider-smoke.mjs";
import { runVisionProviderSmoke } from "./model-vision-smoke.mjs";

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


function safeSmokeSummary(result) {
  const safeCode = value => typeof value === "string" && /^[A-Z0-9_]{1,60}$/.test(value) ? value : undefined;
  const safeModel = value => typeof value === "string" && /^[a-zA-Z0-9._:/-]{1,180}$/.test(value) ? value : undefined;
  const attempts = Array.isArray(result?.attempts) ? result.attempts.slice(0, 7).map(attempt => ({
    ...(safeModel(attempt?.model) ? { model: safeModel(attempt.model) } : {}),
    ...(safeCode(attempt?.code) ? { code: safeCode(attempt.code) } : {}),
    ...(Number.isInteger(attempt?.httpStatus) && attempt.httpStatus >= 100 && attempt.httpStatus <= 599
      ? { httpStatus: attempt.httpStatus } : {})
  })) : [];
  return {
    status: ["passed", "failed", "blocked"].includes(result?.status) ? result.status : "failed",
    ...(safeCode(result?.reason) ? { reason: safeCode(result.reason) } : {}),
    ...(safeModel(result?.provider) ? { provider: safeModel(result.provider) } : {}),
    ...(safeModel(result?.model) ? { model: safeModel(result.model) } : {}),
    ...(result?.challengeVerified === true ? { challengeVerified: true } : {}),
    ...(result?.completionReceived === true ? { completionReceived: true } : {}),
    attemptCount: attempts.length,
    attempts
  };
}

/**
 * Optional operator-triggered live provider smoke checks. Both checks use fixed
 * synthetic prompts/images and report metadata only; they never log API keys,
 * generated text, prompts, or raw upstream error bodies.
 */
export async function runStartupProviderSmokes({
  env = process.env,
  logger = console,
  textSmoke = runModelProviderSmoke,
  visionSmoke = runVisionProviderSmoke
} = {}) {
  const reports = {};
  if (env.ULTRON_RUN_STARTUP_MODEL_SMOKE === "YES") {
    try {
      const result = await textSmoke({ env, timeoutMs: 12_000 });
      reports.text = safeSmokeSummary(result);
    } catch {
      reports.text = { status: "failed", reason: "STARTUP_SMOKE_UNEXPECTED" };
    }
    logger.info?.("ULTRON startup model smoke", reports.text);
  }
  if (env.ULTRON_RUN_STARTUP_VISION_SMOKE === "YES") {
    try {
      const result = await visionSmoke({
        env: { ...env, ULTRON_CONFIRM_VISION_SMOKE: "YES" },
        timeoutMs: 12_000
      });
      reports.vision = safeSmokeSummary(result);
    } catch {
      reports.vision = { status: "failed", reason: "STARTUP_SMOKE_UNEXPECTED" };
    }
    logger.info?.("ULTRON startup vision smoke", reports.vision);
  }
  return reports;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  await ensureGeoSleuthRuntime();
  launchUltron();
  if (envSmokeRequested(process.env)) {
    void runStartupProviderSmokes().catch(() => {
      console.warn("ULTRON startup provider smoke failed: STARTUP_SMOKE_UNEXPECTED");
    });
  }
}

function envSmokeRequested(env) {
  return env.ULTRON_RUN_STARTUP_MODEL_SMOKE === "YES" ||
    env.ULTRON_RUN_STARTUP_VISION_SMOKE === "YES";
}
