import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

test("consequential requests cannot dispatch model-proposed tools", async () => {
  let providerCalls = 0;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
    next();
  };
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "test-only" },
    requireSupabaseUser,
    logger: { warn() {} },
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      providerCalls += 1;
      const body = JSON.parse(options.body);
      if (providerCalls === 1) {
        assert.ok(Array.isArray(body.tools));
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "call_research",
                type: "function",
                function: { name: "research_web", arguments: JSON.stringify({ query: "customer email address" }) }
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
        choices: [{ message: { role: "assistant", content: "I did not send the email. Approval is required before consequential actions." } }]
      }), { status: 200 });
    }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Send an email to the customer confirming the order." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autonomy.risk.requiresConfirmation, true);
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(providerCalls, 2);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
