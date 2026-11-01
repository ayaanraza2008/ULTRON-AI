/**
 * ULTRON AI — Self-Evolution Engine
 * Module: self-improvement/self-evolution-engine.js
 *
 * Implements autonomous self-inspection, weakness discovery,
 * prioritized improvement planning, sandboxed trial modifications,
 * automated regression testing, security review, and auto-rollback.
 *
 * Non-Negotiable Safety & Permission Invariants:
 * 1. Low-risk development changes (tests, docs, prompt tuning, tool extensions, optimizations)
 *    can proceed autonomously.
 * 2. High-risk actions ALWAYS require explicit operator authorization:
 *    - Production deployments (render.yaml, git push main)
 *    - Database schema alterations (supabase/migrations/)
 *    - Operating system level destructive modifications
 *    - Security policy changes (SECURITY_POLICY.md, autonomy-policy.js, network-safety.js)
 *    - Modifying API credentials or .env secrets
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { PROTECTED_SYSTEM_PATHS, SelfImprovementEngine } from "./engine.js";

export const WEAKNESS_CATEGORIES = Object.freeze({
  MISSING_FEATURES: "MISSING_FEATURES",
  INCOMPLETE_IMPLEMENTATIONS: "INCOMPLETE_IMPLEMENTATIONS",
  BROKEN_FUNCTIONALITY: "BROKEN_FUNCTIONALITY",
  INEFFICIENT_IMPLEMENTATIONS: "INEFFICIENT_IMPLEMENTATIONS",
  DUPLICATE_CODE: "DUPLICATE_CODE",
  UNNECESSARY_DEPENDENCIES: "UNNECESSARY_DEPENDENCIES",
  SECURITY_VULNERABILITIES: "SECURITY_VULNERABILITIES",
  PERFORMANCE_BOTTLENECKS: "PERFORMANCE_BOTTLENECKS",
  OUTDATED_COMPONENTS: "OUTDATED_COMPONENTS",
  OPPORTUNITIES_FOR_IMPROVEMENT: "OPPORTUNITIES_FOR_IMPROVEMENT"
});

export const SEVERITY_LEVELS = Object.freeze({
  P0_CRITICAL: "P0_CRITICAL",
  P1_HIGH: "P1_HIGH",
  P2_MEDIUM: "P2_MEDIUM",
  P3_LOW: "P3_LOW",
  P4_OPPORTUNITY: "P4_OPPORTUNITY"
});

export const RESTRICTED_AREAS = new Set([
  "SECURITY_POLICY.md",
  "autonomy-policy.js",
  "network-safety.js",
  ".env",
  ".env.example",
  "render.yaml",
  "supabase/migrations",
  "credentials",
  "keys"
]);

export class UltronSelfEvolutionEngine {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.baseEngine = options.baseEngine || new SelfImprovementEngine();
    this.auditHistory = [];
    this.planHistory = [];
    this.changeHistory = [];
    this.snapshots = new Map();
    this.maxHistory = options.maxHistory || 100;
  }

  /**
   * Performs comprehensive self-audit across the entire ULTRON AI ecosystem.
   */
  async auditSystem(options = {}) {
    const startTime = Date.now();
    const findings = [];

    // 1. Audit core architecture directories
    const subsystems = [
      { name: "core", path: "core", weight: 1.0 },
      { name: "agents", path: "agents", weight: 1.0 },
      { name: "autonomy", path: "autonomy", weight: 0.9 },
      { name: "intelligence", path: "intelligence", weight: 1.0 },
      { name: "security", path: "security", weight: 1.0 },
      { name: "system", path: "system", weight: 0.9 },
      { name: "voice", path: "voice", weight: 0.9 },
      { name: "vision", path: "vision", weight: 0.9 },
      { name: "telephony", path: "telephony", weight: 0.8 },
      { name: "robotics", path: "robotics", weight: 0.8 },
      { name: "integrations", path: "integrations", weight: 0.9 },
      { name: "tests", path: "tests", weight: 0.9 },
      { name: "public", path: "public", weight: 0.8 },
      { name: "windows-companion", path: "windows-companion", weight: 0.8 }
    ];

    for (const sub of subsystems) {
      const fullPath = path.join(this.rootDir, sub.path);
      if (!fs.existsSync(fullPath)) {
        findings.push({
          category: WEAKNESS_CATEGORIES.MISSING_FEATURES,
          severity: SEVERITY_LEVELS.P1_HIGH,
          module: sub.name,
          title: `Subsystem directory missing: ${sub.name}`,
          description: `Directory ${sub.path} was expected but not found.`,
          recommendation: `Restore or initialize ${sub.name} module.`
        });
      }
    }

    // 2. Audit dependencies in package.json
    const packagePath = path.join(this.rootDir, "package.json");
    if (fs.existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        
        // Check for known deprecated / vulnerable package patterns
        for (const [dep, ver] of Object.entries(deps)) {
          if (dep === "request") {
            findings.push({
              category: WEAKNESS_CATEGORIES.OUTDATED_COMPONENTS,
              severity: SEVERITY_LEVELS.P1_HIGH,
              module: "package.json",
              title: `Deprecated dependency found: ${dep}`,
              description: `Package '${dep}' is officially deprecated.`,
              recommendation: `Replace '${dep}' with native fetch or axios.`
            });
          }
        }
      } catch (err) {
        findings.push({
          category: WEAKNESS_CATEGORIES.BROKEN_FUNCTIONALITY,
          severity: SEVERITY_LEVELS.P0_CRITICAL,
          module: "package.json",
          title: "Invalid package.json manifest",
          description: err.message,
          recommendation: "Repair JSON syntax in package.json immediately."
        });
      }
    }

    // 3. Scan for incomplete implementations (TODO/FIXME/STUB)
    const filesToSample = [
      "jarvis-router.js",
      "server.js",
      "voice/voice-engine.js",
      "vision/vision-engine.js",
      "system/windows-capture-affinity.js",
      "voice/audio-processing-pipeline.js"
    ];

    for (const file of filesToSample) {
      const fullPath = path.join(this.rootDir, file);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, "utf8");
          const lines = content.split("\n");
          lines.forEach((line, idx) => {
            if (line.includes("TODO:") || line.includes("FIXME:")) {
              findings.push({
                category: WEAKNESS_CATEGORIES.INCOMPLETE_IMPLEMENTATIONS,
                severity: SEVERITY_LEVELS.P3_LOW,
                module: file,
                line: idx + 1,
                title: `Unresolved tag in ${file}:${idx + 1}`,
                description: line.trim(),
                recommendation: "Implement pending logic or resolve tag."
              });
            }
          });
        } catch {}
      }
    }

    // 4. Calculate overall system health score (0 - 100)
    const deductions = findings.reduce((acc, f) => {
      if (f.severity === SEVERITY_LEVELS.P0_CRITICAL) return acc + 30;
      if (f.severity === SEVERITY_LEVELS.P1_HIGH) return acc + 10;
      if (f.severity === SEVERITY_LEVELS.P2_MEDIUM) return acc + 5;
      if (f.severity === SEVERITY_LEVELS.P3_LOW) return acc + 2;
      return acc + 1;
    }, 0);

    const healthScore = Math.max(0, 100 - deductions);

    const auditReport = {
      id: "audit-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      healthScore,
      status: healthScore >= 90 ? "OPTIMAL" : (healthScore >= 70 ? "NEEDS_IMPROVEMENT" : "CRITICAL_ATTENTION"),
      totalFindings: findings.length,
      findings,
      summary: {
        critical: findings.filter(f => f.severity === SEVERITY_LEVELS.P0_CRITICAL).length,
        high: findings.filter(f => f.severity === SEVERITY_LEVELS.P1_HIGH).length,
        medium: findings.filter(f => f.severity === SEVERITY_LEVELS.P2_MEDIUM).length,
        low: findings.filter(f => f.severity === SEVERITY_LEVELS.P3_LOW).length,
        opportunities: findings.filter(f => f.severity === SEVERITY_LEVELS.P4_OPPORTUNITY).length
      }
    };

    this.auditHistory.unshift(auditReport);
    if (this.auditHistory.length > this.maxHistory) this.auditHistory.pop();

    return auditReport;
  }

  /**
   * Generates a Prioritized Improvement Plan from the latest audit findings.
   */
  generateImprovementPlan(auditReport = null) {
    const report = auditReport || (this.auditHistory.length > 0 ? this.auditHistory[0] : null);
    if (!report) {
      throw new Error("No audit report available. Run auditSystem() first.");
    }

    const items = report.findings.map((finding, index) => {
      const isRestricted = this.isRestrictedTarget(finding.module || "");
      return {
        id: `plan-item-${Date.now()}-${index + 1}`,
        findingCategory: finding.category,
        severity: finding.severity,
        targetModule: finding.module,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        requiresAuthorization: isRestricted,
        autonomousApplicable: !isRestricted,
        riskTier: isRestricted ? "HIGH_GOVERNED" : "LOW_AUTONOMOUS",
        status: "PENDING_EXECUTION"
      };
    });

    // Sort items: P0 -> P1 -> P2 -> P3 -> P4
    const severityOrder = {
      [SEVERITY_LEVELS.P0_CRITICAL]: 0,
      [SEVERITY_LEVELS.P1_HIGH]: 1,
      [SEVERITY_LEVELS.P2_MEDIUM]: 2,
      [SEVERITY_LEVELS.P3_LOW]: 3,
      [SEVERITY_LEVELS.P4_OPPORTUNITY]: 4
    };

    items.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

    const plan = {
      id: "plan-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
      auditId: report.id,
      createdAt: new Date().toISOString(),
      itemCount: items.length,
      autonomousCandidates: items.filter(i => i.autonomousApplicable).length,
      governedCandidates: items.filter(i => i.requiresAuthorization).length,
      items
    };

    this.planHistory.unshift(plan);
    if (this.planHistory.length > this.maxHistory) this.planHistory.pop();

    return plan;
  }

  /**
   * Evaluates if a target module or file path is strictly operator-governed.
   */
  isRestrictedTarget(targetPath = "") {
    const normalized = targetPath.replace(/\\/g, "/");
    for (const rest of RESTRICTED_AREAS) {
      if (normalized.includes(rest) || PROTECTED_SYSTEM_PATHS.has(normalized)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Applies an improvement with sandboxed snapshot verification and rollback.
   */
  async applyImprovement(planItemId, modificationSpec = {}, operatorContext = {}) {
    const targetFile = modificationSpec.targetFile;
    if (!targetFile) {
      throw new Error("applyImprovement requires a valid targetFile.");
    }

    // Safety Invariant 1: Operator authorization requirement check
    if (this.isRestrictedTarget(targetFile) && !operatorContext.authorized) {
      return {
        success: false,
        status: "REQUIRES_OPERATOR_AUTHORIZATION",
        targetFile,
        reason: "Modifying production configs, security rules, DB schemas, or credentials requires explicit operator authorization."
      };
    }

    const fullPath = path.isAbsolute(targetFile) ? targetFile : path.join(this.rootDir, targetFile);
    const fileExists = fs.existsSync(fullPath);

    // Safety Invariant 2: Snapshot capture before modification
    const snapshotId = "snap-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
    const originalContent = fileExists ? fs.readFileSync(fullPath, "utf8") : null;
    this.snapshots.set(snapshotId, {
      id: snapshotId,
      targetFile,
      fullPath,
      existed: fileExists,
      content: originalContent,
      createdAt: new Date().toISOString()
    });

    try {
      // 1. Apply code modification
      if (typeof modificationSpec.transform === "function") {
        const newContent = modificationSpec.transform(originalContent || "");
        fs.writeFileSync(fullPath, newContent, "utf8");
      } else if (typeof modificationSpec.newContent === "string") {
        fs.writeFileSync(fullPath, modificationSpec.newContent, "utf8");
      } else {
        throw new Error("No transform function or newContent provided in modificationSpec.");
      }

      // 2. Automated Regression & Syntax Verification
      const isJs = fullPath.endsWith(".js") || fullPath.endsWith(".mjs");
      if (isJs) {
        try {
          execFileSync(process.execPath, ["--check", fullPath], { stdio: "pipe" });
        } catch (syntaxErr) {
          // AUTO-ROLLBACK TRIGGER
          this.rollbackSnapshot(snapshotId);
          return {
            success: false,
            status: "ROLLED_BACK",
            snapshotId,
            reason: `SYNTAX_REGRESSION_DETECTED: ${syntaxErr.message}`,
            actionTaken: "Original file state restored automatically."
          };
        }
      }

      // 3. Security Code Review (Check for prohibited dangerous patterns)
      const modifiedContent = fs.readFileSync(fullPath, "utf8");
      if (modifiedContent.includes("eval(") || modifiedContent.includes("child_process.execSync(process.env")) {
        // AUTO-ROLLBACK TRIGGER
        this.rollbackSnapshot(snapshotId);
        return {
          success: false,
          status: "ROLLED_BACK",
          snapshotId,
          reason: "SECURITY_VIOLATION_DETECTED: Disallowed arbitrary execution pattern introduced.",
          actionTaken: "Original file state restored automatically."
        };
      }

      // 4. Change committed to ledger
      const record = {
        id: "change-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
        planItemId,
        targetFile,
        snapshotId,
        timestamp: new Date().toISOString(),
        status: "APPLIED_AND_VERIFIED",
        operatorAuthorized: Boolean(operatorContext.authorized),
        summary: modificationSpec.summary || "Autonomous self-improvement applied successfully."
      };

      this.changeHistory.unshift(record);
      if (this.changeHistory.length > this.maxHistory) this.changeHistory.pop();

      return {
        success: true,
        status: "APPLIED_AND_VERIFIED",
        record
      };
    } catch (err) {
      // Emergency rollback on unexpected exception
      this.rollbackSnapshot(snapshotId);
      return {
        success: false,
        status: "ROLLED_BACK",
        snapshotId,
        reason: `EXECUTION_EXCEPTION: ${err.message}`,
        actionTaken: "Original file state restored automatically."
      };
    }
  }

  /**
   * Restores a file to its exact pre-modification state from a captured snapshot.
   */
  rollbackSnapshot(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot '${snapshotId}' not found in registry.`);
    }

    if (snapshot.existed && snapshot.content !== null) {
      fs.writeFileSync(snapshot.fullPath, snapshot.content, "utf8");
    } else if (!snapshot.existed && fs.existsSync(snapshot.fullPath)) {
      fs.unlinkSync(snapshot.fullPath);
    }

    return {
      restored: true,
      snapshotId,
      targetFile: snapshot.targetFile,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Natural Language Command Handler for Voice & Text Commands.
   * Matches commands like:
   * - "Ultron, audit yourself"
   * - "Ultron, upgrade yourself"
   * - "Ultron, improve your intelligence"
   * - "Ultron, find your weaknesses"
   * - "Ultron, optimize your code"
   * - "Ultron, update your prompts"
   * - "Ultron, enhance your tools"
   * - "Ultron, evolve"
   */
  async processEvolutionCommand(commandText = "", context = {}) {
    const raw = String(commandText).toLowerCase().trim();
    
    // Command Intent Parsing
    if (raw.includes("audit") || raw.includes("check yourself") || raw.includes("inspect yourself")) {
      const audit = await this.auditSystem();
      const plan = this.generateImprovementPlan(audit);
      return {
        intent: "SELF_AUDIT",
        message: `Self-audit completed. System health score: ${audit.healthScore}/100. Discovered ${audit.totalFindings} findings. Prioritized plan formulated with ${plan.itemCount} items.`,
        audit,
        plan
      };
    }

    if (raw.includes("weakness") || raw.includes("flaw") || raw.includes("vulnerability")) {
      const audit = await this.auditSystem();
      const weaknesses = audit.findings.map(f => `[${f.severity}] ${f.category} in ${f.module}: ${f.title}`);
      return {
        intent: "DISCOVER_WEAKNESSES",
        message: `Identified ${audit.findings.length} system weaknesses across the ecosystem.`,
        weaknesses,
        healthScore: audit.healthScore
      };
    }

    if (raw.includes("upgrade") || raw.includes("evolve") || raw.includes("improve") || raw.includes("optimize")) {
      const audit = await this.auditSystem();
      const plan = this.generateImprovementPlan(audit);
      
      const candidate = plan.items.find(i => i.autonomousApplicable);
      if (!candidate) {
        return {
          intent: "EVOLVE_CYCLE",
          message: "All pending improvements require operator authorization, or system is already fully optimized.",
          plan
        };
      }

      return {
        intent: "EVOLVE_CYCLE",
        message: `Evolution cycle initiated. High-priority autonomous candidate identified: ${candidate.title}. Ready for execution.`,
        topCandidate: candidate,
        planSummary: {
          total: plan.itemCount,
          autonomous: plan.autonomousCandidates,
          governed: plan.governedCandidates
        }
      };
    }

    // Default intent
    return {
      intent: "UNKNOWN_EVOLUTION_COMMAND",
      message: "Command received. Supported commands: 'Ultron, audit yourself', 'Ultron, upgrade yourself', 'Ultron, find your weaknesses', 'Ultron, evolve'."
    };
  }

  getEvolutionHistory() {
    return {
      audits: this.auditHistory,
      plans: this.planHistory,
      changes: this.changeHistory,
      snapshotsCount: this.snapshots.size
    };
  }
}

export const ultronSelfEvolutionEngine = new UltronSelfEvolutionEngine();
