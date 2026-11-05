import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "../core/tool-registry.js";

test("AI inference tool does not report deterministic offline rules as model inference", async () => {
  const registry = new ToolRegistry({
    ultronCore: { brainRouter: null },
    zeroCostAiEngine: {
      completeWithFallback: async () => ({
        success: true,
        tier: 4,
        provider: "offline_deterministic_rules",
        text: "ULTRON offline mode active.",
        action: "offline_fallback"
      })
    }
  });

  const result = await registry.execute("ai_chat_inference", { prompt: "Explain quantum computing" });
  assert.equal(result.success, false);
  assert.equal(result.status, "MODEL_UNAVAILABLE");
  assert.equal(result.error.code, "AI_MODEL_UNAVAILABLE");
  assert.equal(result.provider, "offline_deterministic_rules");
});

test("memory store tool does not invent a memory ID when persistence is unavailable", async () => {
  const registry = new ToolRegistry({
    ultronCore: {}
  });

  const result = await registry.execute("memory_store", { content: "This should not be persisted" });
  assert.equal(result.success, false);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.error.code, "MEMORY_STORE_UNAVAILABLE");
  assert.equal("memoryId" in result, false);
});
