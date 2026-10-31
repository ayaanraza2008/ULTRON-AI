/**
 * ULTRON AI — Self-Improvement & Continuous Learning Engine
 *
 * Implements task outcome evaluation, failure analysis,
 * skill registration and verification, and regression prevention.
 *
 * Non-Negotiable Security Invariant:
 * The Self-Improvement Engine CANNOT alter security policies, permission tiers,
 * API credentials, or production infrastructure.
 */

export const PROTECTED_SYSTEM_PATHS = new Set([
  "SECURITY_POLICY.md",
  "autonomy-policy.js",
  "network-safety.js",
  ".env",
  ".env.example",
  "render.yaml"
]);

export class SelfImprovementEngine {
  constructor(options = {}) {
    this.mistakeLedger = [];
    this.skillRegistry = new Map();
    this.improvements = [];
    this.maxMistakes = 200;
  }

  /**
   * Analyze task outcome and classify failure mode if applicable.
   */
  analyzeTaskOutcome(task) {
    if (!task) return null;

    const isSuccess = task.status === "COMPLETED";
    const analysis = {
      id: "eval-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      taskId: task.id,
      taskTitle: task.title,
      agentId: task.primaryAgent,
      status: task.status,
      success: isSuccess,
      timestamp: new Date().toISOString(),
      failureCategory: null,
      lessonLearned: null,
      recommendation: null
    };

    if (!isSuccess) {
      const errText = String(task.error || "").toLowerCase();
      let category = "GENERIC_FAILURE";

      if (errText.includes("timeout") || errText.includes("aborted")) {
        category = "TIMEOUT_ERROR";
      } else if (errText.includes("429") || errText.includes("rate limit")) {
        category = "RATE_LIMIT_ERROR";
      } else if (errText.includes("syntax") || errText.includes("parse error")) {
        category = "SYNTAX_ERROR";
      } else if (errText.includes("permission") || errText.includes("denied") || errText.includes("unauthorized")) {
        category = "PERMISSION_ERROR";
      } else if (errText.includes("not found") || errText.includes("enoent")) {
        category = "RESOURCE_NOT_FOUND";
      }

      analysis.failureCategory = category;
      analysis.lessonLearned = `Task failed with ${category}. Adjust execution parameters and verify prerequisites.`;
      analysis.recommendation = category === "RATE_LIMIT_ERROR"
        ? "Apply exponential backoff and route to secondary provider."
        : category === "TIMEOUT_ERROR"
          ? "Decompose task into smaller sequential sub-steps."
          : "Inspect inputs and verify tool readiness.";

      this.recordMistake(analysis);
    } else {
      analysis.recommendation = "Task succeeded. Candidate for reusable workflow template.";
    }

    this.improvements.unshift(analysis);
    if (this.improvements.length > 200) this.improvements.pop();

    return analysis;
  }

  recordMistake(entry) {
    this.mistakeLedger.unshift(entry);
    if (this.mistakeLedger.length > this.maxMistakes) {
      this.mistakeLedger.pop();
    }
  }

  getMistakeLedger(category = null) {
    return category ? this.mistakeLedger.filter(m => m.failureCategory === category) : this.mistakeLedger;
  }

  /**
   * Register a new reusable skill with safety and immutability checks.
   */
  registerSkill(skillDefinition) {
    if (!skillDefinition || typeof skillDefinition !== "object") {
      throw new Error("Invalid skill definition payload.");
    }

    const { id, name, description, execute, targetFiles = [] } = skillDefinition;
    if (!id || !name || typeof execute !== "function") {
      throw new Error("Skills must define an id, name, and an executable handler function.");
    }

    // Safety Invariant: Check if skill attempts to target protected security files
    for (const target of targetFiles) {
      if (PROTECTED_SYSTEM_PATHS.has(target)) {
        throw new Error(`CRITICAL SECURITY VIOLATION: Skill '${id}' attempts to modify protected path '${target}'. Blocked.`);
      }
    }

    const registered = {
      id,
      name,
      description: description || "",
      version: "1.0.0",
      execute,
      verified: false,
      createdAt: new Date().toISOString()
    };

    this.skillRegistry.set(id, registered);
    return registered;
  }

  /**
   * Test a registered skill before promoting to verified.
   */
  async testSkill(skillId, testInput) {
    const skill = this.skillRegistry.get(skillId);
    if (!skill) throw new Error(`Skill '${skillId}' not found in registry.`);

    try {
      const result = await skill.execute(testInput);
      skill.verified = true;
      return { success: true, skillId, verified: true, result };
    } catch (err) {
      skill.verified = false;
      return { success: false, skillId, verified: false, error: err.message };
    }
  }

  listSkills() {
    return Array.from(this.skillRegistry.values()).map(s => ({
      id: s.id,
      name: s.name,
      description: s.description,
      version: s.version,
      verified: s.verified,
      createdAt: s.createdAt
    }));
  }
}
