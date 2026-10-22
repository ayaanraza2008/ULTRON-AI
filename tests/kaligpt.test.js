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


test("security assistant routes to the explicitly selected Gemini provider", async () => {
  let requestedUrl = "";
  let requestBody;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Check CSP and HSTS." }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ GEMINI_API_KEY: "gemini-test-secret", GEMINI_DEFAULT_MODEL: "gemini-2.5-flash" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review headers", provider: "gemini", mode: "defensive-review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "gemini");
    assert.equal(body.answer, "Check CSP and HSTS.");
    assert.match(requestedUrl, /generativelanguage\.googleapis\.com/);
    assert.equal(requestBody.contents[0].role, "user");
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("gemini-test-secret"), false);
  });
});


test("auto mode falls back to Gemini when OpenRouter returns an error", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(String(url));
    if (String(url).includes("openrouter.ai")) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Fallback answer." }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ OPENROUTER_API_KEY: "or-test-secret", GEMINI_API_KEY: "gemini-test-secret" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Explain HSTS", provider: "auto" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "gemini");
    assert.equal(body.fallbackUsed, true);
    assert.equal(seen.length, 2);
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  });
});
