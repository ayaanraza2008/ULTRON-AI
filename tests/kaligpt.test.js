import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createFeatureRouter } from "../features.js";

async function withServer(env, fetchImpl, run, extras = {}) {
  const app = express();
  app.use(express.json());
  const requireSession = (_req, _res, next) => next();
  const requireSupabaseUser = (req, _res, next) => { req.supabaseUser = { id: "00000000-0000-4000-8000-000000000001" }; next(); };
  app.use("/api", createFeatureRouter({ env, fetchImpl, requireSession, requireSupabaseUser, supabaseRest: extras.supabaseRest || (async () => []), logger: { warn() {} } }));
  const server = await new Promise(resolve => { const instance = app.listen(0, "127.0.0.1", () => resolve(instance)); });
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test("KaliGPT capability manifest reports provider readiness without exposing keys", async () => {
  await withServer({ OPENROUTER_API_KEY: "secret-test-key", OLLAMA_BASE_URL: "http://localhost:11434" }, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/capabilities");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.openrouter, true);
    assert.equal(body.providers.localOllama, true);
    assert.equal(body.providers.gemini, false);
    assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
    assert.equal(body.mode, "human-reviewed");
  });
});

test("security assistant fails closed when provider key is missing", async () => {
  let called = false;
  await withServer({}, async () => { called = true; throw new Error("network must not be called"); }, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Explain security headers", mode: "defensive-review" })
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "SECURITY_PROVIDER_NOT_CONFIGURED");
    assert.equal(called, false);
  });
});

test("security assistant returns guidance and explicitly marks commands unexecuted", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ model: "openrouter/free", choices: [{ message: { content: "Review headers manually and document evidence." } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ OPENROUTER_API_KEY: "secret-test-key", OPENROUTER_DEFAULT_MODEL: "openrouter/free" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review security headers", target: "example.com", mode: "defensive-review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.execution, "not_executed");
    assert.equal(body.approvalRequiredForExecution, true);
    assert.match(body.notice, /No commands were run/i);
    assert.match(requestBody.messages[0].content, /Do not execute commands/i);
    assert.equal(JSON.stringify(body).includes("secret-test-key"), false);
  });
});


test("security assistant routes to the explicitly selected Gemini provider", async () => {
  let requestedUrl = "";
  let requestBody;
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Check CSP and HSTS." }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ GEMINI_API_KEY: "gemini-test-secret", GEMINI_DEFAULT_MODEL: "gemini-2.5-flash" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Review headers", provider: "gemini", mode: "defensive-review" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "gemini");
    assert.equal(body.answer, "Check CSP and HSTS.");
    assert.match(requestedUrl, /generativelanguage\.googleapis\.com/);
    assert.equal(requestBody.contents[0].role, "user");
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("gemini-test-secret"), false);
  });
});


test("auto mode falls back to Gemini when OpenRouter returns an error", async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(String(url));
    if (String(url).includes("openrouter.ai")) {
      return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Fallback answer." }] } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await withServer({ OPENROUTER_API_KEY: "or-test-secret", GEMINI_API_KEY: "gemini-test-secret" }, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/assist", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "Explain HSTS", provider: "auto" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "gemini");
    assert.equal(body.fallbackUsed, true);
    assert.equal(seen.length, 2);
    assert.equal(body.execution, "not_executed");
    assert.equal(JSON.stringify(body).includes("test-secret"), false);
  });
});


test("passive HTTP header analyzer reports missing headers without contacting target", async () => {
  let fetchCalls = 0;
  await withServer({}, async () => { fetchCalls++; throw new Error("network must not be called"); }, async base => {
    const response = await fetch(base + "/api/kaligpt/tools/headers/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers: { "content-type": "text/html", "x-content-type-options": "nosniff" } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tool, "http-security-headers");
    assert.equal(body.execution, "local-analysis-only");
    assert.equal(body.findings.find(item => item.id === "x-content-type-options").status, "present-review-value");
    assert.equal(body.findings.find(item => item.id === "content-security-policy").status, "missing");
    assert.equal(fetchCalls, 0);
  });
});

test("passive HTTP header analyzer rejects missing header input", async () => {
  await withServer({}, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/tools/headers/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({})
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "HTTP_HEADERS_REQUIRED");
  });
});


test("desktop diagnostic record is saved as a review-only task", async () => {
  const calls = [];
  const supabaseRest = async (_req, table, method, query, body) => {
    calls.push({ table, method, query, body });
    if (table === "agent_tasks" && method === "POST") return [{ id: "00000000-0000-4000-8000-000000000099", title: body.title, input: body.input, status: body.status, created_at: "2026-10-22T00:00:00.000Z" }];
    return [];
  };
  await withServer({}, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/tools/diagnostics/record", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostic: "kernelVersion", result: "6.12.1" })
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.task.status, "WAITING_FOR_PERMISSION");
    assert.equal(body.task.input.executionMode, "record_only");
    assert.equal(body.task.input.result, "6.12.1");
    assert.match(body.notice, /did not run any local command/);
    assert.equal(calls[0].table, "agent_tasks");
    assert.equal(calls[0].body.input.approved, false);
    assert.equal(calls[1].table, "audit_events");
  }, { supabaseRest });
});

test("desktop diagnostic record rejects arbitrary diagnostic IDs", async () => {
  await withServer({}, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/tools/diagnostics/record", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ diagnostic: "runShell", result: "rm -rf /" })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "DIAGNOSTIC_NOT_ALLOWED");
  });
});


test("tool registry distinguishes implemented tools from blocked and unimplemented tools", async () => {
  await withServer({}, globalThis.fetch, async base => {
    const response = await fetch(base + "/api/kaligpt/tools");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.tools.find(tool => tool.id === "dns-evidence-review").state, "available");
    assert.equal(body.tools.find(tool => tool.id === "network-scanning").state, "not-implemented");
    assert.equal(body.tools.find(tool => tool.id === "arbitrary-shell").state, "blocked_by_design");
  });
});

test("DNS evidence review identifies submitted SPF and DMARC records without network calls", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("DNS evidence review must not make network calls"); };
  await withServer({}, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/dns-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "example.com", records: [
        { type: "TXT", name: "example.com", value: "v=spf1 -all" },
        { type: "TXT", name: "_dmarc.example.com", value: "v=DMARC1; p=reject; rua=mailto:dmarc@example.com" }
      ] })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.recordsAnalyzed, 2);
    assert.ok(body.findings.some(item => item.id === "spf-observed"));
    assert.ok(body.findings.some(item => item.id === "dmarc-observed" && item.severity === "info"));
    assert.match(body.notice, /no DNS lookup/);
    assert.equal(calls, 0);
  });
});

test("DNS evidence review rejects malformed domains and oversized record sets", async () => {
  await withServer({}, globalThis.fetch, async base => {
    const badDomain = await fetch(base + "/api/kaligpt/security/dns-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "https://example.com", records: [] })
    });
    assert.equal(badDomain.status, 400);
    assert.equal((await badDomain.json()).error.code, "INVALID_DNS_DOMAIN");
    const tooMany = await fetch(base + "/api/kaligpt/security/dns-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: "example.com", records: Array(101).fill({ type: "TXT", name: "example.com", value: "x" }) })
    });
    assert.equal(tooMany.status, 400);
    assert.equal((await tooMany.json()).error.code, "INVALID_DNS_RECORDS");
  });
});


test("HTTP response evidence analyzer checks cookie flags and security banners without network calls", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("passive analysis must not make network calls"); };
  await withServer({}, fetchImpl, async base => {
    const response = await fetch(base + "/api/kaligpt/security/http-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        statusCode: 500,
        headers: {
          "strict-transport-security": "includeSubDomains",
          "content-security-policy": "default-src *; script-src 'unsafe-inline'",
          "server": "ExampleServer/1.2",
          "x-powered-by": "ExampleFramework"
        },
        setCookie: ["session=abc; Path=/"]
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.findings.some(item => item.id === "server-error"));
    assert.ok(body.findings.some(item => item.id === "hsts-max-age"));
    assert.ok(body.findings.some(item => item.id === "csp-permissive"));
    assert.ok(body.findings.some(item => item.id === "server-banner"));
    assert.deepEqual(body.cookieFindings[0].missingFlags, ["Secure", "HttpOnly", "SameSite"]);
    assert.equal(body.execution, "local-analysis-only");
    assert.equal(calls, 0);
  });
});

test("HTTP response evidence analyzer validates status, header shape and cookie bounds", async () => {
  await withServer({}, globalThis.fetch, async base => {
    const invalidStatus = await fetch(base + "/api/kaligpt/security/http-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusCode: 99, headers: {} })
    });
    assert.equal(invalidStatus.status, 400);
    assert.equal((await invalidStatus.json()).error.code, "INVALID_HTTP_STATUS");
    const invalidCookies = await fetch(base + "/api/kaligpt/security/http-evidence/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusCode: 200, headers: {}, setCookie: Array(51).fill("a=b") })
    });
    assert.equal(invalidCookies.status, 400);
    assert.equal((await invalidCookies.json()).error.code, "INVALID_COOKIE_EVIDENCE");
  });
});
