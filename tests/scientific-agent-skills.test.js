import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildScientificSkillsGuidance } from "../scientific-agent-skills.js";
import { createAgentRouter } from "../agent-runtime.js";

test("scientific skills select relevant research procedures without loading on unrelated requests", () => {
  const research = buildScientificSkillsGuidance("Find papers about RNA-seq and perform statistical analysis of differential gene expression");
  assert.equal(research.scientificTask, true);
  assert.ok(research.skills.some(skill => skill.name === "paper-lookup"));
  assert.ok(research.skills.some(skill => skill.name === "statistical-analysis"));
  assert.ok(research.skills.length <= 3);
  const unrelated = buildScientificSkillsGuidance("Tell me a joke about a cat");
  assert.equal(unrelated.scientificTask, false);
  assert.deepEqual(unrelated.skills, []);
});

test("scientific skills endpoint exposes automatic selection", async () => {
  const app = express();
  app.use("/api", createAgentRouter({ env: {}, requireSupabaseUser: (_req, _res, next) => next(), logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/scientific-skills?task=Find%20research%20papers%20about%20genomics");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "automatic_task_aware_scientific_skills");
    assert.equal(body.scientificTask, true);
    assert.ok(body.skills.some(skill => skill.name === "paper-lookup"));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("agent fetches only selected scientific skill documents on scientific requests", async () => {
  let sentBody;
  const app = express();
  app.use(express.json());
  const fetchImpl = async (url, options) => {
    if (url.startsWith("https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/main/skills/")) {
      assert.match(url, /\/SKILL\.md$/);
      return new Response("# Scientific skill reference\nUse reproducible methods and cite evidence.", { status: 200 });
    }
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Here is a source-grounded research plan." } }] }), { status: 200 });
  };
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env: { OPENROUTER_API_KEY: "test-only" }, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Find scientific research papers about genomic variant annotation" })
    });
    assert.equal(response.status, 200);
    assert.ok(sentBody.messages.some(message => message.role === "system" && message.content.includes("Scientific Agent Skills guidance")));
    assert.ok(sentBody.messages.some(message => message.role === "user" && message.content.includes("Scientific skill reference")));
    assert.ok(sentBody.messages.some(message => message.role === "user" && message.content.includes("Find scientific research papers")));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
