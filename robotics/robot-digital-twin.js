/**
 * ULTRON AI — Next-Generation Autonomous Intelligence
 * Module: ULTRON ROBOTICS (robotics/robot-digital-twin.js)
 *
 * Implements Robot Digital Twins, pure-CPU kinematic & rigid-body simulation,
 * synthetic LiDAR/IMU sensor feeds, virtual training environments,
 * reinforcement learning (tabular Q-learning), behavior evaluation,
 * and safe sim-to-real deployment verification.
 *
 * Designed for pure CPU execution on AMD Ryzen 7 5700U with 8 GB RAM bounds.
 */

import crypto from "node:crypto";
import { ROBOT_SAFETY_LEVELS, PhysicalSafetyController } from "./robot-controller.js";

export const ROBOT_ACTIONS = {
  MOVE_FORWARD: "MOVE_FORWARD",
  TURN_LEFT: "TURN_LEFT",
  TURN_RIGHT: "TURN_RIGHT",
  REVERSE: "REVERSE",
  HALT: "HALT"
};

export class RobotDigitalTwin {
  constructor(options = {}) {
    this.robotId = options.id || "twin-robot-01";
    this.modelName = options.modelName || "ULTRON-HexaRover-v2";
    this.massKg = options.massKg || 12.5;
    this.wheelbaseM = options.wheelbaseM || 0.45;
    this.maxLinearSpeedMps = options.maxLinearSpeedMps || 1.5;
    this.maxAngularSpeedRps = options.maxAngularSpeedRps || 1.2;
    this.batteryCapacityWh = options.batteryCapacityWh || 120;
    this.currentBatteryPercent = options.batteryPercent ?? 100.0;
    this.currentPosition = { x: 0, y: 0, z: 0 };
    this.orientationRad = 0; // Yaw angle in radians
    this.velocity = { linear: 0, angular: 0 };
    this.sensorConfig = {
      lidarRays: options.lidarRays || 16,
      lidarRangeM: options.lidarRangeM || 10.0,
      imuNoiseStd: 0.02
    };
    this.safetyController = new PhysicalSafetyController();
  }

  /**
   * Physics & Kinematics simulation step (dt in seconds)
   */
  step(command = {}, dt = 0.1, obstacles = []) {
    const linearCmd = Math.max(-0.5, Math.min(this.maxLinearSpeedMps, Number(command.linearVelocity || 0)));
    const angularCmd = Math.max(-this.maxAngularSpeedRps, Math.min(this.maxAngularSpeedRps, Number(command.angularVelocity || 0)));

    // Safety validation
    const safetyCheck = this.safetyController.validateMotionCommand({
      linearVelocity: linearCmd,
      angularVelocity: angularCmd,
      targetPosition: {
        x: this.currentPosition.x + linearCmd * Math.cos(this.orientationRad) * dt,
        y: 0,
        z: this.currentPosition.z + linearCmd * Math.sin(this.orientationRad) * dt
      },
      batteryPercent: this.currentBatteryPercent
    });

    if (!safetyCheck.safe) {
      return {
        stepped: false,
        safetyViolation: safetyCheck.code,
        reason: safetyCheck.reason,
        position: { ...this.currentPosition }
      };
    }

    // Kinematic integration
    this.orientationRad = (this.orientationRad + angularCmd * dt) % (2 * Math.PI);
    const newX = this.currentPosition.x + linearCmd * Math.cos(this.orientationRad) * dt;
    const newZ = this.currentPosition.z + linearCmd * Math.sin(this.orientationRad) * dt;

    // Check collision with 2D bounding obstacles
    let collisionDetected = false;
    for (const obs of obstacles) {
      const dist = Math.hypot(newX - obs.x, newZ - obs.z);
      const minDist = (obs.radius || 0.8) + (this.wheelbaseM / 2);
      if (dist < minDist) {
        collisionDetected = true;
        break;
      }
    }

    if (!collisionDetected) {
      this.currentPosition.x = Number(newX.toFixed(3));
      this.currentPosition.z = Number(newZ.toFixed(3));
      this.velocity.linear = linearCmd;
      this.velocity.angular = angularCmd;
    } else {
      this.velocity.linear = 0;
      this.velocity.angular = 0;
    }

    // Battery drain model: base idle 0.002% per step + kinetic power consumption
    const powerDraw = (0.002 + Math.abs(linearCmd) * 0.015 + Math.abs(angularCmd) * 0.008) * (dt / 0.1);
    this.currentBatteryPercent = Math.max(0, Number((this.currentBatteryPercent - powerDraw).toFixed(3)));

    return {
      stepped: true,
      collision: collisionDetected,
      position: { ...this.currentPosition },
      orientationRad: Number(this.orientationRad.toFixed(3)),
      batteryPercent: this.currentBatteryPercent
    };
  }

  /**
   * Simulates a 360-degree LiDAR raycast range sensor against environment obstacles.
   */
  scanLidar(obstacles = []) {
    const numRays = this.sensorConfig.lidarRays;
    const maxRange = this.sensorConfig.lidarRangeM;
    const readings = [];

    for (let i = 0; i < numRays; i++) {
      const rayAngle = this.orientationRad + (i * (2 * Math.PI / numRays));
      let closestDistance = maxRange;

      for (const obs of obstacles) {
        // Circle-ray intersection check
        const dx = obs.x - this.currentPosition.x;
        const dz = obs.z - this.currentPosition.z;
        const angleToObs = Math.atan2(dz, dx);
        const distToCenter = Math.hypot(dx, dz);
        
        let diff = Math.abs(rayAngle - angleToObs);
        while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

        if (diff < 0.25) { // Ray aligns roughly with obstacle
          const hitDist = Math.max(0.1, distToCenter - (obs.radius || 0.8));
          if (hitDist < closestDistance) {
            closestDistance = Number(hitDist.toFixed(2));
          }
        }
      }

      // Add gentle sensor measurement noise
      const noisyDistance = Math.min(maxRange, Math.max(0.05, Number((closestDistance + (Math.random() - 0.5) * 0.02).toFixed(2))));
      readings.push({
        rayIndex: i,
        angleRad: Number(rayAngle.toFixed(3)),
        distanceM: noisyDistance
      });
    }

    return readings;
  }
}

/**
 * Tabular Reinforcement Learning Navigation Agent (Q-Learning)
 */
export class QLearningNavigationAgent {
  constructor(options = {}) {
    this.qTable = new Map();
    this.alpha = options.alpha !== undefined ? options.alpha : 0.2;
    this.gamma = options.gamma !== undefined ? options.gamma : 0.9;
    this.epsilon = options.epsilon !== undefined ? options.epsilon : 0.15;
    this.actions = [
      ROBOT_ACTIONS.MOVE_FORWARD,
      ROBOT_ACTIONS.TURN_LEFT,
      ROBOT_ACTIONS.TURN_RIGHT,
      ROBOT_ACTIONS.REVERSE
    ];
  }

  discretizeState(frontDist, leftDist, rightDist) {
    const bucket = d => (d < 1.0 ? "NEAR" : d < 3.0 ? "MID" : "FAR");
    return `${bucket(frontDist)}_${bucket(leftDist)}_${bucket(rightDist)}`;
  }

  getQValues(state) {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, {
        [ROBOT_ACTIONS.MOVE_FORWARD]: 0.0,
        [ROBOT_ACTIONS.TURN_LEFT]: 0.0,
        [ROBOT_ACTIONS.TURN_RIGHT]: 0.0,
        [ROBOT_ACTIONS.REVERSE]: 0.0
      });
    }
    return this.qTable.get(state);
  }

  chooseAction(state) {
    if (Math.random() < this.epsilon) {
      const idx = Math.floor(Math.random() * this.actions.length);
      return this.actions[idx];
    }
    const qVals = this.getQValues(state);
    let bestAction = this.actions[0];
    let maxQ = -Infinity;
    for (const [action, q] of Object.entries(qVals)) {
      if (q > maxQ) {
        maxQ = q;
        bestAction = action;
      }
    }
    return bestAction;
  }

  update(state, action, reward, nextState) {
    const qVals = this.getQValues(state);
    const nextQVals = this.getQValues(nextState);
    const maxNextQ = Math.max(...Object.values(nextQVals));

    const currentQ = qVals[action] || 0.0;
    qVals[action] = currentQ + this.alpha * (reward + this.gamma * maxNextQ - currentQ);
  }
}

/**
 * Behavior Evaluator and Sim-to-Real Deployment Gate
 */
export class SimToRealDeploymentGate {
  constructor() {
    this.minSafeClearanceM = 0.35;
    this.minBatteryPercent = 15.0;
  }

  evaluateTrajectory(trajectoryHistory = []) {
    if (!Array.isArray(trajectoryHistory) || trajectoryHistory.length === 0) {
      return { passed: false, score: 0, reason: "Empty trajectory log." };
    }

    let collisionsCount = 0;
    let minObsClearance = Infinity;
    for (const [index, point] of trajectoryHistory.entries()) {
      if (typeof point?.collision !== "boolean" ||
          typeof point?.minClearance !== "number" ||
          !Number.isFinite(point.minClearance) ||
          point.minClearance < 0 ||
          typeof point?.batteryPercent !== "number" ||
          !Number.isFinite(point.batteryPercent) ||
          point.batteryPercent < 0 ||
          point.batteryPercent > 100) {
        return {
          passed: false,
          score: 0,
          reason: `Missing or invalid safety telemetry at trajectory step ${index}.`,
          code: "SAFETY_TELEMETRY_INCOMPLETE"
        };
      }
      if (point.collision) collisionsCount++;
      minObsClearance = Math.min(minObsClearance, point.minClearance);
    }

    const startBat = trajectoryHistory[0].batteryPercent;
    const endBat = trajectoryHistory[trajectoryHistory.length - 1].batteryPercent;
    const totalEnergyPercent = Number((startBat - endBat).toFixed(2));
    const passedSafety = collisionsCount === 0 &&
      minObsClearance >= this.minSafeClearanceM &&
      endBat >= this.minBatteryPercent;
    const score = passedSafety
      ? Math.max(50, Math.round(100 - (totalEnergyPercent * 2) - (trajectoryHistory.length * 0.1)))
      : 0;

    return {
      passed: passedSafety,
      score,
      metrics: {
        collisionsCount,
        minObsClearanceM: Number(minObsClearance.toFixed(2)),
        totalEnergyPercent,
        finalBatteryPercent: endBat,
        trajectorySteps: trajectoryHistory.length
      }
    };
  }

  evaluateSimulationQualification(trajectoryHistory = []) {
    const result = this.evaluateTrajectory(trajectoryHistory);
    return {
      ...result,
      simulationQualified: result.passed === true,
      physicalDeploymentAuthorized: false,
      qualificationType: "SIMULATION_ONLY"
    };
  }

  issueDeploymentPassport(robotId, trajectoryHistory = []) {
    const qualification = this.evaluateSimulationQualification(trajectoryHistory);
    if (!qualification.passed) {
      throw new Error(`Simulation qualification rejected: Safety checks failed (${JSON.stringify(qualification.metrics)})`);
    }

    // A simulation trajectory cannot authorize real-world actuation.
    return {
      success: false,
      code: "PHYSICAL_HIL_REQUIRED",
      error: "Simulation qualification is not a physical deployment passport. Verified hardware-in-the-loop testing and owner authorization are required.",
      robotId,
      simulationQualified: true,
      physicalDeploymentAuthorized: false,
      deploymentPassportToken: null,
      evaluationScore: qualification.score,
      metrics: qualification.metrics,
      qualificationType: "SIMULATION_ONLY",
      evaluatedAt: new Date().toISOString()
    };
  }
}

export const simToRealGate = new SimToRealDeploymentGate();
