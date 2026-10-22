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
