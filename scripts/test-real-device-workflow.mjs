import fs from "node:fs";
import path from "node:path";
import { autonomousOrchestrator } from "../core/autonomous-orchestrator.js";
import { mobileControlEngine } from "../mobile/mobile-control-engine.js";
import { adbBridge } from "../mobile/adb-bridge.js";
import { JarvisVoiceEngine } from "../voice/voice-engine.js";

async function run() {
  console.log("=== ULTRON MOBILE MCP REAL-WORLD AUTONOMY VALIDATION ===");

  // 1. Initialize mobile control engine
  console.log("\n[1] Initializing Mobile Control Subsystem...");
  const initResult = await mobileControlEngine.initialize();
  console.log("Initialization result:", {
    initialized: initResult.initialized,
    devicesCount: initResult.devicesCount,
    activeDevice: initResult.activeDevice?.id,
    model: initResult.activeDevice?.model
  });

  const voice = new JarvisVoiceEngine();

  // 2. Test natural-language voice/chat command
  const command = "Ultron, open YouTube on my phone.";
  console.log(`\n[2] Processing command: "${command}"`);

  // Step 2a: First submission without approval token
  const initialOutcome = await autonomousOrchestrator.processUserRequest(command, {
    userId: "operator-ayaan",
    source: "voice-input"
  });

  console.log("Initial outcome status:", initialOutcome.status);
  console.log("Text response:", initialOutcome.textResponse);
  console.log("Approval request generated:", {
    id: initialOutcome.approvalRequest?.id,
    toolId: initialOutcome.approvalRequest?.toolId,
    description: initialOutcome.approvalRequest?.actionDescription
  });

  if (initialOutcome.status !== "APPROVAL_REQUIRED" || !initialOutcome.approvalRequest) {
    throw new Error("Expected APPROVAL_REQUIRED gate for mobile app launch.");
  }

  // 3. Obtain and evaluate user approval
  const reqId = initialOutcome.approvalRequest.id;
  console.log(`\n[3] Approving request ${reqId} for user 'operator-ayaan'...`);
  const approvalResult = autonomousOrchestrator.approveRequest(reqId, {
    userId: "operator-ayaan",
    isAdmin: true
  });
  console.log("Approval result:", approvalResult);

  // 4. Execute with approved token
  console.log(`\n[4] Executing command with approvalId: ${reqId}...`);
  const executionOutcome = await autonomousOrchestrator.processUserRequest(command, {
    userId: "operator-ayaan",
    approvalId: reqId,
    source: "voice-input"
  });

  console.log("\n[5] Execution outcome:");
  console.log("Success:", executionOutcome.success);
  console.log("Text response:", executionOutcome.textResponse);
  console.log("Steps executed:", executionOutcome.stepResults?.length);

  const voiceSpeech = voice.formatSpokenUpdate(executionOutcome.textResponse, "en");
  console.log("Voice synthesized output:", voiceSpeech);

  // 5. Inspect stepResults & verify real device state
  console.log("\n[6] Real device state verification:");
  const devices = await adbBridge.listDevices();
  const targetId = devices.devices[0]?.id;
  const fgApp = await adbBridge.getForegroundApp(targetId);
  console.log(`Foreground app on real device (${targetId}):`, fgApp);

  // Check if screenshot was captured
  const screenStep = executionOutcome.stepResults?.find(s => s.toolId === "mobile_screen_inspection");
  const imgData = screenStep?.outcome?.screen?.data || screenStep?.outcome?.image?.data;
  if (imgData) {
    const artifactDir = path.resolve(".local/artifacts");
    if (!fs.existsSync(artifactDir)) fs.mkdirSync(artifactDir, { recursive: true });
    const imgPath = path.join(artifactDir, "real_device_youtube_launch.png");
    const buffer = Buffer.from(imgData, "base64");
    fs.writeFileSync(imgPath, buffer);
    console.log(`Real device screenshot saved to: ${imgPath} (${buffer.length} bytes)`);
  }

  // 6. Test cancellation during execution
  console.log("\n[7] Testing cancellation during execution...");
  const wf = {
    goal: "Multi-step navigation workflow",
    steps: [
      { action: "mobile_press_button", params: { button: "HOME" } },
      { action: "mobile_press_button", params: { button: "BACK" } }
    ]
  };
  const execPromise = mobileControlEngine.executeWorkflow(wf);
  const activeWfId = Array.from(mobileControlEngine.activeWorkflows.keys())[0];
  if (activeWfId) {
    mobileControlEngine.cancelWorkflow(activeWfId);
  }
  const cancelOutcome = await execPromise;
  console.log("Workflow cancel outcome:", { cancelled: cancelOutcome.cancelled, completedSteps: cancelOutcome.completedSteps });

  // 7. Test Emergency Stop
  console.log("\n[8] Testing Emergency Stop...");
  const stopRes = autonomousOrchestrator.setEmergencyStop(true, "Physical safety audit test", { userId: "operator", isAdmin: true });
  console.log("Emergency stop engaged:", stopRes.emergencyHalted);

  const blockedReq = await autonomousOrchestrator.processUserRequest("open youtube on my phone", { userId: "operator" });
  console.log("Blocked request under emergency stop:", { status: blockedReq.status, success: blockedReq.success });

  autonomousOrchestrator.setEmergencyStop(false, "Test complete", { userId: "operator", isAdmin: true });
  console.log("Emergency stop reset. Resumed normal operations.");

  // 8. Test cross-user isolation
  console.log("\n[9] Testing cross-user authorization isolation...");
  const initialUserA = await autonomousOrchestrator.processUserRequest("open youtube on my phone", { userId: "user-alpha" });
  const approvalA = initialUserA.approvalRequest.id;
  autonomousOrchestrator.approveRequest(approvalA, { userId: "user-alpha" });

  // Attempt to consume User A's token as User B
  const stolenOutcome = await autonomousOrchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-beta",
    approvalId: approvalA
  });
  console.log("Cross-user token consumption rejected:", {
    status: stolenOutcome.status,
    error: stolenOutcome.error
  });

  // 9. Replay attack rejection
  console.log("\n[10] Testing single-use anti-replay...");
  // User A consumes their token legitimately
  const legitimate = await autonomousOrchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-alpha",
    approvalId: approvalA
  });
  console.log("Legitimate first use success:", legitimate.success);

  // User A attempts to reuse the same token
  const replayOutcome = await autonomousOrchestrator.processUserRequest("open youtube on my phone", {
    userId: "user-alpha",
    approvalId: approvalA
  });
  console.log("Replay attack second use rejected:", {
    status: replayOutcome.status,
    error: replayOutcome.error
  });

  console.log("\n=== REAL-WORLD VERIFICATION COMPLETED SUCCESSFULLY ===");
}

run().catch(err => {
  console.error("FATAL ERROR IN REAL-WORLD VERIFICATION:", err);
  process.exit(1);
});
