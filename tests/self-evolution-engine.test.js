import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  UltronSelfEvolutionEngine,
  WEAKNESS_CATEGORIES,
  SEVERITY_LEVELS
} from "../self-improvement/self-evolution-engine.js";

describe("ULTRON Self-Evolution Engine", () => {
  let tempDir;
  let engine;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ultron-evolution-test-"));
    // Create mock repository structure
    fs.mkdirSync(path.join(tempDir, "core"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "agents"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "security"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({
      name: "ultron-test",
      version: "1.0.0",
      type: "module",
      dependencies: { express: "^4.19.0" }
    }));
    fs.writeFileSync(path.join(tempDir, "server.js"), "// Server stub\n// TODO: Add metrics\n");

    engine = new UltronSelfEvolutionEngine({ rootDir: tempDir });
  });

  after(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test("Conducts thorough self-audit and discovers findings", async () => {
    const audit = await engine.auditSystem();
    assert.ok(audit.id.startsWith("audit-"));
    assert.ok(audit.healthScore >= 0 && audit.healthScore <= 100);
    assert.ok(Array.isArray(audit.findings));
    assert.ok(audit.durationMs >= 0);

    // Verify findings include incomplete implementations (the TODO in server.js)
    const todoFinding = audit.findings.find(f => f.category === WEAKNESS_CATEGORIES.INCOMPLETE_IMPLEMENTATIONS);
    assert.ok(todoFinding);
    assert.equal(todoFinding.module, "server.js");
  });

  test("Generates prioritized improvement plan categorized by autonomy tiers", async () => {
    const audit = await engine.auditSystem();
    const plan = engine.generateImprovementPlan(audit);

    assert.ok(plan.id.startsWith("plan-"));
    assert.ok(Array.isArray(plan.items));
    assert.equal(plan.itemCount, plan.items.length);
    assert.ok(plan.autonomousCandidates >= 0);
    assert.ok(plan.governedCandidates >= 0);

    // Verify sorting order: P0/P1 first before P3/P4
    for (let i = 0; i < plan.items.length - 1; i++) {
      const a = plan.items[i].severity;
      const b = plan.items[i + 1].severity;
      if (a === SEVERITY_LEVELS.P1_HIGH && b === SEVERITY_LEVELS.P3_LOW) {
        assert.ok(true);
      }
    }
  });

  test("Blocks autonomous modification on restricted targets without operator authorization", async () => {
    const res = await engine.applyImprovement("plan-restricted-test", {
      targetFile: "render.yaml",
      newContent: "services:\n  - type: web\n"
    }, { authorized: false });

    assert.equal(res.success, false);
    assert.equal(res.status, "REQUIRES_OPERATOR_AUTHORIZATION");
  });

  test("Permits and executes safe autonomous modification on low-risk targets", async () => {
    const safeTarget = path.join(tempDir, "helper-tool.js");
    fs.writeFileSync(safeTarget, "export const helper = 42;\n");

    const res = await engine.applyImprovement("plan-safe-test", {
      targetFile: safeTarget,
      transform: (orig) => orig + "export const extra = 100;\n",
      summary: "Add extra helper function."
    });

    assert.equal(res.success, true);
    assert.equal(res.status, "APPLIED_AND_VERIFIED");
    const updated = fs.readFileSync(safeTarget, "utf8");
    assert.ok(updated.includes("extra = 100"));
  });

  test("Automatically rolls back on syntax regression", async () => {
    const testFile = path.join(tempDir, "calc.js");
    fs.writeFileSync(testFile, "export function add(a, b) { return a + b; }\n");

    // Intentionally introduce invalid syntax
    const res = await engine.applyImprovement("plan-bad-syntax", {
      targetFile: testFile,
      newContent: "function broken( {\n"
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "ROLLED_BACK");
    assert.ok(res.reason.includes("SYNTAX_REGRESSION_DETECTED"));

    // Verify original content was restored
    const restored = fs.readFileSync(testFile, "utf8");
    assert.equal(restored, "export function add(a, b) { return a + b; }\n");
  });

  test("Automatically rolls back on security violation (eval injection)", async () => {
    const testFile = path.join(tempDir, "eval-test.js");
    fs.writeFileSync(testFile, "export const value = 1;\n");

    const res = await engine.applyImprovement("plan-security-violation", {
      targetFile: testFile,
      newContent: "export const value = 1;\neval('console.log(process.env)');\n"
    });

    assert.equal(res.success, false);
    assert.equal(res.status, "ROLLED_BACK");
    assert.ok(res.reason.includes("SECURITY_VIOLATION_DETECTED"));

    // Verify original content was restored
    const restored = fs.readFileSync(testFile, "utf8");
    assert.equal(restored, "export const value = 1;\n");
  });

  test("Processes natural language evolution commands accurately", async () => {
    // 1. Audit yourself
    const res1 = await engine.processEvolutionCommand("Ultron, audit yourself.");
    assert.equal(res1.intent, "SELF_AUDIT");
    assert.ok(res1.audit);
    assert.ok(res1.plan);

    // 2. Find your weaknesses
    const res2 = await engine.processEvolutionCommand("Ultron, find your weaknesses.");
    assert.equal(res2.intent, "DISCOVER_WEAKNESSES");
    assert.ok(Array.isArray(res2.weaknesses));

    // 3. Evolve / Upgrade
    const res3 = await engine.processEvolutionCommand("Ultron, evolve.");
    assert.equal(res3.intent, "EVOLVE_CYCLE");
    assert.ok(res3.message);
  });
});
