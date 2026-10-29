import test from "node:test";
import assert from "node:assert/strict";
import { buildIntegrationCatalog } from "../integrations/catalog.js";
import {
  getGoogleWorkspaceReadiness,
  isGoogleWorkspaceConfigured,
  runGoogleWorkspaceReadAction
} from "../integrations/google-workspace.js";

const OWNER = "00000000-0000-4000-8000-000000000001";
const URL = "https://script.google.com/macros/s/AKfycbx0123456789abcdefghijklmnopqrstuv/exec";
const TOKEN = "test-only-workspace-token-with-more-than-32-characters";
const ENV = {
  ULTRON_INTEGRATION_OWNER_USER_ID: OWNER,
  GOOGLE_WORKSPACE_BRIDGE_URL: URL,
  GOOGLE_WORKSPACE_BRIDGE_TOKEN: TOKEN
};
const ok = data => new Response(JSON.stringify({ status: "success", data }), {
  status: 200, headers: { "content-type": "application/json" }
});

test("Google Workspace is owner-scoped and exposes no credential values in readiness", () => {
  const status = getGoogleWorkspaceReadiness({ env: ENV, userId: OWNER });
  assert.equal(status.configured, true);
  assert.equal(status.state, "configured_unverified");
  assert.equal(status.writesEnabled, false);
  assert.equal(JSON.stringify(status).includes(TOKEN), false);
  const denied = getGoogleWorkspaceReadiness({ env: ENV, userId: "00000000-0000-4000-8000-000000000002" });
  assert.equal(denied.configured, false);
  assert.equal(denied.error.code, "INTEGRATION_OWNER_ONLY");
});

test("integration catalog reports Google Workspace as configured-but-unverified without exposing secrets", () => {
  const configured = buildIntegrationCatalog(ENV).find(item => item.id === "google-workspace");
  assert.equal(configured.configured, true);
  assert.equal(configured.state, "configured_unverified");
  assert.equal(JSON.stringify(configured).includes(TOKEN), false);
  const blocked = buildIntegrationCatalog({ ...ENV, GOOGLE_WORKSPACE_BRIDGE_TOKEN: "weak" })
    .find(item => item.id === "google-workspace");
  assert.equal(blocked.configured, false);
  assert.equal(blocked.state, "blocked");
});

test("Google Workspace rejects missing, weak, malformed, or non-Google bridge configuration", async () => {
  assert.equal(isGoogleWorkspaceConfigured(ENV), true);
  assert.equal(isGoogleWorkspaceConfigured({ ...ENV, GOOGLE_WORKSPACE_BRIDGE_TOKEN: "weak" }), false);
  assert.equal(isGoogleWorkspaceConfigured({ ...ENV, GOOGLE_WORKSPACE_BRIDGE_URL: "https://example.com/exec" }), false);
  let calls = 0;
  const result = await runGoogleWorkspaceReadAction({
    env: { ...ENV, GOOGLE_WORKSPACE_BRIDGE_URL: "https://example.com/exec" },
    userId: OWNER, action: "gmail_list_unread",
    fetchImpl: async () => { calls++; throw new Error("must not request unsafe bridge"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "GOOGLE_WORKSPACE_URL_INVALID");
  assert.equal(calls, 0);
});

test("Google Workspace denies other users before making any upstream call", async () => {
  let calls = 0;
  const result = await runGoogleWorkspaceReadAction({
    env: ENV,
    userId: "00000000-0000-4000-8000-000000000002",
    action: "gmail_search",
    params: { query: "is:unread" },
    fetchImpl: async () => { calls++; throw new Error("must not call upstream"); }
  });
  assert.equal(result.error.code, "INTEGRATION_OWNER_ONLY");
  assert.equal(calls, 0);
});

test("Google Workspace allows only read-only actions; send, delete and write are blocked", async () => {
  let calls = 0;
  for (const action of ["gmail_send", "drive_delete_file", "calendar_create_event", "sheets_write"]) {
    const result = await runGoogleWorkspaceReadAction({
      env: ENV, userId: OWNER, action, params: {},
      fetchImpl: async () => { calls++; throw new Error("must not call upstream"); }
    });
    assert.equal(result.error.code, "GOOGLE_WORKSPACE_ACTION_NOT_ALLOWED");
  }
  assert.equal(calls, 0);
});

test("Google Gmail search forwards only bounded read-only params and never returns the token", async () => {
  let request;
  const result = await runGoogleWorkspaceReadAction({
    env: ENV, userId: OWNER, action: "gmail_search",
    params: { query: "is:unread from:example.com", limit: 99 },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return ok({ count: 1, emails: [
        { subject: "Roadmap", from: "user@example.com", date: "today", snippet: "Review this item", raw: "secret" },
        { subject: "Out of bounds", from: "someone@example.com", date: "yesterday" }
      ] });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.action, "gmail_search");
  assert.equal(result.data.count, 1);
  assert.equal(result.data.emails.length, 2);
  assert.equal(request.url, URL);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.redirect, "manual");
  assert.equal(request.body.bridgeToken, TOKEN);
  assert.equal(request.body.action, "gmail_search");
  assert.equal(request.body.params.limit, 20);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  assert.equal(JSON.stringify(result).includes("secret"), false);
});

test("Google Calendar ranges and Sheets ranges are bounded before network access", async () => {
  let calls = 0;
  const invalidCalendar = await runGoogleWorkspaceReadAction({
    env: ENV, userId: OWNER, action: "calendar_get_events",
    params: { timeMin: "2026-01-01T00:00:00Z", timeMax: "2027-01-01T00:00:00Z" },
    fetchImpl: async () => { calls++; return ok({}); }
  });
  assert.equal(invalidCalendar.error.code, "GOOGLE_CALENDAR_RANGE_INVALID");
  const invalidSheet = await runGoogleWorkspaceReadAction({
    env: ENV, userId: OWNER, action: "sheets_read",
    params: { spreadsheetId: "abcdefghijklmnopqrstuv", sheetName: "Sheet1", range: "A1:Z99999" },
    fetchImpl: async () => { calls++; return ok({}); }
  });
  assert.equal(invalidSheet.error.code, "GOOGLE_SHEET_RANGE_INVALID");
  assert.equal(calls, 0);
});

test("Google Apps Script ContentService redirect is followed only to the fixed Google response host", async () => {
  const calls = [];
  const result = await runGoogleWorkspaceReadAction({
    env: ENV, userId: OWNER, action: "gmail_list_unread", params: { limit: 5 },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://script.googleusercontent.com/macros/echo?user_content_key=signed-key" }
        });
      }
      return ok({ count: 0, totalUnread: 0, emails: [] });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, "GET");
  assert.equal(calls[1].options.body, undefined);
  assert.equal(calls[1].options.headers["Content-Type"], undefined);
});

test("Google Apps Script redirects to other hosts are rejected without following them", async () => {
  let calls = 0;
  const result = await runGoogleWorkspaceReadAction({
    env: ENV, userId: OWNER, action: "gmail_list_unread",
    fetchImpl: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: "https://attacker.example/macros/echo?token=leak" } });
    }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "GOOGLE_WORKSPACE_REDIRECT_BLOCKED");
  assert.equal(calls, 1);
});
