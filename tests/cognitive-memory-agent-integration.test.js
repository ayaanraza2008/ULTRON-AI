import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

async function withAgent({ memoryEnabled = true, memoryRows = [] } = {}, run) {
  const writes = [];
  const queries = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    queries.push({ table, method, query, body });
    if (table === "user_preferences" && method === "GET") return [{ memory_enabled: memoryEnabled }];
    if (table === "memory_items" && method === "GET" && query.includes("select=kind,title,content")) return memoryRows;
    if (table === "memory_items" && method === "GET" && query.includes("select=id,metadata")) return [];
    if (table === "memory_items" && method === "POST") {
      writes.push({ query, body });
      return [{ id: "memory-lesson-1", ...body }];
    }
    if (table === "memory_items" && method === "GET") return [];
    throw new Error("Unexpected Supabase operation: " + table + " " + method + " " + query);
  };

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "synthetic-test-key", OPENROUTER_DEFAULT_MODEL: "openrouter/free" },
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: USER_ID }; next(); },
    supabaseRest,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      const request = JSON.parse(options.body);
      if (request.messages) {
        assert.ok(request.messages.some(message =>
          message.role === "system" && String(message.content).includes("keep the response concise and focused")
        ), "ranked cognitive memory should be injected into the model context");
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I understand. I will answer the corrected request directly." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port, { writes, queries });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("agent injects ranked per-user cognitive memories and learns a generic correction lesson", async () => {
  const memoryRows = [
    {
      id: "memory-short",
      kind: "profile_note",
      title: "Response quality lesson",
      content: "When the user asks for a very short answer or quick revision, keep the response concise and focused.",
      source: "conversation_summary",
      created_at: "2026-10-28T12:00:00.000Z",
      updated_at: "2026-10-28T12:00:00.000Z",
      metadata: { cognitiveLayer: "procedural", confidence: 0.8, reinforcementCount: 2 }
    }
  ];
  await withAgent({ memoryEnabled: true, memoryRows }, async (base, state) => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "That's not what I asked. Give me a very short answer in English. My password is private-test-secret." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.cognition.memoryItemsUsed, 1);
    assert.equal(result.cognition.correctionLearning, "learned");
    assert.equal(state.writes.length, 1);
    const saved = state.writes[0].body;
    assert.equal(saved.user_id, USER_ID);
    assert.equal(saved.kind, "profile_note");
    assert.equal(saved.title, "Response quality lesson");
    assert.equal(saved.metadata.cognitiveLayer, "procedural");
    assert.equal(saved.metadata.learningSource, "user_correction");
    assert.equal(saved.content.includes("private-test-secret"), false);
    const memoryQuery = state.queries.find(item => item.table === "memory_items" && item.method === "GET" && item.query.includes("select=kind,title,content"));
    assert.match(memoryQuery.query, /limit=32/);
  });
});

test("agent does not recall or write correction lessons when account memory is disabled", async () => {
  await withAgent({ memoryEnabled: false }, async (base, state) => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Wrong answer; I said explain in English." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.cognition.memoryItemsUsed, 0);
    assert.equal(result.cognition.correctionLearning, "memory_disabled");
    assert.equal(state.writes.length, 0);
    assert.equal(state.queries.some(item => item.table === "memory_items"), false);
  });
});
