import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildChromeDevToolsActionInput, createAgentRouter } from "../agent-runtime.js";

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

test("Chrome dispatch discards model-authored confirmation and always forces false", () => {
  const input = buildChromeDevToolsActionInput({ action: "click", selector: "button#continue", confirmExternalAction: true });
  assert.deepEqual(input, { action: "click", selector: "button#continue", confirmExternalAction: false });
  assert.equal(buildChromeDevToolsActionInput({ action: "status", confirmExternalAction: true }).confirmExternalAction, false);
});

test("model cannot self-approve a consequential Chrome click", async () => {
  let providerCalls = 0;
  let bridgeCalls = 0;
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://chrome-bridge.example.com/action") {
      bridgeCalls += 1;
      throw new Error("The autonomy approval gate must block before contacting the local bridge.");
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
    assert.equal(result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(result.approvalRequired, true);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: "The click was blocked by ULTRON autonomy approval. No action was performed."
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
    assert.equal(responseBody.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(responseBody.toolResults[0].result.approvalRequired, true);
    assert.equal(bridgeCalls, 0, "no Chrome bridge request may occur before task-specific user approval");
    assert.equal(providerCalls, 2);
    assert.match(responseBody.content, /no action was performed/i);
  } finally {
    await agent.close();
  }
});
