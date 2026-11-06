import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("personal AI product surface contains no robot runtime or API routes", () => {
  const router = fs.readFileSync(path.join(root, "jarvis-router.js"), "utf8");
  const deviceManager = fs.readFileSync(path.join(root, "integrations", "multi-device-manager.js"), "utf8");
  const toolRegistry = fs.readFileSync(path.join(root, "core", "tool-registry.js"), "utf8");

  assert.doesNotMatch(router, /\/jarvis\/robotics\//i);
  assert.doesNotMatch(router, /from\s+["']\.\/robotics\//i);
  assert.doesNotMatch(deviceManager, /ROBOT_NODE|robot_node/i);
  assert.doesNotMatch(toolRegistry, /robotic|robotics|simready|actuation/i);
  const trackedRobotFiles = execFileSync("git", ["ls-files", "--", "robotics"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(trackedRobotFiles, "", "No robot runtime files may be tracked in the personal AI product.");
});

test("robot-only simulation and hardware test suites are absent", () => {
  const testFiles = [
    "robot-controller-safety.test.js",
    "robotics-hal.test.js",
    "robotics-simulation.test.js",
    "robotics-twin-sim.test.js"
  ];
  for (const name of testFiles) {
    assert.equal(fs.existsSync(path.join(root, "tests", name)), false, name + " must not be part of this product");
  }
});
