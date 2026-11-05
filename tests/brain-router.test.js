import test from "node:test";
import assert from "node:assert/strict";
import { BrainRouter } from "../core/brain-router.js";

test("BrainRouter: classifies task complexity according to keywords and media", () => {
  const router = new BrainRouter();

  const codeTask = router.classifyComplexity("Refactor the Express API endpoint and fix the null pointer bug");
  assert.equal(codeTask.tier, "coding");
  assert.equal(codeTask.modelClass, "reasoning_code");

  const visualTask = router.classifyComplexity("Look at this screenshot and read the UI error", { hasMedia: true });
  assert.equal(visualTask.tier, "multimodal");
  assert.equal(visualTask.modelClass, "vision");

  const complexTask = router.classifyComplexity("Architect a multi-step strategy and decompose the workflow");
  assert.equal(complexTask.tier, "complex");

  const routineTask = router.classifyComplexity("Hello, what is your name?");
  assert.equal(routineTask.tier, "routine");
});

test("BrainRouter: detects Hindi, English, and Romanized Hinglish accurately", () => {
  const router = new BrainRouter();

  const english = router.detectLanguage("Can you please summarize my meeting notes for today?");
  assert.equal(english.language, "en");
  assert.equal(english.isHinglish, false);

  const devanagari = router.detectLanguage("नमस्ते, आप कैसे हैं?");
  assert.equal(devanagari.language, "hi");
  assert.equal(devanagari.script, "devanagari");

  const hinglish = router.detectLanguage("Mera calendar check karke batao aaj kya schedule hai bhai");
  assert.equal(hinglish.language, "hinglish");
  assert.equal(hinglish.isHinglish, true);
});

test("BrainRouter: detects uncertainty and hallucinations in responses", () => {
  const router = new BrainRouter();

  const certain = router.evaluateConfidence("Node.js 24.20.0 was released with enhanced ES module support.");
  assert.equal(certain.flagged, false);
  assert.ok(certain.confidence >= 0.9);

  const uncertain = router.evaluateConfidence("I think this might be right, but I'm not entirely sure as an AI.");
  assert.equal(uncertain.flagged, true);
  assert.ok(uncertain.uncertaintyScore > 0.4);
  assert.equal(uncertain.recommendation, "verify_with_tools_or_sources");
});

test("BrainRouter: provider chain with circuit breaking and CPU fallback", () => {
  const router = new BrainRouter();
  const complexity = router.classifyComplexity("Simple test query");
  const chain = router.selectProviderChain(complexity);

  assert.ok(chain.length >= 2);
  assert.equal(chain[0].name, "openrouter-primary");

  // Trip circuit on primary
  router.recordAttempt("openrouter-primary", false);
  router.recordAttempt("openrouter-primary", false);
  router.recordAttempt("openrouter-primary", false);

  assert.equal(router.isCircuitOpen("openrouter-primary"), true);

  const newChain = router.selectProviderChain(complexity);
  assert.equal(newChain[0].name, "openrouter-secondary");
});

test("BrainRouter: prioritizes Groq and Gemini when environment keys are configured", () => {
  const routerWithGroq = new BrainRouter({
    env: { GROQ_API_KEY: "gsk_mock_key_123" }
  });
  const chainGroq = routerWithGroq.selectProviderChain({ tier: "routine", preferredProvider: "groq" });
  assert.equal(chainGroq[0].name, "groq-cloud");
  assert.equal(chainGroq[0].apiKeyEnv, "GROQ_API_KEY");

  const routerWithGemini = new BrainRouter({
    env: { GEMINI_API_KEY: "AIza_mock_key_123" }
  });
  const chainGemini = routerWithGemini.selectProviderChain({ tier: "multimodal" });
  assert.equal(chainGemini[0].name, "gemini-flash");
  assert.equal(chainGemini[0].supportsVision, true);
});

test("BrainRouter: executeInference executes successfully and handles provider failover", async () => {
  const router = new BrainRouter({
    env: { OPENROUTER_API_KEY: "mock_test_key" }
  });

  // Successful call
  const mockFetchSuccess = async (url, options) => {
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Node.js 24 has first-class ES module and test runner support." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const res = await router.executeInference({
    prompt: "Tell me about Node.js 24",
    fetchImpl: mockFetchSuccess
  });

  assert.equal(res.success, true);
  assert.equal(res.provider, "openrouter-primary");
  assert.ok(res.content.includes("Node.js 24"));
  assert.ok(res.confidence.confidence >= 0.8);
  assert.equal(res.fallbackCount, 0);

  // Failover call: primary fails with 500, secondary succeeds
  let callCount = 0;
  const mockFetchFailover = async (url, options) => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("Internal Server Error", { status: 500 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Fallback secondary response achieved." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const failoverRes = await router.executeInference({
    prompt: "Simple failover test",
    fetchImpl: mockFetchFailover
  });

  assert.equal(failoverRes.success, true);
  assert.equal(failoverRes.provider, "openrouter-secondary");
  assert.equal(failoverRes.fallbackCount, 1);
  assert.ok(failoverRes.content.includes("Fallback secondary response"));
});

test("BrainRouter: ignores Gemini provider if key is an internal bearer token on Google AI Studio endpoint", () => {
  const routerWithInternalToken = new BrainRouter({
    env: { GEMINI_API_KEY: "AQ.mock_internal_session_token" }
  });
  const chain = routerWithInternalToken.selectProviderChain({ tier: "multimodal" });
  assert.ok(!chain.some(p => p.name === "gemini-flash"));
});

test("BrainRouter: prioritizes Cerebras when CEREBRAS_API_KEY is configured", () => {
  const routerWithCerebras = new BrainRouter({
    env: { CEREBRAS_API_KEY: "csk-mock-key-123" }
  });
  const chain = routerWithCerebras.selectProviderChain({ tier: "routine", preferredProvider: "cerebras" });
  assert.equal(chain[0].name, "cerebras-cloud");
  assert.equal(chain[0].apiKeyEnv, "CEREBRAS_API_KEY");
});

test("BrainRouter: fails over to next candidate when a provider returns an empty completion", async () => {
  const router = new BrainRouter({
    env: { OPENROUTER_API_KEY: "mock_test_key" }
  });

  let callCount = 0;
  const mockFetchEmptyFailover = async (url, options) => {
    callCount += 1;
    if (callCount === 1) {
      // Primary returns HTTP 200 with empty choices
      return new Response(JSON.stringify({
        choices: [{ message: { content: "   " } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Secondary recovers
    return new Response(JSON.stringify({
      choices: [{ message: { content: "Recovered from empty completion successfully." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const res = await router.executeInference({
    prompt: "Test empty response failover",
    fetchImpl: mockFetchEmptyFailover
  });

  assert.equal(res.success, true);
  assert.equal(res.provider, "openrouter-secondary");
  assert.equal(res.fallbackCount, 1);
  assert.ok(res.content.includes("Recovered from empty completion"));
});


test("BrainRouter: classifies spatial 3D queries and injects spatial scene context", async () => {
  const router = new BrainRouter({
    env: { OPENROUTER_API_KEY: "mock_test_key" }
  });

  const complexity = router.classifyComplexity("Where is the desk located in this 3D room?");
  assert.equal(complexity.tier, "spatial_3d");

  let sentPayload = null;
  const mockFetch = async (url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({
      choices: [{ message: { content: "The desk is at [0m, 0.4m, 2.4m]." } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const res = await router.executeInference({
    prompt: "Where is the desk?",
    context: {
      spatialSummary: "Room Dimensions: 4.2m x 4.8m x 2.8m. Desk at [0m, 0.4m, 2.4m]."
    },
    fetchImpl: mockFetch
  });

  assert.equal(res.success, true);
  assert.ok(sentPayload.messages[0].content.includes("Active 3D Spatial World Model (Diorama)"));
  assert.ok(sentPayload.messages[0].content.includes("Desk at [0m, 0.4m, 2.4m]"));
});

test("BrainRouter: BYOX pure-CPU semantic intent classification and embedding", () => {
  const router = new BrainRouter();
  const emb = router.getSemanticEmbedding("open chromium browser and click link");
  assert.equal(emb.length, 128);

  const res = router.classifySemanticIntent("increase system volume please", [
    { name: "BROWSER", description: "navigate to website or search internet" },
    { name: "VOLUME", description: "increase speaker volume, audio, mute" },
    { name: "CODE", description: "debug javascript or write python function" }
  ]);

  assert.equal(res.topIntent, "VOLUME");
  assert.ok(res.confidence > 0.45);
});
