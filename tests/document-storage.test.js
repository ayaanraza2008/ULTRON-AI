import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import crypto from "node:crypto";
import { createApp } from "../server.js";

const OWNER = "123e4567-e89b-12d3-a456-426614174000";
const OTHER = "223e4567-e89b-12d3-a456-426614174000";
const DOCUMENT_ID = "323e4567-e89b-12d3-a456-426614174000";
const TOKEN = "test-user-access-token";
const ENV = {
  NODE_ENV: "test",
  APP_ACCESS_PASSWORD: "test-password",
  SESSION_SECRET: "a".repeat(48),
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_API_KEY: "test-openrouter-key",
  OPENROUTER_DEFAULT_MODEL: "test-model",
  OPENROUTER_TIMEOUT_SECONDS: "10",
  SUPABASE_URL: "https://ultron-test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test"
};
const bucketPath = "/storage/v1/object/ultron-private-documents/";

async function withServer(app, fn) {
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await fn("http://127.0.0.1:" + address.port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const cookie = "ultron_sb_access=" + TOKEN;
const authUser = () => new Response(JSON.stringify({ id: OWNER, email: "owner@example.test" }), {
  status: 200, headers: { "Content-Type": "application/json" }
});
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});

test("private document upload, list, integrity-checked download and delete are owner-scoped", async () => {
  const calls = [];
  const fileBytes = Buffer.from("ULTRON private text document\n");
  const fileBase64 = fileBytes.toString("base64");
  const sha256 = crypto.createHash("sha256").update(fileBytes).digest("hex");
  let storedBytes = null;
  let metadata = null;

  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    const method = options.method || "GET";
    calls.push({
      pathname: url.pathname, method, query: url.search,
      authorization: options.headers?.Authorization,
      apikey: options.headers?.apikey,
      body: options.body
    });
    if (url.pathname === "/auth/v1/user" && method === "GET") return authUser();

    if (url.pathname.startsWith(bucketPath)) {
      assert.match(url.pathname, new RegExp(bucketPath.replaceAll("/", "\\/") + OWNER + "\\/[0-9a-f-]+\\.txt$"));
      assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
      assert.equal(options.headers.apikey, "sb_publishable_test");
      if (method === "POST") {
        assert.equal(options.headers["Content-Type"], "text/plain");
        assert.equal(options.headers["x-upsert"], "false");
        storedBytes = Buffer.from(options.body);
        assert.deepEqual(storedBytes, fileBytes);
        return json({ Key: url.pathname.slice(bucketPath.length) }, 200);
      }
      if (method === "GET") {
        assert.ok(storedBytes);
        return new Response(storedBytes, { status: 200, headers: { "Content-Type": "text/plain" } });
      }
      if (method === "DELETE") {
        storedBytes = null;
        return json({ message: "deleted" }, 200);
      }
    }

    if (url.pathname === "/rest/v1/documents" && method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, "Bearer " + TOKEN);
      assert.equal(body.user_id, OWNER);
      assert.equal(body.filename, "notes.txt");
      assert.equal(body.mime_type, "text/plain");
      assert.equal(body.size_bytes, fileBytes.length);
      assert.equal(body.sha256, sha256);
      assert.match(body.storage_path, new RegExp("^" + OWNER + "/[0-9a-f-]+\\.txt$"));
      assert.equal(body.storage_path.includes("notes.txt"), false);
      metadata = { id: DOCUMENT_ID, ...body, created_at: "2026-10-27T18:00:00Z" };
      return json([metadata], 201);
    }

    if (url.pathname === "/rest/v1/documents" && method === "GET") {
      if (!metadata || url.searchParams.get("user_id") !== "eq." + OWNER) return json([]);
      return json([metadata]);
    }

    if (url.pathname === "/rest/v1/documents" && method === "DELETE") {
      if (metadata && url.searchParams.get("id") === "eq." + DOCUMENT_ID && url.searchParams.get("user_id") === "eq." + OWNER) metadata = null;
      return json([], 200);
    }
    throw new Error("Unexpected mocked upstream URL: " + method + " " + rawUrl);
  };

  await withServer(createApp({ env: ENV, fetchImpl, logger: { warn() {}, error() {} } }), async base => {
    const denied = await fetch(base + "/api/documents");
    assert.equal(denied.status, 401, "private document list requires Supabase authentication");

    const upload = await fetch(base + "/api/documents/upload", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "../../notes.txt", fileBase64 })
    });
    assert.equal(upload.status, 201);
    const uploaded = await upload.json();
    assert.equal(uploaded.document.id, DOCUMENT_ID);
    assert.equal(uploaded.document.filename, "notes.txt");

    const list = await fetch(base + "/api/documents", { headers: { Cookie: cookie } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).documents[0].filename, "notes.txt");

    const download = await fetch(base + "/api/documents/" + DOCUMENT_ID + "/download", { headers: { Cookie: cookie } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "text/plain");
    assert.equal(download.headers.get("content-disposition"), 'attachment; filename="notes.txt"');
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), fileBytes);

    const deleted = await fetch(base + "/api/documents/" + DOCUMENT_ID, {
      method: "DELETE", headers: { Cookie: cookie }
    });
    assert.equal(deleted.status, 200);
    assert.equal((await deleted.json()).ok, true);
    assert.equal(storedBytes, null);
    assert.equal(metadata, null);
    assert.equal(calls.filter(call => call.pathname.startsWith(bucketPath) && call.method === "POST").length, 1);
    assert.equal(calls.filter(call => call.pathname.startsWith(bucketPath) && call.method === "GET").length, 1);
    assert.equal(calls.filter(call => call.pathname.startsWith(bucketPath) && call.method === "DELETE").length, 1);
  });
});

test("private document storage rejects invalid formats and malformed signatures before any storage request", async () => {
  const storageCalls = [];
  const fetchImpl = async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    if (url.pathname === "/auth/v1/user") return authUser();
    if (url.pathname.startsWith(bucketPath)) storageCalls.push(url.pathname);
    throw new Error("invalid upload must not reach storage or database");
  };
  await withServer(createApp({ env: ENV, fetchImpl, logger: { warn() {}, error() {} } }), async base => {
    const unsupported = await fetch(base + "/api/documents/upload", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "program.exe", fileBase64: Buffer.from("hello").toString("base64") })
    });
    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json()).error.code, "UNSUPPORTED_DOCUMENT_FORMAT");

    const invalidPdf = await fetch(base + "/api/documents/upload", {
      method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "not-a-pdf.pdf", fileBase64: Buffer.from("not a pdf").toString("base64") })
    });
    assert.equal(invalidPdf.status, 400);
    assert.equal((await invalidPdf.json()).error.code, "INVALID_PDF");
    assert.deepEqual(storageCalls, []);
  });
});

test("document lookup never downloads another user's object", async () => {
  const storageCalls = [];
  const fetchImpl = async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname === "/auth/v1/user") return authUser();
    if (url.pathname === "/rest/v1/documents") return json([]);
    if (url.pathname.startsWith(bucketPath)) storageCalls.push(url.pathname);
    throw new Error("unexpected fetch " + rawUrl);
  };
  await withServer(createApp({ env: ENV, fetchImpl, logger: { warn() {}, error() {} } }), async base => {
    const response = await fetch(base + "/api/documents/" + DOCUMENT_ID + "/download", { headers: { Cookie: cookie } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, "DOCUMENT_NOT_FOUND");
    assert.deepEqual(storageCalls, []);
  });
});

test("document download rejects bytes that do not match stored size and SHA-256", async () => {
  const stored = Buffer.from("tampered bytes");
  const row = {
    id: DOCUMENT_ID, user_id: OWNER, filename: "notes.txt", mime_type: "text/plain",
    size_bytes: 7, sha256: crypto.createHash("sha256").update("original").digest("hex"),
    storage_path: OWNER + "/f0caa3c8-44a9-4fd3-ae17-9d6425a3b19c.txt"
  };
  const fetchImpl = async rawUrl => {
    const url = new URL(rawUrl);
    if (url.pathname === "/auth/v1/user") return authUser();
    if (url.pathname === "/rest/v1/documents") return json([row]);
    if (url.pathname.startsWith(bucketPath)) return new Response(stored, { status: 200 });
    throw new Error("unexpected fetch " + rawUrl);
  };
  await withServer(createApp({ env: ENV, fetchImpl, logger: { warn() {}, error() {} } }), async base => {
    const response = await fetch(base + "/api/documents/" + DOCUMENT_ID + "/download", { headers: { Cookie: cookie } });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, "DOCUMENT_INTEGRITY_CHECK_FAILED");
  });
});
