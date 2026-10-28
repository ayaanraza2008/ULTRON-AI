import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BASE_ENV = {
  NODE_ENV: "test",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-publishable-key"
};

async function withServer(fetchImpl, run, env = {}) {
  const app = createApp({
    env: { ...BASE_ENV, ...env },
    fetchImpl,
    logger: { info() {}, warn() {}, error() {} }
  });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function userResponse() {
  return new Response(JSON.stringify({ id: USER_ID }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function okBoolean(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
function emptyRows() {
  return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
}
const authCookie = "ultron_sb_access=access-token; ultron_sb_refresh=refresh-token";

test("protected data routes check the signed session against the session registry before reading data", async () => {
  const calls = [];
  await withServer(async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return userResponse();
    if (url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")) {
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer access-token");
      assert.equal(options.body, "{}");
      return okBoolean(true);
    }
    if (url.includes("/rest/v1/conversations?")) return emptyRows();
    throw new Error("Unexpected request: " + url);
  }, async base => {
    const response = await fetch(base + "/api/conversations", { headers: { Cookie: authCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).conversations, []);
    assert.equal(calls.filter(call => call.url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")).length, 1);
    assert.equal(calls.filter(call => call.url.includes("/rest/v1/conversations?")).length, 1);
  });
});

test("revoked sessions and unavailable session registry fail closed before user data reads", async () => {
  for (const rpcState of ["inactive", "unavailable"]) {
    const dataReads = [];
    await withServer(async url => {
      if (url.endsWith("/auth/v1/user")) return userResponse();
      if (url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")) {
        // Construct a fresh Response per request. Cloning a shared streamed
        // 503 Response leaves the original tee branch unconsumed and can hang
        // cancellation in the production fail-closed path.
        if (rpcState === "unavailable") {
          return new Response(JSON.stringify({ message: "RPC unavailable" }), { status: 503 });
        }
        return okBoolean(false);
      }
      if (url.includes("/rest/v1/conversations?")) {
        dataReads.push(url);
        return emptyRows();
      }
      throw new Error("Unexpected request: " + url);
    }, async base => {
      const response = await fetch(base + "/api/conversations", {
        headers: { Cookie: authCookie },
        signal: AbortSignal.timeout(5_000)
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "SUPABASE_AUTH_REQUIRED");
      assert.deepEqual(dataReads, []);
    });
  }
});

test("malformed or non-boolean session-registry responses fail closed before user data reads", async () => {
  const invalidResponses = [
    new Response("{not-json", { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify({ active: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify([true]), { status: 200, headers: { "Content-Type": "application/json" } })
  ];

  for (const invalidResponse of invalidResponses) {
    let dataReads = 0;
    await withServer(async url => {
      if (url.endsWith("/auth/v1/user")) return userResponse();
      if (url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")) return invalidResponse;
      if (url.includes("/rest/v1/conversations?")) {
        dataReads += 1;
        return emptyRows();
      }
      throw new Error("Unexpected request: " + url);
    }, async base => {
      const response = await fetch(base + "/api/conversations", {
        headers: { Cookie: authCookie },
        signal: AbortSignal.timeout(5_000)
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "SUPABASE_AUTH_REQUIRED");
      assert.equal(dataReads, 0, "invalid session-registry data must not reach protected database reads");
    });
  }
});

test("refreshed access tokens are checked before refreshed cookies or protected data are accepted", async () => {
  const seen = [];
  await withServer(async (url, options = {}) => {
    seen.push({ url, options });
    if (url.endsWith("/auth/v1/user")) return new Response("{}", { status: 401 });
    if (url.endsWith("/auth/v1/token?grant_type=refresh_token")) {
      assert.deepEqual(JSON.parse(options.body), { refresh_token: "refresh-token" });
      return new Response(JSON.stringify({
        access_token: "new-access-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        user: { id: USER_ID }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")) {
      assert.equal(options.headers.Authorization, "Bearer new-access-token");
      return okBoolean(true);
    }
    if (url.includes("/rest/v1/conversations?")) return emptyRows();
    throw new Error("Unexpected request: " + url);
  }, async base => {
    const response = await fetch(base + "/api/conversations", { headers: { Cookie: authCookie } });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).conversations, []);
    assert.ok((response.headers.get("set-cookie") || "").includes("new-access-token"));
    assert.equal(seen.filter(call => call.url.endsWith("/rest/v1/rpc/ultron_is_current_session_active")).length, 1);
  });
});

test("sign-out reports success only after Supabase confirms remote revocation", async () => {
  let logoutCalls = 0;
  await withServer(async (url, options = {}) => {
    if (url.endsWith("/auth/v1/logout?scope=local")) {
      logoutCalls += 1;
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer access-token");
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected request: " + url);
  }, async base => {
    const response = await fetch(base + "/api/auth/signout", {
      method: "POST",
      headers: { Cookie: authCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, sessionRevoked: true });
    assert.equal(logoutCalls, 1);
    assert.match(response.headers.get("set-cookie") || "", /ultron_sb_access=;/);
    assert.match(response.headers.get("set-cookie") || "", /ultron_sb_refresh=;/);
  });
});

test("sign-out retains cookies and reports failure when remote revocation is not confirmed", async () => {
  await withServer(async url => {
    if (url.endsWith("/auth/v1/logout?scope=local")) return new Response("{}", { status: 503 });
    throw new Error("Unexpected request: " + url);
  }, async base => {
    const response = await fetch(base + "/api/auth/signout", {
      method: "POST",
      headers: { Cookie: authCookie }
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "SIGNOUT_UNAVAILABLE");
    assert.doesNotMatch(response.headers.get("set-cookie") || "", /ultron_sb_access=;/);
    assert.doesNotMatch(response.headers.get("set-cookie") || "", /ultron_sb_refresh=;/);
  });
});

test("sign-out retries once with a refreshed access token when the old token expired", async () => {
  let logoutCalls = 0;
  await withServer(async (url, options = {}) => {
    if (url.endsWith("/auth/v1/logout?scope=local")) {
      logoutCalls += 1;
      if (logoutCalls === 1) return new Response("{}", { status: 401 });
      assert.equal(options.headers.Authorization, "Bearer refreshed-access-token");
      return new Response("{}", { status: 200 });
    }
    if (url.endsWith("/auth/v1/token?grant_type=refresh_token")) {
      return new Response(JSON.stringify({
        access_token: "refreshed-access-token",
        refresh_token: "refreshed-refresh-token",
        expires_in: 3600,
        user: { id: USER_ID }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected request: " + url);
  }, async base => {
    const response = await fetch(base + "/api/auth/signout", {
      method: "POST",
      headers: { Cookie: authCookie }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, sessionRevoked: true });
    assert.equal(logoutCalls, 2);
  });
});
