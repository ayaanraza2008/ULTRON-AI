/**
 * ULTRON AI — Advanced Ethical Hacking & Cybersecurity System
 * Module: TARGET AUTHORIZATION GATEWAY (security/target-authorization-gateway.js)
 *
 * Enforces mandatory scope verification, proof-of-authorization validation,
 * time-bounded testing windows, allowed activity whitelists, request rate limits,
 * and emergency cessation controls for all security assessment tools.
 *
 * PRINCIPLE: No valid authorization scope = Zero active security testing.
 */

import crypto from "node:crypto";
import { ultronGuardian, PERMISSION_SCOPES } from "./ultron-guardian.js";

export const PERMITTED_ACTIVITIES = {
  PASSIVE_RECON: "PASSIVE_RECON",
  VULNERABILITY_SCAN: "VULNERABILITY_SCAN",
  WEB_API_AUDIT: "WEB_API_AUDIT",
  CODE_SECURITY_SAST: "CODE_SECURITY_SAST",
  NETWORK_DEFENSE_AUDIT: "NETWORK_DEFENSE_AUDIT",
  AI_REDTEAM_EVAL: "AI_REDTEAM_EVAL",
  CONTROLLED_PENTEST: "CONTROLLED_PENTEST",
  INCIDENT_INVESTIGATION: "INCIDENT_INVESTIGATION",
  REMEDIATION_PATCH: "REMEDIATION_PATCH"
};

export const TARGET_TYPES = {
  LOCAL_LAB: "LOCAL_LAB",
  WEB_APP: "WEB_APP",
  REST_API: "REST_API",
  NETWORK_HOST: "NETWORK_HOST",
  SOURCE_REPOSITORY: "SOURCE_REPOSITORY",
  CLOUD_DEPLOYMENT: "CLOUD_DEPLOYMENT",
  CTF_CHALLENGE: "CTF_CHALLENGE"
};

export class TargetAuthorizationGateway {
  constructor(options = {}) {
    this.guardian = options.guardian || ultronGuardian;
    this.activeScopes = new Map();
    this.emergencyStopEngaged = false;
    this.defaultRateLimit = 5; // Max 5 req/sec default to avoid service disruption

    // Seed default authorized local security laboratory scope
    this._seedDefaultLocalLabScope();
  }

  /**
   * Internal helper: Register default localhost/lab scope
   */
  _seedDefaultLocalLabScope() {
    const localScope = {
      scopeId: "scope-local-default",
      organization: "ULTRON Development & Security Lab",
      owner: "System Administrator",
      targets: ["localhost", "127.0.0.1", "::1", "local.test"],
      targetType: TARGET_TYPES.LOCAL_LAB,
      permittedActivities: Object.values(PERMITTED_ACTIVITIES),
      excludedEndpoints: ["/api/emergency/stop"],
      allowedRateLimit: 10,
      validFrom: new Date(Date.now() - 3600_000).toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      ownerApproved: true,
      authorizationProof: "SYSTEM_LOCAL_DEVELOPMENT_ENVIRONMENT",
      emergencyContact: "sec-admin@localhost",
      createdAt: new Date().toISOString()
    };
    this.activeScopes.set(localScope.scopeId, localScope);
  }

  /**
   * Register and validate a new authorized security testing scope.
   */
  registerScope(scopeData = {}) {
    if (this.emergencyStopEngaged) {
      throw new Error("Cannot register scope: Cybersecurity operations halted under Emergency Stop.");
    }

    const {
      organization,
      owner,
      targets,
      targetType = TARGET_TYPES.WEB_APP,
      permittedActivities = [PERMITTED_ACTIVITIES.PASSIVE_RECON, PERMITTED_ACTIVITIES.VULNERABILITY_SCAN],
      excludedEndpoints = [],
      allowedRateLimit = this.defaultRateLimit,
      validDurationHours = 24,
      ownerApproved = false,
      authorizationProof,
      emergencyContact
    } = scopeData;

    if (!organization || typeof organization !== "string") {
      throw new Error("Scope registration failed: 'organization' is required.");
    }
    if (!ownerApproved || !authorizationProof) {
      this.guardian.recordAudit("SECURITY_SCOPE_REJECTED", owner || "anonymous", {
        reason: "EXPLICIT_OWNER_AUTHORIZATION_PROOF_REQUIRED",
        organization
      });
      throw new Error("Scope registration failed: Explicit owner approval and verified authorization proof are mandatory.");
    }

    const normalizedTargets = (Array.isArray(targets) ? targets : [targets])
      .map(t => String(t || "").toLowerCase().trim())
      .filter(Boolean);

    if (normalizedTargets.length === 0) {
      throw new Error("Scope registration failed: At least one valid target must be declared.");
    }

    const now = Date.now();
    const scopeId = "scope-" + Date.now() + "-" + crypto.randomBytes(4).toString("hex");

    const record = {
      scopeId,
      organization: organization.trim(),
      owner: String(owner || "Verified Operator").trim(),
      targets: normalizedTargets,
      targetType,
      permittedActivities: Array.isArray(permittedActivities) ? permittedActivities : [permittedActivities],
      excludedEndpoints: Array.isArray(excludedEndpoints) ? excludedEndpoints : [],
      allowedRateLimit: Math.min(Math.max(Number(allowedRateLimit) || this.defaultRateLimit, 1), 20),
      validFrom: new Date(now).toISOString(),
      validUntil: new Date(now + validDurationHours * 3600_000).toISOString(),
      ownerApproved: true,
      authorizationProof: String(authorizationProof).trim(),
      emergencyContact: String(emergencyContact || "security@operator.local").trim(),
      createdAt: new Date().toISOString()
    };

    this.activeScopes.set(scopeId, record);

    this.guardian.recordAudit("SECURITY_SCOPE_REGISTERED", record.owner, {
      scopeId,
      organization: record.organization,
      targets: record.targets,
      targetType: record.targetType,
      validUntil: record.validUntil
    });

    return record;
  }

  /**
   * Authorizes an operation against the registered scopes before execution.
   */
  assertAuthorization(target, requestedActivity = PERMITTED_ACTIVITIES.PASSIVE_RECON) {
    if (this.emergencyStopEngaged) {
      throw new Error("AUTHORIZATION_DENIED: All security testing is halted under EMERGENCY_STOP.");
    }

    const cleanTarget = String(target || "").toLowerCase().trim();
    if (!cleanTarget) {
      throw new Error("AUTHORIZATION_DENIED: Target must be a non-empty string.");
    }

    const now = Date.now();
    let matchingScope = null;

    for (const scope of this.activeScopes.values()) {
      // Check expiration
      if (now > new Date(scope.validUntil).getTime()) {
        continue;
      }

      // Check target match (exact or subdomain/suffix)
      const matchesTarget = scope.targets.some(t => {
        if (cleanTarget === t) return true;
        if (cleanTarget.endsWith("." + t) || cleanTarget.startsWith(t + "/") || cleanTarget.includes("://" + t)) return true;
        // Local path match
        if (t.startsWith("./") || t.startsWith("/") || t.includes("\\")) {
          return cleanTarget.startsWith(t);
        }
        return false;
      });

      if (matchesTarget) {
        matchingScope = scope;
        break;
      }
    }

    if (!matchingScope) {
      this.guardian.recordAudit("SECURITY_ACCESS_BLOCKED", "system", {
        target: cleanTarget,
        requestedActivity,
        reason: "TARGET_OUT_OF_SCOPE"
      });
      throw new Error(`TARGET_OUT_OF_SCOPE: Target '${cleanTarget}' is not registered under any valid authorized scope.`);
    }

    // Verify activity permission
    if (!matchingScope.permittedActivities.includes(requestedActivity)) {
      this.guardian.recordAudit("SECURITY_ACTIVITY_BLOCKED", matchingScope.owner, {
        target: cleanTarget,
        requestedActivity,
        scopeId: matchingScope.scopeId,
        reason: "ACTIVITY_NOT_PERMITTED"
      });
      throw new Error(`ACTIVITY_NOT_PERMITTED: Activity '${requestedActivity}' is not authorized under scope '${matchingScope.scopeId}'. Permitted: [${matchingScope.permittedActivities.join(", ")}].`);
    }

    return {
      authorized: true,
      scopeId: matchingScope.scopeId,
      organization: matchingScope.organization,
      rateLimit: matchingScope.allowedRateLimit,
      targetType: matchingScope.targetType,
      validUntil: matchingScope.validUntil
    };
  }

  /**
   * Revoke an active scope immediately.
   */
  revokeScope(scopeId, reason = "Operator Revocation") {
    if (!this.activeScopes.has(scopeId)) {
      return { success: false, error: "SCOPE_NOT_FOUND" };
    }
    const scope = this.activeScopes.get(scopeId);
    this.activeScopes.delete(scopeId);

    this.guardian.recordAudit("SECURITY_SCOPE_REVOKED", scope.owner, {
      scopeId,
      reason,
      organization: scope.organization
    });

    return { success: true, scopeId, message: `Scope '${scopeId}' revoked: ${reason}` };
  }

  /**
   * List all registered scopes with active/expired status.
   */
  listScopes() {
    const now = Date.now();
    return Array.from(this.activeScopes.values()).map(s => ({
      ...s,
      isExpired: now > new Date(s.validUntil).getTime(),
      isActive: now <= new Date(s.validUntil).getTime() && !this.emergencyStopEngaged
    }));
  }

  /**
   * Emergency Stop: Halts all ongoing security assessments immediately.
   */
  engageEmergencyStop(reason = "Operator Emergency Stop") {
    this.emergencyStopEngaged = true;
    this.guardian.recordAudit("CYBER_EMERGENCY_STOP_ENGAGED", "operator", { reason });
    return { success: true, emergencyStopEngaged: true, message: `CYBER EMERGENCY STOP ENGAGED: ${reason}` };
  }

  /**
   * Disengage Emergency Stop with operator verification.
   */
  disengageEmergencyStop(operatorKey) {
    if (operatorKey !== "ULTRON_OPERATOR_MASTER_KEY_SECRET") {
      throw new Error("EMERGENCY_STOP_CLEAR_FAILED: Invalid operator master authorization key.");
    }
    this.emergencyStopEngaged = false;
    this.guardian.recordAudit("CYBER_EMERGENCY_STOP_DISENGAGED", "operator");
    return { success: true, emergencyStopEngaged: false, message: "CYBER EMERGENCY STOP DISENGAGED: Operations nominal." };
  }
}

export const targetAuthorizationGateway = new TargetAuthorizationGateway();
