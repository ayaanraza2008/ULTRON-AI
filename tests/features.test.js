import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, run, extras = {}) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  const supabaseRest = extras.supabaseRest || (async () => []);
  app.use("/api", createFeatureRouter({
    env, requireSession, requireSupabaseUser, supabaseRest,
    fetchImpl: extras.fetchImpl || globalThis.fetch,
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    await run("http://127.0.0.1:" + address.port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("capabilities endpoint reports provider readiness without exposing secrets", async () => {
  await withServer({ OPENROUTER_API_KEY: "do-not-return-this", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, async base => {
    const response = await fetch(base + "/api/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.cloud.configured, true);
    assert.equal(body.providers.local.configured, false);
    assert.equal(JSON.stringify(body).includes("do-not-return-this"), false);
  });
});

test("local model endpoint fails closed when no endpoint is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/local/models");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "LOCAL_MODEL_NOT_CONFIGURED");
  });
});

test("research endpoint rejects an empty query before making network calls", async () => {
  let called = false;
  await withServer({}, async base => {
    const response = await fetch(base + "/api/research", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: " " })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_RESEARCH_QUERY");
    assert.equal(called, false);
  }, { fetchImpl: async () => { called = true; throw new Error("must not be called"); } });
});

test("task creation records a queued plan and audit event, without claiming execution", async () => {
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, _query, body) => {
    writes.push({ table, method, body });
    if (table === "agent_tasks") return [{ id: "00000000-0000-4000-8000-000000000002", title: body.title, input: body.input, status: body.status, created_at: new Date().toISOString() }];
    return [];
  };
  await withServer({}, async base => {
    const response = await fetch(base + "/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Summarize research", description: "Gather sources and draft a summary", risk: "medium" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.task.status, "WAITING_FOR_PERMISSION");
    assert.match(body.notice, /execution is not enabled/i);
    assert.equal(writes.some(w => w.table === "audit_events"), true);
  }, { supabaseRest: fakeSupabaseRest });
});

test("document extraction parses JSON and marks extracted text as untrusted", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "notes.json", format: "json", content: "{\"goal\":\"test\"}" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.extractedText, /"goal": "test"/);
    assert.match(body.notice, /untrusted input/i);
  });
});

test("document extraction refuses unsupported binary formats", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/documents/extract", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "report.pdf", format: "pdf", content: "not a pdf" })
    });
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error.code, "UNSUPPORTED_DOCUMENT_FORMAT");
  });
});

test("preferences reject unsupported values and save supported voice/memory choices", async () => {
  const writes = [];
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    if (method === "POST" && table === "user_preferences") return [{ ...body, language: body.language || "en", voice_enabled: body.voice_enabled ?? true, voice_input_locale: body.voice_input_locale || "en-IN", memory_enabled: body.memory_enabled ?? true, preferences: body.preferences || {} }];
    return [];
  };
  await withServer({}, async base => {
    const invalid = await fetch(base + "/api/preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language: "klingon" })
    });
    assert.equal(invalid.status, 400);
    const saved = await fetch(base + "/api/preferences", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: "hinglish", voice_enabled: false, memory_enabled: false, preferences: { personality: "concise", ignoredKey: "ignored" } })
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.preferences.voice_enabled, false);
    assert.equal(body.preferences.memory_enabled, false);
    assert.equal(body.preferences.preferences.ignoredKey, undefined);
    assert.equal(writes.length, 1);
  }, { supabaseRest: fakeSupabaseRest });
});

test("task approval requires explicit confirmation and preserves original task input", async () => {
  const writes = [];
  const originalInput = { description: "Research a topic", risk: "medium", requiresApproval: true, approved: false };
  const fakeSupabaseRest = async (_req, table, method, query, body) => {
    writes.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "GET") return [{ id: "00000000-0000-4000-8000-000000000002", title: "Research", input: originalInput, status: "WAITING_FOR_PERMISSION" }];
    if (table === "agent_tasks" && method === "PATCH") return [{ id: "00000000-0000-4000-8000-000000000002", title: "Research", input: body.input, status: body.status }];
    return [];
  };
  await withServer({}, async base => {
    const noConfirm = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
    });
    assert.equal(noConfirm.status, 400);
    const approved = await fetch(base + "/api/tasks/00000000-0000-4000-8000-000000000002/approve", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true })
    });
    assert.equal(approved.status, 200);
    const body = await approved.json();
    assert.equal(body.task.input.description, "Research a topic");
    assert.equal(body.task.input.approved, true);
    assert.match(body.notice, /worker is still required/i);
  }, { supabaseRest: fakeSupabaseRest });
});

test("premium speech endpoints fail clearly when no provider is configured", async () => {
  await withServer({}, async base => {
    const response = await fetch(base + "/api/speech/synthesize", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Hello" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "TTS_NOT_CONFIGURED");
  });
});
