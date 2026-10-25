import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function runBrowserTask(bridgePayload) {
  let modelCalls = 0;
  let bridgeCalls = 0;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env: {
      OPENROUTER_API_KEY: "test-only",
      ULTRON_BROWSER_USE_URL: "https://browser.example.com",
      ULTRON_BROWSER_USE_TOKEN: "browser-test-token",
      ULTRON_INTEGRATION_OWNER_USER_ID: "00000000-0000-4000-8000-000000000001"
    },
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    logger: { warn() {} },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://browser.example.com/run") {
        bridgeCalls += 1;
        assert.equal(options.redirect, "error");
        return new Response(JSON.stringify(bridgePayload), { status: 200, headers: { "content-type": "application/json" } });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      modelCalls += 1;
      if (modelCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{
            id: "browser-validation-call", type: "function",
            function: { name: "browser_use", arguments: JSON.stringify({ task: "Open the website and inspect the pricing page" }) }
          }] } }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "The browser result is available for review." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Open the website and inspect the pricing page" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(modelCalls >= 2, true);
    assert.equal(bridgeCalls, 1);
    return body;
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("Browser Use does not claim completion when the bridge omits result text", async () => {
  const body = await runBrowserTask({ status: "completed", result: "   " });
  const tool = body.toolResults.find(item => item.name === "browser_use");
  assert.equal(tool.result.state, "unknown");
  assert.equal(tool.result.error.code, "BROWSER_RESULT_UNVERIFIED");
  assert.match(tool.result.error.message, /outcome is unverified/i);
  assert.equal(tool.ok, false);
});

test("Browser Use preserves an explicit task failure returned with HTTP 200", async () => {
  const body = await runBrowserTask({ status: "failed", error: "Navigation timed out", result: "" });
  const tool = body.toolResults.find(item => item.name === "browser_use");
  assert.equal(tool.result.state, "failed");
  assert.equal(tool.result.error.code, "BROWSER_TASK_FAILED");
  assert.equal(tool.result.error.message, "Navigation timed out");
  assert.equal(tool.ok, false);
});
