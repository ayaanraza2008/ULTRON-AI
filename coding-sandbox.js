import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const dockerExec = promisify(execFile);
const OWNER = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIGEST = /^[a-z0-9][a-z0-9._:/-]{0,240}@sha256:[a-f0-9]{64}$/i;
const LANGS = new Set(["node", "python"]);
const LIMIT_SOURCE = 20000;
const LIMIT_OUTPUT = 16000;
const clean = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : "";

function imageFor(env, lang) {
  const key = lang === "node" ? "ULTRON_CODING_SANDBOX_NODE_IMAGE" : "ULTRON_CODING_SANDBOX_PYTHON_IMAGE";
  const candidate = clean(env[key], 260);
  return DIGEST.test(candidate) ? candidate : "";
}
function timeoutFor(env) {
  const n = Number.parseInt(String(env.ULTRON_CODING_SANDBOX_TIMEOUT_MS || ""), 10);
  return Number.isFinite(n) ? Math.min(10000, Math.max(1000, n)) : 5000;
}
function boundedOutput(value) {
  const text = typeof value === "string" ? value : "";
  return { text: text.slice(0, LIMIT_OUTPUT), truncated: text.length > LIMIT_OUTPUT };
}
function extractUserCode(prompt, lang) {
  const parts = prompt.split(String.fromCharCode(96).repeat(3));
  if (parts.length !== 3) return null;
  const lines = parts[1].split(/\r?\n/);
  const tag = (lines.shift() || "").trim().toLowerCase();
  const tags = lang === "node" ? ["", "js", "javascript", "node", "nodejs"] : ["", "py", "python"];
  if (!tags.includes(tag)) return null;
  return lines.join("\n").trim();
}

export function hasExplicitSandboxAuthorization(prompt, source, lang) {
  if (typeof prompt !== "string" || typeof source !== "string" || prompt.length > 40000) return false;
  const p = prompt.trim();
  const direct = /^(?:please\s+)?(?:run|execute|test)\s+(?:(?:(?:this|the|following|provided)\s+)?(?:code|script|program|snippet)|(?:(?:this|the|following|provided)\s+)?(?:python|javascript|node(?:\.js)?)\s+(?:code|script|program|snippet))\b/i.test(p);
  if (!direct) return false;
  const provided = extractUserCode(p, lang);
  return provided !== null && provided === source.trim();
}

export function extractExplicitSandboxRequest(prompt) {
  if (typeof prompt !== "string" || prompt.length > 40000) return null;
  for (const language of ["node", "python"]) {
    const source = extractUserCode(prompt.trim(), language);
    if (source && hasExplicitSandboxAuthorization(prompt, source, language)) return { language, source };
  }
  return null;
}

export function codingSandboxReadiness(env = process.env) {
  const enabled = env.ULTRON_CODING_SANDBOX_ENABLED === "true";
  const ownerConfigured = OWNER.test(clean(env.ULTRON_INTEGRATION_OWNER_USER_ID, 80));
  const languages = ["node", "python"].filter(lang => imageFor(env, lang));
  const configured = enabled && ownerConfigured && languages.length > 0;
  const missing = [];
  if (!enabled) missing.push("ULTRON_CODING_SANDBOX_ENABLED=true");
  if (!ownerConfigured) missing.push("valid ULTRON_INTEGRATION_OWNER_USER_ID");
  if (!languages.length) missing.push("at least one digest-pinned runtime image already cached locally");
  return {
    configured, state: configured ? "configured_unverified" : "blocked", enabled, ownerConfigured, languages, missing,
    note: configured ? "Configuration exists; Docker and live execution still need a local smoke test." : "Code execution stays disabled until explicitly configured. Images are never downloaded."
  };
}

export async function runCodeInSandbox({ env = process.env, userId, language, source, execFileImpl = dockerExec } = {}) {
  const runId = randomUUID();
  const configuredOwner = clean(env.ULTRON_INTEGRATION_OWNER_USER_ID, 80).toLowerCase();
  if (!OWNER.test(configuredOwner) || configuredOwner !== String(userId || "").trim().toLowerCase()) {
    return { runId, state: "blocked", code: "SANDBOX_OWNER_ONLY", execution: "not_executed" };
  }
  if (!LANGS.has(language)) return { runId, state: "blocked", code: "SANDBOX_LANGUAGE_UNSUPPORTED", execution: "not_executed" };
  if (env.ULTRON_CODING_SANDBOX_ENABLED !== "true") return { runId, state: "blocked", code: "SANDBOX_DISABLED", execution: "not_executed" };
  const pinnedImage = imageFor(env, language);
  if (!pinnedImage) return { runId, state: "blocked", code: "SANDBOX_IMAGE_NOT_CONFIGURED", execution: "not_executed" };
  if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source, "utf8") > LIMIT_SOURCE || source.includes(String.fromCharCode(0))) {
    return { runId, state: "blocked", code: "SANDBOX_SOURCE_INVALID", execution: "not_executed" };
  }

  const docker = clean(env.ULTRON_CODING_SANDBOX_DOCKER_BIN, 256) || "docker";
  const budget = timeoutFor(env);
  const call = (args, ms = 3000) => execFileImpl(docker, args, { encoding: "utf8", windowsHide: true, maxBuffer: 65536, timeout: ms });
  let dir = "";
  let name = "";
  let id = "";
  try {
    dir = await mkdtemp(join(tmpdir(), "ultron-sandbox-"));
    await chmod(dir, 0o755);
    if (resolve(dir).includes(",")) return { runId, state: "blocked", code: "SANDBOX_PATH_UNSUPPORTED", execution: "not_executed" };
    const filename = language === "node" ? "main.mjs" : "main.py";
    await writeFile(join(dir, filename), source, { encoding: "utf8", mode: 0o444, flag: "wx" });
    await chmod(join(dir, filename), 0o444);
    try {
      await call(["image", "inspect", pinnedImage], 2000);
    } catch {
      return { runId, state: "blocked", code: "SANDBOX_RUNTIME_UNAVAILABLE", execution: "not_executed", message: "Docker or the cached digest-pinned image is unavailable. No image was pulled." };
    }
    name = "ultron-sandbox-" + randomUUID().replaceAll("-", "").slice(0, 20);
    const runner = language === "node" ? "node" : "python3";
    const programArgs = language === "node" ? ["--no-warnings", "/workspace/main.mjs"] : ["-I", "-B", "/workspace/main.py"];
    const args = [
      "create", "--attach=stdout", "--attach=stderr", "--name", name, "--network=none", "--read-only", "--cap-drop=ALL",
      "--security-opt=no-new-privileges:true", "--pids-limit=48", "--memory=256m",
      "--memory-swap=256m", "--cpus=0.5", "--user=65534:65534",
      "--ulimit", "nofile=64:64", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--log-driver=none", "--mount", "type=bind,src=" + resolve(dir) + ",dst=/workspace,readonly",
      "--workdir=/workspace", "--entrypoint", runner, pinnedImage, ...programArgs
    ];
    const created = await call(args, 3000);
    id = String(created.stdout || "").trim();
    if (!/^[a-f0-9]{12,64}$/i.test(id)) return { runId, state: "failed", code: "SANDBOX_CREATE_FAILED", execution: "not_executed" };
    try {
      const out = await call(["start", "--attach", "--sig-proxy=true", id], budget + 1000);
      const stdout = boundedOutput(out.stdout), stderr = boundedOutput(out.stderr);
      return { runId, state: "completed", success: true, exitCode: 0, language, stdout: stdout.text, stderr: stderr.text, outputTruncated: stdout.truncated || stderr.truncated, timeoutMs: budget, execution: "restricted_local_container", limits: { network: "none", memoryMb: 256, cpuCores: 0.5, pids: 48 } };
    } catch (error) {
      const timedOut = error?.code === "ETIMEDOUT" || error?.killed === true || ["SIGTERM", "SIGKILL"].includes(error?.signal);
      const stdout = boundedOutput(error?.stdout), stderr = boundedOutput(error?.stderr);
      return { runId, state: timedOut ? "timed_out" : "failed", success: false, code: timedOut ? "SANDBOX_TIMEOUT" : error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "SANDBOX_OUTPUT_LIMIT" : "SANDBOX_EXECUTION_FAILED", language, stdout: stdout.text, stderr: stderr.text, outputTruncated: stdout.truncated || stderr.truncated || error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", timeoutMs: budget, execution: "restricted_local_container" };
    }
  } catch (error) {
    return { runId, state: "blocked", code: "SANDBOX_RUNTIME_ERROR", execution: "not_executed", detail: String(error?.code || error?.name || "unknown").slice(0, 120), message: "Sandbox preparation failed; host execution is never used as a fallback." };
  } finally {
    if (name) {
      try { await call(["kill", id || name], 1500); } catch {}
      try { await call(["rm", "--force", id || name], 1500); } catch {}
    }
    if (dir) {
      try { await rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }); } catch {}
    }
  }
}
