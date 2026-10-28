import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const NODE_IMAGE = "registry.example/ultron-node:22@sha256:" + "a".repeat(64);
const PYTHON_IMAGE = "registry.example/ultron-python:3.12@sha256:" + "b".repeat(64);
const FENCE = String.fromCharCode(96).repeat(3);
const SOURCE = "print(6 * 7)";
const DIRECT_PROMPT = "Please run this code:\n" + FENCE + "python\n" + SOURCE + "\n" + FENCE;

async function withAgent({ env = {}, userId = OWNER, prompt, source = SOURCE }, run) {
  let providerCalls = 0;
  const toolResults = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env: {
      OPENROUTER_API_KEY: "test-provider-key",
      OPENROUTER_DEFAULT_MODEL: "openrouter/free",
      ...env
    },
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: userId }; next(); },
    logger: { warn() {}, error() {} },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      providerCalls += 1;
      const body = JSON.parse(options.body);
      if (providerCalls === 1) {
        assert.ok(body.tools.some(tool => tool.function?.name === "run_code_in_sandbox"));
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_sandbox",
                type: "function",
                function: {
                  name: "run_code_in_sandbox",
                  arguments: JSON.stringify({ language: "python", source })
                }
              }]
            }
          }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const toolMessage = body.messages.find(message => message.role === "tool" && message.tool_call_id === "call_sandbox");
      assert.ok(toolMessage, "the model must receive the tool's actual blocked result");
      toolResults.push(JSON.parse(toolMessage.content));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Sandbox dispatch was evaluated safely." } }]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    await run({ response, getProviderCalls: () => providerCalls, toolResults });
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("agent does not execute code while the sandbox is disabled by default", async () => {
  await withAgent({ prompt: DIRECT_PROMPT }, async ({ response, getProviderCalls, toolResults }) => {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(getProviderCalls(), 2);
    assert.equal(body.toolResults[0].result.code, "SANDBOX_NOT_CONFIGURED");
    assert.equal(body.toolResults[0].result.execution, "not_executed");
    assert.equal(toolResults[0].code, "SANDBOX_NOT_CONFIGURED");
  });
});

test("agent blocks explicitly requested sandbox execution for a non-owner without contacting Docker", async () => {
  await withAgent({
    userId: OTHER_USER,
    prompt: DIRECT_PROMPT,
    env: {
      ULTRON_CODING_SANDBOX_ENABLED: "true",
      ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
      ULTRON_CODING_SANDBOX_NODE_IMAGE: NODE_IMAGE,
      ULTRON_CODING_SANDBOX_PYTHON_IMAGE: PYTHON_IMAGE
    }
  }, async ({ response, getProviderCalls, toolResults }) => {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(getProviderCalls(), 2);
    assert.equal(body.toolResults[0].result.code, "SANDBOX_OWNER_ONLY");
    assert.equal(body.toolResults[0].result.execution, "not_executed");
    assert.equal(toolResults[0].code, "SANDBOX_OWNER_ONLY");
  });
});

test("agent blocks model-substituted code even when the user directly requested a fenced snippet", async () => {
  await withAgent({
    prompt: DIRECT_PROMPT,
    source: "import os; print(os.environ)"
  }, async ({ response, getProviderCalls, toolResults }) => {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(getProviderCalls(), 2);
    assert.equal(body.toolResults[0].result.code, "SANDBOX_EXPLICIT_INTENT_REQUIRED");
    assert.equal(body.toolResults[0].result.execution, "not_executed");
    assert.equal(toolResults[0].code, "SANDBOX_EXPLICIT_INTENT_REQUIRED");
  });
});

test("agent rejects a model-requested sandbox call when the current prompt is only a question", async () => {
  await withAgent({
    prompt: "How can I run Python code safely?",
    source: SOURCE
  }, async ({ response, getProviderCalls, toolResults }) => {
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(getProviderCalls(), 2);
    assert.equal(body.toolResults[0].result.code, "SANDBOX_EXPLICIT_INTENT_REQUIRED");
    assert.equal(body.toolResults[0].result.execution, "not_executed");
    assert.equal(toolResults[0].code, "SANDBOX_EXPLICIT_INTENT_REQUIRED");
  });
});
