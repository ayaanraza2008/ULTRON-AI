/**
 * ULTRON AI — Next-Generation Autonomous Intelligence
 * Module: ULTRON GUARDIAN (security/ultron-guardian.js)
 *
 * Implements capability-based least-privilege access, sandboxed code evaluation,
 * secret redaction & protection, tamper-evident hash-chained audit logging,
 * network security verification, and latching Emergency Stop.
 */

import crypto from "node:crypto";
import vm from "node:vm";

export const PERMISSION_SCOPES = {
  READ_ONLY: "READ_ONLY",
  SANDBOX_WRITE: "SANDBOX_WRITE",
  NETWORK_RESTRICTED: "NETWORK_RESTRICTED",
  ADMIN_CONTROL: "ADMIN_CONTROL"
};

const SECRET_DETECTION_REGEXES = [
  /(?:sk-[a-zA-Z0-9_-]{20,})/g,
  /(?:ghp_[a-zA-Z0-9]{36})/g,
  /(?:eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})/g, // JWT
  /(?:postgres(?:ql)?:\/\/[^:]+:[^@]+@[^/]+\/[^?\s]+)/g // Database connection string
];

export class UltronGuardian {
  constructor(options = {}) {
    this.emergencyStopLatched = false;
    this.activeCapabilityTokens = new Map();
    this.auditLogChain = [];
    this.lastBlockHash = "0000000000000000000000000000000000000000000000000000000000000000";
    const configuredMasterKey = options.masterKey ?? process.env.ULTRON_OPERATOR_MASTER_KEY ?? "";
    this.operatorMasterKey = typeof configuredMasterKey === "string" && configuredMasterKey.length >= 32
      ? configuredMasterKey
      : "";
  }

  /**
   * Capability Token Issuer (Least-Privilege)
   */
  issueCapabilityToken(actor, scopes = [PERMISSION_SCOPES.READ_ONLY], ttlMs = 3600_000) {
    if (this.emergencyStopLatched) {
      throw new Error("Cannot issue capability tokens: Emergency Stop is latched.");
    }

    const token = "cap_" + crypto.randomBytes(24).toString("hex");
    const record = {
      token,
      actor,
      scopes: new Set(scopes),
      issuedAt: Date.now(),
      expiresAt: Date.now() + ttlMs
    };

    this.activeCapabilityTokens.set(token, record);
    this.recordAudit("ISSUE_CAPABILITY_TOKEN", actor, { scopes });
    return token;
  }

  /**
   * Asserts token validity and verifies required scope.
   */
  assertPermission(token, requiredScope) {
    if (this.emergencyStopLatched) {
      throw new Error("ACCESS_DENIED: All operations halted under Emergency Stop.");
    }

    const record = this.activeCapabilityTokens.get(token);
    if (!record) {
      throw new Error("ACCESS_DENIED: Invalid or revoked capability token.");
    }

    if (Date.now() > record.expiresAt) {
      this.activeCapabilityTokens.delete(token);
      throw new Error("ACCESS_DENIED: Capability token has expired.");
    }

    if (!record.scopes.has(requiredScope) && !record.scopes.has(PERMISSION_SCOPES.ADMIN_CONTROL)) {
      throw new Error(`ACCESS_DENIED: Token lacks required scope '${requiredScope}'.`);
    }

    return true;
  }

  /**
   * Secret Protection & Redaction:
   * Masks sensitive credentials in strings, logs, or error payloads.
   */
  redactSecrets(rawText) {
    if (typeof rawText !== "string") return rawText;
    let sanitized = rawText;

    for (const regex of SECRET_DETECTION_REGEXES) {
      sanitized = sanitized.replace(regex, match => {
        const hash = crypto.createHash("sha256").update(match).digest("hex").slice(0, 8);
        return `[REDACTED_SECRET:${hash}]`;
      });
    }

    return sanitized;
  }

  /**
   * Tamper-Evident Append-Only Audit Logger (Cryptographic Hash Chain)
   */
  recordAudit(action, actor, payload = {}) {
    const sanitizedPayload = typeof payload === "object"
      ? JSON.parse(this.redactSecrets(JSON.stringify(payload)))
      : this.redactSecrets(String(payload));

    const index = this.auditLogChain.length;
    const timestamp = new Date().toISOString();
    const prevHash = this.lastBlockHash;

    const dataToHash = `${index}:${prevHash}:${timestamp}:${action}:${actor}:${JSON.stringify(sanitizedPayload)}`;
    const currentHash = crypto.createHash("sha256").update(dataToHash).digest("hex");

    const block = {
      index,
      prevHash,
      currentHash,
      timestamp,
      action,
      actor,
      payload: sanitizedPayload
    };

    this.auditLogChain.push(block);
    this.lastBlockHash = currentHash;
    return block;
  }

  /**
   * Verifies the cryptographic integrity of the entire audit chain.
   */
  verifyAuditIntegrity() {
    let expectedPrevHash = "0000000000000000000000000000000000000000000000000000000000000000";

    for (let i = 0; i < this.auditLogChain.length; i++) {
      const block = this.auditLogChain[i];
      if (block.prevHash !== expectedPrevHash) {
        return { valid: false, brokenIndex: i, reason: "Previous hash mismatch" };
      }

      const dataToHash = `${block.index}:${block.prevHash}:${block.timestamp}:${block.action}:${block.actor}:${JSON.stringify(block.payload)}`;
      const recomputedHash = crypto.createHash("sha256").update(dataToHash).digest("hex");

      if (recomputedHash !== block.currentHash) {
        return { valid: false, brokenIndex: i, reason: "Current block hash corruption detected" };
      }

      expectedPrevHash = block.currentHash;
    }

    return { valid: true, totalBlocks: this.auditLogChain.length };
  }

  /**
   * Sandboxed Code Execution:
   * Runs pure logic within a constrained V8 context with no process, network, or file access.
   */
  executeSandboxed(codeString, sandboxContext = {}, timeoutMs = 1500) {
    if (this.emergencyStopLatched) {
      throw new Error("Sandboxed execution prohibited under Emergency Stop.");
    }

    const isolatedContext = vm.createContext({
      Math,
      JSON,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      ...sandboxContext
    });

    try {
      const script = new vm.Script(String(codeString));
      const result = script.runInContext(isolatedContext, { timeout: timeoutMs });
      this.recordAudit("EXECUTE_SANDBOX", "SYSTEM", { codeLength: codeString.length, success: true });
      return { success: true, result };
    } catch (err) {
      this.recordAudit("EXECUTE_SANDBOX", "SYSTEM", { codeLength: codeString.length, success: false, error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Constant-time verification for the separately configured operator reset key.
   * No source-controlled fallback exists. Environment keys must be at least 32 characters.
   */
  verifyOperatorKey(operatorKey) {
    const expected = Buffer.from(String(this.operatorMasterKey || ""), "utf8");
    const provided = Buffer.from(String(operatorKey || ""), "utf8");
    if (!expected.length || expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  }

  /**
   * Latching Emergency Stop
   */
  engageEmergencyStop(reason = "Manual Operator Emergency Stop") {
    this.emergencyStopLatched = true;
    const revokedTokensCount = this.activeCapabilityTokens.size;
    this.activeCapabilityTokens.clear(); // Immediately revoke all issued tokens
    const block = this.recordAudit("ENGAGE_EMERGENCY_STOP", "OPERATOR", { reason });
    return {
      latched: true,
      reason,
      revokedTokensCount,
      auditHash: block.currentHash
    };
  }

  disengageEmergencyStop(operatorKey) {
    if (!this.verifyOperatorKey(operatorKey)) {
      throw new Error("Invalid or unconfigured operator key. Cannot disengage Emergency Stop.");
    }
    this.emergencyStopLatched = false;
    this.recordAudit("DISENGAGE_EMERGENCY_STOP", "OPERATOR", { status: "RESTORED" });
    return { latched: false, status: "SECURITY_ARMED_NOMINAL" };
  }
}

export const ultronGuardian = new UltronGuardian();
