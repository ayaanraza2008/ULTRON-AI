import test from "node:test";
import assert from "node:assert/strict";
import {
  getAppFlowyReadiness,
  appflowyListWorkspaces,
  appflowyGetDocument
} from "../integrations/appflowy.js";

const VALID_ENV = {
  APPFLOWY_BASE_URL: "https://appflowy.example.com",
  APPFLOWY_API_TOKEN: "appflowy-secret-token-12345",
  ULTRON_INTEGRATION_OWNER_USER_ID: "owner-uuid-42"
};

test("AppFlowy: readiness reports missing configuration correctly", () => {
  const readiness = getAppFlowyReadiness({ env: {} });
  assert.equal(readiness.state, "missing_configuration");
  assert.equal(readiness.configured, false);
});

test("AppFlowy: readiness reports blocked_owner_guard when owner is missing", () => {
  const envNoOwner = {
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: "test-token"
  };
  const readiness = getAppFlowyReadiness({ env: envNoOwner });
  assert.equal(readiness.state, "blocked_owner_guard");
  assert.equal(readiness.configured, true);
  assert.equal(readiness.ownerGuardConfigured, false);
});

test("AppFlowy: readiness enforces owner matching", () => {
  const nonOwnerReadiness = getAppFlowyReadiness({ env: VALID_ENV, userId: "intruder-user" });
  assert.equal(nonOwnerReadiness.state, "owner_only");
  assert.equal(nonOwnerReadiness.ownerAuthorized, false);

  const ownerReadiness = getAppFlowyReadiness({ env: VALID_ENV, userId: "owner-uuid-42" });
  assert.equal(ownerReadiness.state, "configured_unverified");
  assert.equal(ownerReadiness.ownerAuthorized, true);
});

test("AppFlowy: listWorkspaces fails closed if caller is not the owner or has no authenticated identity", async () => {
  await assert.rejects(
    () => appflowyListWorkspaces({ env: VALID_ENV, userId: "intruder-user" }),
    { code: "APPFLOWY_OWNER_MISMATCH" }
  );
  await assert.rejects(
    () => appflowyListWorkspaces({ env: VALID_ENV }),
    { code: "APPFLOWY_OWNER_MISMATCH" }
  );
  await assert.rejects(
    () => appflowyGetDocument({ documentId: "doc-99", env: VALID_ENV }),
    { code: "APPFLOWY_OWNER_MISMATCH" }
  );
});

test("AppFlowy: listWorkspaces successfully parses server payload", async () => {
  const mockWorkspaces = [
    { id: "ws-1", name: "Engineering Core", created_at: "2026-10-31" },
    { id: "ws-2", name: "ULTRON Docs", created_at: "2026-11-01" }
  ];

  const mockFetch = async (url, options) => {
    assert.equal(url, "https://appflowy.example.com/api/v1/workspace/list");
    assert.equal(options.headers.Authorization, "Bearer appflowy-secret-token-12345");
    return new Response(JSON.stringify({ workspaces: mockWorkspaces }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await appflowyListWorkspaces({
    env: VALID_ENV,
    userId: "owner-uuid-42",
    fetchImpl: mockFetch
  });

  assert.equal(result.success, true);
  assert.equal(result.workspaces.length, 2);
  assert.equal(result.workspaces[0].name, "Engineering Core");
});

test("AppFlowy: getDocument rejects invalid documentId and retrieves valid document", async () => {
  await assert.rejects(
    () => appflowyGetDocument({ documentId: "bad/id/path", env: VALID_ENV, userId: "owner-uuid-42" }),
    { code: "APPFLOWY_INVALID_ID" }
  );

  const mockDoc = { id: "doc-99", title: "Architecture Spec", blocks: [] };
  const mockFetch = async (url) => {
    assert.equal(url, "https://appflowy.example.com/api/v1/document/doc-99");
    return new Response(JSON.stringify(mockDoc), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const result = await appflowyGetDocument({
    documentId: "doc-99",
    env: VALID_ENV,
    userId: "owner-uuid-42",
    fetchImpl: mockFetch
  });

  assert.equal(result.success, true);
  assert.equal(result.documentId, "doc-99");
  assert.equal(result.content.title, "Architecture Spec");
});
