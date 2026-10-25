import test from "node:test";
import assert from "node:assert/strict";
import {
  listChatwootConversations,
  listOpenProjectProjects,
  listOpenProjectWorkPackages,
  listCalDiyEventTypes,
  listCalDiySlots
} from "../integrations/productivity-services.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const ownerEnv = { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId };

test("shared productivity service secrets are unavailable to other ULTRON users", async () => {
  let called = false;
  const env = {
    ...ownerEnv,
    CHATWOOT_BASE_URL: "https://chat.example",
    CHATWOOT_API_TOKEN: "private-token",
    CHATWOOT_ACCOUNT_ID: "12"
  };
  const result = await listChatwootConversations({
    env, userId: "00000000-0000-4000-8000-000000000002",
    fetchImpl: async () => { called = true; throw new Error("must not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(called, false);
  assert.equal(JSON.stringify(result).includes("private-token"), false);
});

test("Chatwoot connector fetches bounded conversation summaries and omits direct contact details", async () => {
  let request;
  const result = await listChatwootConversations({
    env: {
      ...ownerEnv, CHATWOOT_BASE_URL: "https://chat.example/",
      CHATWOOT_API_TOKEN: "chat-secret", CHATWOOT_ACCOUNT_ID: "12"
    },
    userId: ownerId, status: "open", limit: 5,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ data: { payload: [
        { id: 44, status: "open", priority: "high", unread_count: 2, last_activity_at: 1760000000,
          meta: { inbox: { name: "Support" }, sender: { name: "Customer", email: "secret@example.com", phone_number: "+1000000" } },
          labels: ["billing"] },
        { id: 45, status: "pending", meta: { sender: { email: "private@example.com" } } }
      ] } }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.provider, "chatwoot");
  assert.equal(result.count, 2);
  assert.equal(result.conversations[0].id, "44");
  assert.equal(result.conversations[0].contactName, "Customer");
  assert.equal(result.conversations[0].inbox, "Support");
  assert.equal(request.url, "https://chat.example/api/v1/accounts/12/conversations?status=open&page=1");
  assert.equal(request.options.headers.Authorization, "Bearer chat-secret");
  assert.equal(request.options.redirect, "error");
  assert.equal(JSON.stringify(result).includes("secret@example.com"), false);
  assert.equal(JSON.stringify(result).includes("+1000000"), false);
});

test("Chatwoot refuses missing owner guard, malformed account IDs, and unsafe base URLs", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error("must not call upstream"); };
  const noOwner = await listChatwootConversations({
    env: { CHATWOOT_BASE_URL: "https://chat.example", CHATWOOT_API_TOKEN: "token", CHATWOOT_ACCOUNT_ID: "12" },
    userId: ownerId, fetchImpl
  });
  assert.equal(noOwner.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  const badId = await listChatwootConversations({
    env: { ...ownerEnv, CHATWOOT_BASE_URL: "https://chat.example", CHATWOOT_API_TOKEN: "token", CHATWOOT_ACCOUNT_ID: "../1" },
    userId: ownerId, fetchImpl
  });
  assert.equal(badId.error.code, "CHATWOOT_ACCOUNT_ID_INVALID");
  const unsafe = await listChatwootConversations({
    env: { ...ownerEnv, CHATWOOT_BASE_URL: "http://public.example", CHATWOOT_API_TOKEN: "token", CHATWOOT_ACCOUNT_ID: "12" },
    userId: ownerId, fetchImpl
  });
  assert.equal(unsafe.error.code, "INTEGRATION_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("OpenProject project list uses API-key Basic auth and returns bounded project fields", async () => {
  let request;
  const result = await listOpenProjectProjects({
    env: { ...ownerEnv, OPENPROJECT_BASE_URL: "https://projects.example", OPENPROJECT_API_TOKEN: "op-secret" },
    userId: ownerId, limit: 2,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ _embedded: { elements: [
        { id: 9, identifier: "ultron", name: "ULTRON", status: "on track", createdAt: "2026-10-01", _links: { self: { href: "/api/v3/projects/9" } } },
        { id: 10, identifier: "ai", name: "AI Platform" },
        { id: 11, name: "Should be clipped" }
      ] } }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.count, 2);
  assert.equal(result.projects[0].name, "ULTRON");
  assert.equal(request.url, "https://projects.example/api/v3/projects?pageSize=2");
  assert.equal(request.options.headers.Authorization, "Basic " + Buffer.from("apikey:op-secret").toString("base64"));
  assert.equal(request.options.redirect, "error");
  assert.equal(JSON.stringify(result).includes("op-secret"), false);
});

test("OpenProject work package filter accepts only numeric project IDs", async () => {
  let requestUrl = "";
  const env = { ...ownerEnv, OPENPROJECT_BASE_URL: "https://projects.example", OPENPROJECT_API_TOKEN: "op-secret" };
  const fetchImpl = async url => {
    requestUrl = url;
    return new Response(JSON.stringify({ _embedded: { elements: [
      { id: 73, subject: "Add tests", dueDate: "2026-11-01", _links: { status: { title: "Open" }, type: { title: "Task" }, project: { title: "ULTRON" }, self: { href: "/api/v3/work_packages/73" } } }
    ] } }), { status: 200 });
  };
  const valid = await listOpenProjectWorkPackages({ env, userId: ownerId, projectId: 9, limit: 4, fetchImpl });
  assert.equal(valid.count, 1);
  assert.equal(valid.workPackages[0].subject, "Add tests");
  const query = new URL(requestUrl).searchParams;
  assert.equal(query.get("pageSize"), "4");
  assert.equal(JSON.parse(query.get("filters"))[0].project.values[0], "9");
  const invalid = await listOpenProjectWorkPackages({ env, userId: ownerId, projectId: "9&admin=true", fetchImpl });
  assert.equal(invalid.error.code, "OPENPROJECT_PROJECT_ID_INVALID");
});

test("Cal.diy event type listing sends API v2 auth/version headers and limits records", async () => {
  let request;
  const result = await listCalDiyEventTypes({
    env: { ...ownerEnv, CALDIY_BASE_URL: "https://cal.example", CALDIY_API_TOKEN: "cal-secret" },
    userId: ownerId, limit: 2,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ status: "success", data: [
        { id: 3, title: "15 minute chat", slug: "quick-chat", lengthInMinutes: 15, hidden: false },
        { id: 4, title: "Consultation", lengthInMinutes: 45 },
        { id: 5, title: "Clipped" }
      ] }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.count, 2);
  assert.equal(result.eventTypes[0].title, "15 minute chat");
  assert.equal(request.url, "https://cal.example/v2/event-types?take=2");
  assert.equal(request.options.headers.Authorization, "Bearer cal-secret");
  assert.equal(request.options.headers["cal-api-version"], "2026-02-25");
  assert.equal(request.options.redirect, "error");
});

test("Cal.diy availability validates a bounded ISO date window and never books", async () => {
  let request;
  const result = await listCalDiySlots({
    env: { ...ownerEnv, CALDIY_BASE_URL: "https://cal.example", CALDIY_API_TOKEN: "cal-secret" },
    userId: ownerId, eventTypeId: 3,
    start: "2026-11-01T00:00:00Z", end: "2026-11-03T00:00:00Z", timeZone: "Asia/Kolkata",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ status: "success", data: { slots: {
        "2026-11-01": [{ time: "2026-11-01T05:30:00Z" }, { time: "2026-11-01T06:00:00Z" }]
      } } }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.count, 2);
  assert.match(result.notice, /No booking was created/);
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v2/slots");
  assert.equal(url.searchParams.get("eventTypeId"), "3");
  assert.equal(url.searchParams.get("timeZone"), "Asia/Kolkata");
  const tooLong = await listCalDiySlots({
    env: { ...ownerEnv, CALDIY_BASE_URL: "https://cal.example", CALDIY_API_TOKEN: "cal-secret" },
    userId: ownerId, eventTypeId: 3,
    start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z",
    fetchImpl: async () => { throw new Error("must not call upstream"); }
  });
  assert.equal(tooLong.error.code, "CALDIY_DATE_RANGE_INVALID");
});


test("productivity connectors reject HTTPS private-network bases before forwarding tokens", async () => {
  let called = false;
  const env = {
    ...ownerEnv,
    CHATWOOT_BASE_URL: "https://192.168.1.10",
    CHATWOOT_API_TOKEN: "synthetic-token",
    CHATWOOT_ACCOUNT_ID: "12"
  };
  const result = await listChatwootConversations({
    env, userId: ownerId,
    fetchImpl: async () => { called = true; throw new Error("Unsafe URL must not be contacted."); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_NOT_CONFIGURED");
  assert.equal(called, false);
});
