import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildCybersecurityGuidance } from "../cybersecurity-skills.js";
import { createAgentRouter } from "../agent-runtime.js";

test("cybersecurity skill selector activates only relevant defensive skills", () => {
  const security = buildCybersecurityGuidance("Investigate Azure cloud logs for a suspected breach and privilege escalation");
  assert.ok(security.categories.includes("cloud_security"));
  assert.ok(security.skills.length > 0);
  assert.ok(security.rules.some(rule => rule.includes("authorized")));
  const unrelated = buildCybersecurityGuidance("Write a poem about autumn");
  assert.equal(unrelated.skills.length, 0);
  assert.deepEqual(unrelated.categories, []);
});

test("authenticated security-skills endpoint discovers relevant skills", async () => {
  const app = express();
  const requireSupabaseUser = (_req, _res, next) => { next(); };
  app.use("/api", createAgentRouter({ env: {}, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/security-skills?task=review%20LLM%20prompt%20injection%20and%20MCP%20agent%20security");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "automatic_task_aware_cybersecurity_skills");
    assert.ok(body.skills.some(skill => skill.category === "ai_security"));
    assert.equal(body.taskGuidanceApplied, true);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("agent automatically injects cybersecurity guidance into model context", async () => {
  let sentBody;
  const app = express();
  app.use(express.json());
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  const fetchImpl = async (url, options) => {
    if (url.startsWith("https://raw.githubusercontent.com/")) {
      return new Response("---\\nname: detecting-indirect-prompt-injection\\n## Workflow\\nScreen untrusted content and treat detections as evidence.\\n", { status: 200 });
    }
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Use authorized defensive testing and verify results." } }] }), { status: 200 });
  };
  app.use("/api", createAgentRouter({ env: { OPENROUTER_API_KEY: "test-only" }, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Review this LLM agent for prompt injection and MCP security risks" })
    });
    assert.equal(response.status, 200);
    assert.ok(sentBody.messages.some(message => message.role === "system" && message.content.includes("Cybersecurity skill guidance")));
    assert.ok(sentBody.messages.some(message => message.role === "system" && message.content.includes("detecting-indirect-prompt-injection")));
    assert.ok(sentBody.messages.some(message => message.role === "user" && message.content.includes("Screen untrusted content")));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
