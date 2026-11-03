import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { safePinnedFetch } from "../network-safety.js";
import { createApp } from "../server.js";

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
const MAX_RESPONSE_BYTES = 1_000_000;

async function readJson(response) {
  const declaredLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw new Error("Supabase E2E response exceeded the 1 MB safety limit.");
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error("Supabase E2E response did not expose a safely readable body.");
  }

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw new Error("Supabase E2E response exceeded the 1 MB safety limit.");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  try { return raw ? JSON.parse(raw) : null; }
  catch { throw new Error("Supabase E2E endpoint returned malformed JSON."); }
}

test("Supabase E2E JSON reader rejects oversized Content-Length before parsing", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("{}")); },
    cancel() { cancelled = true; }
  });
  const response = new Response(body, {
    headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) }
  });

  await assert.rejects(readJson(response), /exceeded the 1 MB safety limit/);
  assert.equal(cancelled, true);
});

test("Supabase E2E JSON reader enforces the byte limit while streaming", async () => {
  let cancelled = false;
  const oversizedChunk = new Uint8Array(MAX_RESPONSE_BYTES + 1);
  const body = new ReadableStream({
    start(controller) { controller.enqueue(oversizedChunk); },
    cancel() { cancelled = true; }
  });

  await assert.rejects(readJson(new Response(body)), /exceeded the 1 MB safety limit/);
  assert.equal(cancelled, true);
});

test("Supabase E2E JSON reader decodes valid JSON across chunks", async () => {
  const encoded = new TextEncoder().encode('{"ok":true,"text":"hello"}');
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, 8));
      controller.enqueue(encoded.slice(8));
      controller.close();
    }
  });
  assert.deepEqual(await readJson(new Response(body)), { ok: true, text: "hello" });
});

test("production server enforces two-user tenant isolation across authentication, routes, and identity binding", async () => {
  const userA = { id: "123e4567-e89b-12d3-a456-426614174001", email: "user-a@example.test" };
  const userB = { id: "123e4567-e89b-12d3-a456-426614174002", email: "user-b@example.test" };

  const db = {
    conversations: [
      { id: "c1111111-1111-1111-1111-111111111111", user_id: userA.id, title: "User A Convo", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" },
      { id: "c2222222-2222-2222-2222-222222222222", user_id: userB.id, title: "User B Convo", created_at: "2026-10-22T00:00:00Z", updated_at: "2026-10-22T00:00:00Z" }
    ],
    messages: [
      { id: "m1111111-1111-1111-1111-111111111111", conversation_id: "c1111111-1111-1111-1111-111111111111", user_id: userA.id, role: "user", content: "A message" }
    ]
  };

  const app = createApp({
    env: {
      NODE_ENV: "test",
      APP_ACCESS_PASSWORD: "test-secret-access-password",
      SUPABASE_URL: "https://ultron-test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
    },
    fetchImpl: async (url, options = {}) => {
      if (url === "https://ultron-test.supabase.co/auth/v1/user") {
        const auth = options.headers?.Authorization;
        if (auth === "Bearer token-a") return new Response(JSON.stringify(userA), { status: 200 });
        if (auth === "Bearer token-b") return new Response(JSON.stringify(userB), { status: 200 });
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401 });
      }
      if (url.startsWith("https://ultron-test.supabase.co/rest/v1/conversations")) {
        const u = new URL(url);
        const userIdFilter = u.searchParams.get("user_id");
        const idFilter = u.searchParams.get("id");
        if (options.method === "POST") {
          const body = JSON.parse(options.body);
          const newRow = { id: "c-new-" + Date.now(), user_id: body.user_id, title: body.title };
          db.conversations.push(newRow);
          return new Response(JSON.stringify([newRow]), { status: 201 });
        }
        let rows = db.conversations.slice();
        if (userIdFilter && userIdFilter.startsWith("eq.")) {
          const expectedUid = userIdFilter.slice(3);
          rows = rows.filter(r => r.user_id === expectedUid);
        }
        if (idFilter && idFilter.startsWith("eq.")) {
          const expectedId = idFilter.slice(3);
          rows = rows.filter(r => r.id === expectedId);
        }
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      if (url.startsWith("https://ultron-test.supabase.co/rest/v1/messages")) {
        return new Response(JSON.stringify(db.messages), { status: 200 });
      }
      throw new Error("Unexpected URL in test: " + url);
    },
    logger: { warn() {}, error() {} }
  });

  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    // 1. Unauthenticated requests are rejected with 401
    const unauth = await fetch(base + "/api/conversations");
    assert.equal(unauth.status, 401);
    const unauthBody = await unauth.json();
    assert.equal(unauthBody.error.code, "SUPABASE_AUTH_REQUIRED");

    // 2. User A can access User A's conversations
    const resA = await fetch(base + "/api/conversations", {
      headers: { Cookie: "ultron_sb_access=token-a" }
    });
    assert.equal(resA.status, 200);
    const convsA = (await resA.json()).conversations;
    assert.equal(convsA.length, 1);
    assert.equal(convsA[0].id, "c1111111-1111-1111-1111-111111111111");

    // 3. User B can access User B's conversations
    const resB = await fetch(base + "/api/conversations", {
      headers: { Cookie: "ultron_sb_access=token-b" }
    });
    assert.equal(resB.status, 200);
    const convsB = (await resB.json()).conversations;
    assert.equal(convsB.length, 1);
    assert.equal(convsB[0].id, "c2222222-2222-2222-2222-222222222222");

    // 4. User B cannot read User A's conversation messages (returns 404 because ownerRows check filters by user_id)
    const crossRead = await fetch(base + "/api/conversations/c1111111-1111-1111-1111-111111111111/messages", {
      headers: { Cookie: "ultron_sb_access=token-b" }
    });
    assert.equal(crossRead.status, 404);
    assert.equal((await crossRead.json()).error.code, "CONVERSATION_NOT_FOUND");

    // 5. Forged user_id in creation payload is ignored; server always binds the authenticated user_id
    const createForged = await fetch(base + "/api/conversations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: "ultron_sb_access=token-a"
      },
      body: JSON.stringify({ title: "Forged Conversation", user_id: userB.id })
    });
    assert.equal(createForged.status, 201);
    const createdConv = (await createForged.json()).conversation;
    assert.equal(createdConv.user_id, userA.id);
    assert.notEqual(createdConv.user_id, userB.id);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

async function request(url, { apiKey, accessToken, method = "GET", body, prefer } = {}) {
  const response = await safePinnedFetch(url, {
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
  if (!response.ok || typeof payload?.access_token !== "string" || typeof payload?.user?.id !== "string") {
    throw new Error(`Test user ${label} could not sign in (HTTP ${response.status}). Check test-account confirmation and credentials.`);
  }
  return { label, token: payload.access_token, userId: payload.user.id };
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

async function readRows(table, session, filters) {
  const { response, payload } = await request(tableUrl(table, { select: "id", ...filters }), {
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

  try {
    const [userA, userB] = await Promise.all([
      signIn("A", config.emailA, config.passwordA),
      signIn("B", config.emailB, config.passwordB)
    ]);
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

    assert.equal((await readRows("conversations", userA, { id: "eq." + conversationA.id })).length, 1);
    assert.equal((await readRows("messages", userA, { id: "eq." + messageA.id })).length, 1);
    assert.equal((await readRows("memory_items", userA, { id: "eq." + memoryA.id })).length, 1);

    assert.deepEqual(await readRows("conversations", userA, { id: "eq." + conversationB.id }), []);
    assert.deepEqual(await readRows("messages", userA, { id: "eq." + messageB.id }), []);
    assert.deepEqual(await readRows("memory_items", userA, { id: "eq." + memoryB.id }), []);

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
  for (const record of [...created].reverse()) {
    try { await deleteRecord(record); }
    catch { cleanupFailures.push(record.table + ":" + record.id); }
  }

  if (cleanupFailures.length) {
    throw new Error("Supabase E2E cleanup failed for " + cleanupFailures.length + " temporary record(s); inspect the dedicated test accounts before rerunning.");
  }
  if (primaryError) throw primaryError;
});
