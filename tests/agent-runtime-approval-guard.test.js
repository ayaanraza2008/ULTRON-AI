import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

async function setupAgent(fetchImpl) {
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
    fetchImpl
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { base: "http://127.0.0.1:" + server.address().port, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

function researchToolCall() {
  return {
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_research",
          type: "function",
          function: {
            name: "research_web",
            arguments: JSON.stringify({ query: "public best practices for order confirmation emails" })
          }
        }]
      }
    }]
  };
}

test("safe public research can run while a consequential final action remains gated", async () => {
  let providerCalls = 0;
  let researchCalled = false;
  const agent = await setupAgent(async (url, options = {}) => {
    if (url.startsWith("https://html.duckduckgo.com/html/")) {
      researchCalled = true;
      assert.equal(options.redirect, "error");
      return new Response(
        '<html><a class="result__a" href="https://example.com/email-best-practices">Order confirmation email best practices</a><div class="result__snippet">Use clear order details and delivery estimates.</div></html>',
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const body = JSON.parse(options.body);
    if (providerCalls === 1) {
      assert.ok(body.tools.some(tool => tool.function?.name === "research_web"));
      return new Response(JSON.stringify(researchToolCall()), { status: 200 });
    }
    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.provider, "duckduckgo-html");
    assert.equal(result.results[0].url, "https://example.com/email-best-practices");
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "I researched public best practices. I did not send an email; that consequential action remains gated." } }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Research public best practices, then send an email to the customer confirming the order." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autonomy.risk.requiresConfirmation, true);
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].ok, true);
    assert.equal(result.toolResults[0].result.provider, "duckduckgo-html");
    assert.equal(researchCalled, true);
    assert.equal(providerCalls, 2);
  } finally {
    await agent.close();
  }
});

test("mixed private-data and consequential requests do not use safe-tool exception to bypass gating", async () => {
  let providerCalls = 0;
  let researchCalled = false;
  const agent = await setupAgent(async (url, options = {}) => {
    if (url.startsWith("https://html.duckduckgo.com/html/")) {
      researchCalled = true;
      return new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const body = JSON.parse(options.body);
    if (providerCalls === 1) return new Response(JSON.stringify(researchToolCall()), { status: 200 });
    const toolMessages = body.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(result.approvalRequired, true);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "I did not access private email content or send a message." } }]
    }), { status: 200 });
  });

  try {
    const response = await fetch(agent.base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Read my emails to find the order details and send a reply to the customer." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autonomy.risk.requiresConfirmation, true);
    assert.equal(result.toolResults.length, 1);
    assert.equal(result.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(researchCalled, false);
    assert.equal(providerCalls, 2);
  } finally {
    await agent.close();
  }
});
