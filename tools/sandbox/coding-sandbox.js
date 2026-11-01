/**
 * ULTRON AI — Secure Isolated Coding Sandbox (Category K)
 * Module: tools/sandbox/coding-sandbox.js
 *
 * Implements isolated code execution with container detection (Docker),
 * strict CPU/memory limits, network isolation (--network none), read-only root,
 * execution timeouts, and fail-closed security enforcement.
 *
 * Never executes untrusted user code directly on the host machine.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";

const execFileAsync = promisify(execFile);

export const SUPPORTED_SANDBOX_LANGUAGES = ["javascript", "python", "typescript"];

export class CodingSandbox {
  constructor(options = {}) {
    this.timeoutMs = Math.max(1000, Math.min(30000, options.timeoutMs || 5000));
    this.memoryLimitMb = Math.max(64, Math.min(1024, options.memoryLimitMb || 256));
    this.cpuLimit = options.cpuLimit || "0.5";
    this.dockerImageNode = options.dockerImageNode || "node:20-alpine";
    this.dockerImagePython = options.dockerImagePython || "python:3.11-alpine";
    this.executionHistory = [];
    this.isDockerVerified = false;
    this.disabledReason = "CODE_SANDBOX_DISABLED: no verified OS-level isolation runtime is configured (Docker container isolation unavailable). Untrusted execution blocked by design to protect host.";
    // Injection hook for testing isolated container runner without host Docker dependency
    this.customContainerRunner = options.customContainerRunner || null;
  }

  /**
   * Probes for a verified Docker daemon runtime on the host.
   */
  async checkDockerRuntime() {
    if (this.customContainerRunner) {
      this.isDockerVerified = true;
      return { available: true, version: "mock-container-runtime" };
    }

    try {
      const { stdout } = await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
        timeout: 3000,
        windowsHide: true
      });
      if (stdout && stdout.trim()) {
        this.isDockerVerified = true;
        return { available: true, version: stdout.trim() };
      }
    } catch {}

    this.isDockerVerified = false;
    return { available: false, version: null };
  }

  async initialize() {
    const dockerStatus = await this.checkDockerRuntime();
    if (!dockerStatus.available) {
      return {
        ready: false,
        enabled: false,
        code: "CODE_SANDBOX_DISABLED",
        reason: this.disabledReason,
        isolationEngine: "NONE (FAILED_CLOSED)",
        supportedLanguages: SUPPORTED_SANDBOX_LANGUAGES
      };
    }

    return {
      ready: true,
      enabled: true,
      code: "CODE_SANDBOX_ACTIVE",
      isolationEngine: "DOCKER_CONTAINER",
      dockerVersion: dockerStatus.version,
      supportedLanguages: SUPPORTED_SANDBOX_LANGUAGES,
      limits: {
        timeoutMs: this.timeoutMs,
        memoryLimitMb: this.memoryLimitMb,
        cpuLimit: this.cpuLimit,
        network: "NONE_ISOLATED"
      }
    };
  }

  /**
   * Executes JavaScript code inside an isolated ephemeral Docker container.
   */
  async executeJavaScript(codeString, options = {}) {
    return this.executeCode(codeString, "javascript", options);
  }

  /**
   * Executes Python code inside an isolated ephemeral Docker container.
   */
  async executePython(codeString, options = {}) {
    return this.executeCode(codeString, "python", options);
  }

  /**
   * Generalized code execution dispatcher enforcing container boundaries.
   */
  async executeCode(codeString, language = "javascript", options = {}) {
    const lang = String(language || "javascript").toLowerCase();
    if (!SUPPORTED_SANDBOX_LANGUAGES.includes(lang)) {
      return {
        language: lang,
        success: false,
        executed: false,
        timedOut: false,
        errorCode: "UNSUPPORTED_LANGUAGE",
        error: `Language '${lang}' is not supported. Choose from: ${SUPPORTED_SANDBOX_LANGUAGES.join(", ")}`,
        stdout: "",
        stderr: ""
      };
    }

    // Fail closed if container isolation runtime is not verified
    const dockerCheck = await this.checkDockerRuntime();
    if (!dockerCheck.available) {
      return {
        language: lang,
        success: false,
        executed: false,
        timedOut: false,
        errorCode: "CODE_SANDBOX_DISABLED",
        error: this.disabledReason,
        stdout: "",
        stderr: ""
      };
    }

    const execTimeout = Math.min(30000, options.timeoutMs || this.timeoutMs);
    const containerId = "sandbox-" + crypto.randomBytes(6).toString("hex");

    if (this.customContainerRunner) {
      const runnerRes = await this.customContainerRunner(codeString, lang, {
        containerId,
        timeoutMs: execTimeout,
        memoryLimitMb: this.memoryLimitMb,
        cpuLimit: this.cpuLimit
      });
      this.recordHistory(runnerRes);
      return runnerRes;
    }

    // Build strict Docker execution command
    const image = lang === "python" ? this.dockerImagePython : this.dockerImageNode;
    const runArgs = [
      "run",
      "--rm",
      `--name=${containerId}`,
      `--memory=${this.memoryLimitMb}m`,
      `--cpus=${this.cpuLimit}`,
      "--network=none",
      "--read-only",
      "--tmpfs=/tmp:rw,noexec,nosuid,size=32m",
      "--security-opt=no-new-privileges",
      "--user=1000:1000",
      image
    ];

    if (lang === "python") {
      runArgs.push("python3", "-c", codeString);
    } else {
      runArgs.push("node", "-e", codeString);
    }

    const started = Date.now();
    try {
      const { stdout, stderr } = await execFileAsync("docker", runArgs, {
        timeout: execTimeout,
        windowsHide: true,
        maxBuffer: 512 * 1024
      });

      const result = {
        language: lang,
        success: true,
        executed: true,
        timedOut: false,
        executionTimeMs: Date.now() - started,
        stdout: (stdout || "").slice(0, 32768),
        stderr: (stderr || "").slice(0, 32768)
      };

      this.recordHistory(result);
      return result;
    } catch (err) {
      const isTimeout = err.killed || err.signal === "SIGTERM" || err.code === "ETIMEDOUT";

      // Ensure container cleanup if timed out
      if (isTimeout) {
        try { await execFileAsync("docker", ["rm", "-f", containerId], { timeout: 3000 }); } catch {}
      }

      const result = {
        language: lang,
        success: false,
        executed: true,
        timedOut: isTimeout,
        executionTimeMs: Date.now() - started,
        errorCode: isTimeout ? "EXECUTION_TIMEOUT" : "EXECUTION_ERROR",
        error: isTimeout ? `Execution exceeded timeout limit of ${execTimeout}ms.` : err.message,
        stdout: (err.stdout || "").slice(0, 32768),
        stderr: (err.stderr || "").slice(0, 32768)
      };

      this.recordHistory(result);
      return result;
    }
  }

  recordHistory(record) {
    this.executionHistory.push({
      timestamp: new Date().toISOString(),
      ...record
    });
    if (this.executionHistory.length > 50) this.executionHistory.shift();
  }

  getExecutionHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }
}

export const codingSandbox = new CodingSandbox();
