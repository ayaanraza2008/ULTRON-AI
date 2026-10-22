import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildBrowserUseGuidance } from "../browser-use-integration.js";
import { createAgentRouter } from "../agent-runtime.js";

test("Browser Use activates only for interactive browser tasks", () => {
  assert.equal(buildBrowserUseGuidance("Open the website and click the pricing tab").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("Extract text from this JavaScript-rendered page").browserRequested, true);
  assert.equal(buildBrowserUseGuidance("What is the latest news about AI?").browserRequested, false);
  assert.equal(buildBrowserUseGuidance("Write code for a browser automation library").browserRequested, false);
});

test("Browser Use flags consequential actions for confirmation", () => {
  const result = buildBrowserUseGuidance("Open the site and submit the application form");
  assert.equal(result.browserRequested, true);
  assert.equal(result.consequentialAction, true);
  assert.equal(result.requiresExplicitConfirmation, true);
});

test("browser-use readiness endpoint is authenticated and reports missing configuration", async () => {
  const app = express();
  app.use("/api", createAgentRouter({ env: {}, requireSupabaseUser: (_req, _res, next) => next(), logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/browser-use");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "automatic_task_aware_browser_use");
    assert.equal(body.available, false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("browser-use tool calls bridge only when configured and never silently confirms external actions", async () => {
  let captured;
  const app = express();
  app.use(express.json());
  const fetchImpl = async (url, options = {}) => {
    if (url === "https://browser-bridge.example/run") {
      captured = { url, options };
      return new Response(JSON.stringify({ status: "completed", result: "Read page title: Example Domain" }), { status: 200 });
    }
    const body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Browser result received." } }] }), { status: 200 });
  };
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env: { OPENROUTER_API_KEY: "test-only", ULTRON_BROWSER_USE_URL: "https://browser-bridge.example", ULTRON_BROWSER_USE_TOKEN: "test-token" }, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open the website and click the pricing tab" })
    });
    assert.equal(response.status, 200);
    assert.ok(captured);
    assert.equal(captured.options.headers["X-ULTRON-BROWSER-TOKEN"], "test-token");
    assert.equal(JSON.parse(captured.options.body).confirmExternalAction, false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
