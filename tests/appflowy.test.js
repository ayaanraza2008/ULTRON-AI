import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppFlowyReadiness,
  runAppFlowyAction
} from "../integrations/appflowy.js";

const owner = "00000000-0000-4000-8000-000000000001";
const stranger = "00000000-0000-4000-8000-000000000002";
const readyEnv = {
  APPFLOWY_ENABLED: "true",
  APPFLOWY_BASE_URL: "https://appflowy.example.com",
  APPFLOWY_API_TOKEN: "appflowy-user-token-1234567890",
  APPFLOWY_CLIENT_VERSION: "0.9.24",
  APPFLOWY_DEVICE_ID: "00000000-0000-4000-8000-000000000002",
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};
function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("AppFlowy is disabled by default and readiness never exposes provider credentials", () => {
  const disabled = getAppFlowyReadiness({});
  assert.equal(disabled.configured, false);
  assert.equal(disabled.state, "disabled_by_config");
  const configured = getAppFlowyReadiness(readyEnv, owner);
  assert.equal(configured.configured, true);
  assert.equal(configured.ownerAuthorized, true);
  assert.equal(JSON.stringify(configured).includes(readyEnv.APPFLOWY_API_TOKEN), false);
});

test("AppFlowy static capability catalog requires no upstream request", async () => {
  const result = await runAppFlowyAction({ action: "catalog" });
  assert.equal(result.provider, "appflowy");
  assert.ok(result.capabilities.includes("search workspace documents"));
  assert.equal(result.mode, "owner_scoped_read_only_rest_adapter");
});

test("AppFlowy blocks non-owner before outbound requests", async () => {
  let calls = 0;
  await assert.rejects(
    runAppFlowyAction({
      env: readyEnv, userId: stranger, action: "workspaces",
      fetchImpl: async () => { calls++; return jsonResponse({ data: [] }); }
    }),
    error => error.code === "INTEGRATION_OWNER_ONLY"
  );
  assert.equal(calls, 0);
});

test("AppFlowy workspace listing sends documented bearer/client headers and sanitizes metadata", async () => {
  let request;
  const result = await runAppFlowyAction({
    env: readyEnv, userId: owner, action: "workspaces",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: [
        { workspace_id: "00000000-0000-4000-8000-000000000010", name: "Engineering", role: "owner", member_count: 4, token: "must-not-pass" },
        { workspace_id: "../not-a-uuid", name: "Invalid" }
      ] });
    }
  });
  assert.equal(request.url, "https://appflowy.example.com/api/workspace");
  assert.equal(request.options.headers.Authorization, "Bearer " + readyEnv.APPFLOWY_API_TOKEN);
  assert.equal(request.options.headers["client-version"], "0.9.24");
  assert.equal(request.options.headers["device-id"], readyEnv.APPFLOWY_DEVICE_ID);
  assert.equal(request.options.redirect, "error");
  assert.equal(result.state, "completed");
  assert.deepEqual(result.workspaces, [{
    id: "00000000-0000-4000-8000-000000000010",
    name: "Engineering", role: "owner", memberCount: 4
  }]);
  assert.equal(JSON.stringify(result).includes(readyEnv.APPFLOWY_API_TOKEN), false);
});

test("AppFlowy folder-tree reads use validated UUID/depth and return bounded tree metadata", async () => {
  let request;
  const result = await runAppFlowyAction({
    env: readyEnv, userId: owner, action: "folder",
    workspaceId: "00000000-0000-4000-8000-000000000010", depth: 3,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: {
        id: "00000000-0000-4000-8000-000000000010",
        name: "Engineering",
        view_type: "workspace",
        children: [{ id: "view-123", name: "Sprint Plan", view_type: "document", children: [] }]
      } });
    }
  });
  assert.equal(request.url, "https://appflowy.example.com/api/workspace/00000000-0000-4000-8000-000000000010/folder?depth=3");
  assert.equal(result.tree.name, "Engineering");
  assert.equal(result.tree.children[0].name, "Sprint Plan");
  assert.equal(result.nodeCount, 2);
  assert.equal(result.provider, "appflowy");
});

test("AppFlowy document search URL-encodes the query and returns bounded snippets", async () => {
  let request;
  const result = await runAppFlowyAction({
    env: readyEnv, userId: owner, action: "search",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    query: "deployment health",
    limit: 8,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: [
        { view_id: "page-1", name: "Release Notes", preview: "Green build and rollback steps", score: 0.92, apiKey: "must-not-pass" }
      ] });
    }
  });
  assert.equal(request.url, "https://appflowy.example.com/api/search/00000000-0000-4000-8000-000000000010?query=deployment+health&limit=8&preview_size=80");
  assert.equal(request.options.method, "GET");
  assert.equal(result.results[0].name, "Release Notes");
  assert.equal(result.results[0].excerpt, "Green build and rollback steps");
  assert.equal(result.results[0].score, 0.92);
  assert.equal(JSON.stringify(result).includes("apiKey"), false);
});

test("AppFlowy rejects invalid workspace IDs, depth and empty search queries before network", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonResponse({ data: [] }); };
  await assert.rejects(
    runAppFlowyAction({ env: readyEnv, userId: owner, action: "folder", workspaceId: "../escape", fetchImpl }),
    error => error.code === "APPFLOWY_ID_INVALID"
  );
  await assert.rejects(
    runAppFlowyAction({ env: readyEnv, userId: owner, action: "folder", workspaceId: "00000000-0000-4000-8000-000000000010", depth: 9, fetchImpl }),
    error => error.code === "APPFLOWY_DEPTH_INVALID"
  );
  await assert.rejects(
    runAppFlowyAction({ env: readyEnv, userId: owner, action: "search", workspaceId: "00000000-0000-4000-8000-000000000010", query: " ", fetchImpl }),
    error => error.code === "APPFLOWY_QUERY_REQUIRED"
  );
  assert.equal(calls, 0);
});

test("AppFlowy masks upstream HTTP auth errors and never propagates response body or token", async () => {
  const error = await runAppFlowyAction({
    env: readyEnv, userId: owner, action: "workspaces",
    fetchImpl: async () => jsonResponse({ error: "token was rejected: " + readyEnv.APPFLOWY_API_TOKEN }, 401)
  }).catch(value => value);
  assert.equal(error.code, "APPFLOWY_AUTH_FAILED");
  assert.doesNotMatch(error.message, /appflowy-user-token/);
});


test("AppFlowy reads a bounded collab document through the numeric type allowlist", async () => {
  let request;
  const result = await runAppFlowyAction({
    env: readyEnv,
    userId: owner,
    action: "read_document",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    viewId: "00000000-0000-4000-8000-000000000011",
    documentType: "document",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({ data: {
        collab: { document: { root: { children: [{ text: "Meeting notes and action items" }] } }, metadata: { layout: "document" } },
        privateToken: "must-not-be-returned"
      } });
    }
  });
  assert.equal(request.url, "https://appflowy.example.com/api/workspace/v1/00000000-0000-4000-8000-000000000010/collab/00000000-0000-4000-8000-000000000011/json?collab_type=0");
  assert.equal(request.options.method, "GET");
  assert.equal(result.state, "completed");
  assert.equal(result.documentType, "document");
  assert.equal(result.collab.document.root.children[0].text, "Meeting notes and action items");
  assert.equal(JSON.stringify(result).includes("must-not-be-returned"), false);
  assert.match(result.notice, /Read-only AppFlowy collab JSON/i);
});

test("AppFlowy document read rejects unsupported collab types before network access", async () => {
  let calls = 0;
  await assert.rejects(
    runAppFlowyAction({
      env: readyEnv, userId: owner, action: "read_document",
      workspaceId: "00000000-0000-4000-8000-000000000010",
      viewId: "00000000-0000-4000-8000-000000000011",
      documentType: "user_awareness",
      fetchImpl: async () => { calls++; return jsonResponse({ data: {} }); }
    }),
    error => error.code === "APPFLOWY_DOCUMENT_TYPE_INVALID"
  );
  assert.equal(calls, 0);
});


test("AppFlowy collab JSON projection bounds large payloads and nested values", async () => {
  const oversizedText = "x".repeat(5000);
  const payload = {
    collab: {
      document: {
        root: {
          text: oversizedText,
          children: Array.from({ length: 150 }, (_, index) => ({ id: "node-" + index, text: "note-" + index }))
        }
      }
    }
  };
  const result = await runAppFlowyAction({
    env: readyEnv, userId: owner, action: "read_document",
    workspaceId: "00000000-0000-4000-8000-000000000010",
    viewId: "00000000-0000-4000-8000-000000000011",
    documentType: "document",
    fetchImpl: async () => jsonResponse({ data: payload })
  });
  assert.equal(result.state, "completed");
  assert.ok(result.collab.document.root.children.length <= 60);
  assert.equal(result.collab.document.root.text.length, 2000);
  assert.ok(JSON.stringify(result.collab).length < 20_000);
});
