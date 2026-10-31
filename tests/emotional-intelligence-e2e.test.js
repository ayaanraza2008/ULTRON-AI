import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createJarvisRouter } from "../jarvis-router.js";
import { BrainRouter } from "../core/brain-router.js";
import { ultronHEI } from "../intelligence/hei/index.js";
import { EnergyCoreController, CORE_STATES } from "../public/energy-core.js";

async function withRouter({ env = { ULTRON_INTEGRATION_OWNER_USER_ID: "owner-user" }, userId = "owner-user" } = {}, run) {
  const app = express();
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: userId };
    next();
  };
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api", createJarvisRouter({ env, requireSupabaseUser }));
  const server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  try {
    await run("http://127.0.0.1:" + address.port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("HEI E2E: BrainRouter classifyComplexity dynamically includes emotional intelligence", () => {
  const brain = new BrainRouter();

  const codeQuery = "I am so frustrated that the database migration keeps failing again and again!";
  const result = brain.classifyComplexity(codeQuery);

  assert.ok(result.tier === "coding" || result.tier === "routine");
  assert.ok(result.emotionalIntelligence, "classifyComplexity must attach emotionalIntelligence");
  assert.equal(result.emotionalIntelligence.assessment.primaryEmotion, "FRUSTRATION");
  assert.ok(result.emotionalIntelligence.directive.includes("USER EMOTIONAL STATE: Frustration"));
  assert.equal(result.emotionalIntelligence.coreVisualState, "THOUGHTFUL");
});

test("HEI E2E: GET /api/jarvis/hei/status reports active engine telemetry and taxonomy", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/hei/status");
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.enabled, true);
    assert.equal(data.taxonomySize, 51);
    assert.ok(data.preferences);
    assert.ok(typeof data.activeContextTurns === "number");
  });
});

test("HEI E2E: POST /api/jarvis/hei/analyze performs multi-signal emotional evaluation", async () => {
  await withRouter({}, async base => {
    const res = await fetch(base + "/api/jarvis/hei/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "ULTRON, it finally worked! All 900 tests passed, I am so hyped!" })
    });
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.enabled, true);
    assert.equal(data.assessment.primaryEmotion, "EXCITEMENT");
    assert.ok(data.assessment.valence > 0.6);
    assert.equal(data.coreVisualState, "EXCITED");
    assert.ok(data.vocalSettings.speed >= 1.0);
  });
});

test("HEI E2E: POST /api/jarvis/hei/preferences updates user communication preferences", async () => {
  await withRouter({}, async base => {
    // 1. Update preferred style to DIRECT and adjust empathy slider
    const updateRes = await fetch(base + "/api/jarvis/hei/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        preferredStyle: "DIRECT",
        empathyLevel: 0.95,
        directAnswersWhenFrustrated: true
      })
    });
    assert.equal(updateRes.status, 200);
    const updatedData = await updateRes.json();
    assert.equal(updatedData.preferences.preferredStyle, "DIRECT");
    assert.equal(updatedData.preferences.empathyLevel, 0.95);

    // 2. Verify GET reflects update
    const getRes = await fetch(base + "/api/jarvis/hei/preferences");
    const getData = await getRes.json();
    assert.equal(getData.preferences.preferredStyle, "DIRECT");
  });
});

test("HEI E2E: POST /api/jarvis/hei/clear-context and delete-memory maintain privacy guarantees", async () => {
  await withRouter({}, async base => {
    // 1. Clear active conversational trajectory
    const clearRes = await fetch(base + "/api/jarvis/hei/clear-context", { method: "POST" });
    assert.equal(clearRes.status, 200);
    const clearData = await clearRes.json();
    assert.equal(clearData.cleared, true);

    // 2. Factory reset / delete all stored emotional memory
    const deleteRes = await fetch(base + "/api/jarvis/hei/delete-memory", { method: "POST" });
    assert.equal(deleteRes.status, 200);
    const deleteData = await deleteRes.json();
    assert.equal(deleteData.deleted, true);
    assert.equal(deleteData.resetToDefaults, true);
  });
});

test("HEI E2E: EnergyCoreController reacts dynamically to emotional feedback states", () => {
  const core = new EnergyCoreController();

  core.setEmotionalVisualState("SUPPORTIVE");
  assert.equal(core.currentState, CORE_STATES.EMOTIONAL_SUPPORTIVE);

  core.setEmotionalVisualState("EXCITED");
  assert.equal(core.currentState, CORE_STATES.EMOTIONAL_EXCITED);

  core.setEmotionalVisualState("THOUGHTFUL");
  assert.equal(core.currentState, CORE_STATES.EMOTIONAL_THOUGHTFUL);

  core.setEmotionalVisualState("CALM");
  assert.equal(core.currentState, CORE_STATES.EMOTIONAL_CALM);
});
