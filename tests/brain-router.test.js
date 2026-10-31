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
