import test from "node:test";
import assert from "node:assert/strict";
import {
  robotController,
  PhysicalSafetyController,
  RobotController,
  ROBOT_SAFETY_LEVELS,
  STANDARD_SENSORS,
  STANDARD_ACTUATORS
} from "../robotics/robot-controller.js";

test("Robotics HAL: Standard catalogs include required sensors and actuators", () => {
  assert.ok(STANDARD_SENSORS.includes("lidar"));
  assert.ok(STANDARD_SENSORS.includes("depth_camera"));
  assert.ok(STANDARD_SENSORS.includes("battery_monitor"));
  assert.ok(STANDARD_ACTUATORS.includes("differential_drive"));
  assert.ok(STANDARD_ACTUATORS.includes("robotic_arm_6dof"));
  assert.ok(STANDARD_ACTUATORS.includes("gripper"));
});

test("PhysicalSafetyController: enforces 3D geofence bounds", () => {
  const safety = new PhysicalSafetyController();
  // Within default bounds [-50, 50, -50, 50, 0, 3]
  assert.equal(safety.isWithinGeofence(10, 20, 1.5), true);
  // Outside bounds
  assert.equal(safety.isWithinGeofence(60, 0, 1.0), false);
  assert.equal(safety.isWithinGeofence(0, -55, 1.0), false);
  assert.equal(safety.isWithinGeofence(0, 0, 4.0), false);
});

test("PhysicalSafetyController: enforces velocity limits", () => {
  const safety = new PhysicalSafetyController({
    maxLinearVelocityMps: 1.5,
    maxAngularVelocityRps: 1.0
  });

  // Valid motion
  const valid = safety.validateMotionCommand({
    linearVelocity: 1.2,
    angularVelocity: 0.8,
    targetPosition: { x: 5, y: 5, z: 0.5 },
    batteryLevel: 50
  });
  assert.equal(valid.permitted, true);

  // Excessive linear velocity
  const excessiveSpeed = safety.validateMotionCommand({
    linearVelocity: 2.5,
    angularVelocity: 0.5,
    targetPosition: { x: 5, y: 5, z: 0.5 },
    batteryLevel: 50
  });
  assert.equal(excessiveSpeed.permitted, false);
  assert.equal(excessiveSpeed.code, "VELOCITY_LIMIT_EXCEEDED");

  // Excessive angular velocity
  const excessiveTurn = safety.validateMotionCommand({
    linearVelocity: 0.5,
    angularVelocity: 2.0,
    targetPosition: { x: 5, y: 5, z: 0.5 },
    batteryLevel: 50
  });
  assert.equal(excessiveTurn.permitted, false);
  assert.equal(excessiveTurn.code, "ANGULAR_VELOCITY_EXCEEDED");
});

test("PhysicalSafetyController: enforces critical battery cutoff threshold", () => {
  const safety = new PhysicalSafetyController();
  const lowBattery = safety.validateMotionCommand({
    linearVelocity: 0.5,
    angularVelocity: 0.2,
    targetPosition: { x: 1, y: 1, z: 0 },
    batteryLevel: 10 // Below 15% threshold
  });
  assert.equal(lowBattery.permitted, false);
  assert.equal(lowBattery.code, "BATTERY_CRITICAL");
});

test("PhysicalSafetyController: latching Emergency Stop blocks all motion until reset token provided", () => {
  const safety = new PhysicalSafetyController();
  assert.equal(safety.emergencyStopLatched, false);

  const eStopResult = safety.triggerEmergencyStop("Test operator trigger");
  assert.equal(eStopResult.latched, true);
  assert.ok(eStopResult.resetToken);

  // Any motion command must now be rejected
  const motionAfterEStop = safety.validateMotionCommand({
    linearVelocity: 0.1,
    angularVelocity: 0.1,
    targetPosition: { x: 0, y: 0, z: 0 },
    batteryLevel: 80
  });
  assert.equal(motionAfterEStop.permitted, false);
  assert.equal(motionAfterEStop.code, "EMERGENCY_STOP_ACTIVE");

  // Invalid reset token fails
  const invalidReset = safety.clearEmergencyStop("wrong-token");
  assert.equal(invalidReset.success, false);
  assert.equal(safety.emergencyStopLatched, true);

  // Correct reset token clears latch
  const validReset = safety.clearEmergencyStop(eStopResult.resetToken);
  assert.equal(validReset.success, true);
  assert.equal(safety.emergencyStopLatched, false);
});

test("RobotController: Registration handshake registers compatible robots", () => {
  const controller = new RobotController();
  const robot = controller.registerRobot({
    robotId: "mobile-bot-alpha",
    name: "Alpha Rover",
    type: "ground_rover",
    actuators: ["differential_drive", "pan_tilt_head"],
    sensors: ["lidar", "rgb_camera", "battery_monitor"],
    kinematics: "differential_drive"
  });

  assert.equal(robot.registered, true);
  assert.equal(robot.robotId, "mobile-bot-alpha");

  const fleet = controller.getFleetStatus();
  assert.equal(fleet.fleetCount, 1);
  assert.equal(fleet.robots[0].id, "mobile-bot-alpha");
});

test("RobotController: Dispatch motion respects safety mode and heartbeats", () => {
  const controller = new RobotController();
  controller.registerRobot({
    robotId: "bot-beta",
    name: "Beta Arm",
    actuators: ["robotic_arm_6dof"]
  });

  // Safe command in simulation mode
  const motion = controller.dispatchMotionCommand("bot-beta", {
    linearVelocity: 0.5,
    angularVelocity: 0.2,
    targetPosition: { x: 2, y: 3, z: 1 },
    batteryLevel: 65,
    mode: ROBOT_SAFETY_LEVELS.SIMULATION
  });

  assert.equal(motion.permitted, true);
  assert.equal(motion.mode, ROBOT_SAFETY_LEVELS.SIMULATION);
  assert.equal(motion.executed, true);
});

test("RobotController: Brain export and import handshake with cryptographic signature", () => {
  const controller = new RobotController();
  const exportedPackage = controller.exportBrainPackage({
    sourceIdentity: "ULTRON-CORE-001"
  });

  assert.ok(exportedPackage.packageId);
  assert.ok(exportedPackage.signature);
  assert.ok(exportedPackage.modules.length > 5);
  assert.equal(exportedPackage.robotCompatibility.ros2Supported, true);

  // Verify import into target robot host node
  const importResult = controller.importBrainPackage(exportedPackage, "unitree-robotics-dog");
  assert.equal(importResult.success, true);
  assert.equal(importResult.importedOn, "unitree-robotics-dog");
  assert.equal(importResult.status, "BRAIN_TRANSFERRED_READY");

  // Tampered package fails import
  const tamperedPackage = { ...exportedPackage, sourceIdentity: "TAMPERED-NODE" };
  const tamperedResult = controller.importBrainPackage(tamperedPackage, "unitree-robotics-dog");
  assert.equal(tamperedResult.success, false);
  assert.equal(tamperedResult.error, "PACKAGE_SIGNATURE_MISMATCH");
});
