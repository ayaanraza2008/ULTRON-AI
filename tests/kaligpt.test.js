import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createFeatureRouter({ env, fetchImpl, requireSession, requireSupabaseUser, supabaseRest: async () => [], logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("KaliGPT capability manifest reports provider readiness without exposing keys", async () => {
  await withServer({ OPENROUTER_API_KEY: "secret-test-key", OLLAMA_BASE_URL: "http://localhost:11434" }, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.openrouter, true);
    assert.equal(body.providers.localOllama, true);
    assert.equal(body.providers.gemini, false);
    assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
    assert.equal(body.mode, "human-reviewed");
  });
});

test("security assistant fails closed when provider key is missing", async () => {
  let called = false;
  await withServer({}, async () => { called = true; throw new Error("network must not be called"); }, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Explain security headers", mode: "defensive-review" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SECURITY_PROVIDER_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("security assistant returns guidance and explicitly marks commands unexecuted", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ model: "openrouter/free", choices: [{ message: { content: "Review headers manually and document evidence." } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ OPENROUTER_API_KEY: "secret-test-key", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review security headers", target: "example.com", mode: "defensive-review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.execution, "not_executed");
    assert.equal(body.approvalRequiredForExecution, true);
    assert.match(body.notice, /No commands were run/i);
    assert.match(requestBody.messages[0].content, /Do not execute commands/i);
    assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
  });
});
