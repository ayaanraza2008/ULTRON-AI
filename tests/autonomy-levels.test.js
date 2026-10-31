import test from "node:test";
import assert from "node:assert/strict";
import { AUTONOMY_LEVELS, canExecuteAutonomously, checkHardwareHeadroom } from "../autonomy-policy.js";

test("Autonomy Levels: 6 tiers defined from Level 0 to Level 5", () => {
  assert.equal(Object.keys(AUTONOMY_LEVELS).length, 6);
  assert.equal(AUTONOMY_LEVELS[0].name, "Manual");
  assert.equal(AUTONOMY_LEVELS[1].name, "Assisted");
  assert.equal(AUTONOMY_LEVELS[2].name, "Supervised");
  assert.equal(AUTONOMY_LEVELS[3].name, "Conditional");
  assert.equal(AUTONOMY_LEVELS[4].name, "High Autonomy");
  assert.equal(AUTONOMY_LEVELS[5].name, "Continuous");
});

test("Autonomy Levels: enforcement rules across levels", () => {
  // Level 0 blocks all tool actions
  const l0 = canExecuteAutonomously("routine", 0);
  assert.equal(l0.allowed, false);

  // Level 1 blocks execution (assisted only)
  const l1 = canExecuteAutonomously("routine", 1);
  assert.equal(l1.allowed, false);

  // Level 2 allows routine but requires approval for external actions
  const l2Routine = canExecuteAutonomously("routine", 2);
  assert.equal(l2Routine.allowed, true);
  const l2External = canExecuteAutonomously("external_effect", 2);
  assert.equal(l2External.allowed, false);

  // Level 3 allows sandboxed code execution and routine research
  const l3Sandbox = canExecuteAutonomously("sandbox_code", 3);
  assert.equal(l3Sandbox.allowed, true);

  // Destructive actions ALWAYS fail closed across all levels
  for (let lvl = 0; lvl <= 5; lvl++) {
    const destructive = canExecuteAutonomously("destructive", lvl);
    assert.equal(destructive.allowed, false, `Destructive must be forbidden at level ${lvl}`);

    const prodDeploy = canExecuteAutonomously("production_deployment", lvl);
    assert.equal(prodDeploy.allowed, false, `Production deploy must be forbidden at level ${lvl}`);
  }
});

test("Hardware Guard: monitors memory pressure for AMD Ryzen 7 / 8 GB RAM", () => {
  const normal = checkHardwareHeadroom({ memory: { usedPercent: 55.0 } });
  assert.equal(normal.safeToExecute, true);
  assert.equal(normal.warning, null);
  assert.equal(normal.maxConcurrentAllowed, 4);

  // Memory pressure alert when > 85% RAM
  const highPressure = checkHardwareHeadroom({ memory: { usedPercent: 89.5 } });
  assert.equal(highPressure.safeToExecute, false);
  assert.ok(highPressure.warning.includes("Hardware memory pressure detected"));
  assert.equal(highPressure.maxConcurrentAllowed, 1);
});
