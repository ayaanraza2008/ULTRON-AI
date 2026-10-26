import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createSafeOutboundFetch, createConfiguredOutboundFetch, isPublicDestinationAddress } from "../safe-outbound-fetch.js";

const publicAddress = { address: "93.184.216.34", family: 4 };

function response(body = "ok", status = 200, headers = {}) {
  return new Response(body, { status, headers });
}

test("public destination IP classifier rejects local, reserved, transition, multicast, and mapped ranges", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "100.127.255.254", "127.0.0.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.254", "192.0.0.8", "192.0.2.1",
    "192.88.99.1", "192.168.1.1", "198.18.0.1", "198.19.255.254",
    "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "2001:0000::1", "2001:db8::1",
    "2002:0808:0808::1", "3fff:0000::1", "64:ff9b::808:808"
  ]) assert.equal(isPublicDestinationAddress(address), false, address);

  for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPublicDestinationAddress(address), true, address);
  }
});

test("outbound transport rejects unsafe URLs and unsupported ports before DNS or connection", async () => {
  let dnsCalls = 0;
  let connectionCalls = 0;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => { dnsCalls += 1; return [publicAddress]; },
    requestImpl: async () => { connectionCalls += 1; return response(); }
  });
  for (const url of [
    "http://example.com", "ftp://example.com", "https://user:password@example.com",
    "https://127.0.0.1", "https://10.0.0.1", "https://169.254.169.254/latest/meta-data",
    "https://[::1]", "https://[fd00::1]", "https://[::ffff:127.0.0.1]",
    "https://example.com:4443", "https://localhost", "https://metadata.google.internal",
    "https://example..com", "not a URL"
  ]) {
    await assert.rejects(safeFetch(url), error => String(error.code || "").startsWith("OUTBOUND_"), url);
  }
  assert.equal(dnsCalls, 0);
  assert.equal(connectionCalls, 0);
});

test("public HTTPS requests pin one validated public A/AAAA answer into the connection", async () => {
  let lookupCalls = 0;
  let requestOptions;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async host => {
      lookupCalls += 1;
      assert.equal(host, "api.example.com");
      return [publicAddress, { address: "2606:4700:4700::1111", family: 6 }];
    },
    requestImpl: async options => { requestOptions = options; return response('{"ok":true}'); }
  });
  const result = await safeFetch("https://api.example.com/v1/chat", {
    method: "POST",
    headers: { Authorization: "Bearer test-value", "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "hello" }),
    redirect: "error"
  });
  assert.equal(await result.text(), '{"ok":true}');
  assert.equal(lookupCalls, 1);
  assert.equal(requestOptions.address, publicAddress.address);
  assert.equal(requestOptions.family, 4);
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers.get("authorization"), "Bearer test-value");
  assert.equal(requestOptions.headers.get("host"), null);
  assert.equal(requestOptions.headers.get("content-length"), null);
  assert.ok(Buffer.isBuffer(requestOptions.body));
  assert.equal(requestOptions.body.toString(), '{"prompt":"hello"}');
});

test("mixed public/private DNS answers fail closed before any socket connection", async () => {
  let connected = false;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress, { address: "10.0.0.2", family: 4 }],
    requestImpl: async () => { connected = true; return response(); }
  });
  await assert.rejects(safeFetch("https://mixed.ultron-public.com.com"), { code: "OUTBOUND_ADDRESS_BLOCKED" });
  assert.equal(connected, false);
});

test("DNS rebinding between validation and connect cannot replace the pinned address", async () => {
  let lookupCalls = 0;
  const connectedAddresses = [];
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => {
      lookupCalls += 1;
      return lookupCalls === 1 ? [publicAddress] : [{ address: "127.0.0.1", family: 4 }];
    },
    requestImpl: async options => { connectedAddresses.push(options.address); return response(); }
  });
  const result = await safeFetch("https://rebind.ultron-public.com.com/resource");
  assert.equal(result.status, 200);
  assert.equal(lookupCalls, 1, "the transport must not perform a second DNS lookup");
  assert.deepEqual(connectedAddresses, [publicAddress.address]);
});

test("redirects to loopback/private addresses are rejected without a second request", async () => {
  let requests = 0;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress],
    requestImpl: async () => {
      requests += 1;
      return response(null, 302, { location: "https://127.0.0.1/admin" });
    }
  });
  await assert.rejects(safeFetch("https://public.ultron-public.com.com/start"), { code: "OUTBOUND_ADDRESS_BLOCKED" });
  assert.equal(requests, 1);
});

test("each public redirect is resolved anew and credentials are stripped across origins", async () => {
  const resolutions = [];
  const requests = [];
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async host => {
      resolutions.push(host);
      return [{ address: host === "first.ultron-public.com.com" ? "93.184.216.34" : "8.8.8.8", family: 4 }];
    },
    requestImpl: async options => {
      requests.push(options);
      if (requests.length === 1) return response(null, 302, { location: "https://second.ultron-public.com.com/final" });
      return response("finished");
    }
  });
  const result = await safeFetch("https://first.ultron-public.com.com/start", {
    headers: {
      Authorization: "Bearer do-not-forward",
      "X-API-Key": "do-not-forward",
      "X-ULTRON-BROWSER-TOKEN": "do-not-forward",
      Accept: "application/json"
    }
  });
  assert.equal(await result.text(), "finished");
  assert.deepEqual(resolutions, ["first.ultron-public.com.com", "second.ultron-public.com.com"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers.get("authorization"), null);
  assert.equal(requests[1].headers.get("x-api-key"), null);
  assert.equal(requests[1].headers.get("x-ultron-browser-token"), null);
  assert.equal(requests[1].headers.get("accept"), "application/json");
  assert.equal(requests[1].address, "8.8.8.8");
});

test("FormData requests are bounded and encoded before the pinned transport", async () => {
  let captured;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress],
    requestImpl: async options => { captured = options; return response("ok"); }
  });
  const form = new FormData();
  form.append("language", "hi");
  form.append("file", new Blob(["small audio"], { type: "audio/wav" }), "sample.wav");
  const result = await safeFetch("https://audio.ultron-public.com.com/upload", { method: "POST", body: form });
  assert.equal(await result.text(), "ok");
  assert.match(captured.headers.get("content-type"), /^multipart\/form-data; boundary=/);
  assert.match(captured.body.toString(), /name="language"/);
  assert.match(captured.body.toString(), /sample\.wav/);
});

test("explicit loopback HTTP is limited to local adapters and remains response-size bounded", async t => {
  const server = createServer((_req, res) => {
    res.write("123");
    res.write("456");
    res.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const address = server.address();
  const safeFetch = createSafeOutboundFetch({ maxResponseBytes: 5 });
  const url = "http://127.0.0.1:" + address.port + "/";
  await assert.rejects(
    safeFetch(url, { ultronAllowLoopbackHttp: true }),
    { code: "OUTBOUND_SCHEME_BLOCKED" }
  );
  const configuredFetch = createConfiguredOutboundFetch({
    env: { LOCAL_BRIDGE_URL: url },
    baseUrlEnvNames: ["LOCAL_BRIDGE_URL"],
    fetchImpl: safeFetch
  });
  const responseResult = await configuredFetch(url);
  await assert.rejects(responseResult.text(), error => error.code === "OUTBOUND_RESPONSE_TOO_LARGE");
});

test("DNS failures and HTTP redirects cannot fall back to global fetch or a second transport", async () => {
  let calls = 0;
  const failedDns = createSafeOutboundFetch({
    lookupImpl: async () => { throw new Error("private resolver detail"); },
    requestImpl: async () => { calls += 1; return response(); }
  });
  await assert.rejects(failedDns("https://dns-failure.ultron-public.com.com"), { code: "OUTBOUND_DNS_FAILED" });
  assert.equal(calls, 0);

  const redirectError = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress],
    requestImpl: async () => { calls += 1; return response(null, 302, { location: "https://second.ultron-public.com.com/" }); }
  });
  await assert.rejects(redirectError("https://first.ultron-public.com.com/", { redirect: "error" }), { code: "OUTBOUND_REDIRECT_BLOCKED" });
  assert.equal(calls, 1);
});


test("configured local HTTP origin is opt-in and cannot authorize arbitrary loopback URLs", async () => {
  const calls = [];
  const rawFetch = async (url, options = {}) => {
    calls.push({ url: String(url), allow: options.ultronAllowLoopbackHttp === true });
    return response("ok");
  };
  const configuredFetch = createConfiguredOutboundFetch({
    env: { VOICESTUDIO_BASE_URL: "http://127.0.0.1:8787/api" },
    baseUrlEnvNames: ["VOICESTUDIO_BASE_URL"],
    fetchImpl: rawFetch
  });
  await configuredFetch("http://127.0.0.1:8787/api/voices");
  await configuredFetch("http://127.0.0.1:9090/admin");
  await configuredFetch("http://localhost:8787/private");
  await configuredFetch("https://api.example.com/v1");
  assert.deepEqual(calls.map(item => item.allow), [true, false, false, false]);
});

test("configured model registry loopback URLs are allowed only when the exact origin is configured", async () => {
  const calls = [];
  const configuredFetch = createConfiguredOutboundFetch({
    env: {
      ULTRON_MODEL_PROVIDERS_JSON: JSON.stringify([
        { name: "local-dev", baseUrl: "http://localhost:11434/v1", apiKeyEnv: "LOCAL_KEY", model: "test" }
      ])
    },
    includeModelProviderRegistry: true,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), allowed: options.ultronAllowLoopbackHttp === true });
      return response("ok");
    }
  });
  await configuredFetch("http://localhost:11434/v1/chat/completions");
  await configuredFetch("http://localhost:11435/v1/chat/completions");
  assert.deepEqual(calls.map(item => item.allowed), [true, false]);
});


test("bad URL percent escapes are rejected before DNS", async () => {
  let dnsCalls = 0;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => { dnsCalls += 1; return [publicAddress]; },
    requestImpl: async () => response()
  });
  await assert.rejects(safeFetch("https://public.ultron-public.com.com/%ZZ"), { code: "OUTBOUND_URL_INVALID" });
  assert.equal(dnsCalls, 0);
});


test("oversized outbound request bodies fail before DNS resolution", async () => {
  let dnsCalls = 0;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => { dnsCalls += 1; return [publicAddress]; },
    requestImpl: async () => response()
  });
  await assert.rejects(safeFetch("https://public.ultron-public.com.com/upload", {
    method: "POST",
    body: "123456",
    ultronMaxRequestBytes: 5
  }), { code: "OUTBOUND_REQUEST_TOO_LARGE" });
  assert.equal(dnsCalls, 0);
});

test("pre-aborted outbound requests fail without DNS or connection attempts", async () => {
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  let calls = 0;
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => { calls += 1; return [publicAddress]; },
    requestImpl: async () => { calls += 1; return response(); }
  });
  await assert.rejects(safeFetch("https://public.ultron-public.com.com/", { signal: controller.signal }), { code: "OUTBOUND_ABORTED" });
  assert.equal(calls, 0);
});

test("upstream compressed responses are rejected instead of bypassing response bounds", async () => {
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress],
    requestImpl: async () => response("not really gzip", 200, { "content-encoding": "gzip" })
  });
  await assert.rejects(safeFetch("https://public.ultron-public.com.com/", { redirect: "error" }), { code: "OUTBOUND_COMPRESSION_UNSUPPORTED" });
});


test("a private capability survives trusted wrappers without allowing a caller-set boolean", async t => {
  const server = createServer((_req, res) => res.end("ok"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const safeFetch = createSafeOutboundFetch();
  const inner = createConfiguredOutboundFetch({
    env: { OLLAMA_BASE_URL: url },
    baseUrlEnvNames: ["OLLAMA_BASE_URL"],
    fetchImpl: safeFetch
  });
  const outer = createConfiguredOutboundFetch({
    env: {},
    baseUrlEnvNames: [],
    fetchImpl: inner
  });
  const result = await outer(url);
  assert.equal(await result.text(), "ok");
  await assert.rejects(safeFetch(url, { ultronAllowLoopbackHttp: true }), { code: "OUTBOUND_SCHEME_BLOCKED" });
});
