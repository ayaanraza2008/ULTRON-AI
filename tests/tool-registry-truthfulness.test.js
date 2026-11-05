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


test("memory store does not claim durability for process-local memory records", async () => {
  const registry = new ToolRegistry({
    ultronCore: {
      storeMemory: async () => ({ id: "mem-process-local-1" })
    }
  });

  const result = await registry.execute("memory_store", { content: "This is only process-local" });
  assert.equal(result.success, false);
  assert.equal(result.status, "NON_DURABLE");
  assert.equal(result.durable, false);
  assert.equal(result.error.code, "MEMORY_STORE_NOT_DURABLE");
  assert.equal(result.memoryId, "mem-process-local-1");
});


test("memory store reports durable success only after owner-scoped AgentMemory capture", async () => {
  let capturedUserId = null;
  let capturedText = null;
  const registry = new ToolRegistry({
    ultronCore: {},
    agentMemoryStore: {
      capture: async (content, options) => {
        capturedText = content;
        capturedUserId = options.userId;
        return { state: "captured" };
      }
    }
  });

  const result = await registry.execute("memory_store", { content: "Project uses isolated task workers" }, {
    actorId: "owner-123"
  });
  assert.equal(result.success, true);
  assert.equal(result.durable, true);
  assert.equal(result.storage, "agentmemory");
  assert.equal(capturedUserId, "owner-123");
  assert.match(capturedText, /^Remember this:/);
});
