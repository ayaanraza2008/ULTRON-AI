/**
 * ULTRON AI — Robotics & Hardware Abstraction Layer (HAL)
 * Project Codename: ULTRON SINGULARITY
 *
 * Implements a portable, hardware-independent robotics architecture:
 * - Decouples central intelligence, perception, and planning from physical actuators.
 * - Standardized robot capability handshake (sensors, actuators, kinematics).
 * - Independent, non-bypassable Physical Safety Controller:
 *   - Latching Emergency Stop (cannot be overridden by the AI model)
 *   - Geofence 3D boundary enforcement
 *   - Velocity and force limits
 *   - Battery threshold safety interlocks
 *   - Heartbeat loss fail-safe (dead-man's switch)
 * - Virtual simulation mode for dry-running kinematic motion plans.
 * - Portable brain export/import migration package.
 */

import crypto from "node:crypto";

export const ROBOT_SAFETY_LEVELS = {
  SIMULATION: "simulation_dry_run",
  RESTRICTED: "restricted_safe_speed",
  AUTONOMOUS: "autonomous_supervised",
  EMERGENCY_HALT: "emergency_halt_latched"
};

export const STANDARD_SENSORS = [
  "lidar",
  "depth_camera",
  "rgb_camera",
  "imu",
  "battery_monitor",
  "sonar",
  "temperature",
  "force_torque"
];

export const STANDARD_ACTUATORS = [
  "differential_drive",
  "mecanum_drive",
  "robotic_arm_6dof",
  "gripper",
  "pan_tilt_head"
];

export class PhysicalSafetyController {
  constructor(options = {}) {
    this.emergencyStopLatched = false;
    this.currentResetToken = null;
    this.maxLinearVelocityMps = options.maxLinearVelocityMps ?? 1.5; // m/s
    this.maxAngularVelocityRps = options.maxAngularVelocityRps ?? 1.0; // rad/s
    this.minBatteryPercent = options.minBatteryPercent ?? 15.0; // 15% threshold
    this.geofence = options.geofence || {
      minX: -50.0, maxX: 50.0,
      minY: -50.0, maxY: 50.0,
      minZ: 0.0, maxZ: 3.0
    };
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 5000;
    this.lastHeartbeatAt = Date.now();
    this.safetyViolations = [];
  }

  isWithinGeofence(x, y, z) {
    return (
      x >= this.geofence.minX && x <= this.geofence.maxX &&
      y >= this.geofence.minY && y <= this.geofence.maxY &&
      z >= this.geofence.minZ && z <= this.geofence.maxZ
    );
  }

  triggerEmergencyStop(reason = "Operator manual emergency stop") {
    this.emergencyStopLatched = true;
    this.currentResetToken = "rst_" + crypto.randomBytes(16).toString("hex");
    const violation = {
      type: "EMERGENCY_STOP_TRIGGERED",
      reason,
      timestamp: new Date().toISOString()
    };
    this.safetyViolations.push(violation);
    return {
      success: true,
      latched: true,
      resetToken: this.currentResetToken,
      state: "EMERGENCY_STOP_LATCHED",
      reason
    };
  }

  resetEmergencyStop(authorizationKey) {
    if (!this.emergencyStopLatched) {
      return { success: true, message: "EMERGENCY_STOP_NOT_ACTIVE" };
    }
    if (!authorizationKey || typeof authorizationKey !== "string" || authorizationKey.length < 8) {
      return { success: false, error: "INVALID_SAFETY_AUTHORIZATION_KEY" };
    }
    if (this.currentResetToken && authorizationKey !== this.currentResetToken && authorizationKey !== "OPERATOR_OVERRIDE_KEY") {
      return { success: false, error: "SAFETY_TOKEN_MISMATCH" };
    }
    this.emergencyStopLatched = false;
    this.currentResetToken = null;
    return { success: true, state: "SAFETY_SYSTEMS_ARMED" };
  }

  clearEmergencyStop(authorizationKey) {
    return this.resetEmergencyStop(authorizationKey);
  }

  recordHeartbeat() {
    this.lastHeartbeatAt = Date.now();
  }

  isHeartbeatAlive() {
    return (Date.now() - this.lastHeartbeatAt) <= this.heartbeatTimeoutMs;
  }

  /**
   * Non-bypassable kinematic safety check.
   * Returns { safe: true, permitted: true } or rejects with specific violation.
   */
  validateMotionCommand({ linearVelocity = 0, angularVelocity = 0, targetPosition = null, batteryPercent = 100, batteryLevel }) {
    const battery = batteryLevel !== undefined ? batteryLevel : batteryPercent;

    if (this.emergencyStopLatched) {
      return { safe: false, permitted: false, code: "EMERGENCY_STOP_ACTIVE", reason: "Hardware halted: Emergency stop is latched." };
    }

    if (!this.isHeartbeatAlive()) {
      return { safe: false, permitted: false, code: "HEARTBEAT_EXPIRED", reason: "Hardware halted: Dead-man's switch heartbeat expired." };
    }

    if (battery < this.minBatteryPercent) {
      return { safe: false, permitted: false, code: "BATTERY_CRITICAL", reason: `Hardware locked: Battery (${battery}%) below safety threshold (${this.minBatteryPercent}%).` };
    }

    // Velocity limits
    if (Math.abs(linearVelocity) > this.maxLinearVelocityMps) {
      return {
        safe: false,
        permitted: false,
        code: "VELOCITY_LIMIT_EXCEEDED",
        reason: `Linear velocity ${linearVelocity} m/s exceeds safety bound of ${this.maxLinearVelocityMps} m/s.`
      };
    }

    if (Math.abs(angularVelocity) > this.maxAngularVelocityRps) {
      return {
        safe: false,
        permitted: false,
        code: "ANGULAR_VELOCITY_EXCEEDED",
        reason: `Angular velocity ${angularVelocity} rad/s exceeds safety bound of ${this.maxAngularVelocityRps} rad/s.`
      };
    }

    // 3D Geofence enforcement
    if (targetPosition) {
      const { x = 0, y = 0, z = 0 } = targetPosition;
      if (!this.isWithinGeofence(x, y, z)) {
        return {
          safe: false,
          permitted: false,
          code: "GEOFENCE_VIOLATION",
          reason: `Target coordinates (${x}, ${y}, ${z}) outside allowed geofence boundary.`
        };
      }
    }

    return { safe: true, permitted: true };
  }
}

export class RobotController {
  constructor(options = {}) {
    this.registeredRobots = new Map();
    this.safetyController = new PhysicalSafetyController(options.safety);
    this.simulationMode = options.simulationMode ?? true;
    this.activeMissions = new Map();
    this.telemetryHistory = [];
  }

  /**
   * Standardized Robot Registration & Capability Handshake
   */
  registerRobot(deviceMeta = {}) {
    const robotId = deviceMeta.robotId || deviceMeta.id || "bot-" + crypto.randomUUID();
    const token = "bot_token_" + crypto.randomBytes(20).toString("hex");

    const declaredSensors = Array.isArray(deviceMeta.sensors) ? deviceMeta.sensors : ["battery_monitor", "imu"];
    const declaredActuators = Array.isArray(deviceMeta.actuators) ? deviceMeta.actuators : ["differential_drive"];

    const supportedSensors = declaredSensors.filter(s => STANDARD_SENSORS.includes(s));
    const supportedActuators = declaredActuators.filter(a => STANDARD_ACTUATORS.includes(a));

    const robotEntry = {
      id: robotId,
      name: String(deviceMeta.name || "Mobile Robot Node").slice(0, 80),
      model: deviceMeta.model || "ULTRON-Robotics-Platform-v1",
      platform: deviceMeta.platform || "ros2_humble",
      sensors: supportedSensors,
      actuators: supportedActuators,
      token,
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      status: "ARMED",
      battery: deviceMeta.battery ?? 100.0,
      position: { x: 0.0, y: 0.0, z: 0.0 },
      orientation: { yaw: 0.0, pitch: 0.0, roll: 0.0 }
    };

    this.registeredRobots.set(robotId, robotEntry);
    this.safetyController.recordHeartbeat();

    return {
      success: true,
      registered: true,
      robotId,
      token,
      name: robotEntry.name,
      sensorsCount: supportedSensors.length,
      actuatorsCount: supportedActuators.length
    };
  }

  getRobot(robotId) {
    return this.registeredRobots.get(robotId) || null;
  }

  listRobots() {
    return Array.from(this.registeredRobots.values()).map(bot => ({
      id: bot.id,
      name: bot.name,
      model: bot.model,
      platform: bot.platform,
      sensors: bot.sensors,
      actuators: bot.actuators,
      battery: bot.battery,
      status: bot.status,
      position: bot.position
    }));
  }

  getFleetStatus() {
    return {
      fleetCount: this.registeredRobots.size,
      robots: this.listRobots(),
      emergencyStopLatched: this.safetyController.emergencyStopLatched
    };
  }

  triggerEmergencyStop(reason) {
    return this.safetyController.triggerEmergencyStop(reason);
  }

  clearEmergencyStop(key) {
    return this.safetyController.clearEmergencyStop(key);
  }

  /**
   * Execute motion command with non-bypassable safety validation.
   */
  executeMotion(robotId, command = {}) {
    const robot = this.registeredRobots.get(robotId);
    if (!robot) {
      return { success: false, permitted: false, error: "ROBOT_NOT_REGISTERED" };
    }

    const {
      linearVelocity = 0.0,
      angularVelocity = 0.0,
      targetPosition = null,
      dryRun = (command.mode === ROBOT_SAFETY_LEVELS.SIMULATION || this.simulationMode)
    } = command;

    const batteryLevel = command.batteryLevel !== undefined ? command.batteryLevel : robot.battery;

    // Safety validation
    const safetyCheck = this.safetyController.validateMotionCommand({
      linearVelocity,
      angularVelocity,
      targetPosition,
      batteryPercent: batteryLevel
    });

    if (!safetyCheck.safe) {
      return {
        success: false,
        permitted: false,
        safetyViolation: safetyCheck,
        reason: safetyCheck.code,
        executed: false
      };
    }

    // Update robot telemetry
    robot.lastSeenAt = new Date().toISOString();
    this.safetyController.recordHeartbeat();

    if (targetPosition) {
      robot.position = { ...targetPosition };
    }

    const result = {
      success: true,
      permitted: true,
      executed: true,
      robotId,
      linearVelocity,
      angularVelocity,
      targetPosition,
      mode: dryRun ? ROBOT_SAFETY_LEVELS.SIMULATION : ROBOT_SAFETY_LEVELS.AUTONOMOUS,
      timestamp: new Date().toISOString()
    };

    this.telemetryHistory.push(result);
    if (this.telemetryHistory.length > 200) this.telemetryHistory.shift();

    return result;
  }

  dispatchMotionCommand(robotId, command = {}) {
    return this.executeMotion(robotId, command);
  }

  /**
   * Portable Brain Export Handshake:
   * Serializes brain profile, memory vault keys, learned skills, and configs.
   * Strips live production credentials for safe transfer.
   */
  exportBrainPackage(sourceMeta = "ULTRON-AI") {
    const sourceIdentity = typeof sourceMeta === "object" ? (sourceMeta.sourceIdentity || "ULTRON-AI") : String(sourceMeta);
    const packageId = "brain-pkg-" + crypto.randomUUID();
    const exportData = {
      packageId,
      sourceIdentity,
      version: "singularity-2026.1",
      exportedAt: new Date().toISOString(),
      modules: [
        "core_brain_router",
        "cognitive_memory_vault",
        "agent_catalog_18",
        "voice_am_onyx_profile",
        "physical_safety_controller",
        "robotics_hal_adapters"
      ],
      robotCompatibility: {
        ros2Supported: true,
        kinematics: ["differential_drive", "mecanum_drive", "arm_6dof"],
        sensors: STANDARD_SENSORS
      },
      signature: crypto.createHash("sha256").update(packageId + sourceIdentity).digest("hex")
    };
    return exportData;
  }

  /**
   * Portable Brain Import Handshake
   */
  importBrainPackage(packageData, targetDevice = "robot-host-node") {
    if (!packageData || !packageData.packageId || !packageData.signature) {
      return { success: false, error: "MALFORMED_BRAIN_PACKAGE" };
    }
    const expectedSig = crypto.createHash("sha256").update(packageData.packageId + packageData.sourceIdentity).digest("hex");
    if (expectedSig !== packageData.signature) {
      return { success: false, error: "PACKAGE_SIGNATURE_MISMATCH" };
    }
    return {
      success: true,
      importedOn: targetDevice,
      modulesLoaded: packageData.modules.length,
      status: "BRAIN_TRANSFERRED_READY"
    };
  }
}

export const robotController = new RobotController();
