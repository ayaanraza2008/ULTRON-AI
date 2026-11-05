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
    ultronCore: {},
    agentMemoryStore: { capture: async () => ({ state: "not_configured" }), readiness: () => ({ configured: false }) }
  });

  const result = await registry.execute("memory_store", { content: "This should not be persisted" }, { actorId: "owner-a" });
  assert.equal(result.success, false);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.error.code, "MEMORY_STORE_UNAVAILABLE");
  assert.equal("memoryId" in result, false);
});


test("memory store does not claim durability for process-local memory records", async () => {
  const registry = new ToolRegistry({
    ultronCore: {
      storeMemory: async () => ({ id: "mem-process-local-1" })
    },
    agentMemoryStore: {
      capture: async () => ({ state: "not_configured" }),
      readiness: () => ({ configured: false, automaticCapture: false })
    }
  });

  let localStoreCalls = 0;
  registry.adapters.ultronCore.storeMemory = async () => { localStoreCalls += 1; return { id: "mem-process-local-1" }; };
  const result = await registry.execute("memory_store", { content: "This is only process-local" }, { actorId: "owner-a" });
  assert.equal(result.success, false);
  assert.equal(result.status, "NON_DURABLE");
  assert.equal(result.durable, false);
  assert.equal(result.error.code, "MEMORY_STORE_NOT_DURABLE");
  assert.equal("memoryId" in result, false);
  assert.equal(localStoreCalls, 0, "process-local global memory must not receive cross-user content");
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


test("memory recall is owner-scoped and never falls back to the shared process memory map", async () => {
  let recalledUserId = null;
  const registry = new ToolRegistry({
    ultronCore: {
      recallMemories: () => { throw new Error("shared process memory must not be queried"); }
    },
    agentMemoryStore: {
      recall: async (_query, options) => {
        recalledUserId = options.userId;
        return { state: "completed", memories: ["owner-only memory"] };
      }
    }
  });

  const result = await registry.execute("memory_recall", { query: "project", limit: 3 }, { actorId: "owner-456" });
  assert.equal(result.success, true);
  assert.equal(result.durable, true);
  assert.equal(result.storage, "agentmemory");
  assert.deepEqual(result.memories, ["owner-only memory"]);
  assert.equal(recalledUserId, "owner-456");
});

test("memory recall fails closed without an authenticated owner", async () => {
  const registry = new ToolRegistry({
    agentMemoryStore: { recall: async () => { throw new Error("must not be called"); } }
  });
  const result = await registry.execute("memory_recall", { query: "project" });
  assert.equal(result.success, false);
  assert.equal(result.error.code, "MEMORY_OWNER_REQUIRED");
});
