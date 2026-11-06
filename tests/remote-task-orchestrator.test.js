import test from "node:test";
import assert from "node:assert/strict";
import { RemoteTaskOrchestrator } from "../system/remote-task-orchestrator.js";

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
  assert.equal(outcome.result.storageCheckAvailable, true);
  assert.equal(outcome.result.storageAvailableGb, 180);
  assert.match(outcome.result.verdict, /other run prerequisites remain unverified/i);
  assert.ok(progressSteps.length >= 2);
  assert.equal(orchestrator.getTaskHistory().length, 1);
});

test("RemoteTaskOrchestrator: Suppresses duplicate commands and returns the original result", async () => {
  let executions = 0;
  const mockAgent = {
    unlockScreen: async () => {
      executions += 1;
      return { success: true, message: "PC unlocked." };
    }
  };
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: mockAgent
  });

  const firstCall = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "unique-key-12345"
  });
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.duplicateSuppressed, undefined);

  const secondCall = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "unique-key-12345"
  });
  assert.equal(secondCall.success, true);
  assert.equal(secondCall.duplicateSuppressed, true);
  assert.equal(secondCall.status, "COMPLETED");
  assert.equal(secondCall.taskId, firstCall.taskId);
  assert.deepEqual(secondCall.result, firstCall.result);
  assert.match(secondCall.message, /suppressed/);
  assert.equal(executions, 1);
});

test("RemoteTaskOrchestrator: Fails closed with WINDOWS_AGENT_UNAVAILABLE when companion is missing (no fake success)", async () => {
  const orchestrator = new RemoteTaskOrchestrator(); // No windowsDesktopAgent provided

  const res = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN"
  });

  assert.equal(res.success, false);
  assert.equal(res.error, "WINDOWS_AGENT_UNAVAILABLE");
  assert.match(res.message, /not connected or registered/);

  const resApp = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "LAUNCH_PC_APP",
    payload: { app: "code" }
  });
  assert.equal(resApp.success, false);
  assert.equal(resApp.error, "WINDOWS_AGENT_UNAVAILABLE");

  const resStop = await orchestrator.executeRemoteTask({
    callerId: "owner-call-01",
    isOwner: true,
    action: "EMERGENCY_STOP"
  });
  assert.equal(resStop.success, false);
  assert.equal(resStop.error, "WINDOWS_AGENT_UNAVAILABLE");
});


test("RemoteTaskOrchestrator: Does not report a failed Windows application launch as successful", async () => {
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      executeCommand: async () => ({
        success: false,
        error: "APP_NOT_ALLOWED",
        message: "The requested application is not on the allowlist."
      })
    }
  });
  const outcome = await orchestrator.executeRemoteTask({
    callerId: "owner-call-02",
    isOwner: true,
    action: "LAUNCH_PC_APP",
    payload: { app: "unapproved-app" }
  });

  assert.equal(outcome.success, false);
  assert.equal(outcome.error, "APP_NOT_ALLOWED");
  assert.match(outcome.progressSteps.at(-1).description, /launch failed/i);
});


test("RemoteTaskOrchestrator: Reports unavailable storage as unverified instead of zero or low", async () => {
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      getSystemVitals: async () => ({ storageAvailableGb: null, ramUsedPercent: 51 })
    }
  });
  const outcome = await orchestrator.executeRemoteTask({
    callerId: "owner-call-03",
    isOwner: true,
    action: "CHECK_STORAGE_AND_RUNNABILITY"
  });

  assert.equal(outcome.success, true);
  assert.equal(outcome.result.storageCheckAvailable, false);
  assert.equal(outcome.result.canRun, null);
  assert.match(outcome.result.verdict, /could not be measured/i);
  assert.match(outcome.progressSteps.at(-1).description, /remains unverified/i);
});

test("RemoteTaskOrchestrator: Does not claim a simulated non-Windows lock locked the workstation", async () => {
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      lockScreen: async () => ({ success: true, simulated: true })
    }
  });
  const outcome = await orchestrator.executeRemoteTask({
    callerId: "owner-call-04",
    isOwner: true,
    action: "LOCK_PC_SCREEN"
  });

  assert.equal(outcome.success, true);
  assert.match(outcome.progressSteps.at(-1).description, /simulated; no real Windows workstation was locked/i);
});

test("RemoteTaskOrchestrator: Duplicate while original is running is not reported as success", async () => {
  let finishUnlock;
  let executions = 0;
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      unlockScreen: () => {
        executions += 1;
        return new Promise(resolve => { finishUnlock = resolve; });
      }
    }
  });

  const firstPromise = orchestrator.executeRemoteTask({
    callerId: "owner-call-in-progress",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "in-progress-key"
  });

  const duplicate = await orchestrator.executeRemoteTask({
    callerId: "owner-call-in-progress",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "in-progress-key"
  });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.duplicateSuppressed, true);
  assert.equal(duplicate.status, "RUNNING");
  assert.equal(duplicate.error, "DUPLICATE_TASK_IN_PROGRESS");
  assert.equal(executions, 1);

  finishUnlock({ success: true, message: "PC unlocked." });
  const first = await firstPromise;
  assert.equal(first.success, true);
  const completedDuplicate = await orchestrator.executeRemoteTask({
    callerId: "owner-call-in-progress",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "in-progress-key"
  });
  assert.equal(completedDuplicate.success, true);
  assert.equal(completedDuplicate.status, "COMPLETED");
  assert.equal(completedDuplicate.taskId, first.taskId);
});

test("RemoteTaskOrchestrator: Duplicate of a failed task retains failure instead of returning success", async () => {
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      unlockScreen: async () => ({ success: false, error: "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION" })
    }
  });
  const first = await orchestrator.executeRemoteTask({
    callerId: "owner-call-failed",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "failed-key"
  });
  assert.equal(first.success, false);
  assert.equal(first.error, "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION");

  const duplicate = await orchestrator.executeRemoteTask({
    callerId: "owner-call-failed",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "failed-key"
  });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.duplicateSuppressed, true);
  assert.equal(duplicate.status, "FAILED");
  assert.equal(duplicate.error, "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION");
  assert.equal(duplicate.result.error, "UNLOCK_REQUIRES_LOCAL_AUTHENTICATION");
});

test("RemoteTaskOrchestrator: Idempotency keys are scoped to the authenticated caller", async () => {
  let executions = 0;
  const orchestrator = new RemoteTaskOrchestrator({
    windowsDesktopAgent: {
      unlockScreen: async () => {
        executions += 1;
        return { success: true };
      }
    }
  });
  const first = await orchestrator.executeRemoteTask({
    callerId: "owner-device-a",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "shared-client-key"
  });
  const second = await orchestrator.executeRemoteTask({
    callerId: "owner-device-b",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "shared-client-key"
  });
  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(second.duplicateSuppressed, undefined);
  assert.equal(executions, 2);
});

test("RemoteTaskOrchestrator: Idempotency retention does not expire while a remote task is still running", async () => {
  let finishUnlock;
  const orchestrator = new RemoteTaskOrchestrator({
    idempotencyWindowMs: 10,
    windowsDesktopAgent: {
      unlockScreen: () => new Promise(resolve => { finishUnlock = resolve; })
    }
  });

  const firstPromise = orchestrator.executeRemoteTask({
    callerId: "owner-call-slow",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "slow-task-key"
  });

  // The cleanup window is intentionally much shorter than this pause.
  await new Promise(resolve => setTimeout(resolve, 40));
  const duplicate = await orchestrator.executeRemoteTask({
    callerId: "owner-call-slow",
    isOwner: true,
    action: "UNLOCK_PC_SCREEN",
    idempotencyKey: "slow-task-key"
  });
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.duplicateSuppressed, true);
  assert.equal(duplicate.status, "RUNNING");
  assert.equal(duplicate.error, "DUPLICATE_TASK_IN_PROGRESS");

  finishUnlock({ success: true, message: "PC unlocked." });
  const first = await firstPromise;
  assert.equal(first.success, true);
});
