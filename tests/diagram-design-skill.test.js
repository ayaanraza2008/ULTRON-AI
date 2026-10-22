import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { buildDiagramDesignGuidance } from "../diagram-design-skill.js";
import { createAgentRouter } from "../agent-runtime.js";

test("diagram-design skill activates for diagram tasks only", () => {
  const architecture = buildDiagramDesignGuidance("Create an architecture diagram of ULTRON with API, database, and worker");
  assert.equal(architecture.diagramRequested, true);
  assert.equal(architecture.diagramType, "architecture");
  assert.ok(architecture.references.some(reference => reference.path === "references/type-architecture.md"));
  assert.ok(architecture.references.some(reference => reference.path === "references/output-spec.md"));
  const unrelated = buildDiagramDesignGuidance("Explain how JavaScript promises work");
  assert.equal(unrelated.diagramRequested, false);
  assert.deepEqual(unrelated.references, []);
});

test("diagram skills endpoint returns task-specific reference selection", async () => {
  const app = express();
  app.use("/api", createAgentRouter({ env: {}, requireSupabaseUser: (_req, _res, next) => next(), logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/diagram-skills?task=make%20a%20sequence%20diagram%20for%20token%20refresh");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.diagramRequested, true);
    assert.equal(body.diagramType, "sequence");
    assert.equal(body.mode, "automatic_task_aware_diagram_design");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("agent loads selected diagram references on demand before the active prompt", async () => {
  let sentBody;
  const app = express();
  app.use(express.json());
  const fetchImpl = async (url, options) => {
    if (url.startsWith("https://raw.githubusercontent.com/cathrynlavery/diagram-design/")) {
      return new Response("# Selected diagram reference\\nUse readable labels and consistent left-to-right flow.", { status: 200 });
    }
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "<!doctype html><html><body><svg></svg></body></html>" } }] }), { status: 200 });
  };
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createAgentRouter({ env: { OPENROUTER_API_KEY: "test-only" }, fetchImpl, requireSupabaseUser, logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Create an architecture diagram for an API and database" })
    });
    assert.equal(response.status, 200);
    assert.ok(sentBody.messages.some(message => message.role === "system" && message.content.includes("Diagram Design skill guidance")));
    assert.ok(sentBody.messages.some(message => message.role === "user" && message.content.includes("Selected diagram reference")));
    assert.ok(sentBody.messages.at(-1).content.includes("Create an architecture diagram"));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
