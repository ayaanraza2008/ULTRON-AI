import { spawn as nodeSpawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const IMAGE_PATTERN = /^python:3\.12-slim@sha256:[a-f0-9]{64}$/i;
const MAX_CODE_CHARS = 20_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const MAX_TIMEOUT_MS = 8_000;
const DEFAULT_TIMEOUT_MS = 4_000;
const MAX_CONCURRENT_RUNS = 2;
let activeRuns = 0;

function safeCode(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CODE_CHARS ? value : "";
}

export function getCodeSandboxReadiness(env = process.env) {
  const enabled = env.ULTRON_CODE_SANDBOX_ENABLED === "true";
  const image = typeof env.ULTRON_CODE_SANDBOX_IMAGE === "string" ? env.ULTRON_CODE_SANDBOX_IMAGE.trim() : "";
  const pinnedImage = IMAGE_PATTERN.test(image);
  const configured = enabled && pinnedImage;
  return {
    provider: "docker-python-restricted",
    configured,
    enabled,
    state: !enabled ? "disabled" : pinnedImage ? "configured_unverified" : "blocked",
    requiredEnv: ["ULTRON_CODE_SANDBOX_ENABLED=true", "ULTRON_CODE_SANDBOX_IMAGE=python:3.12-slim@sha256:<64-hex-digest>"],
    limits: {
      network: "disabled",
      rootFilesystem: "read_only",
      writableFilesystem: "16 MiB tmpfs only",
      memory: "128 MiB",
      cpu: "0.5 CPU",
      pids: 32,
      timeoutMs: MAX_TIMEOUT_MS,
      outputBytesPerStream: MAX_OUTPUT_BYTES,
      concurrentRuns: MAX_CONCURRENT_RUNS
    },
    note: configured
      ? "A digest-pinned Python image is configured. Docker daemon isolation, runtime health and image provenance still require verification."
      : "Code execution remains disabled until an operator enables it and pins the approved Python 3.12 slim image by SHA-256 digest. No code is executed by this readiness check."
  };
}

function dockerArgs(image, timeoutMs, containerName) {
  return [
    "run", "--rm", "--interactive",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--pids-limit=32",
    "--memory=128m",
    "--memory-swap=128m",
    "--cpus=0.5",
    "--user=65532:65532",
    "--workdir=/tmp",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m",
    "--ulimit", "nofile=64:64",
    "--env", "PYTHONDONTWRITEBYTECODE=1",
    "--env", "PYTHONIOENCODING=utf-8",
    "--pull=never",
    image,
    "python", "-I", "-S", "-B", "-"
  ];
}

export async function runSandboxedPython({
  env = process.env,
  code,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = nodeSpawn
} = {}) {
  const readiness = getCodeSandboxReadiness(env);
  if (!readiness.configured) {
    return { state: "blocked", execution: "not_started", code: "CODE_SANDBOX_NOT_CONFIGURED", message: readiness.note };
  }
  const source = safeCode(code);
  if (!source) {
    return { state: "blocked", execution: "not_started", code: "CODE_SANDBOX_INVALID_SOURCE", message: "Python source must be a non-empty string up to 20,000 characters." };
  }
  const timeout = Number.isInteger(timeoutMs) ? Math.max(1_000, Math.min(MAX_TIMEOUT_MS, timeoutMs)) : DEFAULT_TIMEOUT_MS;
  if (activeRuns >= MAX_CONCURRENT_RUNS) {
    return { state: "busy", execution: "not_started", code: "CODE_SANDBOX_BUSY", message: "The restricted code sandbox is at its concurrency limit." };
  }
  if (typeof spawnImpl !== "function") {
    return { state: "blocked", execution: "not_started", code: "DOCKER_SPAWN_UNAVAILABLE", message: "The restricted Docker runner is unavailable." };
  }

  activeRuns += 1;
  try {
    return await new Promise(resolve => {
      let child;
      const containerName = "ultron-sandbox-" + randomUUID();
      let settled = false;
      let timedOut = false;
      let outputExceeded = false;
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let timer;
      const finish = result => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const kill = () => {
        // Killing the Docker CLI alone can orphan a running container. Ask the
        // daemon to stop this uniquely named container, then terminate the CLI.
        try {
          const killer = spawnImpl("docker", ["kill", containerName], {
            stdio: "ignore",
            windowsHide: true,
            env: {
              PATH: typeof process.env.PATH === "string" ? process.env.PATH : "",
              LANG: "C.UTF-8"
            }
          });
          killer?.on?.("error", () => {});
        } catch {}
        try { child?.kill("SIGKILL"); } catch {}
      };
      try {
        child = spawnImpl("docker", dockerArgs(env.ULTRON_CODE_SANDBOX_IMAGE.trim(), timeout, containerName), {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
          env: {
            PATH: typeof process.env.PATH === "string" ? process.env.PATH : "",
            LANG: "C.UTF-8"
          }
        });
      } catch (error) {
        const missing = error?.code === "ENOENT";
        finish({
          state: "failed",
          execution: "docker",
          code: missing ? "DOCKER_NOT_INSTALLED" : "DOCKER_START_FAILED",
          message: missing ? "Docker CLI is not installed on this host." : "The Docker sandbox process could not start."
        });
        return;
      }
      timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeout);
      const collect = (chunk, stream) => {
        if (settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        if (stream === "stdout") {
          stdoutBytes += buffer.length;
          if (stdoutBytes <= MAX_OUTPUT_BYTES) stdout += buffer.toString("utf8");
        } else {
          stderrBytes += buffer.length;
          if (stderrBytes <= MAX_OUTPUT_BYTES) stderr += buffer.toString("utf8");
        }
        if (stdoutBytes > MAX_OUTPUT_BYTES || stderrBytes > MAX_OUTPUT_BYTES) {
          outputExceeded = true;
          kill();
        }
      };
      child.stdout?.on("data", chunk => collect(chunk, "stdout"));
      child.stderr?.on("data", chunk => collect(chunk, "stderr"));
      child.on("error", error => {
        const missing = error?.code === "ENOENT";
        finish({
          state: "failed",
          execution: "docker",
          code: missing ? "DOCKER_NOT_INSTALLED" : "DOCKER_START_FAILED",
          message: missing ? "Docker CLI is not installed on this host." : "The Docker sandbox process could not start."
        });
      });
      child.on("close", (exitCode, signal) => {
        if (timedOut) {
          finish({ state: "failed", execution: "docker", code: "CODE_SANDBOX_TIMEOUT", timeoutMs: timeout, stdout: stdout.slice(0, 4000), stderr: stderr.slice(0, 4000) });
          return;
        }
        if (outputExceeded) {
          finish({ state: "failed", execution: "docker", code: "CODE_SANDBOX_OUTPUT_LIMIT", outputLimitBytes: MAX_OUTPUT_BYTES });
          return;
        }
        const output = {
          execution: "docker",
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          signal: typeof signal === "string" ? signal : null,
          stdout: stdout.slice(0, 4000),
          stderr: stderr.slice(0, 4000)
        };
        finish(exitCode === 0
          ? { state: "completed", ...output }
          : { state: "failed", code: "CODE_SANDBOX_EXIT_NONZERO", ...output });
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(source);
    });
  } finally {
    activeRuns = Math.max(0, activeRuns - 1);
  }
}

export const codeSandboxLimits = Object.freeze({
  maxCodeChars: MAX_CODE_CHARS,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  maxTimeoutMs: MAX_TIMEOUT_MS,
  defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  maxConcurrentRuns: MAX_CONCURRENT_RUNS
});
