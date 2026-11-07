import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AutonomousOrchestrator } from "../core/autonomous-orchestrator.js";
import { toolRegistry, PERMISSION_LEVELS } from "../core/tool-registry.js";
import { MultiDeviceManager, DEVICE_TYPES, FilePersistenceAdapter } from "../integrations/multi-device-manager.js";

async function verifyAutonomyAndPersistence() {
  console.log("=== ULTRON AUTONOMOUS EXECUTION & PERSISTENCE VERIFICATION ===");

  // 1. Multi-step autonomous task execution
  console.log("\n[1] Submitting Multi-Step Autonomous Task: 'Check system vitals'");
  const orchestrator = new AutonomousOrchestrator({ registry: toolRegistry });
  const taskOutcome = await orchestrator.processUserRequest("Check system vitals and battery", {
    userId: "operator-ayaan",
    source: "autonomous-verifier"
  });

  console.log("Task Intent:", taskOutcome.intent);
  console.log("Verified:", taskOutcome.verified);
  console.log("Step results count:", taskOutcome.stepResults?.length);
  if (taskOutcome.stepResults?.length > 0) {
    for (const [idx, step] of taskOutcome.stepResults.entries()) {
      console.log(`  Step ${idx + 1}: tool=${step.toolId}, success=${step.success}`);
    }
  }
  console.log("Text response preview:", taskOutcome.textResponse?.slice(0, 100));

  if (!taskOutcome.verified) {
    throw new Error("Multi-step autonomous task verification failed.");
  }

  // 2. Persistent Background Workflows (Submit, Query, Pause, Resume, Cancel)
  console.log("\n[2] Testing Background Workflow Lifecycle");
  const sub = orchestrator.submitBackgroundTask("Check system vitals");
  console.log("Submitted background workflow:", { id: sub.workflowId, status: sub.status });
  if (!sub.success || !sub.workflowId) throw new Error("Failed to submit background workflow");

  const pauseRes = orchestrator.pauseWorkflow(sub.workflowId);
  console.log("Pause outcome:", { success: pauseRes.success, status: pauseRes.status });

  const resumeRes = orchestrator.resumeWorkflow(sub.workflowId);
  console.log("Resume outcome:", { success: resumeRes.success, status: resumeRes.status });

  const cancelRes = orchestrator.cancelWorkflow(sub.workflowId, "Completed test");
  console.log("Cancel outcome:", { success: cancelRes.success, status: cancelRes.status });
  if (cancelRes.status !== "CANCELLED") throw new Error("Failed to cancel workflow");

  // 3. Multi-device conversation persistence & shared memory across Phone and Web
  console.log("\n[3] Testing Cross-Device Memory Sync (Android -> Web)");
  const tempFile = path.join(os.tmpdir(), `ultron-fleet-${Date.now()}.json`);
  try {
    const adapter1 = new FilePersistenceAdapter({ storagePath: tempFile, logger: console });
    const mdmInstance1 = new MultiDeviceManager({
      persistenceAdapter: adapter1,
      persist: true
    });

    // Register Phone and Web devices
    const r1 = mdmInstance1.registerDevice({
      id: "phone-oppo-ayaan",
      name: "OPPO Reno 8 Pro",
      type: DEVICE_TYPES.ANDROID_SMARTPHONE,
      platform: "android",
      ownerUserId: "operator-ayaan",
      online: true
    });
    console.log("Registered Phone:", r1.name || r1.error);

    const r2 = mdmInstance1.registerDevice({
      id: "web-living-core",
      name: "Living Core Web",
      type: DEVICE_TYPES.WEB_BROWSER,
      platform: "web",
      ownerUserId: "operator-ayaan",
      online: true
    });
    console.log("Registered Web:", r2.name || r2.error);

    // Android device writes a memory snapshot
    const memorySyncOutcome = mdmInstance1.syncSharedMemory({
      memoryKey: "active_conversation_context",
      memoryData: {
        lastQuery: "Analyze system vitals and security status",
        modelChoice: "am_onyx",
        taskTurn: 17
      },
      originDeviceId: "phone-oppo-ayaan",
      ownerUserId: "operator-ayaan"
    });
    console.log("Android syncSharedMemory outcome:", {
      success: memorySyncOutcome.success,
      version: memorySyncOutcome.version
    });

    // 4. Test recovery across process restart (Instantiate second manager from same persisted file)
    console.log("\n[4] Testing Cold-Restart Persistence Recovery");
    const adapter2 = new FilePersistenceAdapter({ storagePath: tempFile });
    const mdmInstance2 = new MultiDeviceManager({
      persistenceAdapter: adapter2,
      persist: true
    });

    // Verify phone and web devices survived cold restart
    const recoveredPhone = mdmInstance2.getDevice("phone-oppo-ayaan");
    const recoveredWeb = mdmInstance2.getDevice("web-living-core");
    console.log("Recovered Phone Device:", recoveredPhone?.name);
    console.log("Recovered Web Device:", recoveredWeb?.name);
    if (!recoveredPhone || !recoveredWeb) throw new Error("Devices failed to recover across restart");

    // Web client reads conversation memory written by Phone
    const recoveredMemory = mdmInstance2.getSharedMemory("active_conversation_context");
    console.log("Web client read recovered memory:", recoveredMemory);
    if (recoveredMemory?.taskTurn !== 17) {
      throw new Error("Memory persistence integrity failed across cold restart!");
    }

    // 5. Sensitive Credential Filtering Guard
    console.log("\n[5] Testing Sensitive Data Sanitizer Guard");
    const blockedSync = mdmInstance2.syncStateAcrossDevices({
      stateKey: "leak_attempt",
      payload: { api_key: "blocked-token" },
      ownerUserId: "operator-ayaan"
    });
    console.log("Sanitizer Guard Response:", {
      success: blockedSync.success,
      error: blockedSync.error,
      sanitized: blockedSync.sanitized
    });
    if (blockedSync.success !== false || blockedSync.error !== "SENSITIVE_DATA_BLOCKED") {
      throw new Error("Security failure: Sensitive credential guard did not reject forbidden payload!");
    }

  } finally {
    try { fs.unlinkSync(tempFile); } catch {}
  }

  console.log("\n=== AUTONOMOUS EXECUTION & PERSISTENCE VERIFIED 100% ===");
}

verifyAutonomyAndPersistence().catch(err => {
  console.error("FATAL ERROR IN VERIFICATION:", err);
  process.exit(1);
});
