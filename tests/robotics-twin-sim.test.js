import test from "node:test";
import assert from "node:assert/strict";
import {
  RobotDigitalTwin,
  QLearningNavigationAgent,
  SimToRealDeploymentGate,
  ROBOT_ACTIONS
} from "../robotics/robot-digital-twin.js";

test("RobotDigitalTwin: kinematic simulation step updates coordinates and depletes battery", () => {
  const twin = new RobotDigitalTwin({ batteryPercent: 95 });

  // Move forward for 1 second (10 steps at dt=0.1s)
  for (let i = 0; i < 10; i++) {
    const res = twin.step({ linearVelocity: 1.0, angularVelocity: 0.0 }, 0.1);
    assert.equal(res.stepped, true);
    assert.equal(res.collision, false);
  }

  assert.ok(twin.currentPosition.x > 0.8, `Expected position x > 0.8, got ${twin.currentPosition.x}`);
  assert.ok(twin.currentBatteryPercent < 95.0, "Battery should deplete with movement");
});

test("RobotDigitalTwin: LiDAR raycasting detects obstacles and reports distances", () => {
  const twin = new RobotDigitalTwin({ lidarRays: 8, lidarRangeM: 10.0 });
  twin.currentPosition = { x: 0, y: 0, z: 0 };
  twin.orientationRad = 0;

  // Obstacle right ahead at x=3.0, z=0
  const obstacles = [{ x: 3.0, z: 0.0, radius: 0.5 }];
  const scan = twin.scanLidar(obstacles);

  assert.equal(scan.length, 8);
  // Ray 0 is forward along yaw=0
  const forwardRay = scan[0];
  assert.ok(forwardRay.distanceM < 3.0, `Expected forward ray < 3.0m, got ${forwardRay.distanceM}`);
});

test("QLearningNavigationAgent: learns state-action policy and updates Q-table", () => {
  const agent = new QLearningNavigationAgent({ alpha: 0.5, gamma: 0.9, epsilon: 0.0 });

  const state1 = "NEAR_FAR_FAR";
  const action = ROBOT_ACTIONS.TURN_RIGHT;
  const reward = 5.0;
  const nextState = "FAR_FAR_FAR";

  const initialQ = agent.getQValues(state1)[action];
  assert.equal(initialQ, 0.0);

  // Update policy with positive reward
  agent.update(state1, action, reward, nextState);
  const updatedQ = agent.getQValues(state1)[action];
  assert.ok(updatedQ > 0, `Expected updated Q > 0, got ${updatedQ}`);

  // With epsilon=0, greedily chooses highest Q-value action
  const chosen = agent.chooseAction(state1);
  assert.equal(chosen, ROBOT_ACTIONS.TURN_RIGHT);
});

test("SimToRealDeploymentGate: rejects unsafe trajectories and issues deployment passport for safe missions", () => {
  const gate = new SimToRealDeploymentGate();

  // 1. Unsafe trajectory with a collision
  const unsafeTrajectory = [
    { collision: false, minClearance: 1.0, batteryPercent: 90 },
    { collision: true, minClearance: 0.05, batteryPercent: 88 }
  ];
  assert.throws(() => {
    gate.issueDeploymentPassport("bot-99", unsafeTrajectory);
  }, /Sim-to-Real deployment rejected/);

  // 2. Safe trajectory with clearance > 0.35m and zero collisions
  const safeTrajectory = [
    { collision: false, minClearance: 1.5, batteryPercent: 98 },
    { collision: false, minClearance: 0.8, batteryPercent: 95 },
    { collision: false, minClearance: 0.5, batteryPercent: 92 }
  ];

  const passport = gate.issueDeploymentPassport("bot-99", safeTrajectory);
  assert.equal(passport.success, true);
  assert.ok(passport.deploymentPassportToken.startsWith("pass_"));
  assert.ok(passport.evaluationScore > 50);
});
