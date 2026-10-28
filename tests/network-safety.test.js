import test from "node:test";
import assert from "node:assert/strict";
import { createPinnedDnsLookup, isPublicNetworkHost, safePinnedFetch, safeServiceBase } from "../network-safety.js";
import { createServer } from "node:http";
import { Readable } from "node:stream";

test("public network host validator rejects private, local, metadata, and transition hosts", () => {
  for (const host of [
    "localhost", "printer.local", "service.internal", "metadata.google.internal", "service.example",
    "127.1", "0177.0.0.1", "0x7f.0.0.1", "2130706433",
    "10.0.0.1", "127.0.0.1", "169.254.169.254", "192.168.1.1", "192.0.0.9", "192.0.2.10", "172.20.0.2",
    "::1", "[::1]", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
    "2001:db8::1", "2001:0db8::1", "2001::1", "2001:1::1", "2001:100::1", "2001:1ff::1", "2001:2::1", "2001:10::1", "2001:20::1", "2002:7f00:1::1",
    "3fff::1", "192.88.99.1", "192.88.99.254"
  ]) assert.equal(isPublicNetworkHost(host), false, host);
  for (const host of ["openrouter.ai", "api.example.com", "8.8.8.8", "192.0.1.1", "192.0.255.1", "2606:4700:4700::1111", "2001:200::1"]) {
    assert.equal(isPublicNetworkHost(host), true, host);
  }
});

test("service URL validator accepts HTTPS public services and local HTTP development only", () => {
  assert.equal(safeServiceBase("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(safeServiceBase("http://localhost:11434/"), "http://localhost:11434");
  assert.equal(safeServiceBase("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  assert.equal(safeServiceBase("http://[::1]:8787"), "http://[::1]:8787");
  for (const url of [
    "http://api.example.com", "https://169.254.169.254/metadata",
    "https://192.168.1.10", "https://10.0.0.3", "https://metadata.google.internal",
    "https://printer.local", "https://[::1]", "https://[fd00::1]", "ftp://api.example.com",
    "https://user:password@api.example.com", "https://api.example.com?token=secret",
    "https://api.example.com#fragment", "https://single-label",
    "https://127.1", "https://0177.0.0.1", "https://0x7f.0.0.1", "https://2130706433",
    "https://192.88.99.1", "https://[2001::1]", "https://[2001:1::1]", "https://[2001:100::1]", "https://[2001:1ff::1]", "https://[2001:2::1]", "https://[2001:10::1]", "https://[2001:20::1]", "https://[3fff::1]"
  ]) assert.equal(safeServiceBase(url), null, url);
});


function mockIncomingResponse(statusCode = 200, body = "pinned response", headers = { "content-type": "text/plain" }) {
  const incoming = Readable.from([Buffer.from(body)]);
  incoming.statusCode = statusCode;
  incoming.statusMessage = statusCode === 200 ? "OK" : "Redirect";
  incoming.headers = headers;
  return incoming;
}

function mockClientRequest(onResponse, incoming) {
  const listeners = new Map();
  return {
    on(event, handler) {
      listeners.set(event, handler);
      return this;
    },
    end() {
      queueMicrotask(() => onResponse(incoming));
    },
    destroy(error) {
      if (error) listeners.get("error")?.(error);
      return this;
    }
  };
}

test("pinned DNS lookup returns only the address already validated for the expected host", async () => {
  const lookup = createPinnedDnsLookup([
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 }
  ], "api.example.com");

  const result = await new Promise((resolve, reject) => {
    lookup("api.example.com", { family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      resolve({ address, family });
    });
  });
  assert.deepEqual(result, { address: "93.184.216.34", family: 4 });

  await assert.rejects(
    () => new Promise((resolve, reject) => lookup("attacker.example", {}, error => error ? reject(error) : resolve())),
    error => error.code === "DNS_PIN_HOST_MISMATCH"
  );
});

test("safePinnedFetch pins validated public DNS answers into the actual HTTPS connection", async () => {
  let connection;
  const response = await safePinnedFetch("https://api.example.com/v1/status", {}, {
    lookupImpl: async hostname => {
      assert.equal(hostname, "api.example.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    httpsRequestImpl: (url, options, onResponse) => {
      connection = { url: url.toString(), options };
      return mockClientRequest(onResponse, mockIncomingResponse(200, "pinned response"));
    }
  });

  assert.equal(await response.text(), "pinned response");
  assert.equal(connection.url, "https://api.example.com/v1/status");
  assert.equal(connection.options.servername, "api.example.com");
  assert.equal(connection.options.headers["accept-encoding"], "identity");
  const address = await new Promise((resolve, reject) => {
    connection.options.lookup("api.example.com", { family: 4 }, (error, selected, family) => {
      if (error) return reject(error);
      resolve({ address: selected, family });
    });
  });
  assert.deepEqual(address, { address: "93.184.216.34", family: 4 });
});

test("safePinnedFetch rejects mixed public/private DNS answers before opening a connection", async () => {
  let connected = false;
  await assert.rejects(
    () => safePinnedFetch("https://rebind.example.com/secret", {}, {
      lookupImpl: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 }
      ],
      httpsRequestImpl: () => { connected = true; throw new Error("transport must not be called"); }
    }),
    error => error.code === "DNS_TARGET_NOT_PUBLIC"
  );
  assert.equal(connected, false);
});

test("safePinnedFetch blocks remote HTTP and redirects instead of following to an unvalidated target", async () => {
  let requests = 0;
  await assert.rejects(
    () => safePinnedFetch("http://api.example.com/data", {}, {
      lookupImpl: async () => { throw new Error("DNS must not run for remote HTTP"); },
      httpRequestImpl: () => { requests += 1; throw new Error("transport must not run"); }
    }),
    error => error.code === "OUTBOUND_PROTOCOL_BLOCKED"
  );
  assert.equal(requests, 0);

  await assert.rejects(
    () => safePinnedFetch("https://api.example.com/redirect", {}, {
      lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
      httpsRequestImpl: (_url, _options, onResponse) => mockClientRequest(
        onResponse,
        mockIncomingResponse(302, "", { location: "http://127.0.0.1:8080/admin" })
      )
    }),
    error => error.code === "OUTBOUND_REDIRECT_BLOCKED"
  );
});

test("safePinnedFetch streams local HTTP development request and response bodies", async () => {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("echo:" + Buffer.concat(chunks).toString("utf8"));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    const response = await safePinnedFetch("http://127.0.0.1:" + address.port + "/echo", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hello"
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "echo:hello");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


test("safePinnedFetch aborts before DNS when its signal is already cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let lookupCalls = 0;
  await assert.rejects(
    () => safePinnedFetch("https://api.example.com/status", { signal: controller.signal }, {
      lookupImpl: async () => { lookupCalls += 1; return [{ address: "93.184.216.34", family: 4 }]; },
      httpsRequestImpl: () => { throw new Error("transport must not run"); }
    }),
    error => error?.name === "AbortError"
  );
  assert.equal(lookupCalls, 0);
});

test("safePinnedFetch times out a resolver that never completes", async () => {
  let connections = 0;
  await assert.rejects(
    () => safePinnedFetch("https://slow-dns.example.com/status", {}, {
      dnsTimeoutMs: 10,
      lookupImpl: () => new Promise(() => {}),
      httpsRequestImpl: () => {
        connections += 1;
        throw new Error("transport must not run after DNS timeout");
      }
    }),
    error => error?.code === "DNS_LOOKUP_TIMEOUT"
  );
  assert.equal(connections, 0);
});

test("safePinnedFetch aborts promptly while DNS resolution is still pending", async () => {
  const controller = new AbortController();
  let finishLookup;
  let markLookupStarted;
  const lookupStarted = new Promise(resolve => { markLookupStarted = resolve; });
  const lookupPending = new Promise(resolve => { finishLookup = resolve; });
  const pending = safePinnedFetch("https://slow-dns.example.com/status", { signal: controller.signal }, {
    lookupImpl: () => {
      markLookupStarted();
      return lookupPending;
    },
    httpsRequestImpl: () => { throw new Error("transport must not run"); }
  });
  await lookupStarted;
  controller.abort();
  await assert.rejects(pending, error => error?.name === "AbortError");
  // Resolve the injected DNS promise after cancellation to prove it is safely
  // observed and cannot restart the outbound request.
  finishLookup([{ address: "93.184.216.34", family: 4 }]);
});
