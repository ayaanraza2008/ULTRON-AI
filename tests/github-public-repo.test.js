import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";
import { classifyTaskRoute } from "../task-router.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const API = "https://api.github.com/repos/octocat/Hello-World";

async function withAgentServer(fetchImpl, supabaseRest, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { OPENROUTER_API_KEY: "github-public-test-provider-key", ULTRON_INTEGRATION_OWNER_USER_ID: USER_ID },
    fetchImpl,
    supabaseRest,
    privilegedSupabaseRest: supabaseRest,
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

function reply(message) {
  return new Response(JSON.stringify({ choices: [{ message }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function sendPrompt(base, prompt) {
  return fetch(base + "/api/agent/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt })
  });
}

test("task router narrows named public GitHub repository questions to the read-only tool", () => {
  for (const prompt of [
    "Look up the GitHub repository octocat/Hello-World metadata",
    "Read the README from GitHub repository octocat/Hello-World",
    "Show the latest commits for GitHub octocat/Hello-World"
  ]) {
    const route = classifyTaskRoute(prompt);
    assert.equal(route.tier, "medium");
    assert.ok(route.categories.includes("github"));
    assert.equal(route.filtered, true);
    assert.deepEqual(route.toolNames, ["github_public_repo"]);
  }
});

test("agent reads public GitHub metadata through a fixed unauthenticated endpoint", async () => {
  let providerCalls = 0;
  let githubCalls = 0;
  let firstToolSchema;
  await withAgentServer(async (url, options) => {
    if (url === API) {
      githubCalls += 1;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Accept, "application/vnd.github+json");
      assert.equal(options.headers.Authorization, undefined, "public metadata reads must not use a GitHub token");
      assert.equal(options.headers["X-GitHub-Api-Version"], "2022-11-28");
      return new Response(JSON.stringify({
        full_name: "octocat/Hello-World",
        description: "My first repository on GitHub!",
        html_url: "https://github.com/octocat/Hello-World",
        default_branch: "main",
        language: "JavaScript",
        stargazers_count: 2000,
        forks_count: 400,
        open_issues_count: 12,
        license: { spdx_id: "MIT" },
        archived: false,
        updated_at: "2026-10-28T10:00:00Z"
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    firstToolSchema ||= payload.tools.map(tool => tool.function.name);
    const hasMetadata = payload.messages.some(message => message.role === "tool" && message.content.includes('"fullName":"octocat/Hello-World"'));
    if (hasMetadata) return reply({ role: "assistant", content: "The public repository is octocat/Hello-World, a JavaScript project under the MIT license." });
    return reply({
      content: null,
      tool_calls: [{
        id: "github-metadata-call",
        type: "function",
        function: { name: "github_public_repo", arguments: JSON.stringify({ owner: "octocat", repo: "Hello-World", action: "metadata" }) }
      }]
    });
  }, async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    throw new Error("Public repository lookup should not query any other table.");
  }, async base => {
    const response = await sendPrompt(base, "Look up the GitHub repository octocat/Hello-World metadata");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.content, /public repository is octocat\/Hello-World/i);
    assert.deepEqual(firstToolSchema, ["github_public_repo"]);
    assert.deepEqual(body.routing.categories, ["github"]);
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.repository.fullName, "octocat/Hello-World");
    assert.equal(body.toolResults[0].result.repository.license, "MIT");
    assert.equal(body.toolResults[0].result.sourceContentTrust, undefined);
    assert.equal(body.toolResults[0].result.repository.url, "https://github.com/octocat/Hello-World");
  });
  assert.equal(providerCalls, 2);
  assert.equal(githubCalls, 1);
});

test("agent reads bounded text files and README content as untrusted repository data", async () => {
  let providerCalls = 0;
  let githubCalls = 0;
  const source = "# Hello World\n\nThis repository demonstrates a small project.\n";
  const path = "README.md";
  await withAgentServer(async (url, options) => {
    if (url === API + "/contents/README.md") {
      githubCalls += 1;
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, undefined);
      return new Response(JSON.stringify({
        path,
        sha: "0123456789012345678901234567890123456789",
        encoding: "base64",
        size: Buffer.byteLength(source, "utf8"),
        content: Buffer.from(source, "utf8").toString("base64")
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasFile = payload.messages.some(message => message.role === "tool" && message.content.includes("This repository demonstrates a small project."));
    if (hasFile) return reply({ role: "assistant", content: "The README says this repository demonstrates a small project." });
    return reply({
      content: null,
      tool_calls: [{
        id: "github-readme-call",
        type: "function",
        function: { name: "github_public_repo", arguments: JSON.stringify({ owner: "octocat", repo: "Hello-World", action: "read_file", path: "README.md", ref: "main" }) }
      }]
    });
  }, async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    throw new Error("Reading a public README must not access database content.");
  }, async base => {
    const response = await sendPrompt(base, "Read the README from GitHub repository octocat/Hello-World");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.state, "completed");
    assert.equal(body.toolResults[0].result.content, source);
    assert.equal(body.toolResults[0].result.path, "README.md");
    assert.equal(body.toolResults[0].result.sourceContentTrust, "untrusted_external_content");
  });
  assert.equal(providerCalls, 2);
  assert.equal(githubCalls, 1);
});

test("GitHub tool excludes pull requests from its open-issues result", async () => {
  let githubCalls = 0;
  const issues = [
    { number: 1, title: "A bug report", state: "open", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", html_url: "https://github.com/octocat/Hello-World/issues/1", labels: [{ name: "bug" }] },
    { number: 2, title: "A pull request", state: "open", pull_request: { url: "https://api.github.com/repos/octocat/Hello-World/pulls/2" }, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", html_url: "https://github.com/octocat/Hello-World/pull/2", labels: [] }
  ];
  await withAgentServer(async (url, options) => {
    if (url === API + "/issues?state=open&per_page=5") {
      githubCalls += 1;
      return new Response(JSON.stringify(issues), { status: 200, headers: { "content-type": "application/json" } });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    const payload = JSON.parse(options.body);
    const hasIssues = payload.messages.some(message => message.role === "tool" && message.content.includes('"number":1'));
    if (hasIssues) return reply({ role: "assistant", content: "There is one open issue in the public repository." });
    return reply({
      content: null,
      tool_calls: [{
        id: "github-issues-call",
        type: "function",
        function: { name: "github_public_repo", arguments: JSON.stringify({ owner: "octocat", repo: "Hello-World", action: "open_issues", limit: 5 }) }
      }]
    });
  }, async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    throw new Error("Public issue listing must not access unrelated database tables.");
  }, async base => {
    const response = await sendPrompt(base, "Show the open issues for GitHub octocat/Hello-World");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.issues.length, 1);
    assert.equal(body.toolResults[0].result.issues[0].number, 1);
    assert.deepEqual(body.toolResults[0].result.issues[0].labels, ["bug"]);
  });
  assert.equal(githubCalls, 1);
});

test("GitHub file reads reject traversal paths before calling the public API", async () => {
  let githubCalls = 0;
  let providerCalls = 0;
  await withAgentServer(async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    const hasError = payload.messages.some(message => message.role === "tool" && message.content.includes("GITHUB_PATH_INVALID"));
    if (hasError) return reply({ role: "assistant", content: "That repository path is not a valid safe relative path." });
    return reply({
      content: null,
      tool_calls: [{
        id: "github-traversal-call",
        type: "function",
        function: { name: "github_public_repo", arguments: JSON.stringify({ owner: "octocat", repo: "Hello-World", action: "read_file", path: "../../.env" }) }
      }]
    });
  }, async (_req, table) => {
    if (table === "user_preferences") return [{ memory_enabled: false }];
    throw new Error("No unrelated DB access expected.");
  }, async base => {
    const response = await sendPrompt(base, "Read README from GitHub octocat/Hello-World");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].ok, false);
    assert.match(body.content, /not a valid safe relative path/i);
  });
  assert.equal(providerCalls, 2);
  assert.equal(githubCalls, 0);
});
