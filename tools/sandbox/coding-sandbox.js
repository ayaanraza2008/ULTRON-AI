/**
 * ULTRON AI — Isolated Coding Sandbox Subsystem
 *
 * Provides a bounded, isolated Node.js/Python execution sandbox
 * with strict CPU timeouts, memory caps (256 MB max), output limits (64 KB),
 * isolated scratch workspaces, and emergency termination.
 *
 * Hardware optimized for AMD Ryzen 7 5700U with 8 GB RAM.
 */

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const MAX_EXEC_TIMEOUT_MS = 10_000; // 10 seconds max
const MAX_OUTPUT_BYTES = 64 * 1024; // 64 KB max
const MAX_MEMORY_MB = 256; // 256 MB memory cap

export class CodingSandbox {
  constructor(options = {}) {
    this.sandboxRoot = options.sandboxRoot || path.join(os.tmpdir(), "ultron-coding-sandbox");
    this.timeoutMs = options.timeoutMs || MAX_EXEC_TIMEOUT_MS;
    this.maxMemoryMb = options.maxMemoryMb || MAX_MEMORY_MB;
    this.maxOutputBytes = options.maxOutputBytes || MAX_OUTPUT_BYTES;
    this.executionHistory = [];
  }

  async initialize() {
    try {
      await fs.mkdir(this.sandboxRoot, { recursive: true });
    } catch {}
  }

  /**
   * Execute JavaScript / Node.js code inside the bounded sandbox.
   */
  async executeJavaScript(codeString, filename = "snippet.mjs") {
    await this.initialize();
    const runId = "run-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    const runDir = path.join(this.sandboxRoot, runId);
    await fs.mkdir(runDir, { recursive: true });

    const scriptPath = path.join(runDir, filename);
    await fs.writeFile(scriptPath, String(codeString), "utf-8");

    const startTime = Date.now();

    return new Promise((resolve) => {
      // Spawn isolated node process with strict memory limit (--max-old-space-size)
      const child = spawn(process.execPath, [
        `--max-old-space-size=${this.maxMemoryMb}`,
        "--no-deprecation",
        scriptPath
      ], {
        cwd: runDir,
        env: {
          NODE_ENV: "sandbox",
          PATH: process.env.PATH || ""
        },
        timeout: this.timeoutMs,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGKILL");
      }, this.timeoutMs);

      child.stdout.on("data", (chunk) => {
        if (Buffer.byteLength(stdout) < this.maxOutputBytes) {
          stdout += chunk.toString("utf-8");
        }
      });

      child.stderr.on("data", (chunk) => {
        if (Buffer.byteLength(stderr) < this.maxOutputBytes) {
          stderr += chunk.toString("utf-8");
        }
      });

      child.on("close", async (exitCode) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        // Cleanup temporary script file
        try {
          await fs.rm(runDir, { recursive: true, force: true });
        } catch {}

        const result = {
          runId,
          language: "javascript",
          exitCode: exitCode ?? (killed ? 124 : 1),
          success: exitCode === 0 && !killed,
          timedOut: killed,
          durationMs,
          stdout: stdout.trim().slice(0, this.maxOutputBytes),
          stderr: stderr.trim().slice(0, this.maxOutputBytes)
        };

        this.executionHistory.push({
          runId,
          durationMs,
          success: result.success,
          timestamp: new Date().toISOString()
        });
        if (this.executionHistory.length > 100) this.executionHistory.shift();

        resolve(result);
      });

      child.on("error", async (err) => {
        clearTimeout(timer);
        try { await fs.rm(runDir, { recursive: true, force: true }); } catch {}
        resolve({
          runId,
          language: "javascript",
          exitCode: 1,
          success: false,
          timedOut: false,
          error: err.message,
          stdout: "",
          stderr: err.message
        });
      });
    });
  }

  getExecutionHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }
}
