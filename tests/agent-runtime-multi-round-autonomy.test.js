import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

test("agent executes up to three bounded safe tool rounds without user orchestration", async () => {
  let modelCalls = 0;
  const chosenTools = [];
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
    next();
  };

  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "test-only" },
    requireSupabaseUser,
    logger: { warn() {}, info() {} },
    fetchImpl: async (url, options = {}) => {
      if (url !== "https://openrouter.ai/api/v1/chat/completions") {
        // Optional task-skill retrieval is best-effort and must not affect the
        // deterministic tool-round assertions in this test.
        return new Response("not found", { status: 404 });
      }
      modelCalls += 1;
      const body = JSON.parse(options.body);
      if (modelCalls === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_integrations", type: "function", function: { name: "check_integrations", arguments: "{}" } }]
          } }]
        }), { status: 200 });
      }
      if (modelCalls === 2) {
        const toolMessages = body.messages.filter(message => message.role === "tool");
        assert.equal(toolMessages.length, 1, "round one result should be available to model");
        chosenTools.push("check_integrations");
        return new Response(JSON.stringify({
          choices: [{ message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_capabilities", type: "function", function: { name: "check_repository_capabilities", arguments: JSON.stringify({ task: "repository capability readiness", limit: 3 }) } }]
          } }]
        }), { status: 200 });
      }
      if (modelCalls === 3) {
        const toolMessages = body.messages.filter(message => message.role === "tool");
        assert.equal(toolMessages.length, 2, "round two should receive results from prior rounds");
        chosenTools.push("check_repository_capabilities");
        return new Response(JSON.stringify({
          choices: [{ message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call_cactus", type: "function", function: { name: "check_cactus", arguments: "{}" } }]
          } }]
        }), { status: 200 });
      }

      const toolMessages = body.messages.filter(message => message.role === "tool");
      assert.equal(toolMessages.length, 3, "final synthesis should receive all three safe tool results");
      chosenTools.push("check_cactus");
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I checked integrations, repository capabilities, and local-model readiness. The results reflect configuration/readiness, not proof of every upstream being live." } }]
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
      body: JSON.stringify({ prompt: "Check integration status, repository capability readiness, and local Cactus readiness." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(modelCalls, 4, "one initial call, two tool-aware follow-ups, and bounded final synthesis");
    assert.deepEqual(chosenTools, ["check_integrations", "check_repository_capabilities", "check_cactus"]);
    assert.deepEqual(result.toolsUsed.map(tool => tool.name), chosenTools);
    assert.ok(result.toolsUsed.every(tool => tool.ok));
    assert.equal(result.autonomy.executionLimits.maxToolRounds, 3);
    assert.equal(result.autonomy.executionLimits.maxToolCallsPerRound, 3);
    assert.equal(result.autonomy.executionLimits.maxToolCallsPerRequest, 9);
    assert.match(result.content, /checked integrations/i);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("a consequential tool call in a later round is still blocked by the dispatch policy", async () => {
  let modelCalls = 0;
  let browserServiceCalls = 0;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const requireSupabaseUser = (req, _res, next) => {
    req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
    next();
  };
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "test-only", BROWSER_USE_URL: "https://browser.example.com", ULTRON_BROWSER_USE_URL: "https://browser.example.com", ULTRON_BROWSER_USE_TOKEN: "test-token" },
    requireSupabaseUser,
    logger: { warn() {}, info() {} },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://browser.example.com/run") {
        browserServiceCalls += 1;
        throw new Error("A consequential browser action must never be dispatched by this test.");
      }
      if (url !== "https://openrouter.ai/api/v1/chat/completions") {
        return new Response("not found", { status: 404 });
      }
      modelCalls += 1;
      if (modelCalls === 1) {
        return new Response(JSON.stringify({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "call_safe_check", type: "function", function: { name: "check_integrations", arguments: "{}" } }]
        } }] }), { status: 200 });
      }
      if (modelCalls === 2) {
        return new Response(JSON.stringify({ choices: [{ message: {
          role: "assistant", content: null,
          tool_calls: [{ id: "call_send_email", type: "function", function: { name: "browser_use", arguments: JSON.stringify({ task: "Send an email to the customer confirming the order.", maxSteps: 3 }) } }]
        } }] }), { status: 200 });
      }
      const toolResults = bodyToolResults(JSON.parse(options.body).messages);
      assert.equal(toolResults.length, 2);
      const blocked = JSON.parse(toolResults[1].content);
      assert.equal(blocked.error.code, "AUTONOMY_APPROVAL_REQUIRED");
      assert.equal(blocked.approvalRequired, true);
      return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "The integration check ran; sending the email remained blocked for approval." } }] }), { status: 200 });
    }
  }));
  function bodyToolResults(messages) {
    return messages.filter(message => message.role === "tool");
  }
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Check connected integrations, then send an email to the customer confirming the order." })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(modelCalls, 3);
    assert.equal(browserServiceCalls, 0);
    assert.deepEqual(result.toolsUsed.map(tool => tool.name), ["check_integrations", "browser_use"]);
    assert.equal(result.toolResults[1].result.approvalRequired, true);
    assert.equal(result.toolResults[1].result.risk.level, "external_effect");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
