import test from "node:test";
import assert from "node:assert/strict";
import {
  SIMREADY_ASSET_CATALOG,
  USDEnvironmentBuilder,
  JointActuatorController,
  SyntheticDepthCamera,
  TRAINING_SCENARIOS,
  SimulationTrainingProject,
  SimulationPlaybackEngine,
  HardwareInTheLoopBridge,
  simReadyEngine,
  playbackEngine,
  hilBridge,
  simReadyCentralExplorer,
  SIMREADY_CENTRAL_EXTENDED_CATALOG
} from "../robotics/simready-simulation-engine.js";

test("RoboticsSim: SIMREADY_ASSET_CATALOG discovers valid 3D robot assets", () => {
  assert.ok(Array.isArray(SIMREADY_ASSET_CATALOG));
  assert.ok(SIMREADY_ASSET_CATALOG.length >= 3);

  for (const asset of SIMREADY_ASSET_CATALOG) {
    assert.ok(asset.assetId, "Asset must have an ID");
    assert.ok(asset.name, "Asset must have a name");
    assert.ok(asset.category, "Asset must have a category");
    assert.ok(asset.dimensionsM && typeof asset.dimensionsM.x === "number");
    assert.ok(asset.massKg > 0, "Mass must be positive");
    assert.ok(asset.simReadyCompliance.hasVisualMesh, "Must declare visual mesh");
    assert.ok(asset.simReadyCompliance.hasCollisionMesh, "Must declare collision mesh");
    assert.ok(Array.isArray(asset.joints) && asset.joints.length > 0, "Must declare joints");
    assert.ok(Array.isArray(asset.defaultSensors), "Must declare default sensors");
  }
});

test("RoboticsSim: USDEnvironmentBuilder generates valid OpenUSD (USDA) text and stage JSON", () => {
  const env = new USDEnvironmentBuilder({ stageName: "TestWarehouseWorld" });
  env.addObstacle({
    id: "cargo_box_01",
    shape: "box",
    position: { x: 2.5, y: 0.5, z: -1.0 },
    dimensions: { x: 1.0, y: 1.0, z: 1.0 }
  });

  const json = env.toJSON();
  assert.equal(json.stageName, "TestWarehouseWorld");
  assert.equal(json.obstaclesCount, 1);
  assert.equal(json.obstacles[0].id, "cargo_box_01");

  const usda = env.exportOpenUSDA();
  assert.ok(usda.includes("#usda 1.0"), "Must declare usda 1.0 header");
  assert.ok(usda.includes("def Xform \"TestWarehouseWorld\""), "Must declare stage prim");
  assert.ok(usda.includes("def Xform \"cargo_box_01\""), "Must declare obstacle prim");
  assert.ok(usda.includes("PhysicsRigidBodyAPI"), "Must include physics schema");
});

test("RoboticsSim: JointActuatorController steps PID control towards target with joint limit bounds", () => {
  const jointDef = {
    name: "arm_elbow",
    type: "revolute",
    lowerLimitRad: -2.5,
    upperLimitRad: 2.5,
    maxVelocityRps: 3.0,
    maxTorqueNm: 50.0
  };

  const pid = new JointActuatorController(jointDef, { kp: 150.0, ki: 5.0, kd: 20.0 });
  assert.equal(pid.position, 0.0);

  // Command to move to 1.57 radians (90 deg)
  const target = 1.57;
  for (let i = 0; i < 50; i++) {
    pid.stepPID(target, 0.01);
  }

  // After 50 steps, position should have moved towards target
  assert.ok(pid.position > 0.5, `Expected joint position > 0.5, got ${pid.position}`);

  // Test over-limit command
  const overLimitTarget = 4.0; // exceeds upperLimit of 2.5
  const stepRes = pid.stepPID(overLimitTarget, 0.01);
  assert.equal(stepRes.target, 2.5, "Target should clamp to upper limit");
});

test("RoboticsSim: SyntheticDepthCamera captures frame, calculates min depth, and outputs 3D point cloud", () => {
  const camera = new SyntheticDepthCamera({
    name: "test_depth_sensor",
    resolution: { width: 16, height: 12 },
    nearM: 0.2,
    farM: 10.0
  });

  const obstacles = [
    {
      id: "near_pillar",
      position: { x: 2.0, y: 0.0, z: 0.0 },
      dimensions: { x: 0.6, y: 2.0, z: 0.6 }
    }
  ];

  const frame = camera.captureFrame(obstacles);
  assert.equal(frame.sensor, "test_depth_sensor");
  assert.ok(frame.minObservedDepthM < 2.5, `Expected min depth < 2.5m, got ${frame.minObservedDepthM}`);
  assert.ok(frame.pointCloudCount > 0, "Point cloud should contain observed 3D points");
  assert.ok(frame.pointCloudSample[0].confidence > 0.9);
});

test("RoboticsSim: SimulationTrainingProject loads scenario, runs episode, and records trajectory", () => {
  const project = new SimulationTrainingProject({ name: "UnitTestSimProject" });
  const loadRes = project.loadScenario("OBSTACLE_COURSE");

  assert.equal(loadRes.loaded, true);
  assert.equal(loadRes.scenarioId, "scenario-obstacle-slalom");
  assert.ok(loadRes.obstaclesCount >= 4);

  const episode = project.runEpisode(25);
  assert.ok(episode.episodeId.startsWith("ep-"));
  assert.equal(episode.scenarioId, "scenario-obstacle-slalom");
  assert.ok(episode.stepsCount > 0);
  assert.ok(Array.isArray(episode.trajectory));
  assert.ok(typeof episode.finalDistanceM === "number");
});

test("RoboticsSim: Dataset generator exports valid JSON and CSV formats", () => {
  const project = new SimulationTrainingProject();
  project.loadScenario("SAFE_CORRIDOR_PATROL");
  project.runEpisode(15);

  // Test JSON dataset export
  const jsonDataset = project.exportDatasetJSON();
  assert.equal(jsonDataset.formatVersion, "ULTRON-SIMDATA-v1");
  assert.equal(jsonDataset.episodesCount, 1);
  assert.equal(jsonDataset.episodes[0].trajectory.length, 15);

  // Test CSV dataset export
  const csvDataset = project.exportDatasetCSV();
  assert.ok(typeof csvDataset === "string");
  const lines = csvDataset.trim().split("\n");
  assert.equal(lines.length, 16); // Header + 15 data rows
  assert.ok(lines[0].startsWith("episode_id,step,timestamp_ms,pos_x"));
});

test("RoboticsSim: SimulationPlaybackEngine evaluates trajectory and computes efficiency score", () => {
  const project = new SimulationTrainingProject();
  project.loadScenario("WAREHOUSE_NAVIGATION");
  const ep = project.runEpisode(20);

  const playback = new SimulationPlaybackEngine();
  const report = playback.evaluateAndPlayback(ep);

  assert.equal(report.episodeId, ep.episodeId);
  assert.ok(report.totalPathLengthM >= 0);
  assert.ok(report.minClearanceObservedM > 0);
  assert.ok(report.efficiencyScore >= 0 && report.efficiencyScore <= 100);
  assert.equal(report.playbackReady, true);
});

test("RoboticsSim: HIL bridge remains simulation-only without attested physical hardware", async () => {
  const hil = new HardwareInTheLoopBridge();
  assert.equal(hil.activeMode, "SIMULATION");

  const handRes = await hil.handshake("OPERATOR_AUTHORIZED_HIL_KEY");
  assert.equal(handRes.success, false);
  assert.equal(handRes.mode, "SIMULATION");
  assert.equal(handRes.error, "PHYSICAL_HIL_ADAPTER_NOT_IMPLEMENTED");
  assert.equal(hil.physicalHardwareVerified, false);

  const twist = hil.formatRos2TwistPacket(1.25, -0.45);
  assert.equal(twist.topic, "/cmd_vel");
  assert.equal(twist.msgType, "geometry_msgs/msg/Twist");
  assert.equal(twist.linear.x, 1.25);
  assert.equal(twist.angular.z, -0.45);
  assert.equal(twist.hilFailsafeArm, false);
  assert.equal(twist.transmissionAllowed, false);
  assert.equal(twist.physicalHardwareVerified, false);

  const blocked = await hil.sendRos2TwistPacket(1.25, -0.45);
  assert.equal(blocked.success, false);
  assert.equal(blocked.transmitted, false);
  assert.equal(blocked.physicalActuation, false);
  assert.equal(blocked.error, "PHYSICAL_HIL_ADAPTER_NOT_IMPLEMENTED");

  const telem = hil.formatSensorTelemetryPacket({ batteryPercent: 88, linearSpeed: 1.1 });
  assert.equal(telem.topic, "/ultron/telemetry");
  assert.equal(telem.batteryPercent, 88);
  assert.equal(telem.mode, "SIMULATION");
  assert.equal(telem.physicalHardwareVerified, false);

  const mockHil = new HardwareInTheLoopBridge({
    hardwareAdapter: {
      isPhysicalHardware: false,
      connect: async () => ({ physicalHardwareVerified: true, deviceId: "fake-device" }),
      send: async () => ({ acknowledged: true })
    },
    authorizationVerifier: async () => true,
    safetyController: { validateMotionCommand: () => ({ safe: true, permitted: true }) }
  });
  const mockHandshake = await mockHil.handshake("test-token");
  assert.equal(mockHandshake.success, false);
  assert.equal(mockHandshake.error, "PHYSICAL_HIL_ADAPTER_NOT_IMPLEMENTED");
  assert.equal(mockHil.activeMode, "SIMULATION");

  const disc = hil.disconnect();
  assert.equal(disc.mode, "SIMULATION");
  assert.equal(hil.activeMode, "SIMULATION");
});

test("RoboticsSim: SimReadyCentralExplorer filters its local static metadata catalog", () => {
  assert.ok(Array.isArray(SIMREADY_CENTRAL_EXTENDED_CATALOG));
  assert.ok(SIMREADY_CENTRAL_EXTENDED_CATALOG.length >= 3);

  // Search by category
  const logistics = simReadyCentralExplorer.searchAssets({ category: "logistics" });
  assert.equal(logistics.success, true);
  assert.ok(logistics.assets.some(a => a.assetId === "simready-agv-forklift"));

  // Search by keyword
  const quadruped = simReadyCentralExplorer.searchAssets({ query: "quadruped" });
  assert.equal(quadruped.success, true);
  assert.ok(quadruped.assets.some(a => a.assetId === "simready-quadruped-spot"));

  // Details lookup
  const details = simReadyCentralExplorer.getAssetDetails("simready-agv-forklift");
  assert.equal(details.success, true);
  assert.equal(details.asset.source, "nvidia/simready-central");
  assert.ok(details.asset.huggingFaceSpace.includes("simready-central"));
});

test("RoboticsSim: SimReadyCentralExplorer registers metadata without downloading geometry", () => {
  const result = simReadyCentralExplorer.importAssetToProject("simready-agv-forklift");
  assert.equal(result.success, true);
  assert.equal(result.importedAssetId, "simready-agv-forklift");
  assert.equal(result.registeredName, "Autonomous Pallet Forklift AGV");
  assert.equal(result.importType, "STATIC_METADATA_REGISTRATION");
  assert.equal(result.geometryDownloaded, false);
  assert.equal(result.liveHuggingFaceConnection, false);
});
