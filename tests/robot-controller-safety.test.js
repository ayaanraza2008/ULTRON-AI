import test from "node:test";
import assert from "node:assert/strict";
import { PhysicalSafetyController, RobotController, ROBOT_SAFETY_LEVELS } from "../robotics/robot-controller.js";

test("RobotController registrations are explicitly simulation-only", () => {
  const controller = new RobotController();
  const registration = controller.registerRobot({ robotId: "bot-sim-1" });
  assert.equal(registration.success, true);
  assert.equal(registration.registrationMode, "SIMULATION_ONLY");
  assert.equal(registration.tokenScope, "SIMULATION_ONLY");
  assert.equal(registration.hardwareConnected, false);
  assert.equal(controller.getRobot("bot-sim-1").status, "SIMULATION_ONLY");
  assert.equal(controller.getFleetStatus().physicalActuationEnabled, false);
});

test("RobotController simulation motion never claims physical actuation", () => {
  const controller = new RobotController();
  const registration = controller.registerRobot({ robotId: "bot-sim-2" });
  const result = controller.executeMotion(registration.robotId, {
    linearVelocity: 0.5,
    angularVelocity: 0.1,
    targetPosition: { x: 1, y: 0, z: 0 }
  });
  assert.equal(result.success, true);
  assert.equal(result.simulated, true);
  assert.equal(result.physicalActuation, false);
  assert.equal(result.mode, ROBOT_SAFETY_LEVELS.SIMULATION);
});

test("RobotController fails closed when autonomous physical transport is unavailable", () => {
  const controller = new RobotController({ simulationMode: false });
  const registration = controller.registerRobot({ robotId: "bot-no-hardware" });
  const result = controller.executeMotion(registration.robotId, {
    mode: ROBOT_SAFETY_LEVELS.AUTONOMOUS,
    dryRun: false,
    linearVelocity: 0.2
  });
  assert.equal(result.success, false);
  assert.equal(result.executed, false);
  assert.equal(result.physicalActuation, false);
  assert.equal(result.code, "HARDWARE_TRANSPORT_UNAVAILABLE");
  assert.deepEqual(controller.getRobot(registration.robotId).position, { x: 0, y: 0, z: 0 });
});

test("PhysicalSafetyController rejects the old static emergency-stop override", () => {
  const safety = new PhysicalSafetyController();
  const stopped = safety.triggerEmergencyStop("test");
  assert.equal(stopped.latched, true);
  assert.equal(stopped.resetRequired, true);
  assert.equal("resetToken" in stopped, false);
  assert.equal(safety.resetEmergencyStop("OPERATOR_OVERRIDE_KEY").success, false);
  assert.equal(safety.emergencyStopLatched, true);
});

test("PhysicalSafetyController requires an injected operator authorization verifier to reset", () => {
  const safety = new PhysicalSafetyController({
    resetAuthorizationVerifier: (key, nonce) => key === "physical-operator-approval" && typeof nonce === "string"
  });
  safety.triggerEmergencyStop("test");
  const result = safety.resetEmergencyStop("physical-operator-approval");
  assert.equal(result.success, true);
  assert.equal(safety.emergencyStopLatched, false);
});

test("PhysicalSafetyController keeps emergency stop latched when authorization is absent", () => {
  const safety = new PhysicalSafetyController();
  safety.triggerEmergencyStop("test");
  const result = safety.resetEmergencyStop("valid-looking-but-unverified-key");
  assert.equal(result.success, false);
  assert.equal(result.error, "PHYSICAL_OPERATOR_AUTHORIZATION_REQUIRED");
  assert.equal(safety.emergencyStopLatched, true);
});

test("PhysicalSafetyController requires a live heartbeat and valid battery telemetry", () => {
  const safety = new PhysicalSafetyController();
  const noHeartbeat = safety.validateMotionCommand({ batteryPercent: 100 });
  assert.equal(noHeartbeat.code, "HEARTBEAT_EXPIRED");

  safety.recordHeartbeat();
  const noBattery = safety.validateMotionCommand({});
  assert.equal(noBattery.code, "BATTERY_TELEMETRY_UNAVAILABLE");
});

test("PhysicalSafetyController rejects nonnumeric velocities and target coordinates", () => {
  const safety = new PhysicalSafetyController();
  safety.recordHeartbeat();

  const badVelocity = safety.validateMotionCommand({
    linearVelocity: "not-a-number",
    angularVelocity: 0,
    batteryPercent: 100
  });
  assert.equal(badVelocity.code, "INVALID_MOTION_COMMAND");

  const badPosition = safety.validateMotionCommand({
    linearVelocity: 0,
    angularVelocity: 0,
    targetPosition: { x: "1", y: 0, z: 0 },
    batteryPercent: 100
  });
  assert.equal(badPosition.code, "INVALID_TARGET_POSITION");
});
