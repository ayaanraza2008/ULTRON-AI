import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("chat automatically recalls and captures a user-scoped OpenViking session", async () => {
  const userId = "00000000-0000-4000-8000-000000000001";
  let providerMessages = [];
  let capturedMessages = null;
  let sessionPath = "";
  const env = {
    NODE_ENV: "test",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    OPENROUTER_API_KEY: "test-openrouter-key",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    OPENVIKING_URL: "https://openviking.test",
    OPENVIKING_API_KEY: "test-openviking-secret",
    MAX_MESSAGE_CHARS: "12000"
  };
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "supabase.test" && url.pathname === "/auth/v1/user") {
      return jsonResponse({ id: userId });
    }
    if (url.hostname === "supabase.test" && url.pathname.startsWith("/rest/v1/")) {
      return jsonResponse([]);
    }
    if (url.hostname === "openviking.test" && url.pathname.endsWith("/messages/batch")) {
      sessionPath = url.pathname;
      capturedMessages = JSON.parse(options.body).messages;
      return jsonResponse({ status: "ok", result: { accepted: true } });
    }
    if (url.hostname === "openviking.test" && url.pathname.endsWith("/context")) {
      sessionPath = url.pathname.replace(/\/context$/, "");
      return jsonResponse({ status: "ok", result: { context: "Previous project: ULTRON automation." } });
    }
    if (url.hostname === "openviking.test" && url.pathname.includes("/api/v1/sessions/")) {
      sessionPath = url.pathname;
      return jsonResponse({ status: "ok", result: { session_id: url.pathname.split("/").pop(), message_count: 0 } });
    }
    if (url.hostname === "openviking.test" && url.pathname === "/api/v1/search/find") {
      return jsonResponse({ status: "ok", result: { memories: [], resources: [], skills: [] } });
    }
    if (url.hostname === "openrouter.ai" && url.pathname.endsWith("/chat/completions")) {
      providerMessages = JSON.parse(options.body).messages;
      return jsonResponse({ choices: [{ message: { content: "I found the previous project context." } }], model: "openrouter/free" });
    }
    throw new Error("Unexpected fetch in test: " + url.hostname + url.pathname);
  };

  const app = createApp({ env, fetchImpl, logger: { warn() {}, error() {} } });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    const address = server.address();
    const response = await fetch("http://127.0.0.1:" + address.port + "/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "ultron_sb_access=test-access-token"
      },
      body: JSON.stringify({
        stream: false,
        messages: [{ role: "user", content: "Please remember our previous project and continue it." }]
      })
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.content, "I found the previous project context.");
    assert.ok(providerMessages.some(message => message.role === "system" && String(message.content).includes("Previous project: ULTRON automation.")));
    assert.ok(capturedMessages, "user/assistant messages should be persisted to OpenViking");
    assert.equal(capturedMessages.length, 2);
    assert.equal(capturedMessages[0].role, "user");
    assert.equal(capturedMessages[1].role, "assistant");
    assert.match(sessionPath, /ultron_[a-f0-9]{32}/);
    assert.equal(JSON.stringify(providerMessages).includes("test-openviking-secret"), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
