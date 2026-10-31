import test from "node:test";
import assert from "node:assert/strict";
import {
  remoteTaskOrchestrator,
  RemoteTaskOrchestrator
} from "../system/remote-task-orchestrator.js";

test("RemoteTaskOrchestrator: Rejects unauthorized callers from executing remote tasks", async () => {
  const orchestrator = new RemoteTaskOrchestrator();
  const outcome = await orchestrator.executeRemoteTask({
    callerId: "unknown-caller-00",
    isOwner: false,
    action: "UNLOCK_PC_SCREEN"
  });

  assert.equal(outcome.success, false);
  assert.equal(outcome.error, "CALLER_UNAUTHORIZED");
});

test("RemoteTaskOrchestrator: Executes storage diagnostics and checks project runnability", async () => {
  let vitalsQueried = false;
  const mockAgent = {
    getSystemVitals: async () => {
      vitalsQueried = true;
      return { storageAvailableGb: 180, ramUsedPercent: 32 };
    }
  };

  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: mockAgent
  });

  const progressSteps = [];
  const outcome = await orchestrator.executeRemoteTask({
    callerId: "+919876543210",
    isOwner: true,
    action: "CHECK_STORAGE_AND_RUNNABILITY",
    onProgress: (p) => progressSteps.push(p)
  });

  assert.equal(outcome.success, true);
  assert.equal(vitalsQueried, true);
  assert.equal(outcome.result.canRun, true);
  assert.equal(outcome.result.storageAvailableGb, 180);
  assert.ok(progressSteps.length >= 2);
  assert.equal(orchestrator.getTaskHistory().length, 1);
});

test("RemoteTaskOrchestrator: Suppresses duplicate commands within idempotency window", async () => {
  const orchestrator = new RemoteTaskOrchestrator();

  const firstCall = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "unique-key-12345"
  });
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.duplicateSuppressed, undefined);

  // Duplicate task with same idempotency key
  const secondCall = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "unique-key-12345"
  });
  assert.equal(secondCall.success, true);
  assert.equal(secondCall.duplicateSuppressed, true);
  assert.match(secondCall.message, /suppressed/);
});
