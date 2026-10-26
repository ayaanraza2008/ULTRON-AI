import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";

test("upstream task-skill retrieval rejects redirects", async () => {
  let skillFetches = 0;
  let modelFetches = 0;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "test-only" },
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" };
      next();
    },
    logger: { warn() {} },
    fetchImpl: async (url, options = {}) => {
      if (url.startsWith("https://raw.githubusercontent.com/")) {
        skillFetches += 1;
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Accept, "text/plain");
        assert.ok(options.signal, "skill fetch must remain time-bounded");
        return new Response("# Defensive security reference\\nUse authorized, evidence-backed review.", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" }
        });
      }
      assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
      modelFetches += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "A defensive security assessment draft is ready." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Audit this API for SQL injection and prompt injection vulnerabilities." })
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).content, /defensive security assessment/i);
    assert.equal(skillFetches, 1);
    assert.equal(modelFetches, 1);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
