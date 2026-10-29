import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const REMINDER_ID = "40000000-0000-4000-8000-000000000001";

async function withServer(run, supabaseRest) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createFeatureRouter({
    env: {},
    requireSession: (_req, _res, next) => next(),
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: USER_ID }; next(); },
    supabaseRest,
    privilegedSupabaseRest: supabaseRest,
    fetchImpl: globalThis.fetch,
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("reminder API creates future ISO-timestamp reminders under the authenticated owner", async () => {
  const dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let calls = 0;
  await withServer(async base => {
    const response = await fetch(base + "/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Call dentist", body: "Ask about the appointment", dueAt })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.reminder.id, REMINDER_ID);
    assert.equal(body.reminder.user_id, USER_ID);
    assert.equal(body.reminder.status, "scheduled");
    assert.equal(body.reminder.due_at, dueAt);
  }, async (_req, table, method, query, body) => {
    calls++;
    assert.equal(table, "user_reminders");
    assert.equal(method, "POST");
    assert.equal(query, "");
    assert.equal(body.user_id, USER_ID, "owner must be supplied from the authenticated session");
    assert.equal(body.due_at, dueAt);
    assert.equal(body.status, "scheduled");
    return [{ ...body, id: REMINDER_ID, created_at: dueAt, updated_at: dueAt }];
  });
  assert.equal(calls, 1);
});

test("reminder API rejects relative, timezone-free, past and oversized due times before database access", async () => {
  let calls = 0;
  const futureLocalNoZone = "2030-01-01T12:00:00";
  await withServer(async base => {
    for (const dueAt of [
      "tomorrow at five",
      futureLocalNoZone,
      new Date(Date.now() - 60 * 1000).toISOString()
    ]) {
      const response = await fetch(base + "/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unsafe time", dueAt })
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, "INVALID_REMINDER_DUE_AT");
    }
    const oversized = await fetch(base + "/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(201), dueAt: new Date(Date.now() + 3600000).toISOString() })
    });
    assert.equal(oversized.status, 400);
    assert.equal((await oversized.json()).error.code, "INVALID_REMINDER_TITLE");
  }, async () => {
    calls++;
    return [];
  });
  assert.equal(calls, 0);
});

test("reminder API list/read/update/delete explicitly scope every query to the authenticated user", async () => {
  const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const calls = [];
  const row = { id: REMINDER_ID, user_id: USER_ID, title: "Call dentist", body: "", due_at: dueAt, status: "scheduled" };
  await withServer(async base => {
    const list = await fetch(base + "/api/reminders?status=scheduled&limit=999");
    assert.equal(list.status, 200);
    assert.equal((await list.json()).reminders[0].id, REMINDER_ID);

    const detail = await fetch(base + "/api/reminders/" + REMINDER_ID);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).reminder.title, "Call dentist");

    const update = await fetch(base + "/api/reminders/" + REMINDER_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" })
    });
    assert.equal(update.status, 200);
    assert.equal((await update.json()).reminder.status, "completed");

    const deletion = await fetch(base + "/api/reminders/" + REMINDER_ID, { method: "DELETE" });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { deleted: true, id: REMINDER_ID });
  }, async (_req, table, method, query, body) => {
    calls.push({ table, method, query, body });
    assert.equal(table, "user_reminders");
    assert.ok(query.includes("user_id=eq." + USER_ID), "every reminder query must be owner filtered");
    if (method === "PATCH") return [{ ...row, ...body, status: body.status || row.status }];
    if (method === "DELETE") return [row];
    return [row];
  });
  assert.equal(calls.length, 4);
  assert.ok(calls[0].query.endsWith("&limit=50"));
  assert.ok(calls[1].query.includes("id=eq." + REMINDER_ID));
  assert.equal(calls[2].method, "PATCH");
  assert.equal(calls[3].method, "DELETE");
});

test("reminder API requires an explicit due time when rescheduling", async () => {
  let calls = 0;
  await withServer(async base => {
    const response = await fetch(base + "/api/reminders/" + REMINDER_ID, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "scheduled" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "REMINDER_RESCHEDULE_REQUIRED");
  }, async () => { calls++; return []; });
  assert.equal(calls, 0);
});
