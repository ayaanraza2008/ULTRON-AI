import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";

async function withAgentServer(env, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ...env, ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => {
      req.supabaseUser = { id: USER_ID };
      next();
    },
    logger: { warn() {}, info() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("task router narrows an explicit Wikipedia article request to one tool", () => {
  const route = classifyTaskRoute("Look up the Wikipedia article for Alan Turing");
  assert.equal(route.tier, "medium");
  assert.deepEqual(route.categories, ["wikipedia"]);
  assert.equal(route.filtered, true);
  assert.deepEqual(route.toolNames, ["wikipedia_lookup"]);
});

test("agent fetches and returns a bounded Wikipedia summary with source URL", async () => {
  let providerCalls = 0;
  let wikipediaCalls = 0;
  let firstToolSchema;
  const expectedUrl = "https://en.wikipedia.org/api/rest_v1/page/summary/Alan_Turing";
  const env = { OPENROUTER_API_KEY: "wikipedia-test-provider-key" };

  await withAgentServer(env, async (url, options) => {
    if (url === expectedUrl) {
      wikipediaCalls += 1;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/json");
      assert.ok(options.signal);
      return new Response(JSON.stringify({
        title: "Alan Turing",
        description: "English mathematician and computer scientist",
        extract: "Alan Mathison Turing was an English mathematician, computer scientist, logician, cryptanalyst, philosopher and theoretical biologist.",
        type: "standard",
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Alan_Turing" } }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (!firstToolSchema) firstToolSchema = payload.tools.map(tool => tool.function.name);
    const alreadyHasToolResult = payload.messages.some(message =>
      message.role === "tool" && message.content.includes("Alan Turing")
    );
    if (alreadyHasToolResult) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Wikipedia returned a summary for Alan Turing." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "wikipedia-call-1",
            type: "function",
            function: { name: "wikipedia_lookup", arguments: JSON.stringify({ title: "Alan Turing" }) }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Look up the Wikipedia article for Alan Turing" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /Wikipedia returned a summary/i);
    assert.deepEqual(firstToolSchema, ["wikipedia_lookup"]);
    assert.deepEqual(body.routing.categories, ["wikipedia"]);
    assert.deepEqual(body.toolsUsed.map(item => item.name), ["wikipedia_lookup"]);
    assert.equal(body.toolsUsed[0].ok, true);
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.title, "Alan Turing");
    assert.match(body.toolResults[0].result.extract, /mathematician/);
    assert.equal(body.toolResults[0].result.pageUrl, "https://en.wikipedia.org/wiki/Alan_Turing");
    assert.equal(body.toolResults[0].result.sourceContentTrust, "untrusted_external_content");
  });

  assert.equal(providerCalls, 2);
  assert.equal(wikipediaCalls, 1);
});

test("agent reports a missing Wikipedia article without claiming lookup success", async () => {
  let providerCalls = 0;
  let wikipediaCalls = 0;
  const env = { OPENROUTER_API_KEY: "wikipedia-not-found-test-key" };

  await withAgentServer(env, async (url, options) => {
    if (url.startsWith("https://en.wikipedia.org/api/rest_v1/page/summary/")) {
      wikipediaCalls += 1;
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasNotFound = payload.messages.some(message => message.role === "tool" && message.content.includes("not_found"));
    if (hasNotFound) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I could not find a matching Wikipedia summary for that title." } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: "wikipedia-call-404",
            type: "function",
            function: { name: "wikipedia_lookup", arguments: JSON.stringify({ title: "This Article Definitely Does Not Exist 93825" }) }
          }]
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Look up the Wikipedia article for a nonexistent title" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /could not find a matching Wikipedia summary/i);
    assert.equal(body.toolResults[0].result.state, "not_found");
    assert.equal(body.toolsUsed[0].ok, true);
  });

  assert.equal(providerCalls, 2);
  assert.equal(wikipediaCalls, 1);
});
