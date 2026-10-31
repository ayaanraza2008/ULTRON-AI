import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllProviders,
  getProvider,
  listProviders,
  parseProviderModelId,
  makeProviderModelId,
  configureProvider,
  resolveProviderAuth,
  getProviderRegistryStats,
  isDeniedChannel,
} from "../integrations/dsh-god/provider-registry.js";

test("DSH Provider Registry: loads at least 70 offered providers from registry.json", () => {
  const providers = getAllProviders();
  assert.ok(providers.length >= 70, `Expected >= 70 providers, got ${providers.length}`);
  
  const groq = getProvider("groq");
  assert.ok(groq, "Groq provider should exist in registry");
  assert.equal(groq.id, "groq");
  assert.ok(Array.isArray(groq.models));
  assert.ok(groq.models.length > 0);
});

test("DSH Provider Registry: filters out denied channels (WorkBuddy, CodeBuddy, Huawei Cloud)", () => {
  assert.equal(isDeniedChannel("workbuddy"), true);
  assert.equal(isDeniedChannel("codebuddy"), true);
  assert.equal(isDeniedChannel("huaweicloud"), true);
  assert.equal(isDeniedChannel("groq"), false);
  assert.equal(isDeniedChannel("deepseek"), false);

  const all = getAllProviders();
  const deniedFound = all.some(p => isDeniedChannel(p.id, p.name));
  assert.equal(deniedFound, false, "Denied channels should not exist in offered providers list");
});

test("DSH Provider Registry: supports category, format, and search filtering", () => {
  const freeTier = listProviders({ category: "free-tier" });
  assert.ok(freeTier.length > 0);
  assert.ok(freeTier.every(p => p.category === "free-tier"));

  const chatFormat = listProviders({ format: "openai-chat" });
  assert.ok(chatFormat.length > 0);
  assert.ok(chatFormat.every(p => p.format === "openai-chat"));

  const anthropicFormat = listProviders({ format: "anthropic-messages" });
  assert.ok(anthropicFormat.length > 0);
  assert.ok(anthropicFormat.every(p => p.format === "anthropic-messages"));

  const searchResults = listProviders({ search: "deepseek" });
  assert.ok(searchResults.length > 0);
});

test("DSH Provider Registry: parses and builds composite provider/model IDs", () => {
  const composite = makeProviderModelId("groq", "llama-3.3-70b-versatile");
  assert.equal(composite, "groq/llama-3.3-70b-versatile");

  const parsed = parseProviderModelId("groq/llama-3.3-70b-versatile");
  assert.ok(parsed);
  assert.equal(parsed.providerId, "groq");
  assert.equal(parsed.modelId, "llama-3.3-70b-versatile");
  assert.equal(parsed.provider.id, "groq");

  const invalid = parseProviderModelId("invalid-no-slash");
  assert.equal(invalid, null);

  const unknownProvider = parseProviderModelId("nonexistent_provider/some-model");
  assert.equal(unknownProvider, null);
});

test("DSH Provider Registry: configures provider enable status, custom API key, and baseUrl", () => {
  const updated = configureProvider("groq", {
    enabled: true,
    apiKey: "sk-test-groq-mock-key-12345678",
    baseUrl: "https://custom.groq.example.com/v1",
  });

  assert.equal(updated.id, "groq");
  assert.equal(updated.hasCustomKey, true);
  assert.equal(updated.effectiveBaseUrl, "https://custom.groq.example.com/v1");

  const auth = resolveProviderAuth("groq");
  assert.equal(auth.baseUrl, "https://custom.groq.example.com/v1");
  assert.ok(auth.headers["authorization"]?.includes("Bearer"));

  // Reset back to clean state
  configureProvider("groq", { apiKey: null, baseUrl: null });
});

test("DSH Provider Registry: computes summary metrics correctly", () => {
  const stats = getProviderRegistryStats();
  assert.ok(stats.totalProviders >= 70);
  assert.ok(stats.totalModels >= 500);
  assert.ok(stats.byCategory["apikey"] > 0);
  assert.ok(stats.byFormat["openai-chat"] > 0);
  assert.ok(stats.enabledCount > 0);
});
