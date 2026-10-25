import test from "node:test";
import assert from "node:assert/strict";
import { getPaperclipAgentDashboard, getPaperclipReadiness } from "../integrations/paperclip-services.js";

const ownerId = "00000000-0000-4000-8000-000000000001";

test("Paperclip remains disabled until a service, company ID, token, and owner guard are configured", async () => {
  let calls = 0;
  const result = await getPaperclipAgentDashboard({
    env: {}, userId: ownerId,
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(calls, 0);
  const readiness = getPaperclipReadiness({});
  assert.equal(readiness.state, "separate_service_required");
  assert.equal(readiness.configured, false);
});

test("Paperclip blocks other ULTRON accounts before using a shared bearer token", async () => {
  let calls = 0;
  const result = await getPaperclipAgentDashboard({
    env: {
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      PAPERCLIP_BASE_URL: "https://paperclip.example",
      PAPERCLIP_API_TOKEN: "private-paperclip-token",
      PAPERCLIP_COMPANY_ID: "company-123"
    },
    userId: "00000000-0000-4000-8000-000000000002",
    fetchImpl: async () => { calls++; throw new Error("should not call upstream"); }
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_NOT_CONFIGURED");
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(result).includes("private-paperclip-token"), false);
});

test("Paperclip connector performs only GET requests and returns sanitized roster/dashboard/cost data", async () => {
  const requests = [];
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    PAPERCLIP_BASE_URL: "https://paperclip.example/",
    PAPERCLIP_API_TOKEN: "private-paperclip-token",
    PAPERCLIP_COMPANY_ID: "company-123"
  };
  const result = await getPaperclipAgentDashboard({
    env, userId: ownerId,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/companies/company-123/agents")) {
        return new Response(JSON.stringify([{ id: "agent-1", name: "ULTRON", role: "ceo", title: "Assistant", status: "running", reportsTo: null, budgetMonthlyCents: 1000, spentMonthlyCents: 200, secret: "must-not-escape" }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/companies/company-123/dashboard")) {
        return new Response(JSON.stringify({
          companyId: "company-123",
          agents: { active: 1, running: 1, paused: 0, error: 0, secret: "must-not-escape" },
          tasks: { open: 3, inProgress: 1, blocked: 1, done: 5, notes: "hidden" },
          costs: { monthSpendCents: 200, monthBudgetCents: 1000, monthUtilizationPercent: 20 },
          pendingApprovals: 0,
          budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
          privateActivity: [{ body: "do not return full dashboard activity" }]
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/companies/company-123/costs/summary")) {
        return new Response(JSON.stringify({
          companyId: "company-123",
          eventCount: 4,
          spendCents: 200,
          spendCentsExact: "200",
          budgetCents: 1000,
          utilizationPercent: 20,
          pricingComplete: true,
          privateProviderError: "do not return"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected Paperclip endpoint");
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.provider, "paperclip");
  assert.equal(result.agentCount, 1);
  assert.equal(result.agents[0].name, "ULTRON");
  assert.equal(result.agents[0].budgetMonthlyCents, 1000);
  assert.equal(result.dashboard.agents.active, 1);
  assert.equal(result.dashboard.tasks.open, 3);
  assert.equal(result.dashboard.costs.monthSpendCents, 200);
  assert.equal(result.costs.spendCents, 200);
  assert.equal(result.costs.pricingComplete, true);
  assert.equal(result.mode, "read_only");
  assert.equal(requests.length, 3);
  assert.equal(requests.every(item => item.options.method === "GET"), true);
  assert.equal(requests.every(item => item.options.redirect === "error"), true);
  assert.equal(requests.every(item => item.options.headers.Authorization === "Bearer private-paperclip-token"), true);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("private-paperclip-token"), false);
  assert.equal(serialized.includes("must-not-escape"), false);
  assert.equal(serialized.includes("privateActivity"), false);
  assert.equal(serialized.includes("privateProviderError"), false);
  assert.ok(result.actionsNotExposed.includes("terminate_agent"));
});

test("Paperclip rejects unsafe base URLs and malformed company IDs before networking", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("should not call upstream"); };
  const baseEnv = {
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    PAPERCLIP_API_TOKEN: "private-paperclip-token",
    PAPERCLIP_COMPANY_ID: "company-123"
  };
  for (const value of ["http://paperclip.example", "https://user:password@paperclip.example", "https://paperclip.example/?token=x"]) {
    const result = await getPaperclipAgentDashboard({
      env: { ...baseEnv, PAPERCLIP_BASE_URL: value }, userId: ownerId, fetchImpl
    });
    assert.equal(result.state, "blocked");
    assert.equal(result.error.code, "PAPERCLIP_NOT_CONFIGURED");
  }
  const invalidCompany = await getPaperclipAgentDashboard({
    env: { ...baseEnv, PAPERCLIP_BASE_URL: "https://paperclip.example", PAPERCLIP_COMPANY_ID: "../other" },
    userId: ownerId, fetchImpl
  });
  assert.equal(invalidCompany.error.code, "PAPERCLIP_NOT_CONFIGURED");
  assert.equal(calls, 0);
});

test("Paperclip readiness returns states only and never leaks API token values", () => {
  const readiness = getPaperclipReadiness({
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    PAPERCLIP_BASE_URL: "https://paperclip.example",
    PAPERCLIP_API_TOKEN: "private-paperclip-token",
    PAPERCLIP_COMPANY_ID: "company-123"
  });
  assert.equal(readiness.state, "configured_unverified");
  assert.equal(readiness.configured, true);
  assert.equal(JSON.stringify(readiness).includes("private-paperclip-token"), false);
});


test("Paperclip readiness rejects HTTPS private and metadata service endpoints", () => {
  for (const url of [
    "https://192.168.1.10",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal"
  ]) {
    const readiness = getPaperclipReadiness({
      ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
      PAPERCLIP_BASE_URL: url,
      PAPERCLIP_API_TOKEN: "synthetic-token",
      PAPERCLIP_COMPANY_ID: "company-123"
    });
    assert.equal(readiness.configured, false, url);
  }
});
