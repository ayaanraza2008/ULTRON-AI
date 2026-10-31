import test from "node:test";
import assert from "node:assert/strict";
import { UltronCore, MODEL_TIERS } from "../core/ultron-core.js";

test("UltronCore: token estimation and context preparation", () => {
  const core = new UltronCore({ maxContextTokens: 2048 });
  const prompt = "Analyze the deployment logs for memory pressure and optimize CPU usage.";
  const context = core.prepareContext(prompt, {
    systemPrompt: "System active.",
    media: [{ type: "image/jpeg", dataUrl: "data:image/jpeg;base64,12345", description: "dashboard screenshot" }]
  });

  assert.equal(context.prompt, prompt);
  assert.equal(context.mediaAttachments.length, 1);
  assert.equal(context.mediaAttachments[0].description, "dashboard screenshot");
  assert.ok(context.estimatedTotalTokens > 0);
  assert.ok(context.sessionId.startsWith("ultron-session-"));
});

test("UltronCore: short-term memory sliding-window compaction and promotion", () => {
  const core = new UltronCore({ maxShortTermTurns: 3 });

  core.recordTurn("user", "Hello Ultron");
  core.recordTurn("assistant", "Systems online. Awaiting directive.");
  core.recordTurn("user", "Save key architecture design pattern.", { important: true });
  assert.equal(core.shortTermMemory.length, 3);

  // Evict turn 0 ("Hello Ultron")
  core.recordTurn("assistant", "Acknowledged.");
  assert.equal(core.shortTermMemory.length, 3);
  assert.equal(core.shortTermMemory[0].content, "Systems online. Awaiting directive.");

  // Evict turn 1 ("Systems online...")
  core.recordTurn("user", "Turn 4");
  assert.equal(core.shortTermMemory.length, 3);

  // Evict turn 2 ("Save key architecture...") which has important: true
  core.recordTurn("assistant", "Turn 5");
  assert.equal(core.shortTermMemory.length, 3);

  // Verify important turn was promoted to long-term memory
  assert.ok(core.longTermMemory.size >= 1);
  const mems = Array.from(core.longTermMemory.values());
  assert.ok(mems.some(m => m.fact.includes("Save key architecture")));
});

test("UltronCore: long-term memory indexing and keyword recall ranking", () => {
  const core = new UltronCore();

  core.storeMemory("Iron Man suit Mark 85 utilizes nano-tech alloy composition.", ["suit", "ironman", "armor"]);
  core.storeMemory("Ryzen 7 5700U features 8 cores and 16 threads at 15W TDP.", ["hardware", "cpu", "amd"]);
  core.storeMemory("Supabase Mumbai region ap-south-1 hosts the primary user data.", ["database", "supabase", "mumbai"]);

  const recalledCpu = core.recallMemories("tell me about the hardware CPU specifications");
  assert.ok(recalledCpu.length >= 1);
  assert.equal(recalledCpu[0].tags.includes("cpu"), true);
  assert.ok(recalledCpu[0].fact.includes("Ryzen 7"));

  const recalledArmor = core.recallMemories("suit armor alloy");
  assert.ok(recalledArmor.length >= 1);
  assert.equal(recalledArmor[0].tags.includes("armor"), true);
});

test("UltronCore: reasoning and verification engine scores certainty and flags speculation", () => {
  const core = new UltronCore();

  // Certain, verified statement
  const verifiedRes = core.verifyReasoning("The server is listening on port 3000. All unit tests passed cleanly.");
  assert.equal(verifiedRes.verified, true);
  assert.ok(verifiedRes.confidenceScore >= 0.7);
  assert.equal(verifiedRes.flagged, false);

  // Speculative, uncertain statement
  const speculativeRes = core.verifyReasoning("I think maybe the database might fail if possibly the network drops. Perhaps it could happen.");
  assert.equal(speculativeRes.verified, false);
  assert.ok(speculativeRes.uncertaintyScore > 0.4);
  assert.equal(speculativeRes.flagged, true);
  assert.ok(speculativeRes.claims.some(c => c.requiresToolVerification));
});

test("UltronCore: model orchestration handles provider failover and tracks trace", async () => {
  const core = new UltronCore();

  // Test with injected runner simulating primary failure and secondary success
  let callCount = 0;
  const mockRunner = async (provider, context) => {
    callCount++;
    if (provider.name === "openrouter-primary") {
      throw new Error("HTTP 429: Rate limit exceeded");
    }
    return {
      text: `Generated response from ${provider.name}`,
      model: provider.model,
      provider: provider.name
    };
  };

  const res = await core.orchestrateInference("Write a binary search in JavaScript", {
    inferenceRunner: mockRunner
  });

  assert.equal(res.success, true);
  assert.ok(res.content.includes("Generated response"));
  assert.equal(res.executionTrace.length, 2);
  assert.equal(res.executionTrace[0].status, "failed");
  assert.equal(res.executionTrace[1].status, "success");
  assert.equal(callCount, 2);
  assert.ok(core.shortTermMemory.length >= 2);
});
