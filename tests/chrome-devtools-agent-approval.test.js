import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const owner = "00000000-0000-4000-8000-000000000001";
const token = "chrome-devtools-test-token-that-is-long-enough";
const env = {
  OPENROUTER_API_KEY: "test-only",
  ULTRON_CHROME_DEVTOOLS_URL: "https://chrome-bridge.example.com",
  ULTRON_CHROME_DEVTOOLS_TOKEN: token,
  ULTRON_INTEGRATION_OWNER_USER_ID: owner,
  // Even with the local operator's additional switch enabled, the model must
  // not be able to pass the bridge's per-action confirmation check.
  CHROME_ALLOW_EXTERNAL_ACTIONS: "true"
};

async function startAgent(fetchImpl) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: owner };
      next();
    },
    logger: { warn() {} },
    fetchImpl
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return {
    base: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  };
}

test("model cannot self-approve a consequential Chrome click", async () => {
  let providerCalls = 0;
  let bridgeCalls = 0;
  let capturedBridgeAction;
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://chrome-bridge.example.com/action") {
      bridgeCalls += 1;
      assert.equal(options.headers.Authorization, "Bearer " + token);
      assert.equal(options.redirect, "error");
      capturedBridgeAction = JSON.parse(options.body);
      // Mirrors the local bridge's consequential-action guard. No click is made.
      return new Response(JSON.stringify({
        ok: false,
        error: {
          code: "EXTERNAL_ACTION_CONFIRMATION_REQUIRED",
          message: "A user-confirmed task-specific approval is required. No click was performed."
        }
      }), { status: 403, headers: { "content-type": "application/json" } });
    }

    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const body = JSON.parse(options.body);
    if (providerCalls === 1) {
      const chromeTool = body.tools.find(tool => tool.function?.name === "chrome_devtools");
      assert.ok(chromeTool, "the task router must expose Chrome DevTools for a browser click");
      assert.equal(chromeTool.function.parameters.properties.confirmExternalAction, undefined,
        "confirmation must not be a model-visible tool parameter");
      return new Response(JSON.stringify({
        choices: [{
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call-chrome",
              type: "function",
              function: {
                name: "chrome_devtools",
                // Intentionally try to approve the consequential click.
                arguments: JSON.stringify({
                  action: "click",
                  selector: "button#continue",
                  confirmExternalAction: true
                })
              }
            }]
          }
        }]
      }), { status: 200 });
    }

    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.state, "failed");
    assert.equal(result.error.code, "EXTERNAL_ACTION_CONFIRMATION_REQUIRED");
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: "The click was blocked because a separate user confirmation flow is not available. No action was performed."
        }
      }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Click the Continue button on the browser page." })
    });
    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.toolResults.length, 1);
    assert.equal(responseBody.toolResults[0].name, "chrome_devtools");
    assert.equal(responseBody.toolResults[0].ok, false);
    assert.equal(responseBody.toolResults[0].result.error.code, "EXTERNAL_ACTION_CONFIRMATION_REQUIRED");
    assert.equal(capturedBridgeAction.action, "click");
    assert.equal(capturedBridgeAction.selector, "button#continue");
    assert.equal(capturedBridgeAction.confirmExternalAction, false,
      "ULTRON must force false even when the model emits true");
    assert.equal(bridgeCalls, 1);
    assert.equal(providerCalls, 2);
    assert.match(responseBody.content, /no action was performed/i);
  } finally {
    await agent.close();
  }
});
