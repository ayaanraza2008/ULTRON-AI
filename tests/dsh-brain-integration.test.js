import test from "node:test";
import assert from "node:assert/strict";
import { BrainRouter } from "../core/brain-router.js";
import { executeInference } from "../integrations/dsh-god/inference-router.js";

test("DSH Brain Integration: BrainRouter includes dsh-god-gateway in provider chain", () => {
  const router = new BrainRouter();
  const complexityCoding = router.classifyComplexity("Refactor the parser algorithm in JavaScript");
  const chain = router.selectProviderChain(complexityCoding);

  const dshCandidate = chain.find(p => p.name === "dsh-god-gateway");
  assert.ok(dshCandidate, "dsh-god-gateway candidate must exist in provider chain");
  assert.equal(dshCandidate.type, "dsh_god_inference");
  assert.equal(dshCandidate.model, "combo:smart-code");
});

test("DSH Brain Integration: BrainRouter prioritizes DSH when preferredProvider is dsh", () => {
  const router = new BrainRouter();
  const chainDsh = router.selectProviderChain({
    tier: "routine",
    preferredProvider: "dsh",
    recommendedModel: "openrouter/free"
  });

  assert.equal(chainDsh[0].name, "dsh-god-gateway");
  assert.equal(chainDsh[0].type, "dsh_god_inference");
});

test("DSH Brain Integration: local fast-path execution resolves instantaneously with zero egress", async () => {
  const result = await executeInference({
    model: "local",
    messages: [{ role: "user", content: "ping" }],
  });

  assert.equal(result.model, "local-fast-path");
  assert.equal(result.choices?.[0]?.message?.content, "pong");
  assert.ok(result.usage.total_tokens > 0);
});
