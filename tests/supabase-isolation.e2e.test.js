import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { safeFetch } from "../outbound-transport.js";

const EXPECTED_PROJECT_REF = "opdjfhwepmcprbqojpat";
const CONFIRM_WRITES_VALUE = "CONFIRM_ULTRON_E2E_WRITES";
const TIMEOUT_MS = 10_000;

function readConfig(env = process.env) {
  const config = {
    url: String(env.ULTRON_E2E_SUPABASE_URL || "").trim(),
    projectRef: String(env.ULTRON_E2E_SUPABASE_PROJECT_REF || "").trim(),
    publishableKey: String(env.ULTRON_E2E_SUPABASE_PUBLISHABLE_KEY || "").trim(),
    emailA: String(env.ULTRON_E2E_USER_A_EMAIL || "").trim(),
    passwordA: String(env.ULTRON_E2E_USER_A_PASSWORD || ""),
    emailB: String(env.ULTRON_E2E_USER_B_EMAIL || "").trim(),
    passwordB: String(env.ULTRON_E2E_USER_B_PASSWORD || "")
  };
  const explicitlyConfirmed = env.ULTRON_E2E_ALLOW_WRITES === CONFIRM_WRITES_VALUE;
  let urlMatchesExpectedProject = false;
  try {
    const url = new URL(config.url);
    urlMatchesExpectedProject = url.protocol === "https:" &&
      url.hostname === EXPECTED_PROJECT_REF + ".supabase.co" &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {}
  const ready = explicitlyConfirmed &&
    config.projectRef === EXPECTED_PROJECT_REF &&
    urlMatchesExpectedProject &&
    Boolean(config.publishableKey && config.emailA && config.passwordA && config.emailB && config.passwordB);
  return { ...config, ready };
}

const config = readConfig();

async function readJson(response) {
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > 1_000_000) {
    throw new Error("Supabase E2E response exceeded the 1 MB safety limit.");
  }
  try { return raw ? JSON.parse(raw) : null; }
  catch { throw new Error("Supabase E2E endpoint returned malformed JSON."); }
}

async function request(url, { apiKey, accessToken, method = "GET", body, prefer } = {}) {
  const response = await safeFetch(url, {
    method,
    headers: {
      apikey: apiKey,
      ...(accessToken ? { Authorization: "Bearer " + accessToken } : {}),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(prefer ? { Prefer: prefer } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  const payload = response.status === 204 ? null : await readJson(response);
  return { response, payload };
}

async function signIn(label, email, password) {
  const endpoint = new URL("/auth/v1/token", config.url);
  endpoint.searchParams.set("grant_type", "password");
  const { response, payload } = await request(endpoint, {
    apiKey: config.publishableKey,
    method: "POST",
    body: { email, password }
  });
  if (!response.ok || typeof payload?.access_token !== "string" ||
      typeof payload?.refresh_token !== "string" || typeof payload?.user?.id !== "string") {
    // Do not include auth response bodies, which can contain sensitive details.
    throw new Error(`Test user ${label} could not sign in (HTTP ${response.status}). Check test-account confirmation and credentials.`);
  }
  return {
    label,
    token: payload.access_token,
    refreshToken: payload.refresh_token,
    userId: payload.user.id
  };
}

function tableUrl(table, params = {}) {
  const url = new URL("/rest/v1/" + table, config.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function insertRecord(table, session, values) {
  const { response, payload } = await request(tableUrl(table, { select: "id" }), {
    apiKey: config.publishableKey,
    accessToken: session.token,
    method: "POST",
    body: values,
    prefer: "return=representation"
  });
  if (!response.ok || !Array.isArray(payload) || typeof payload[0]?.id !== "string") {
    throw new Error(`Could not create temporary ${table} test record (HTTP ${response.status}). Check the live schema and RLS policy.`);
  }
  return { table, id: payload[0].id, owner: session };
}

async function readRows(table, session, filters, selectColumn = "id") {
  const { response, payload } = await request(tableUrl(table, { select: selectColumn, ...filters }), {
    apiKey: config.publishableKey,
    accessToken: session.token
  });
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error(`Could not verify account-scoped ${table} visibility (HTTP ${response.status}).`);
  }
  return payload;
}

async function deleteRecord(record) {
  const endpoint = tableUrl(record.table, { id: "eq." + record.id });
  const { response } = await request(endpoint, {
    apiKey: config.publishableKey,
    accessToken: record.owner.token,
    method: "DELETE",
    prefer: "return=minimal"
  });
  if (!response.ok) throw new Error("Cleanup request failed with HTTP " + response.status + ".");
}

test("live Supabase auth, conversation, message, and memory access is isolated between two users", {
  skip: config.ready ? false : "Set the explicit ULTRON E2E write-confirmation flag, expected project ref, publishable key, and two dedicated test accounts to run live database writes."
}, async () => {
  const nonce = randomUUID();
  const created = [];
  let primaryError = null;
  let testSessions = [];

  try {
    const [userA, userB] = await Promise.all([
      signIn("A", config.emailA, config.passwordA),
      signIn("B", config.emailB, config.passwordB)
    ]);
    testSessions = [userA, userB];
    assert.notEqual(userA.userId, userB.userId, "E2E test accounts must be distinct users.");

    const conversationA = await insertRecord("conversations", userA, {
      user_id: userA.userId,
      title: "ULTRON E2E isolation A " + nonce
    });
    created.push(conversationA);

    const conversationB = await insertRecord("conversations", userB, {
      user_id: userB.userId,
      title: "ULTRON E2E isolation B " + nonce
    });
    created.push(conversationB);

    const messageA = await insertRecord("messages", userA, {
      user_id: userA.userId,
      conversation_id: conversationA.id,
      role: "user",
      content: "ULTRON E2E isolation probe A " + nonce
    });
    created.push(messageA);

    const messageB = await insertRecord("messages", userB, {
      user_id: userB.userId,
      conversation_id: conversationB.id,
      role: "user",
      content: "ULTRON E2E isolation probe B " + nonce
    });
    created.push(messageB);

    const memoryA = await insertRecord("memory_items", userA, {
      user_id: userA.userId,
      kind: "preference",
      title: "ULTRON E2E memory A " + nonce,
      content: "Temporary account isolation probe " + nonce,
      source: "user_approved",
      is_active: true,
      metadata: { e2e: true }
    });
    created.push(memoryA);

    const memoryB = await insertRecord("memory_items", userB, {
      user_id: userB.userId,
      kind: "preference",
      title: "ULTRON E2E memory B " + nonce,
      content: "Temporary account isolation probe " + nonce,
      source: "user_approved",
      is_active: true,
      metadata: { e2e: true }
    });
    created.push(memoryB);

    // Use BLOCKED test tasks so no live worker can pick up or execute them.
    const taskA = await insertRecord("agent_tasks", userA, {
      user_id: userA.userId,
      title: "ULTRON E2E isolation A " + nonce,
      input: { source: "isolated_e2e", testOnly: true },
      status: "BLOCKED"
    });
    created.push(taskA);

    const taskB = await insertRecord("agent_tasks", userB, {
      user_id: userB.userId,
      title: "ULTRON E2E isolation B " + nonce,
      input: { source: "isolated_e2e", testOnly: true },
      status: "BLOCKED"
    });
    created.push(taskB);

    // Disabled schedules are temporary ownership probes and cannot run during E2E.
    const scheduleA = await insertRecord("employee_schedules", userA, {
      user_id: userA.userId,
      role_id: "seo-aeo",
      routine_id: "ultron-isolation-test",
      goal: "Temporary ULTRON E2E isolation probe " + nonce,
      context: "Test only; no external actions",
      interval_minutes: 1440,
      enabled: false
    });
    created.push(scheduleA);

    const scheduleB = await insertRecord("employee_schedules", userB, {
      user_id: userB.userId,
      role_id: "seo-aeo",
      routine_id: "ultron-isolation-test",
      goal: "Temporary ULTRON E2E isolation probe " + nonce,
      context: "Test only; no external actions",
      interval_minutes: 1440,
      enabled: false
    });
    created.push(scheduleB);

    assert.equal((await readRows("conversations", userA, { id: "eq." + conversationA.id })).length, 1);
    assert.equal((await readRows("messages", userA, { id: "eq." + messageA.id })).length, 1);
    assert.equal((await readRows("memory_items", userA, { id: "eq." + memoryA.id })).length, 1);
    assert.equal((await readRows("agent_tasks", userA, { id: "eq." + taskA.id })).length, 1);
    assert.equal((await readRows("employee_schedules", userA, { id: "eq." + scheduleA.id })).length, 1);

    assert.deepEqual(await readRows("conversations", userA, { id: "eq." + conversationB.id }), []);
    assert.deepEqual(await readRows("messages", userA, { id: "eq." + messageB.id }), []);
    assert.deepEqual(await readRows("memory_items", userA, { id: "eq." + memoryB.id }), []);
    assert.deepEqual(await readRows("agent_tasks", userA, { id: "eq." + taskB.id }), []);
    assert.deepEqual(await readRows("employee_schedules", userA, { id: "eq." + scheduleB.id }), []);

    // Preferences and audit records use different access patterns; verify neither
    // permits a user to enumerate the other account's records.
    assert.deepEqual(await readRows("user_preferences", userA, { user_id: "eq." + userB.userId }, "user_id"), []);
    assert.deepEqual(await readRows("audit_events", userA, { user_id: "eq." + userB.userId }), []);

    // Anonymous and invalid-token requests must not enumerate user-owned rows.
    for (const [table, selectColumn] of [
      ["conversations", "id"],
      ["messages", "id"],
      ["memory_items", "id"],
      ["agent_tasks", "id"],
      ["employee_schedules", "id"],
      ["user_preferences", "user_id"],
      ["audit_events", "id"]
    ]) {
      const endpoint = tableUrl(table, { select: selectColumn, limit: "1" });
      const anonymous = await request(endpoint, { apiKey: config.publishableKey });
      assert.equal(anonymous.response.ok, false, "anonymous access to " + table + " must be denied");

      const invalidToken = await request(endpoint, {
        apiKey: config.publishableKey,
        accessToken: "invalid.jwt.token"
      });
      assert.equal(invalidToken.response.ok, false, "invalid-token access to " + table + " must be denied");
    }

    // PostgREST/RLS commonly returns an empty representation for mutations that
    // matched no visible rows. Assert both cross-account updates and deletes have
    // no effect, rather than requiring one particular HTTP error status.
    async function assertForeignMutationDenied(table, rowId, method, body) {
      const result = await request(tableUrl(table, { select: "id", id: "eq." + rowId }), {
        apiKey: config.publishableKey,
        accessToken: userA.token,
        method,
        ...(body === undefined ? {} : { body }),
        prefer: "return=representation"
      });
      assert.equal(result.response.ok, true, "RLS should safely return zero changed rows for " + method + " " + table);
      assert.deepEqual(result.payload, [], "user A must not mutate user B's " + table + " row");
    }

    await assertForeignMutationDenied("conversations", conversationB.id, "PATCH", {
      title: "FORBIDDEN ULTRON E2E change " + nonce
    });
    await assertForeignMutationDenied("conversations", conversationB.id, "DELETE");
    await assertForeignMutationDenied("messages", messageB.id, "PATCH", {
      content: "FORBIDDEN ULTRON E2E change " + nonce
    });
    await assertForeignMutationDenied("messages", messageB.id, "DELETE");
    await assertForeignMutationDenied("memory_items", memoryB.id, "PATCH", {
      content: "FORBIDDEN ULTRON E2E change " + nonce
    });
    await assertForeignMutationDenied("memory_items", memoryB.id, "DELETE");
    await assertForeignMutationDenied("agent_tasks", taskB.id, "PATCH", {
      title: "FORBIDDEN ULTRON E2E change " + nonce
    });
    await assertForeignMutationDenied("agent_tasks", taskB.id, "DELETE");
    await assertForeignMutationDenied("employee_schedules", scheduleB.id, "PATCH", {
      goal: "FORBIDDEN ULTRON E2E change " + nonce
    });
    await assertForeignMutationDenied("employee_schedules", scheduleB.id, "DELETE");

    // Preferences are keyed by user_id rather than an id column.
    const foreignPreferencePatch = await request(tableUrl("user_preferences", {
      select: "user_id",
      user_id: "eq." + userB.userId
    }), {
      apiKey: config.publishableKey,
      accessToken: userA.token,
      method: "PATCH",
      body: { language: "hi" },
      prefer: "return=representation"
    });
    if (!foreignPreferencePatch.response.ok) {
      assert.ok([401, 403, 404].includes(foreignPreferencePatch.response.status));
    } else {
      assert.deepEqual(foreignPreferencePatch.payload, [], "user A must not change user B's preferences");
    }

    // A valid authenticated identity must not be able to create a row owned by B.
    const forged = await request(tableUrl("conversations", { select: "id" }), {
      apiKey: config.publishableKey,
      accessToken: userA.token,
      method: "POST",
      body: { user_id: userB.userId, title: "ULTRON E2E forged owner " + nonce },
      prefer: "return=representation"
    });
    if (forged.response.ok && Array.isArray(forged.payload)) {
      for (const row of forged.payload) {
        if (typeof row?.id === "string") created.push({ table: "conversations", id: row.id, owner: userB });
      }
    }
    assert.equal(forged.response.ok, false, "RLS must reject a user_id that does not match the authenticated identity.");
  } catch (error) {
    primaryError = error;
  }

  const cleanupFailures = [];
  // Delete individual memory rows, then conversations (which cascade to messages).
  for (const record of [...created].reverse()) {
    try { await deleteRecord(record); }
    catch { cleanupFailures.push(record.table + ":" + record.id); }
  }

  if (cleanupFailures.length) {
    throw new Error("Supabase E2E cleanup failed for " + cleanupFailures.length + " temporary record(s); inspect the dedicated test accounts before rerunning.");
  }

  // Revoke each disposable test session after all temporary rows have been cleaned.
  // A fresh refresh attempt must not be accepted after the Auth logout succeeds.
  const sessionRevocationFailures = [];
  for (const session of testSessions) {
    try {
      const logout = await request(new URL("/auth/v1/logout", config.url), {
        apiKey: config.publishableKey,
        accessToken: session.token,
        method: "POST"
      });
      if (!logout.response.ok) {
        throw new Error("Sign-out returned HTTP " + logout.response.status + ".");
      }

      const refreshEndpoint = new URL("/auth/v1/token", config.url);
      refreshEndpoint.searchParams.set("grant_type", "refresh_token");
      const refreshed = await request(refreshEndpoint, {
        apiKey: config.publishableKey,
        method: "POST",
        body: { refresh_token: session.refreshToken }
      });
      if (refreshed.response.ok) {
        throw new Error("Supabase accepted a refresh token after sign-out.");
      }
    } catch {
      sessionRevocationFailures.push(session.label);
    }
  }

  if (primaryError) throw primaryError;
  if (sessionRevocationFailures.length) {
    throw new Error("Could not verify sign-out/refresh-token revocation for disposable test session(s): " + sessionRevocationFailures.join(", ") + ".");
  }
});
