/**
 * ULTRON AI — Robotics & Simulation Training Engine (Category Q)
 * Module: robotics/simready-simulation-engine.js
 *
 * Implements a CPU-friendly, NVIDIA SimReady & OpenUSD-compatible robotics
 * simulation, asset discovery, depth-sensor perception, joint PID actuation,
 * training scenario generation, dataset export, playback, and Hardware-In-The-Loop (HIL)
 * architecture optimized for AMD Ryzen 7 5700U / 8GB RAM environments.
 */

import crypto from "node:crypto";

/**
 * Standard 3D Robot Asset Archetypes
 */
export const SIMREADY_ASSET_CATALOG = [
  {
    assetId: "simready-hexarover-v2",
    name: "ULTRON HexaRover v2",
    category: "mobile_base",
    description: "6-wheel independent drive heavy-duty mobile base with skid steering and LiDAR mast.",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "ULTRON_METADATA_ONLY",
    format: "usd",
    openUsdVersion: "23.11",
    dimensionsM: { x: 0.85, y: 0.42, z: 0.65 },
    massKg: 18.5,
    centerOfMassM: { x: 0, y: 0.12, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.85,
      restitution: 0.05
    },
    joints: [
      { name: "wheel_fl", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "wheel_ml", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "wheel_rl", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "wheel_fr", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "wheel_mr", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "wheel_rr", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 15.0, maxTorqueNm: 25.0 },
      { name: "lidar_mast_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -Math.PI, upperLimitRad: Math.PI, maxVelocityRps: 6.28, maxTorqueNm: 5.0 }
    ],
    defaultSensors: ["lidar_360", "depth_camera_front", "imu_6axis", "battery_telemetry"]
  },
  {
    assetId: "simready-arm-6dof",
    name: "ULTRON Manipulator 6DOF",
    category: "manipulator",
    description: "6-axis articulated robotic arm with modular two-finger parallel gripper.",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "ULTRON_METADATA_ONLY",
    format: "urdf",
    openUsdVersion: "23.11",
    dimensionsM: { x: 0.3, y: 0.95, z: 0.3 },
    massKg: 8.2,
    centerOfMassM: { x: 0, y: 0.35, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.7,
      restitution: 0.02
    },
    joints: [
      { name: "base_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -2.96, upperLimitRad: 2.96, maxVelocityRps: 3.14, maxTorqueNm: 40.0 },
      { name: "shoulder_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -1.74, upperLimitRad: 1.74, maxVelocityRps: 2.5, maxTorqueNm: 60.0 },
      { name: "elbow_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -2.61, upperLimitRad: 2.61, maxVelocityRps: 2.8, maxTorqueNm: 35.0 },
      { name: "wrist_roll", type: "revolute", axis: [1, 0, 0], lowerLimitRad: -3.14, upperLimitRad: 3.14, maxVelocityRps: 4.0, maxTorqueNm: 15.0 },
      { name: "wrist_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -1.92, upperLimitRad: 1.92, maxVelocityRps: 4.0, maxTorqueNm: 15.0 },
      { name: "wrist_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -3.14, upperLimitRad: 3.14, maxVelocityRps: 4.5, maxTorqueNm: 10.0 },
      { name: "gripper_finger_left", type: "prismatic", axis: [0, 1, 0], lowerLimitM: 0.0, upperLimitM: 0.045, maxVelocityMps: 0.1, maxForceN: 50.0 }
    ],
    defaultSensors: ["wrist_ft_sensor", "wrist_camera_rgbd", "joint_encoders"]
  },
  {
    assetId: "simready-biped-v1",
    name: "ULTRON Humanoid Biped v1",
    category: "humanoid",
    description: "12-DOF bipedal locomotion testbed for balance, gait synthesis, and rough terrain traversal.",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "ULTRON_METADATA_ONLY",
    format: "usd",
    openUsdVersion: "23.11",
    dimensionsM: { x: 0.45, y: 1.15, z: 0.35 },
    massKg: 24.0,
    centerOfMassM: { x: 0, y: 0.65, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.9,
      restitution: 0.01
    },
    joints: [
      { name: "l_hip_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -0.78, upperLimitRad: 0.78, maxVelocityRps: 4.0, maxTorqueNm: 80.0 },
      { name: "l_hip_roll", type: "revolute", axis: [1, 0, 0], lowerLimitRad: -0.52, upperLimitRad: 0.52, maxVelocityRps: 4.0, maxTorqueNm: 80.0 },
      { name: "l_hip_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -1.57, upperLimitRad: 0.78, maxVelocityRps: 5.0, maxTorqueNm: 110.0 },
      { name: "l_knee_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: 0.0, upperLimitRad: 2.35, maxVelocityRps: 5.0, maxTorqueNm: 120.0 },
      { name: "l_ankle_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -0.78, upperLimitRad: 0.78, maxVelocityRps: 6.0, maxTorqueNm: 50.0 },
      { name: "l_ankle_roll", type: "revolute", axis: [1, 0, 0], lowerLimitRad: -0.35, upperLimitRad: 0.35, maxVelocityRps: 6.0, maxTorqueNm: 40.0 },
      { name: "r_hip_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -0.78, upperLimitRad: 0.78, maxVelocityRps: 4.0, maxTorqueNm: 80.0 },
      { name: "r_hip_roll", type: "revolute", axis: [1, 0, 0], lowerLimitRad: -0.52, upperLimitRad: 0.52, maxVelocityRps: 4.0, maxTorqueNm: 80.0 },
      { name: "r_hip_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -1.57, upperLimitRad: 0.78, maxVelocityRps: 5.0, maxTorqueNm: 110.0 },
      { name: "r_knee_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: 0.0, upperLimitRad: 2.35, maxVelocityRps: 5.0, maxTorqueNm: 120.0 },
      { name: "r_ankle_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -0.78, upperLimitRad: 0.78, maxVelocityRps: 6.0, maxTorqueNm: 50.0 },
      { name: "r_ankle_roll", type: "revolute", axis: [1, 0, 0], lowerLimitRad: -0.35, upperLimitRad: 0.35, maxVelocityRps: 6.0, maxTorqueNm: 40.0 }
    ],
    defaultSensors: ["pelvis_imu", "foot_force_sensors", "head_depth_camera"]
  }
];

/**
 * 3D OpenUSD Stage and USDA Text Generator
 */
export class USDEnvironmentBuilder {
  constructor(options = {}) {
    this.stageName = options.stageName || "UltronSimulationWorld";
    this.gravity = options.gravity || { x: 0, y: -9.81, z: 0 };
    this.groundFriction = options.groundFriction ?? 0.8;
    this.ambientTempC = options.ambientTempC ?? 22.0;
    this.obstacles = [];
    this.lighting = {
      sunIntensity: 1000.0,
      sunDirection: [0.3, -0.9, 0.3],
      ambientIntensity: 120.0
    };
  }

  addObstacle(obstacle = {}) {
    const obs = {
      id: obstacle.id || "obs-" + crypto.randomBytes(4).toString("hex"),
      name: obstacle.name || "StaticObstacle",
      shape: obstacle.shape || "box", // "box" | "sphere" | "cylinder"
      position: obstacle.position || { x: 0, y: 0.5, z: 0 },
      dimensions: obstacle.dimensions || { x: 1.0, y: 1.0, z: 1.0 },
      friction: obstacle.friction ?? this.groundFriction,
      colorRgb: obstacle.colorRgb || [0.4, 0.4, 0.5]
    };
    this.obstacles.push(obs);
    return obs;
  }

  /**
   * Generates standard OpenUSD (USDA format) text definition compatible with
   * NVIDIA Omniverse, Isaac Sim, Blender USD, and Pixar USD toolchains.
   */
  exportOpenUSDA() {
    const obstaclePrims = this.obstacles.map(obs => `
    def Xform "${obs.id}" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsCollisionAPI"]
    )
    {
        custom float3 xformOp:translate = (${obs.position.x}, ${obs.position.y}, ${obs.position.z})
        uniform token[] xformOpOrder = ["xformOp:translate"]

        def Cube "collision_mesh"
        {
            float3 size = (${obs.dimensions.x}, ${obs.dimensions.y}, ${obs.dimensions.z})
            color3f[] primvars:displayColor = [(${obs.colorRgb.join(", ")})]
        }
    }`).join("\n");

    return `#usda 1.0
(
    defaultPrim = "${this.stageName}"
    metersPerUnit = 1.0
    upAxis = "Y"
)

def Xform "${this.stageName}" (
    prepend apiSchemas = ["PhysicsSceneAPI"]
)
{
    float3 physics:gravity = (${this.gravity.x}, ${this.gravity.y}, ${this.gravity.z})
    float physics:groundFriction = ${this.groundFriction}

    def GroundPlane "GroundPlane"
    {
        uniform token axis = "Y"
        float friction = ${this.groundFriction}
    }

${obstaclePrims}
}
`;
  }

  toJSON() {
    return {
      stageName: this.stageName,
      gravity: this.gravity,
      groundFriction: this.groundFriction,
      ambientTempC: this.ambientTempC,
      obstaclesCount: this.obstacles.length,
      obstacles: this.obstacles,
      lighting: this.lighting
    };
  }
}

/**
 * Joint Actuator PID Effort Controller
 */
export class JointActuatorController {
  constructor(jointDef, gains = { kp: 120.0, ki: 2.0, kd: 15.0 }) {
    this.name = jointDef.name;
    this.type = jointDef.type;
    this.axis = jointDef.axis || [0, 0, 1];
    this.lowerLimit = jointDef.lowerLimitRad ?? jointDef.lowerLimitM ?? -Infinity;
    this.upperLimit = jointDef.upperLimitRad ?? jointDef.upperLimitM ?? Infinity;
    this.maxVelocity = jointDef.maxVelocityRps ?? jointDef.maxVelocityMps ?? 5.0;
    this.maxEffort = jointDef.maxTorqueNm ?? jointDef.maxForceN ?? 50.0;

    // Current state
    this.position = 0.0;
    this.velocity = 0.0;
    this.effort = 0.0;

    // PID configuration
    this.kp = gains.kp;
    this.ki = gains.ki;
    this.kd = gains.kd;
    this.integralErr = 0.0;
    this.prevErr = 0.0;
  }

  stepPID(targetPosition, dt = 0.01) {
    if (dt <= 0) return { position: this.position, effort: 0 };

    // Clamped target position within joint mechanical limits
    const clampedTarget = Math.max(this.lowerLimit, Math.min(this.upperLimit, targetPosition));
    const error = clampedTarget - this.position;

    this.integralErr += error * dt;
    // Anti-windup clamping
    this.integralErr = Math.max(-10.0, Math.min(10.0, this.integralErr));
    const derivative = (error - this.prevErr) / dt;
    this.prevErr = error;

    let computedEffort = (this.kp * error) + (this.ki * this.integralErr) + (this.kd * derivative);
    computedEffort = Math.max(-this.maxEffort, Math.min(this.maxEffort, computedEffort));
    this.effort = computedEffort;

    // Numerical integration (assuming simplified 1.0 kg*m^2 joint inertia)
    const acceleration = computedEffort / 1.0;
    this.velocity += acceleration * dt;
    this.velocity = Math.max(-this.maxVelocity, Math.min(this.maxVelocity, this.velocity));

    this.position += this.velocity * dt;
    this.position = Math.max(this.lowerLimit, Math.min(this.upperLimit, this.position));

    return {
      joint: this.name,
      target: Number(clampedTarget.toFixed(4)),
      position: Number(this.position.toFixed(4)),
      velocity: Number(this.velocity.toFixed(4)),
      effort: Number(this.effort.toFixed(4)),
      error: Number(error.toFixed(4))
    };
  }
}

/**
 * Synthetic Depth & RGB Camera Sensor Simulation
 * Computes pinhole projection, depth buffer, and 3D point cloud.
 */
export class SyntheticDepthCamera {
  constructor(options = {}) {
    this.name = options.name || "front_depth_camera";
    this.resolution = options.resolution || { width: 32, height: 24 }; // CPU-friendly low-res grid
    this.fovRad = options.fovRad || (70 * Math.PI / 180); // 70 deg
    this.nearM = options.nearM || 0.15;
    this.farM = options.farM || 10.0;
    this.sensorPosition = options.position || { x: 0, y: 0.4, z: 0 };
    this.sensorYawRad = options.yawRad || 0;
  }

  /**
   * Generates a depth image matrix and 3D point cloud against 3D obstacles
   */
  captureFrame(obstacles = []) {
    const { width, height } = this.resolution;
    const depthMatrix = [];
    const pointCloud = [];

    const halfFov = this.fovRad / 2;

    for (let r = 0; r < height; r++) {
      const row = [];
      const pitchAngle = ((r / (height - 1)) - 0.5) * (this.fovRad * (height / width));

      for (let c = 0; c < width; c++) {
        const yawOffset = ((c / (width - 1)) - 0.5) * this.fovRad;
        const totalYaw = this.sensorYawRad + yawOffset;

        // Cast ray from camera position
        let rayDist = this.farM;

        for (const obs of obstacles) {
          const dx = obs.position.x - this.sensorPosition.x;
          const dz = obs.position.z - this.sensorPosition.z;
          const angleToObs = Math.atan2(dz, dx);
          const centerDist = Math.hypot(dx, dz);

          let diff = Math.abs(totalYaw - angleToObs);
          while (diff > Math.PI) diff = Math.abs(diff - 2 * Math.PI);

          const approxRadius = Math.max(obs.dimensions.x, obs.dimensions.z) / 2;
          if (diff < (approxRadius / Math.max(0.5, centerDist))) {
            const hitDist = Math.max(this.nearM, centerDist - approxRadius);
            if (hitDist < rayDist) {
              rayDist = Number(hitDist.toFixed(2));
            }
          }
        }

        // Add subtle sensor noise (+- 1%)
        const noisyDist = Math.min(this.farM, Math.max(this.nearM, Number((rayDist + (Math.random() - 0.5) * 0.03).toFixed(2))));
        row.push(noisyDist);

        if (noisyDist < this.farM) {
          // Reconstruct 3D Point in world coordinates
          pointCloud.push({
            x: Number((this.sensorPosition.x + noisyDist * Math.cos(totalYaw) * Math.cos(pitchAngle)).toFixed(3)),
            y: Number((this.sensorPosition.y + noisyDist * Math.sin(pitchAngle)).toFixed(3)),
            z: Number((this.sensorPosition.z + noisyDist * Math.sin(totalYaw) * Math.cos(pitchAngle)).toFixed(3)),
            confidence: 0.98
          });
        }
      }
      depthMatrix.push(row);
    }

    return {
      sensor: this.name,
      timestamp: new Date().toISOString(),
      resolution: this.resolution,
      nearM: this.nearM,
      farM: this.farM,
      minObservedDepthM: Math.min(...depthMatrix.flat()),
      maxObservedDepthM: Math.max(...depthMatrix.flat()),
      pointCloudCount: pointCloud.length,
      pointCloudSample: pointCloud.slice(0, 50)
    };
  }
}

/**
 * Standard Robotics Training Scenarios
 */
export const TRAINING_SCENARIOS = {
  WAREHOUSE_NAVIGATION: {
    id: "scenario-warehouse-nav",
    name: "Warehouse Autonomous Navigation",
    description: "Navigate cluttered warehouse aisles to reach the target shipping bay without collisions.",
    startPosition: { x: -8.0, y: 0.0, z: -8.0 },
    targetWaypoint: { x: 8.0, y: 0.0, z: 8.0 },
    maxSteps: 250,
    timeLimitS: 60,
    obstacles: [
      { id: "shelf_01", shape: "box", position: { x: -3.0, y: 1.0, z: -2.0 }, dimensions: { x: 1.5, y: 2.0, z: 4.0 } },
      { id: "shelf_02", shape: "box", position: { x: 3.0, y: 1.0, z: 2.0 }, dimensions: { x: 1.5, y: 2.0, z: 4.0 } },
      { id: "pallet_stack", shape: "box", position: { x: 0.0, y: 0.6, z: 0.0 }, dimensions: { x: 1.2, y: 1.2, z: 1.2 } }
    ]
  },
  OBSTACLE_COURSE: {
    id: "scenario-obstacle-slalom",
    name: "Agility Slalom Obstacle Course",
    description: "Tight slalom obstacle course designed for tuning turning radii and obstacle avoidance.",
    startPosition: { x: 0.0, y: 0.0, z: -10.0 },
    targetWaypoint: { x: 0.0, y: 0.0, z: 10.0 },
    maxSteps: 200,
    timeLimitS: 45,
    obstacles: [
      { id: "cone_1", shape: "cylinder", position: { x: 1.0, y: 0.5, z: -6.0 }, dimensions: { x: 0.6, y: 1.0, z: 0.6 } },
      { id: "cone_2", shape: "cylinder", position: { x: -1.0, y: 0.5, z: -2.0 }, dimensions: { x: 0.6, y: 1.0, z: 0.6 } },
      { id: "cone_3", shape: "cylinder", position: { x: 1.0, y: 0.5, z: 2.0 }, dimensions: { x: 0.6, y: 1.0, z: 0.6 } },
      { id: "cone_4", shape: "cylinder", position: { x: -1.0, y: 0.5, z: 6.0 }, dimensions: { x: 0.6, y: 1.0, z: 0.6 } }
    ]
  },
  SAFE_CORRIDOR_PATROL: {
    id: "scenario-corridor-patrol",
    name: "Facility Perimeter Corridor Patrol",
    description: "Cyclic patrol loop adhering to physical corridor boundaries with geofence safety margins.",
    startPosition: { x: -5.0, y: 0.0, z: 0.0 },
    targetWaypoint: { x: 5.0, y: 0.0, z: 0.0 },
    maxSteps: 180,
    timeLimitS: 40,
    obstacles: [
      { id: "wall_left", shape: "box", position: { x: 0.0, y: 1.5, z: -3.0 }, dimensions: { x: 14.0, y: 3.0, z: 0.4 } },
      { id: "wall_right", shape: "box", position: { x: 0.0, y: 1.5, z: 3.0 }, dimensions: { x: 14.0, y: 3.0, z: 0.4 } }
    ]
  }
};

/**
 * Simulation Training Scenario Runner & Dataset Generator
 */
export class SimulationTrainingProject {
  constructor(options = {}) {
    this.projectId = options.id || "proj-sim-" + crypto.randomBytes(4).toString("hex");
    this.name = options.name || "ULTRON-Robotics-Sim-Project";
    this.selectedAsset = options.asset || SIMREADY_ASSET_CATALOG[0];
    this.environment = new USDEnvironmentBuilder({ stageName: this.name });
    this.depthCamera = new SyntheticDepthCamera({ position: { x: 0, y: 0.35, z: 0 } });
    this.jointControllers = (this.selectedAsset.joints || []).map(j => new JointActuatorController(j));
    this.recordedEpisodes = [];
    this.status = "INITIALIZED";
  }

  registerRobot(asset) {
    if (!asset || typeof asset !== "object") throw new Error("Invalid robot asset");
    this.selectedAsset = asset;
    this.jointControllers = (asset.joints || []).map(j => new JointActuatorController(j));
    return { registered: true, assetId: asset.assetId, name: asset.name };
  }

  loadScenario(scenarioKey = "WAREHOUSE_NAVIGATION") {
    const sc = TRAINING_SCENARIOS[scenarioKey] || TRAINING_SCENARIOS.WAREHOUSE_NAVIGATION;
    this.currentScenario = sc;
    this.environment.obstacles = [];
    for (const obs of sc.obstacles) {
      this.environment.addObstacle(obs);
    }
    return {
      loaded: true,
      scenarioId: sc.id,
      name: sc.name,
      obstaclesCount: sc.obstacles.length
    };
  }

  /**
   * Runs an automated closed-loop training episode using PID control and depth sensing.
   */
  runEpisode(maxSteps = 50) {
    if (!this.currentScenario) {
      this.loadScenario("WAREHOUSE_NAVIGATION");
    }

    const episodeId = "ep-" + crypto.randomBytes(4).toString("hex");
    const trajectory = [];
    let currentX = this.currentScenario.startPosition.x;
    let currentZ = this.currentScenario.startPosition.z;
    let currentYaw = 0.0;
    const dt = 0.1;
    let collisions = 0;
    let targetReached = false;

    for (let step = 0; step < maxSteps; step++) {
      // Calculate angle and distance to target waypoint
      const dx = this.currentScenario.targetWaypoint.x - currentX;
      const dz = this.currentScenario.targetWaypoint.z - currentZ;
      const distToTarget = Math.hypot(dx, dz);
      const angleToTarget = Math.atan2(dz, dx);

      if (distToTarget < 0.6) {
        targetReached = true;
        break;
      }

      // Proportional steering control
      let yawError = angleToTarget - currentYaw;
      while (yawError > Math.PI) yawError -= 2 * Math.PI;
      while (yawError < -Math.PI) yawError += 2 * Math.PI;

      const steerCmd = Math.max(-1.0, Math.min(1.0, yawError * 1.5));
      const speedCmd = Math.max(0.2, Math.min(1.2, distToTarget * 0.3));

      // Sensor frame
      this.depthCamera.sensorPosition = { x: currentX, y: 0.35, z: currentZ };
      this.depthCamera.sensorYawRad = currentYaw;
      const sensorFrame = this.depthCamera.captureFrame(this.environment.obstacles);

      // Check collision
      let hit = false;
      for (const obs of this.environment.obstacles) {
        const d = Math.hypot(currentX - obs.position.x, currentZ - obs.position.z);
        const clearance = Math.max(obs.dimensions.x, obs.dimensions.z) / 2 + 0.4;
        if (d < clearance) {
          hit = true;
          collisions++;
          break;
        }
      }

      currentYaw += steerCmd * dt;
      currentX += speedCmd * Math.cos(currentYaw) * dt;
      currentZ += speedCmd * Math.sin(currentYaw) * dt;

      trajectory.push({
        step,
        timestampMs: step * 100,
        position: { x: Number(currentX.toFixed(3)), y: 0.0, z: Number(currentZ.toFixed(3)) },
        yawRad: Number(currentYaw.toFixed(3)),
        linearSpeed: Number(speedCmd.toFixed(2)),
        angularSpeed: Number(steerCmd.toFixed(2)),
        minObservedDepthM: sensorFrame.minObservedDepthM,
        distToTargetM: Number(distToTarget.toFixed(2)),
        collision: hit
      });
    }

    const episodeRecord = {
      episodeId,
      scenarioId: this.currentScenario.id,
      stepsCount: trajectory.length,
      targetReached,
      collisionsCount: collisions,
      initialDistanceM: Number(Math.hypot(
        this.currentScenario.targetWaypoint.x - this.currentScenario.startPosition.x,
        this.currentScenario.targetWaypoint.z - this.currentScenario.startPosition.z
      ).toFixed(2)),
      finalDistanceM: trajectory.length ? trajectory[trajectory.length - 1].distToTargetM : 0,
      trajectory
    };

    this.recordedEpisodes.push(episodeRecord);
    if (this.recordedEpisodes.length > 20) this.recordedEpisodes.shift();

    return episodeRecord;
  }

  /**
   * Export episode trajectory as a ML training dataset in JSON format
   */
  exportDatasetJSON() {
    return {
      projectId: this.projectId,
      robotAsset: this.selectedAsset.assetId,
      formatVersion: "ULTRON-SIMDATA-v1",
      exportedAt: new Date().toISOString(),
      episodesCount: this.recordedEpisodes.length,
      totalTrajectoryFrames: this.recordedEpisodes.reduce((acc, ep) => acc + ep.trajectory.length, 0),
      episodes: this.recordedEpisodes
    };
  }

  /**
   * Export episode trajectory as a ML training dataset in CSV format
   */
  exportDatasetCSV() {
    const headers = [
      "episode_id",
      "step",
      "timestamp_ms",
      "pos_x",
      "pos_z",
      "yaw_rad",
      "linear_speed",
      "angular_speed",
      "min_depth_m",
      "dist_to_target_m",
      "collision"
    ];

    const lines = [headers.join(",")];

    for (const ep of this.recordedEpisodes) {
      for (const t of ep.trajectory) {
        lines.push([
          ep.episodeId,
          t.step,
          t.timestampMs,
          t.position.x,
          t.position.z,
          t.yawRad,
          t.linearSpeed,
          t.angularSpeed,
          t.minObservedDepthM,
          t.distToTargetM,
          t.collision ? 1 : 0
        ].join(","));
      }
    }

    return lines.join("\n");
  }
}

/**
 * Simulation Playback & Metric Evaluation Engine
 */
export class SimulationPlaybackEngine {
  constructor() {}

  evaluateAndPlayback(episodeRecord) {
    if (!episodeRecord || !Array.isArray(episodeRecord.trajectory) || episodeRecord.trajectory.length === 0) {
      throw new Error("Invalid episode trajectory record for playback.");
    }

    const traj = episodeRecord.trajectory;
    let totalPathLengthM = 0;
    let minObservedDistanceM = Infinity;
    let maxAngularSpeedRps = 0;

    for (let i = 1; i < traj.length; i++) {
      const prev = traj[i - 1];
      const curr = traj[i];
      const segDist = Math.hypot(curr.position.x - prev.position.x, curr.position.z - prev.position.z);
      totalPathLengthM += segDist;

      if (curr.minObservedDepthM < minObservedDistanceM) {
        minObservedDistanceM = curr.minObservedDepthM;
      }
      if (Math.abs(curr.angularSpeed) > maxAngularSpeedRps) {
        maxAngularSpeedRps = Math.abs(curr.angularSpeed);
      }
    }

    const efficiencyScore = Math.max(0, Math.min(100, Math.round(
      (episodeRecord.targetReached ? 60 : 20) +
      (episodeRecord.collisionsCount === 0 ? 30 : -20) +
      (minObservedDistanceM > 0.5 ? 10 : 0) -
      (traj.length * 0.05)
    )));

    return {
      episodeId: episodeRecord.episodeId,
      playbackDurationS: (traj.length * 0.1).toFixed(1),
      totalPathLengthM: Number(totalPathLengthM.toFixed(2)),
      minClearanceObservedM: Number(minObservedDistanceM.toFixed(2)),
      maxAngularSpeedRps: Number(maxAngularSpeedRps.toFixed(2)),
      targetReached: episodeRecord.targetReached,
      collisionsCount: episodeRecord.collisionsCount,
      efficiencyScore,
      playbackReady: true
    };
  }
}

/**
 * Hardware-in-the-Loop (HIL) Extension Interface
 * Provides standardized ROS 2 / Micro-ROS message structures and serial telemetry packets.
 */
export class HardwareInTheLoopBridge {
  constructor(options = {}) {
    this.activeMode = "SIMULATION";
    this.baudRate = options.baudRate || 115200;
    this.targetNode = options.targetNode || "ultron_hil_node";
    this.physicalHardwareVerified = false;
    this.connectionTimestamp = null;
    this.lastPacketReceived = null;
  }

  async handshake() {
    // No physical ROS 2 transport/attestation adapter exists in this release.
    // Never promote a token-shaped string or injected mock to HIL_CONNECTED.
    this.activeMode = "SIMULATION";
    this.physicalHardwareVerified = false;
    return {
      success: false,
      mode: "SIMULATION",
      physicalHardwareVerified: false,
      error: "PHYSICAL_HIL_ADAPTER_NOT_IMPLEMENTED"
    };
  }

  formatRos2TwistPacket(linearMps, angularRps) {
    return {
      topic: "/cmd_vel",
      msgType: "geometry_msgs/msg/Twist",
      timestamp: Date.now(),
      linear: { x: Number(linearMps.toFixed(3)), y: 0.0, z: 0.0 },
      angular: { x: 0.0, y: 0.0, z: Number(angularRps.toFixed(3)) },
      hilFailsafeArm: false,
      transmissionAllowed: false,
      physicalHardwareVerified: false,
      mode: "SIMULATION"
    };
  }

  async sendRos2TwistPacket() {
    return {
      success: false,
      transmitted: false,
      physicalActuation: false,
      error: "PHYSICAL_HIL_ADAPTER_NOT_IMPLEMENTED"
    };
  }

  formatSensorTelemetryPacket(sensors = {}) {
    return {
      topic: "/ultron/telemetry",
      msgType: "ultron_interfaces/msg/RobotTelemetry",
      timestamp: Date.now(),
      batteryPercent: sensors.batteryPercent ?? null,
      emergencyHaltState: sensors.emergencyHaltLatched ?? null,
      linearSpeed: sensors.linearSpeed ?? null,
      mode: "SIMULATION",
      physicalHardwareVerified: false
    };
  }

  disconnect() {
    this.activeMode = "SIMULATION";
    this.physicalHardwareVerified = false;
    this.connectionTimestamp = null;
    return { success: true, mode: "SIMULATION", physicalHardwareVerified: false };
  }
}

/**
 * Static metadata references for NVIDIA SimReady Central entries.
 * This catalogue does not fetch or bundle meshes, collision assets, or physics files.
 * https://huggingface.co/spaces/nvidia/simready-central
 */
export const SIMREADY_CENTRAL_EXTENDED_CATALOG = [
  {
    assetId: "simready-agv-forklift",
    name: "Autonomous Pallet Forklift AGV",
    category: "logistics",
    source: "nvidia/simready-central",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "STATIC_REFERENCE_NOT_FETCHED",
    huggingFaceSpace: "https://huggingface.co/spaces/nvidia/simready-central",
    description: "Industrial autonomous guided vehicle with dual hydraulic forks, 360-degree safety LiDAR, and 1200kg lift capacity.",
    format: "usd",
    openUsdVersion: "23.11",
    dimensionsM: { x: 1.6, y: 1.1, z: 2.1 },
    massKg: 650.0,
    centerOfMassM: { x: 0, y: 0.45, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.9,
      restitution: 0.01
    },
    joints: [
      { name: "drive_wheel", type: "continuous", axis: [0, 1, 0], maxVelocityRps: 12.0, maxTorqueNm: 200.0 },
      { name: "steer_pivot", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -1.57, upperLimitRad: 1.57, maxVelocityRps: 2.0, maxTorqueNm: 80.0 },
      { name: "fork_elevator", type: "prismatic", axis: [0, 0, 1], lowerLimitM: 0.05, upperLimitM: 1.8, maxVelocityMps: 0.3, maxForceN: 12000.0 }
    ],
    defaultSensors: ["safety_lidar_360", "fork_camera_depth", "wheel_odometry"]
  },
  {
    assetId: "simready-quadruped-spot",
    name: "Industrial Quadruped Scout v1",
    category: "robotics",
    source: "nvidia/simready-central",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "STATIC_REFERENCE_NOT_FETCHED",
    huggingFaceSpace: "https://huggingface.co/spaces/nvidia/simready-central",
    description: "12-DOF dynamic quadruped robotic platform for rough terrain inspection, obstacle climbing, and facility patrol.",
    format: "usd",
    openUsdVersion: "23.11",
    dimensionsM: { x: 0.9, y: 0.45, z: 0.6 },
    massKg: 32.0,
    centerOfMassM: { x: 0, y: 0.2, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.85,
      restitution: 0.03
    },
    joints: [
      { name: "fl_hip_yaw", type: "revolute", axis: [0, 0, 1], lowerLimitRad: -0.8, upperLimitRad: 0.8, maxVelocityRps: 15.0, maxTorqueNm: 35.0 },
      { name: "fl_hip_pitch", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -1.2, upperLimitRad: 1.2, maxVelocityRps: 15.0, maxTorqueNm: 40.0 },
      { name: "fl_knee", type: "revolute", axis: [0, 1, 0], lowerLimitRad: -2.5, upperLimitRad: -0.5, maxVelocityRps: 18.0, maxTorqueNm: 45.0 }
    ],
    defaultSensors: ["body_imu_6axis", "front_stereo_depth", "foot_contact_sensors"]
  },
  {
    assetId: "simready-warehouse-pallet",
    name: "Standard Euro Pallet (EUR 1)",
    category: "props",
    source: "nvidia/simready-central",
    assetAvailability: "METADATA_ONLY",
    sourceVerification: "STATIC_REFERENCE_NOT_FETCHED",
    huggingFaceSpace: "https://huggingface.co/spaces/nvidia/simready-central",
    description: "Standard industrial wooden pallet with accurate physics collision boundaries and surface friction.",
    format: "usd",
    openUsdVersion: "23.11",
    dimensionsM: { x: 1.2, y: 0.8, z: 0.144 },
    massKg: 25.0,
    centerOfMassM: { x: 0, y: 0.07, z: 0 },
    simReadyCompliance: {
      metadataOnly: true,
      hasVisualMesh: false,
      hasCollisionMesh: false,
      hasPhysicsMaterials: false,
      frictionCoefficient: 0.65,
      restitution: 0.02
    },
    joints: [],
    defaultSensors: []
  }
];

export class SimReadyCentralExplorer {
  constructor(options = {}) {
    this.catalog = [...SIMREADY_ASSET_CATALOG, ...SIMREADY_CENTRAL_EXTENDED_CATALOG];
  }

  searchAssets({ query = "", category = null, limit = 10 } = {}) {
    const q = String(query || "").trim().toLowerCase();
    const matches = this.catalog.filter(asset => {
      const matchQuery = !q ||
        asset.assetId.toLowerCase().includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        asset.description.toLowerCase().includes(q);
      const matchCat = !category || asset.category.toLowerCase() === category.toLowerCase();
      return matchQuery && matchCat;
    });

    return {
      success: true,
      query: q,
      categoryFilter: category,
      totalMatched: matches.length,
      assets: matches.slice(0, limit)
    };
  }

  getAssetDetails(assetId) {
    const asset = this.catalog.find(a => a.assetId === assetId);
    if (!asset) {
      return { success: false, error: "ASSET_NOT_FOUND" };
    }
    return { success: true, asset };
  }

  importAssetToProject(assetId, project = simReadyEngine) {
    const asset = this.catalog.find(a => a.assetId === assetId);
    if (!asset) {
      return { success: false, error: "ASSET_NOT_FOUND" };
    }
    const registered = project.registerRobot(asset);
    return {
      success: true,
      importedAssetId: asset.assetId,
      registeredName: registered.name,
      importType: "STATIC_METADATA_REGISTRATION",
      geometryDownloaded: false,
      liveHuggingFaceConnection: false
    };
  }
}

export const simReadyCentralExplorer = new SimReadyCentralExplorer();

export const simReadyEngine = new SimulationTrainingProject();
export const playbackEngine = new SimulationPlaybackEngine();
export const hilBridge = new HardwareInTheLoopBridge();
