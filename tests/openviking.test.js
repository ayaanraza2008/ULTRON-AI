import test from "node:test";
import assert from "node:assert/strict";
import { findOpenVikingContext, getOpenVikingReadiness, isOpenVikingUri, readOpenVikingContext } from "../integrations/openviking.js";

const ownerId = "00000000-0000-4000-8000-000000000001";
const env = {
  OPENVIKING_BASE_URL: "https://openviking.example/openviking",
  OPENVIKING_API_TOKEN: "synthetic-openviking-secret",
  ULTRON_INTEGRATION_OWNER_USER_ID: ownerId
};

test("OpenViking readiness never exposes credentials and requires owner guard", () => {
  const result = getOpenVikingReadiness({ env: { OPENVIKING_BASE_URL: env.OPENVIKING_BASE_URL, OPENVIKING_API_TOKEN: env.OPENVIKING_API_TOKEN }, userId: ownerId });
  assert.equal(result.state, "blocked_owner_guard");
  assert.equal(JSON.stringify(result).includes(env.OPENVIKING_API_TOKEN), false);
  assert.equal(getOpenVikingReadiness({ env, userId: ownerId }).state, "configured_unverified");
  assert.equal(getOpenVikingReadiness({ env, userId: "another-user" }).state, "owner_only");
});

test("OpenViking URI validator is restricted to the authenticated user's home scope", () => {
  assert.equal(isOpenVikingUri("viking://~/"), true);
  assert.equal(isOpenVikingUri("viking://~/memories/preferences.md"), true);
  assert.equal(isOpenVikingUri("viking://~/resources/project/docs"), true);
  assert.equal(isOpenVikingUri("viking://resources/shared"), false);
  assert.equal(isOpenVikingUri("viking://~/resources/../other-user"), false);
  assert.equal(isOpenVikingUri("viking://~/resources/%2e%2e/other-user"), false);
  assert.equal(isOpenVikingUri("viking://~/resources/auth?token=x"), false);
});

test("OpenViking find is read-only, owner-scoped, and returns bounded normalized context", async () => {
  let request;
  const result = await findOpenVikingContext({
    env, userId: ownerId, query: "OAuth authentication", limit: 2,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ status: "ok", result: {
        total: 3, resources: [
          { uri: "viking://~/resources/oauth.md", context_type: "resource", level: 2, abstract: "OAuth reference", score: 0.9 },
          { uri: "viking://resources/shared-secret.md", abstract: "Must be ignored" },
          { uri: "viking://~/resources/login.md", abstract: "Login flow" }
        ],
        memories: [{ uri: "viking://~/memories/preference.md", abstract: "Not returned above the cap" }]
      }}), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.count, 2);
  assert.equal(result.total, 3);
  assert.deepEqual(result.contexts.map(context => context.uri), [
    "viking://~/memories/preference.md",
    "viking://~/resources/oauth.md"
  ]);
  assert.equal(request.url, "https://openviking.example/openviking/api/v1/search/find");
  assert.equal(request.options.headers["X-API-Key"], env.OPENVIKING_API_TOKEN);
  assert.deepEqual(JSON.parse(request.options.body), { query: "OAuth authentication", limit: 2, target_uri: "viking://~/", read_content: false });
  assert.equal(request.options.method, "POST");
});

test("OpenViking blocks other users before making any upstream request", async () => {
  let called = false;
  const result = await findOpenVikingContext({ env, userId: "other-user", query: "private memory", fetchImpl: async () => { called = true; } });
  assert.equal(result.state, "blocked");
  assert.equal(result.error.code, "INTEGRATION_OWNER_ONLY");
  assert.equal(called, false);
});

test("OpenViking read allows only validated home URIs and reads bounded content", async () => {
  let requestUrl;
  const result = await readOpenVikingContext({
    env, userId: ownerId, uri: "viking://~/resources/readme.md",
    fetchImpl: async url => {
      requestUrl = url;
      return new Response(JSON.stringify({ status: "ok", result: { content: "Verified context" } }), { status: 200 });
    }
  });
  assert.equal(result.state, "completed");
  assert.equal(result.content, "Verified context");
  assert.match(requestUrl, /\/api\/v1\/content\/read\?uri=/);
  let called = false;
  const blocked = await readOpenVikingContext({ env, userId: ownerId, uri: "viking://resources/private.md", fetchImpl: async () => { called = true; } });
  assert.equal(blocked.error.code, "OPENVIKING_URI_INVALID");
  assert.equal(called, false);
});

test("OpenViking upstream errors are sanitized and credentials never enter returned JSON", async () => {
  const result = await findOpenVikingContext({
    env, userId: ownerId, query: "private memory",
    fetchImpl: async () => new Response(JSON.stringify({ error: "secret echoed " + env.OPENVIKING_API_TOKEN }), { status: 401 })
  });
  assert.equal(result.state, "failed");
  assert.equal(result.error.code, "OPENVIKING_UPSTREAM_UNAVAILABLE");
  assert.equal(JSON.stringify(result).includes(env.OPENVIKING_API_TOKEN), false);
  assert.equal(JSON.stringify(result).includes("secret echoed"), false);
});

test("OpenViking rejects insecure, private-IP, and HTTPS metadata endpoints before calling upstream", async () => {
  const unsafeUrls = [
    "http://metadata.google.internal/latest/meta-data",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.10/openviking",
    "https://10.0.0.8/openviking",
    "https://metadata.google.internal/openviking",
    "https://openviking.local/openviking"
  ];
  for (const url of unsafeUrls) {
    let called = false;
    const result = await findOpenVikingContext({
      env: { ...env, OPENVIKING_BASE_URL: url },
      userId: ownerId, query: "memory", fetchImpl: async () => { called = true; }
    });
    assert.equal(result.error.code, "OPENVIKING_NOT_CONFIGURED", url);
    assert.equal(called, false, url);
  }
  let localCalled = false;
  const local = await findOpenVikingContext({
    env: { ...env, OPENVIKING_BASE_URL: "http://127.0.0.1:8100" },
    userId: ownerId, query: "memory", fetchImpl: async () => {
      localCalled = true;
      return new Response(JSON.stringify({ result: { resources: [] } }), { status: 200 });
    }
  });
  assert.equal(local.state, "completed");
  assert.equal(localCalled, true);
});


test("OpenViking rejects newly covered reserved and private endpoints without network access", async () => {
  for (const url of [
    "https://192.88.99.1/openviking",
    "https://192.168.1.10/openviking",
    "https://169.254.169.254/openviking",
    "https://[2001:2::1]/openviking",
    "https://[3fff::1]/openviking"
  ]) {
    let called = false;
    const settings = { ...env, OPENVIKING_BASE_URL: url };
    assert.equal(getOpenVikingReadiness({ env: settings, userId: ownerId }).configured, false, url);
    const result = await findOpenVikingContext({
      env: settings, userId: ownerId, query: "memory",
      fetchImpl: async () => { called = true; throw new Error("Unsafe URL must not be contacted."); }
    });
    assert.equal(result.error.code, "OPENVIKING_NOT_CONFIGURED", url);
    assert.equal(called, false, url);
  }
});
