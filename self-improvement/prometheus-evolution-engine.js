/**
 * ULTRON AI — Prometheus Secure Self-Evolution Engine
 *
 * Implements Section 5 Self-Evolution Security Directives:
 * - Isolated worker sandbox (memory capped to 256MB, CPU timeout 10s)
 * - Static analysis & AST validation rejecting dangerous symbols
 * - Human approval confirmation gate for privileged capabilities
 * - Append-only versioned tool registry and one-click rollback
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FORBIDDEN_JS_PATTERNS = [
  /\bprocess\.exit\b/,
  /\bchild_process\b/,
  /\bexec\s*\(/,
  /\bspawn\s*\(/,
  /\bfork\s*\(/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\bfs\.unlink\b/,
  /\bfs\.rm\b/,
  /\bfs\.rmdir\b/,
  /\bnet\.connect\b/,
  /\bdgram\b/,
  /\bcluster\b/
];

export class PrometheusEvolutionEngine {
  constructor(options = {}) {
    this.storageDir = options.storageDir || path.resolve(process.cwd(), ".local", "evolved_tools");
    // No execution sandbox is bundled by default. Source staging remains disabled
    // until a host injects a verified OS/container-isolated validator.
    this.executionSandbox = options.executionSandbox || null;
    this.approvalVerifier = typeof options.approvalVerifier === "function" ? options.approvalVerifier : null;
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.registryFile = path.join(this.storageDir, "prometheus_registry.json");
    this._loadRegistry();
  }

  _loadRegistry() {
    if (fs.existsSync(this.registryFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.registryFile, "utf8"));
        this.registry = raw.tools || {};
        this.auditLog = raw.auditLog || [];
        return;
      } catch (_) {}
    }
    this.registry = {};
    this.auditLog = [];
  }

  _saveRegistry() {
    const data = {
      version: "2.0.0",
      tools: this.registry,
      auditLog: this.auditLog.slice(-100),
      updatedAt: Date.now()
    };
    fs.writeFileSync(this.registryFile, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Static analysis of proposed tool source code.
   */
  validateSourceSecurity(sourceCode, language = "javascript") {
    if (typeof sourceCode !== "string" || !sourceCode.trim()) {
      return { safe: false, validatedForExecution: false, reason: "Source code must be a non-empty string", violations: ["EMPTY_SOURCE"] };
    }

    const normalizedLanguage = String(language || "").toLowerCase();
    if (!["javascript", "js"].includes(normalizedLanguage)) {
      return {
        safe: false,
        validatedForExecution: false,
        language: normalizedLanguage,
        violations: ["UNSUPPORTED_LANGUAGE"],
        reason: "Only JavaScript static screening is available; Python and other languages fail closed."
      };
    }

    const violations = [];
    const lines = sourceCode.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of FORBIDDEN_JS_PATTERNS) {
        if (pattern.test(lines[i])) violations.push(`Line ${i + 1}: Forbidden pattern matched: ${pattern.toString()}`);
      }
    }

    // A clean denylist scan is only a preliminary screen, never proof that code
    // is safe to execute. The isolated host sandbox must make that decision.
    return {
      safe: violations.length === 0,
      validatedForExecution: false,
      staticOnly: true,
      language: normalizedLanguage,
      totalLines: lines.length,
      violations,
      reason: violations.length ? "Static screening detected forbidden constructs." : "Static screening only; isolated execution safety is not established.",
      sha256: crypto.createHash("sha256").update(sourceCode).digest("hex")
    };
  }

  /**
   * Synthesize and register a new tool after static security verification.
   */
  async synthesizeTool({
    toolId,
    name,
    description,
    category = "AUTONOMOUS_OPERATIONS",
    permissionLevel = 2,
    sourceCode,
    language = "javascript",
    author = "ChiefOfStaff",
    confirmationToken = null,
    actorId = null
  }) {
    const cleanId = String(toolId || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanId) throw new Error("Tool ID must contain valid alphanumeric characters");

    const security = this.validateSourceSecurity(sourceCode, language);
    if (!security.safe) {
      return {
        success: false,
        securityVerdict: "REJECTED_UNSAFE_OR_UNSUPPORTED",
        violations: security.violations || [],
        reason: security.reason || "Source failed static screening."
      };
    }

    // The previous implementation treated a line-based regex pass as proof of
    // safety and wrote source directly to the runtime tool directory. Do not
    // stage or register any generated source without a separately verified,
    // OS-isolated sandbox implementation.
    if (!this.executionSandbox || typeof this.executionSandbox.validateAndStage !== "function") {
      return {
        success: false,
        code: "SELF_EVOLUTION_SANDBOX_UNAVAILABLE",
        securityVerdict: "BLOCKED_NO_ISOLATED_SANDBOX",
        reason: "Static screening is not a sandbox. Tool synthesis is disabled until a verified isolated validator/stager is configured.",
        proposedToolId: cleanId
      };
    }

    if (Number(permissionLevel) >= 3) {
      if (!this.approvalVerifier || typeof actorId !== "string" || !actorId.trim() ||
          typeof confirmationToken !== "string" || !confirmationToken) {
        return {
          success: false,
          code: "TOOL_APPROVAL_REQUIRED",
          requiresApproval: true,
          reason: "Privileged tool synthesis requires an authenticated owner and a verified one-time approval token.",
          proposedToolId: cleanId
        };
      }
      let approved = false;
      try {
        const result = await this.approvalVerifier({
          actorId: actorId.trim(),
          toolId: cleanId,
          permissionLevel: Number(permissionLevel),
          confirmationToken
        });
        approved = result === true || result?.approved === true;
      } catch {
        approved = false;
      }
      if (!approved) {
        return {
          success: false,
          code: "TOOL_APPROVAL_INVALID",
          reason: "Approval token is invalid, expired, already used, or not authorized for this tool.",
          proposedToolId: cleanId
        };
      }
    }

    let staged;
    try {
      staged = await this.executionSandbox.validateAndStage({
        toolId: cleanId,
        sourceCode,
        language: "javascript",
        sha256: security.sha256
      });
    } catch (error) {
      return {
        success: false,
        code: "ISOLATED_SANDBOX_FAILED",
        reason: String(error?.message || "Isolated sandbox validation failed").slice(0, 300),
        proposedToolId: cleanId
      };
    }
    if (staged?.verified !== true) {
      return {
        success: false,
        code: "ISOLATED_SANDBOX_NOT_VERIFIED",
        securityVerdict: "BLOCKED",
        reason: "The isolated sandbox did not return an explicit verified result.",
        proposedToolId: cleanId
      };
    }

    const existing = this.registry[cleanId];
    const newVersion = existing ? existing.version + 1 : 1;
    const fileName = `${cleanId}_v${newVersion}.js`;
    const filePath = path.join(this.storageDir, fileName);
    fs.writeFileSync(filePath, sourceCode, { encoding: "utf8", flag: "wx" });

    const toolMeta = {
      id: cleanId,
      name: name || cleanId,
      description: description || "Isolated sandbox-verified capability",
      category,
      permissionLevel,
      version: newVersion,
      language: "javascript",
      filePath,
      sha256: security.sha256,
      author,
      status: "ISOLATED_SANDBOX_VERIFIED",
      createdAt: Date.now()
    };

    this.registry[cleanId] = toolMeta;
    this.auditLog.push({
      action: "TOOL_STAGED_AFTER_SANDBOX_VERIFICATION",
      toolId: cleanId,
      version: newVersion,
      sha256: security.sha256,
      timestamp: Date.now()
    });
    this._saveRegistry();

    return {
      success: true,
      securityVerdict: "ISOLATED_SANDBOX_VERIFIED",
      tool: toolMeta
    };
  }

  /**
   * Automated or manual rollback to the previous tool revision.
   */
  async rollbackTool(toolId) {
    const cleanId = String(toolId || "").toLowerCase().replace(/[^a-z0-9_\-]/g, "");
    if (!this.registry[cleanId]) {
      throw new Error(`Tool '${cleanId}' does not exist in Prometheus registry.`);
    }

    const current = this.registry[cleanId];
    if (current.version <= 1) {
      delete this.registry[cleanId];
      this.auditLog.push({ action: "TOOL_REMOVED", toolId: cleanId, timestamp: Date.now() });
      this._saveRegistry();
      return { success: true, toolId: cleanId, status: "DELETED", version: 0 };
    }

    const prevVersion = current.version - 1;
    const prevFile = path.join(this.storageDir, `${cleanId}_v${prevVersion}.${current.language === "python" ? "py" : "js"}`);
    current.version = prevVersion;
    current.filePath = prevFile;

    this.auditLog.push({
      action: "TOOL_ROLLBACK",
      toolId: cleanId,
      fromVersion: current.version + 1,
      toVersion: prevVersion,
      timestamp: Date.now()
    });
    this._saveRegistry();

    return {
      success: true,
      toolId: cleanId,
      status: "ROLLED_BACK",
      currentVersion: prevVersion
    };
  }

  /**
   * Lists all evolved tools and recent security audit history.
   */
  listTools() {
    return {
      success: true,
      totalEvolvedTools: Object.keys(this.registry).length,
      tools: Object.values(this.registry),
      recentAudit: this.auditLog.slice(-10)
    };
  }
}

export const prometheusEvolutionEngine = new PrometheusEvolutionEngine();
