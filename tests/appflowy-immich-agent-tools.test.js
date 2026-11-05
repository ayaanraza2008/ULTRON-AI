import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createAgentRouter } from "../agent-runtime.js";
import { ImmichConnector } from "../integrations/immich.js";
import { parsePrivateDataReadApproval } from "../agent-runtime.js";

const ownerId = "00000000-0000-4000-8000-000000000001";

async function withServer(env, userId, fetchImpl, run) {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  app.use("/api", createAgentRouter({
    env: { ULTRON_INTEGRATION_OWNER_USER_ID: ownerId, ...env },
    fetchImpl,
    requireSupabaseUser: (req, _res, next) => { req.supabaseUser = { id: userId }; next(); },
    logger: { warn() {} }
  }));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run("http://127.0.0.1:" + server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("AppFlowy and Immich agent tools are visible only to the configured owner", async () => {
  const env = {
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: "appflowy-private-token",
    IMMICH_BASE_URL: "https://immich.example.com",
    IMMICH_API_KEY: "immich-private-key"
  };
  const noNetwork = async () => { throw new Error("tool catalog must not call upstream services"); };

  await withServer(env, ownerId, noNetwork, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const name of [
      "check_appflowy", "appflowy_list_workspaces", "appflowy_get_document",
      "immich_check_status", "immich_list_albums", "immich_search_assets"
    ]) {
      assert.equal(body.tools.find(item => item.name === name)?.available, true, name);
    }
    assert.equal(JSON.stringify(body).includes("appflowy-private-token"), false);
    assert.equal(JSON.stringify(body).includes("immich-private-key"), false);
  });

  await withServer(env, "different-user", noNetwork, async base => {
    const response = await fetch(base + "/api/agent/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    for (const name of [
      "check_appflowy", "appflowy_list_workspaces", "appflowy_get_document",
      "immich_check_status", "immich_list_albums", "immich_search_assets"
    ]) {
      assert.equal(body.tools.find(item => item.name === name)?.available, false, name);
    }
    assert.equal(JSON.stringify(body).includes("appflowy-private-token"), false);
    assert.equal(JSON.stringify(body).includes("immich-private-key"), false);
  });
});

test("private Immich search is blocked until an explicit approval and never calls upstream early", async () => {
  let providerCalls = 0;
  let immichCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    IMMICH_BASE_URL: "https://immich.example.com",
    IMMICH_API_KEY: "immich-private-key"
  };

  await withServer(env, ownerId, async (url, options = {}) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (providerCalls === 1) {
      assert.ok(payload.tools.some(tool => tool.function?.name === "immich_search_assets"));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "immich-private-search",
          type: "function",
          function: { name: "immich_search_assets", arguments: JSON.stringify({ query: "beach", limit: 5 }) }
        }] } }]
      }), { status: 200 });
    }
    const toolMessages = payload.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(result.approvalRequired, true);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "I need your approval before searching your private Immich library." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Search my Immich library for beach photos." })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults.length, 1);
    assert.equal(body.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(providerCalls, 2);
    assert.equal(immichCalls, 0);
  });
});

test("private-data consent requires an exact current-message attestation", () => {
  assert.equal(parsePrivateDataReadApproval(
    "I approve reading my Immich photo and video metadata for this request. Search for beach photos.",
    "immich"
  ), true);
  assert.equal(parsePrivateDataReadApproval(
    "Search my Immich library. I approve reading my Immich photo and video metadata for this request.",
    "immich"
  ), false);
  assert.equal(parsePrivateDataReadApproval(
    "I approve reading my AppFlowy workspace and documents for this request. Actually, cancel that.",
    "appflowy"
  ), false);
  assert.equal(parsePrivateDataReadApproval(
    "I approve reading my AppFlowy workspace and documents for this request.",
    "immich"
  ), false);
});

test("a prior private-data approval cannot authorize a later short confirmation", async () => {
  let providerCalls = 0;
  let immichCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    IMMICH_BASE_URL: "https://immich.example.com",
    IMMICH_API_KEY: "immich-private-key"
  };

  await withServer(env, ownerId, async (url, options = {}) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    const payload = JSON.parse(options.body);
    if (providerCalls === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "stale-approval-search",
          type: "function",
          function: { name: "immich_search_assets", arguments: JSON.stringify({ query: "beach", limit: 5 }) }
        }] } }]
      }), { status: 200 });
    }
    const toolMessages = payload.messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    const result = JSON.parse(toolMessages[0].content);
    assert.equal(result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(result.approvalRequired, true);
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Please repeat the approval phrase in your current message." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "yes",
        messages: [{ role: "user", content: "I approve reading my Immich photo and video metadata for this request." }]
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(immichCalls, 0);
    assert.equal(providerCalls, 2);
  });
});

test("explicit current-message approval allows only the requested owner-scoped Immich metadata search", async () => {
  let providerCalls = 0;
  let immichCalls = 0;
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    IMMICH_BASE_URL: "https://immich.example.com",
    IMMICH_API_KEY: "immich-private-key"
  };
  const prompt = "I approve reading my Immich photo and video metadata for this request. Search for beach photos.";

  await withServer(env, ownerId, async (url, options = {}) => {
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      providerCalls += 1;
      if (providerCalls === 1) {
        const payload = JSON.parse(options.body);
        assert.ok(payload.tools.some(tool => tool.function?.name === "immich_search_assets"));
        return new Response(JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [{
            id: "immich-approved-search",
            type: "function",
            function: { name: "immich_search_assets", arguments: JSON.stringify({ query: "beach", limit: 5 }) }
          }] } }]
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "Found one matching beach photo in your library." } }]
      }), { status: 200 });
    }

    assert.equal(url, "https://immich.example.com/api/search/metadata");
    immichCalls += 1;
    return new Response(JSON.stringify({ assets: { items: [
      { id: "asset-approved", type: "IMAGE", originalFileName: "beach.jpg", fileCreatedAt: "2026-03-01", originalPath: "/private/original.jpg" }
    ] } }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(providerCalls, 2);
    assert.equal(immichCalls, 1);
    assert.equal(body.toolResults.length, 1);
    assert.equal(body.toolResults[0].result.count, 1);
    assert.equal(body.toolResults[0].result.assets[0].originalFileName, "beach.jpg");
    assert.equal(JSON.stringify(body.toolResults).includes("/private/original.jpg"), false);
  });
});

test("Immich connector is owner-bound and returns only bounded metadata", async () => {
  const env = {
    ULTRON_INTEGRATION_OWNER_USER_ID: ownerId,
    IMMICH_BASE_URL: "https://immich.example.com",
    IMMICH_API_KEY: "immich-test-key"
  };
  const requests = [];
  const connector = new ImmichConnector({
    env,
    fetch: async (url, options = {}) => {
      requests.push({ url, options });
      if (url.endsWith("/api/server/version")) {
        return new Response(JSON.stringify({ major: 1, minor: 2, patch: 3 }), { status: 200 });
      }
      if (url.includes("/api/albums")) {
        return new Response(JSON.stringify([
          { id: "album-1", albumName: "Family", assetCount: 8, createdAt: "2026-01-01" },
          { id: "album-2", albumName: "Travel", assetCount: 12, createdAt: "2026-02-01" }
        ]), { status: 200 });
      }
      if (url.endsWith("/api/search/metadata")) {
        return new Response(JSON.stringify({ assets: { items: [
          { id: "asset-1", type: "IMAGE", originalFileName: "beach.jpg", fileCreatedAt: "2026-03-01", originalPath: "/private/original.jpg" }
        ] } }), { status: 200 });
      }
      throw new Error("Unexpected Immich URL: " + url);
    }
  });

  await assert.rejects(() => connector.listAlbums("different-user"), /owner|access denied/i);
  const status = await connector.checkServerStatus(ownerId);
  assert.equal(status.online, true);
  const albums = await connector.listAlbums(ownerId, { limit: 1 });
  assert.equal(albums.count, 1);
  assert.equal(albums.albums[0].albumName, "Family");
  const assets = await connector.searchAssets(ownerId, { query: "beach", limit: 5 });
  assert.equal(assets.count, 1);
  assert.equal(assets.assets[0].originalFileName, "beach.jpg");
  assert.equal(JSON.stringify(assets).includes("/private/original.jpg"), false);
  assert.ok(requests.every(item => item.options.headers["x-api-key"] === "immich-test-key"));
});


test("private AppFlowy document reads require exact current-message approval", async () => {
  const env = {
    OPENROUTER_API_KEY: "provider-test-secret",
    OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_DEFAULT_MODEL: "openrouter/free",
    APPFLOWY_BASE_URL: "https://appflowy.example.com",
    APPFLOWY_API_TOKEN: "appflowy-private-token"
  };
  let providerCalls = 0;
  let appflowyCalls = 0;

  await withServer(env, ownerId, async (url, options = {}) => {
    if (url === "https://appflowy.example.com/api/v1/document/doc-99") {
      appflowyCalls += 1;
      return new Response(JSON.stringify({ title: "Private note", content: "private body" }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      const payload = JSON.parse(options.body);
      assert.ok(payload.tools.some(tool => tool.function?.name === "appflowy_get_document"));
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "appflowy-private-document",
          type: "function",
          function: { name: "appflowy_get_document", arguments: JSON.stringify({ documentId: "doc-99" }) }
        }] } }]
      }), { status: 200 });
    }
    const toolMessages = JSON.parse(options.body).messages.filter(message => message.role === "tool");
    assert.equal(toolMessages.length, 1);
    assert.equal(JSON.parse(toolMessages[0].content).error.code, "AUTONOMY_APPROVAL_REQUIRED");
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "I need your explicit approval before reading that private AppFlowy document." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Read my AppFlowy document doc-99" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.error.code, "AUTONOMY_APPROVAL_REQUIRED");
    assert.equal(appflowyCalls, 0);
    assert.equal(providerCalls, 2);
  });

  providerCalls = 0;
  appflowyCalls = 0;
  const approvedPrompt = "I approve reading my AppFlowy workspace and documents for this request. Read document doc-99.";
  await withServer(env, ownerId, async (url, options = {}) => {
    if (url === "https://appflowy.example.com/api/v1/document/doc-99") {
      appflowyCalls += 1;
      return new Response(JSON.stringify({ title: "Private note", content: "private body" }), { status: 200 });
    }
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    providerCalls += 1;
    if (providerCalls === 1) {
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: null, tool_calls: [{
          id: "appflowy-approved-document",
          type: "function",
          function: { name: "appflowy_get_document", arguments: JSON.stringify({ documentId: "doc-99" }) }
        }] } }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Read the approved AppFlowy document." } }]
    }), { status: 200 });
  }, async base => {
    const response = await fetch(base + "/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: approvedPrompt })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolResults[0].result.success, true);
    assert.equal(body.toolResults[0].result.documentId, "doc-99");
    assert.equal(appflowyCalls, 1);
    assert.equal(providerCalls, 2);
    assert.equal(JSON.stringify(body).includes("appflowy-private-token"), false);
  });
});
