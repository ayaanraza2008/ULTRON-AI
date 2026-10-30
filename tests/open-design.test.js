import test from "node:test";
import assert from "node:assert/strict";
import {
  getOpenDesignReadiness,
  runOpenDesignAction,
  OPEN_DESIGN_PAID_CONFIRMATION
} from "../integrations/open-design.js";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const readyEnv = {
  OPEN_DESIGN_ENABLED: "true",
  OPEN_DESIGN_BASE_URL: "https://design.example.com",
  OPEN_DESIGN_API_TOKEN: "od-test-daemon-token",
  OPEN_DESIGN_PROJECT_ID: "personal_project_123",
  OPEN_DESIGN_BYOK_PROTOCOL: "openai",
  OPEN_DESIGN_BYOK_BASE_URL: "https://openrouter.ai/api/v1",
  OPEN_DESIGN_BYOK_API_KEY: "provider-key-synthetic",
  OPEN_DESIGN_BYOK_MODEL: "openrouter/free",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};
const approvedPrompt = "I approve this task using my configured provider credits in OpenDesign.";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("OpenDesign is disabled by default and readiness never returns configured secrets", () => {
  const disabled = getOpenDesignReadiness({});
  assert.equal(disabled.configured, false);
  assert.equal(disabled.state, "disabled_by_config");
  const configured = getOpenDesignReadiness(readyEnv, owner);
  assert.equal(configured.configured, true);
  assert.equal(configured.ownerAuthorized, true);
  const serialized = JSON.stringify(configured);
  assert.equal(serialized.includes(readyEnv.OPEN_DESIGN_API_TOKEN), false);
  assert.equal(serialized.includes(readyEnv.OPEN_DESIGN_BYOK_API_KEY), false);
});

test("OpenDesign static catalog requires no network or credentials", async () => {
  const result = await runOpenDesignAction({ action: "catalog" });
  assert.equal(result.provider, "open-design");
  assert.ok(result.capabilities.includes("submit a headless BYOK design/coding task"));
  assert.equal(result.execution, "static_adapter_catalog_only");
});

test("OpenDesign blocks non-owner account before outbound requests", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenDesignAction({ env: readyEnv, userId: stranger, action: "projects", fetchImpl: async () => { calls++; return jsonResponse({ projects: [] }); } }),
    error => error.code === "INTEGRATION_OWNER_ONLY"
  );
  assert.equal(calls, 0);
});

test("OpenDesign project list returns bounded safe project metadata", async () => {
  let request;
  const result = await runOpenDesignAction({
    env: readyEnv, userId: owner, action: "projects",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ projects: [
        { id: "personal_project_123", name: "My design project", metadata: { kind: "personal", apiKey: "should-not-pass" } },
        { id: "../escape", name: "Invalid project" },
        { id: "project-2", name: "Second project" }
      ] });
    }
  });
  assert.equal(request.url, "https://design.example.com/api/projects");
  assert.equal(request.options.headers.Authorization, "Bearer " + readyEnv.OPEN_DESIGN_API_TOKEN);
  assert.equal(request.options.redirect, "error");
  assert.equal(result.state, "completed");
  assert.deepEqual(result.projects, [
    { id: "personal_project_123", name: "My design project", kind: "personal" },
    { id: "project-2", name: "Second project" }
  ]);
  assert.equal(JSON.stringify(result).includes(readyEnv.OPEN_DESIGN_API_TOKEN), false);
});

test("OpenDesign requires explicit paid-run approval before provider credentials are sent", async () => {
  let calls = 0;
  const result = await runOpenDesignAction({
    env: readyEnv, userId: owner, action: "submit", prompt: "Create a simple landing page",
    fetchImpl: async () => { calls++; throw new Error("unexpected outbound request"); }
  });
  assert.equal(result.state, "approval_required");
  assert.equal(result.execution, "not_started");
  assert.equal(calls, 0);
});

test("OpenDesign submits a headless BYOK run only to the configured project", async () => {
  let request;
  const result = await runOpenDesignAction({
    env: readyEnv, userId: owner, action: "submit",
    prompt: "Create a single-page project status report in index.html.",
    approveRun: true,
    confirmationText: OPEN_DESIGN_PAID_CONFIRMATION,
    userPrompt: approvedPrompt,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ runId: "run_123", conversationId: "conversation_1", assistantMessageId: "message_1" }, 202);
    }
  });
  assert.equal(request.url, "https://design.example.com/api/runs");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.Authorization, "Bearer " + readyEnv.OPEN_DESIGN_API_TOKEN);
  assert.equal(request.options.redirect, "error");
  const body = JSON.parse(request.options.body);
  assert.equal(body.projectId, readyEnv.OPEN_DESIGN_PROJECT_ID);
  assert.equal(body.agentId, "byok-opencode");
  assert.equal(body.model, readyEnv.OPEN_DESIGN_BYOK_MODEL);
  assert.equal(body.byokProvider.protocol, "openai");
  assert.equal(body.byokProvider.baseUrl, readyEnv.OPEN_DESIGN_BYOK_BASE_URL);
  assert.equal(body.byokProvider.apiKey, readyEnv.OPEN_DESIGN_BYOK_API_KEY);
  assert.equal(typeof body.clientRequestId, "string");
  assert.equal(body.message, "Create a single-page project status report in index.html.");
  assert.equal(result.state, "queued");
  assert.equal(result.runId, "run_123");
  assert.equal(JSON.stringify(result).includes(readyEnv.OPEN_DESIGN_API_TOKEN), false);
  assert.equal(JSON.stringify(result).includes(readyEnv.OPEN_DESIGN_BYOK_API_KEY), false);
});

test("OpenDesign refuses a caller-supplied project override and disallows invalid model configuration", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenDesignAction({
      env: { ...readyEnv, OPEN_DESIGN_PROJECT_ID: "../other-project" },
      userId: owner, action: "submit", prompt: "Do work",
      approveRun: true, confirmationText: OPEN_DESIGN_PAID_CONFIRMATION, userPrompt: approvedPrompt,
      fetchImpl: async () => { calls++; return jsonResponse({ runId: "run_123" }, 202); }
    }),
    error => error.code === "OPEN_DESIGN_NOT_CONFIGURED"
  );
  assert.equal(calls, 0);

  await assert.rejects(
    runOpenDesignAction({
      env: { ...readyEnv, OPEN_DESIGN_BYOK_MODEL: "default" },
      userId: owner, action: "submit", prompt: "Do work",
      approveRun: true, confirmationText: OPEN_DESIGN_PAID_CONFIRMATION, userPrompt: approvedPrompt,
      fetchImpl: async () => { calls++; return jsonResponse({ runId: "run_123" }, 202); }
    }),
    error => error.code === "OPEN_DESIGN_NOT_CONFIGURED"
  );
  assert.equal(calls, 0);
});

test("OpenDesign validates run IDs and sanitizes status response paths", async () => {
  let calls = 0;
  await assert.rejects(
    runOpenDesignAction({ env: readyEnv, userId: owner, action: "status", requestId: "../other", fetchImpl: async () => { calls++; return jsonResponse({}); } }),
    error => error.code === "OPEN_DESIGN_RUN_ID_INVALID"
  );
  assert.equal(calls, 0);

  let url;
  const result = await runOpenDesignAction({
    env: readyEnv, userId: owner, action: "status", requestId: "run_123",
    fetchImpl: async input => {
      url = input;
      return jsonResponse({ status: "succeeded", deliverableValid: true, deliverableEntryFile: "index.html", apiKey: "not-returned" });
    }
  });
  assert.equal(url, "https://design.example.com/api/runs/run_123");
  assert.equal(result.state, "status_available");
  assert.equal(result.status, "succeeded");
  assert.equal(result.verified, true);
  assert.equal(result.deliverableEntryFile, "index.html");
  assert.equal(JSON.stringify(result).includes("apiKey"), false);
});
