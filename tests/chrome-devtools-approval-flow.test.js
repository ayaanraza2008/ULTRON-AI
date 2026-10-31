import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createAgentRouter,
  parseChromeActionApproval
} from "../agent-runtime.js";
import {
  approveChromeDevToolsAction,
  runChromeDevToolsAction
} from "../integrations/chrome-devtools.js";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const token = "chrome-approval-test-token-that-is-long-enough";
const env = {
  OPENROUTER_API_KEY: "test-only",
  ULTRON_CHROME_DEVTOOLS_URL: "https://chrome-bridge.example.com",
  ULTRON_CHROME_DEVTOOLS_TOKEN: token,
  ULTRON_INTEGRATION_OWNER_USER_ID: owner
};

function inspection(overrides = {}) {
  return {
    action: "inspect_click",
    origin: "https://checkout.example.com",
    url: "https://checkout.example.com/order/confirm",
    selector: "button#pay-now",
    label: "Pay now",
    tag: "button",
    type: "submit",
    formActionOrigin: "https://checkout.example.com",
    highImpact: true,
    crossOriginForm: false,
    requiresConfirmation: true,
    ...overrides
  };
}

function bridgeFetch({ inspectionValue = inspection(), calls = [] } = {}) {
  return async (url, options = {}) => {
    calls.push({ url, action: JSON.parse(options.body) });
    const input = JSON.parse(options.body);
    if (input.action === "inspect_click") {
      return new Response(JSON.stringify({ ok: true, result: inspectionValue }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    if (input.action === "click") {
      return new Response(JSON.stringify({ ok: true, result: { state: "completed", action: "click", selector: input.selector } }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }
    throw new Error("Unexpected action " + input.action);
  };
}

test("only the exact current-user approval phrase is parsed", () => {
  const id = "8b55e2d1-c8b7-4c68-a1db-6e5d98f2bc0a";
  assert.equal(parseChromeActionApproval("I approve ULTRON Chrome action " + id), id);
  assert.equal(parseChromeActionApproval("Please I approve ULTRON Chrome action " + id), "");
  assert.equal(parseChromeActionApproval("I approve ULTRON Chrome action " + id + " and then pay"), "");
  assert.equal(parseChromeActionApproval("I approve ULTRON Chrome action not-a-uuid"), "");
  assert.equal(parseChromeActionApproval(null), "");
});

test("consequential click is inspected and held until an exact owner approval", async () => {
  const calls = [];
  const fetchImpl = bridgeFetch({ calls });
  const challenge = await runChromeDevToolsAction({
    env, fetchImpl, userId: owner,
    input: { action: "click", selector: "button#pay-now" }
  });
  assert.equal(challenge.state, "approval_required");
  assert.equal(challenge.approvalRequired, true);
  assert.match(challenge.approvalPhrase, /^I approve ULTRON Chrome action [0-9a-f-]{36}$/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.action, "inspect_click");
  assert.equal(calls.some(call => call.action.action === "click"), false);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createAgentRouter({
    env,
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: owner }; next(); },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: challenge.approvalPhrase })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.model, "chrome-approval-flow");
    assert.equal(body.toolResults[0].ok, true);
    assert.match(body.content, /approved.*completed/i);
    const click = calls.find(call => call.action.action === "click");
    assert.ok(click);
    assert.equal(click.action.confirmExternalAction, true);
    assert.deepEqual(click.action.approvalFingerprint, {
      origin: "https://checkout.example.com",
      pageUrl: "https://checkout.example.com/order/confirm",
      selector: "button#pay-now",
      label: "Pay now",
      tag: "button",
      type: "submit",
      formActionOrigin: "https://checkout.example.com",
      highImpact: true,
      crossOriginForm: false
    });

    const countAfterSuccess = calls.length;
    const replay = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: challenge.approvalPhrase })
    });
    const replayBody = await replay.json();
    assert.equal(replayBody.toolResults[0].ok, false);
    assert.match(replayBody.content, /no matching pending browser approval/i);
    assert.equal(calls.length, countAfterSuccess, "replaying an approval phrase must not contact Chrome");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("request-level high-impact intent still requires approval when the target label looks harmless", async () => {
  const calls = [];
  const lowRiskInspection = inspection({
    label: "Continue",
    type: "button",
    highImpact: false,
    crossOriginForm: false,
    requiresConfirmation: false
  });
  const challenge = await runChromeDevToolsAction({
    env,
    userId: owner,
    fetchImpl: bridgeFetch({ calls, inspectionValue: lowRiskInspection }),
    input: { action: "click", selector: "button#continue" },
    forceApproval: true
  });
  assert.equal(challenge.state, "approval_required");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action.action, "inspect_click");

  const result = await approveChromeDevToolsAction({
    env,
    userId: owner,
    approvalId: challenge.approvalId,
    fetchImpl: bridgeFetch({ calls, inspectionValue: lowRiskInspection })
  });
  assert.equal(result.state, "completed");
  const click = calls.find(call => call.action.action === "click");
  assert.ok(click);
  assert.equal(click.action.confirmExternalAction, true);
  assert.equal(click.action.approvalFingerprint.highImpact, false);
});

test("approval is owner-bound and a changed page or element invalidates the challenge", async () => {
  const calls = [];
  const challenge = await runChromeDevToolsAction({
    env, userId: owner, calls,
    fetchImpl: bridgeFetch({ calls }),
    input: { action: "click", selector: "button#pay-now" }
  });
  assert.equal(challenge.state, "approval_required");

  const before = calls.length;
  const denied = await approveChromeDevToolsAction({
    env, userId: other, approvalId: challenge.approvalId,
    fetchImpl: bridgeFetch({ calls })
  });
  assert.equal(denied.code, "CHROME_DEVTOOLS_OWNER_ONLY");
  assert.equal(calls.length, before);

  const changedCalls = [];
  const changed = await approveChromeDevToolsAction({
    env, userId: owner, approvalId: challenge.approvalId,
    fetchImpl: bridgeFetch({ calls: changedCalls, inspectionValue: inspection({ label: "Continue" }) })
  });
  assert.equal(changed.state, "blocked");
  assert.equal(changed.code, "CHROME_APPROVAL_STALE");
  assert.equal(changedCalls.some(call => call.action.action === "click"), false);
});
