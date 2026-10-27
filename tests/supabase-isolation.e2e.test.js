import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { safePinnedFetch } from "../network-safety.js";

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
    // Do not include auth response bodies, which can contain sensitive details.
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
  if (primaryError) throw primaryError;
});
