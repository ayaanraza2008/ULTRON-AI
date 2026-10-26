import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createSafeOutboundFetch, isPublicDestinationAddress } from "../safe-outbound-fetch.js";

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
  await assert.rejects(safeFetch("https://mixed.example"), { code: "OUTBOUND_ADDRESS_BLOCKED" });
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
  const result = await safeFetch("https://rebind.example/resource");
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
  await assert.rejects(safeFetch("https://public.example/start"), { code: "OUTBOUND_HOST_BLOCKED" });
  assert.equal(requests, 1);
});

test("each public redirect is resolved anew and credentials are stripped across origins", async () => {
  const resolutions = [];
  const requests = [];
  const safeFetch = createSafeOutboundFetch({
    lookupImpl: async host => {
      resolutions.push(host);
      return [{ address: host === "first.example" ? "93.184.216.34" : "8.8.8.8", family: 4 }];
    },
    requestImpl: async options => {
      requests.push(options);
      if (requests.length === 1) return response(null, 302, { location: "https://second.example/final" });
      return response("finished");
    }
  });
  const result = await safeFetch("https://first.example/start", {
    headers: {
      Authorization: "Bearer do-not-forward",
      "X-API-Key": "do-not-forward",
      "X-ULTRON-BROWSER-TOKEN": "do-not-forward",
      Accept: "application/json"
    }
  });
  assert.equal(await result.text(), "finished");
  assert.deepEqual(resolutions, ["first.example", "second.example"]);
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
  const result = await safeFetch("https://audio.example/upload", { method: "POST", body: form });
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
  const responseResult = await safeFetch("http://127.0.0.1:" + address.port + "/", {
    ultronAllowLoopbackHttp: true
  });
  await assert.rejects(responseResult.text(), error => error.code === "OUTBOUND_RESPONSE_TOO_LARGE");
});

test("DNS failures and HTTP redirects cannot fall back to global fetch or a second transport", async () => {
  let calls = 0;
  const failedDns = createSafeOutboundFetch({
    lookupImpl: async () => { throw new Error("private resolver detail"); },
    requestImpl: async () => { calls += 1; return response(); }
  });
  await assert.rejects(failedDns("https://dns-failure.example"), { code: "OUTBOUND_DNS_FAILED" });
  assert.equal(calls, 0);

  const redirectError = createSafeOutboundFetch({
    lookupImpl: async () => [publicAddress],
    requestImpl: async () => { calls += 1; return response(null, 302, { location: "https://second.example/" }); }
  });
  await assert.rejects(redirectError("https://first.example/", { redirect: "error" }), { code: "OUTBOUND_REDIRECT_BLOCKED" });
  assert.equal(calls, 1);
});
