import test from "node:test";
import assert from "node:assert/strict";
import { GenesisEngine, GENESIS_TYPES } from "../genesis/genesis-engine.js";

test("GenesisEngine: generates REST API application scaffold with package and server", () => {
  const engine = new GenesisEngine();
  const app = engine.generateApplication({ name: "telemetry-relay", archetype: "REST_API" });

  assert.equal(app.type, GENESIS_TYPES.APP);
  assert.equal(app.name, "telemetry-relay");
  assert.ok(app.files["package.json"]);
  assert.ok(app.files["server.js"]);
  assert.ok(app.files["test/server.test.js"]);

  const pkg = JSON.parse(app.files["package.json"]);
  assert.equal(pkg.name, "telemetry-relay");
  assert.equal(pkg.dependencies.express, "^4.21.2");

  const validation = engine.validateArtifact(app.id);
  assert.equal(validation.passed, true);
  assert.equal(validation.issues.length, 0);
});

test("GenesisEngine: generates 3D physics-based simulation environment", () => {
  const engine = new GenesisEngine();
  const scene = engine.generate3DEnvironment({
    name: "Autonomous-Rover-Proving-Grounds",
    dimensions: { width: 60, depth: 60 },
    obstacleCount: 4
  });

  assert.equal(scene.type, GENESIS_TYPES.SIMULATION_3D);
  assert.equal(scene.name, "Autonomous-Rover-Proving-Grounds");
  assert.equal(scene.physicsEngine, "pure_cpu_rigid_body");
  assert.equal(scene.obstacles.length, 4);
  assert.ok(scene.spawnPoint);
  assert.ok(scene.targetGoal);
  assert.equal(scene.gravity.y, -9.81);

  const validation = engine.validateArtifact(scene.id);
  assert.equal(validation.passed, true);
});

test("GenesisEngine: generates, validates, and installs reusable agent capabilities", () => {
  const engine = new GenesisEngine();
  const capability = engine.generateAgentCapability({
    name: "network_diagnostics",
    description: "Performs DNS and latency diagnostics on a host",
    parameters: {
      type: "object",
      properties: {
        host: { type: "string", description: "Target hostname" }
      },
      required: ["host"]
    }
  });

  assert.equal(capability.type, GENESIS_TYPES.AGENT_CAPABILITY);
  assert.equal(capability.name, "network_diagnostics");
  assert.equal(capability.installed, false);

  // Validate artifact
  const val = engine.validateArtifact(capability.id);
  assert.equal(val.passed, true);

  // Install artifact
  const installRes = engine.installCapability(capability.id);
  assert.equal(installRes.success, true);
  assert.equal(installRes.toolName, "network_diagnostics");
  assert.ok(engine.installedCapabilities.has("network_diagnostics"));
});

test("GenesisEngine: catches unsafe code patterns and blocks installation", () => {
  const engine = new GenesisEngine();
  const dangerousCap = engine.generateAgentCapability({ name: "unsafe_tool" });
  dangerousCap.executableCode = "export async function execute() { return eval('2 + 2'); }";

  const val = engine.validateArtifact(dangerousCap.id);
  assert.equal(val.passed, false);
  assert.ok(val.issues.some(i => i.includes("disallowed pattern")));

  // Attempting to install must fail
  assert.throws(() => {
    engine.installCapability(dangerousCap.id);
  }, /Cannot install unverified capability/);
});
