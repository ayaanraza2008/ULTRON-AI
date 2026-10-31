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
  const bridgeCalls = [];
  const agent = await startAgent(async (url, options = {}) => {
    if (url === "https://chrome-bridge.example.com/action") {
      const action = JSON.parse(options.body);
      bridgeCalls.push(action);
      assert.equal(action.action, "inspect_click", "the bridge may inspect but must not click before approval");
      return new Response(JSON.stringify({
        ok: true,
        result: {
          action: "inspect_click",
          origin: "https://example.com",
          url: "https://example.com/checkout",
          selector: "button#continue",
          label: "Continue",
          tag: "button",
          type: "button",
          formActionOrigin: "https://example.com",
          highImpact: false,
          crossOriginForm: false,
          requiresConfirmation: false
        }
      }), { status: 200, headers: { "content-type": "application/json" } });
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
    assert.equal(result.state, "approval_required");
    assert.equal(result.approvalRequired, true);
    assert.match(result.approvalPhrase, /^I approve ULTRON Chrome action [0-9a-f-]{36}$/i);
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
      body: JSON.stringify({ prompt: "Purchase this item by clicking the Continue button on the browser page." })
    });
    assert.equal(response.status, 200);
    const responseBody = await response.json();
    assert.equal(responseBody.toolResults.length, 1);
    assert.equal(responseBody.toolResults[0].name, "chrome_devtools");
    assert.equal(responseBody.toolResults[0].ok, true);
    assert.equal(responseBody.toolResults[0].result.state, "approval_required");
    assert.equal(responseBody.toolResults[0].result.approvalRequired, true);
    assert.match(responseBody.toolResults[0].result.approvalPhrase, /^I approve ULTRON Chrome action [0-9a-f-]{36}$/i);
    assert.equal(bridgeCalls.length, 1, "only a read-only inspection may occur before approval");
    assert.equal(bridgeCalls[0].action, "inspect_click");
    assert.equal(providerCalls, 2);
    assert.match(responseBody.content, /no action was performed/i);
  } finally {
    await agent.close();
  }
});
