import test from "node:test";
import assert from "node:assert/strict";
import { UltronEyesManager, SESSION_STATES, CAMERA_TYPES } from "../vision/ultron-eyes-manager.js";

// Helper: 1x1 transparent PNG data URL for test frames
const TEST_FRAME_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("ULTRON EYES: Enumerate supported cameras and verify default preselection", () => {
  const manager = new UltronEyesManager();
  const devices = manager.getAvailableDevices();

  assert.ok(Array.isArray(devices));
  assert.ok(devices.length >= 4);

  const defaultCam = manager.getDefaultCamera();
  assert.ok(defaultCam);
  assert.equal(defaultCam.id, "cam-default-0");
  assert.equal(defaultCam.isDefault, true);
  assert.equal(defaultCam.type, CAMERA_TYPES.LAPTOP_WEBCAM);
});

test("ULTRON EYES: Switch preselected default camera", () => {
  const manager = new UltronEyesManager();
  const switched = manager.setDefaultCamera("cam-usb-1");

  assert.equal(switched.id, "cam-usb-1");
  assert.equal(switched.isDefault, true);
  assert.equal(manager.getDefaultCamera().id, "cam-usb-1");

  // Attempting to set unknown device throws
  assert.throws(() => manager.setDefaultCamera("non-existent-cam"), /not found/);
});

test("ULTRON EYES: Register dynamic camera device", () => {
  const manager = new UltronEyesManager();
  const newCam = manager.registerDevice({
    id: "cam-drone-01",
    name: "Aerial Drone Camera",
    type: CAMERA_TYPES.USB_CAMERA,
    maxResolution: "1080p",
    defaultFps: 3
  });

  assert.equal(newCam.id, "cam-drone-01");
  assert.equal(newCam.name, "Aerial Drone Camera");
  assert.ok(manager.getAvailableDevices().some(d => d.id === "cam-drone-01"));
});

test("ULTRON EYES: Camera activation strictly enforces explicit user consent", () => {
  const manager = new UltronEyesManager();

  // Attempt start without consent
  assert.throws(
    () => manager.startSession({ userId: "stark-01", userConsent: false }),
    /PERMISSION_DENIED/
  );

  const status = manager.getSessionStatus("stark-01");
  assert.equal(status.state, SESSION_STATES.PERMISSION_DENIED);
});

test("ULTRON EYES: Session lifecycle — start, pause, resume, and stop", () => {
  const manager = new UltronEyesManager();

  // Start with explicit consent
  const startRes = manager.startSession({
    userId: "stark-01",
    userConsent: true,
    fps: 3,
    resolution: "1080p"
  });

  assert.equal(startRes.success, true);
  assert.equal(startRes.state, SESSION_STATES.ACTIVE_STREAMING);
  assert.equal(startRes.fps, 3);
  assert.equal(startRes.resolution, "1080p");

  let status = manager.getSessionStatus("stark-01");
  assert.equal(status.streamingActive, true);
  assert.equal(status.state, SESSION_STATES.ACTIVE_STREAMING);

  // Pause
  const pauseRes = manager.pauseSession("stark-01");
  assert.equal(pauseRes.success, true);
  assert.equal(pauseRes.state, SESSION_STATES.PAUSED);

  // Resume
  const resumeRes = manager.resumeSession("stark-01");
  assert.equal(resumeRes.success, true);
  assert.equal(resumeRes.state, SESSION_STATES.ACTIVE_STREAMING);

  // Stop
  const stopRes = manager.stopSession("stark-01");
  assert.equal(stopRes.success, true);
  assert.equal(stopRes.state, SESSION_STATES.STOPPED);
});

test("ULTRON EYES: Real-time visual perception pipeline (Objects, OCR, Activity, Scene, Changes)", async () => {
  const manager = new UltronEyesManager();
  manager.startSession({ userId: "stark-01", userConsent: true });

  // Process Frame 1
  const obs1 = await manager.processFrame({
    userId: "stark-01",
    frameData: TEST_FRAME_DATA_URL
  });

  assert.ok(obs1.observationId.startsWith("obs-"));
  assert.equal(obs1.frameNumber, 1);
  assert.ok(obs1.objects.length >= 3);
  assert.ok(obs1.objects.some(o => o.label === "laptop_display"));
  assert.ok(obs1.objects.some(o => o.label === "coffee_mug"));

  // Verify multi-frame object tracking
  assert.ok(obs1.trackedObjects.length >= 3);
  assert.equal(obs1.trackedObjects[0].consecutiveFramesTracked, 1);

  // Verify OCR with credential scrubbing
  assert.equal(obs1.textAndOcr.hasText, true);
  assert.ok(obs1.textAndOcr.extractedText.includes("ULTRON-AI Core"));

  // Verify Privacy-Preserving Human Activity Perception (NO face identification)
  assert.equal(obs1.humanActivity.personPresent, true);
  assert.ok(obs1.humanActivity.privacyAdvisory.includes("NOT inferred"));

  // Verify Spatial Estimates labeled as approximations
  assert.ok(obs1.spatialEstimates.length >= 3);
  assert.equal(obs1.spatialEstimates[0].measurementType, "ESTIMATED_APPROXIMATION");

  // Process Frame 2 (checks change detection and object tracking continuation)
  const obs2 = await manager.processFrame({
    userId: "stark-01",
    frameData: TEST_FRAME_DATA_URL
  });

  assert.equal(obs2.frameNumber, 2);
  assert.ok(obs2.trackedObjects[0].consecutiveFramesTracked >= 2);
  assert.equal(obs2.changesDetected, true); // Phase 1 adds desk lamp
  assert.ok(obs2.changeSummary.includes("desk_lamp"));
});

test("ULTRON EYES: Session Visual Memory retention and purge", async () => {
  const manager = new UltronEyesManager();
  manager.startSession({ userId: "stark-01", userConsent: true });

  await manager.processFrame({ userId: "stark-01", frameData: TEST_FRAME_DATA_URL });
  await manager.processFrame({ userId: "stark-01", frameData: TEST_FRAME_DATA_URL });

  const mem = manager.getVisualMemory("stark-01");
  assert.equal(mem.memoryCount, 2);
  assert.equal(mem.observations.length, 2);

  // Clear memory
  const clearRes = manager.clearVisualMemory("stark-01");
  assert.equal(clearRes.success, true);

  const memCleared = manager.getVisualMemory("stark-01");
  assert.equal(memCleared.memoryCount, 0);
});

test("ULTRON EYES: Authorized visual snapshot capture", async () => {
  const manager = new UltronEyesManager();
  manager.startSession({ userId: "stark-01", userConsent: true });
  await manager.processFrame({ userId: "stark-01", frameData: TEST_FRAME_DATA_URL });

  const snapshot = manager.captureSnapshot({
    userId: "stark-01",
    note: "Calibration check",
    userConsent: true
  });

  assert.ok(snapshot.snapshotId.startsWith("snap-"));
  assert.equal(snapshot.note, "Calibration check");
  assert.ok(snapshot.observedEntities.includes("laptop_display"));

  // Snapshot without consent throws
  assert.throws(
    () => manager.captureSnapshot({ userId: "stark-01", userConsent: false }),
    /PERMISSION_DENIED/
  );
});

test("ULTRON EYES: Visual reasoning and Q&A in Hinglish and English", async () => {
  const manager = new UltronEyesManager();
  manager.startSession({ userId: "stark-01", userConsent: true });
  await manager.processFrame({ userId: "stark-01", frameData: TEST_FRAME_DATA_URL });

  // Hinglish query
  const resHinglish = await manager.queryVisualContext({
    userId: "stark-01",
    query: "ULTRON, mere saamne kya hai?"
  });

  assert.equal(resHinglish.success, true);
  assert.ok(resHinglish.answer.includes("workstation"));
  assert.ok(resHinglish.directlyObserved.length >= 3);
  assert.ok(typeof resHinglish.uncertaintyScore === "number");
  assert.equal(resHinglish.requiresHumanApproval, false);

  // English query for screen reading
  const resScreen = await manager.queryVisualContext({
    userId: "stark-01",
    query: "What is written on my screen?"
  });

  assert.equal(resScreen.success, true);
  assert.ok(resScreen.answer.includes("ULTRON-AI Core"));

  // Query requiring consequential action flags approval
  const resConsequential = await manager.queryVisualContext({
    userId: "stark-01",
    query: "Delete all files and reboot system based on what you see."
  });

  assert.equal(resConsequential.success, true);
  assert.equal(resConsequential.requiresHumanApproval, true);
  assert.ok(resConsequential.recommendedAction.includes("CRITICAL"));
});

test("ULTRON EYES: Resource bounds — rejects invalid or oversized frame payloads", async () => {
  const manager = new UltronEyesManager();
  manager.startSession({ userId: "stark-01", userConsent: true });

  // Invalid payload format
  await assert.rejects(
    () => manager.processFrame({ userId: "stark-01", frameData: "not-a-valid-data-url" }),
    /INVALID_DATA_URL/
  );

  // Missing session
  await assert.rejects(
    () => manager.processFrame({ userId: "unknown-user", frameData: TEST_FRAME_DATA_URL }),
    /Cannot process frame/
  );
});
