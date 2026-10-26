import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createSafeFetch } from "../outbound-transport.js";

function fakeRequest(status = 200, headers = ["content-type", "application/json"], onWrite = () => {}) {
  const seen = { calls: 0, options: null, pinnedAddress: null, writtenBytes: 0 };
  const request = (url, options, callback) => {
    seen.calls += 1;
    seen.options = options;
    const req = new EventEmitter();
    req.write = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      seen.writtenBytes += bytes.byteLength;
      onWrite(bytes);
      return true;
    };
    req.destroy = error => {
      if (error) req.emit("error", error);
    };
    req.end = () => {
      options.lookup(url.hostname.replace(/^\[|\]$/g, ""), {}, (error, address, family) => {
        if (error) {
          req.emit("error", error);
          return;
        }
        seen.pinnedAddress = { address, family };
        const response = new Readable({
          read() {
            this.push(status === 200 ? "{\"ok\":true}" : "");
            this.push(null);
          }
        });
        response.statusCode = status;
        response.statusMessage = status === 200 ? "OK" : "Found";
        response.rawHeaders = status === 200 ? headers : [...headers, "location", "https://attacker.example/"];
        callback(response);
      });
    };
    return req;
  };
  return { request, seen };
}

test("safeFetch pins the HTTPS connection to the address it validated", async () => {
  const fake = fakeRequest();
  const fetch = createSafeFetch({
    lookupImpl: async host => {
      assert.equal(host, "api.example.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    httpsRequest: fake.request
  });
  const response = await fetch("https://api.example.com/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer test", "content-length": "999999" },
    body: "{\"test\":true}"
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(fake.seen.pinnedAddress, { address: "93.184.216.34", family: 4 });
  assert.equal(fake.seen.options.headers.host, "api.example.com");
  assert.equal(fake.seen.options.headers["content-length"], String(Buffer.byteLength("{\"test\":true}")));
});

test("safeFetch blocks private DNS answers before making an upstream request", async () => {
  const fake = fakeRequest();
  let lookupCalled = false;
  const fetch = createSafeFetch({
    lookupImpl: async () => {
      lookupCalled = true;
      return [{ address: "127.0.0.1", family: 4 }];
    },
    httpsRequest: fake.request
  });
  await assert.rejects(fetch("https://attacker.example.com/secret"), error => error.code === "UNSAFE_OUTBOUND_TARGET");
  assert.equal(lookupCalled, true);
  assert.equal(fake.seen.calls, 0);
});

test("safeFetch blocks mixed public/private DNS answers rather than selecting a public answer", async () => {
  const fake = fakeRequest();
  let lookupCalled = false;
  const fetch = createSafeFetch({
    lookupImpl: async () => {
      lookupCalled = true;
      return [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.8", family: 4 }
      ];
    },
    httpsRequest: fake.request
  });
  await assert.rejects(fetch("https://mixed.example.com/"), error => error.code === "UNSAFE_OUTBOUND_TARGET");
  assert.equal(lookupCalled, true);
  assert.equal(fake.seen.calls, 0);
});

test("safeFetch limits streaming request bodies before oversized chunks are written and cancels the source", async () => {
  const chunks = [];
  let sent = false;
  let sourceDestroyed = false;
  const source = new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push(Buffer.from("123456789"));
      }
    },
    destroy(error, callback) {
      sourceDestroyed = true;
      callback(error);
    }
  });
  const fake = fakeRequest(200, ["content-type", "application/json"], chunk => chunks.push(Buffer.from(chunk)));
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "127.0.0.1", family: 4 }],
    httpRequest: fake.request,
    maxRequestBodyBytes: 8
  });
  await assert.rejects(
    fetch("http://localhost:8787/upload", {
      method: "POST",
      body: source
    }),
    error => error.code === "OUTBOUND_BODY_TOO_LARGE"
  );
  assert.equal(fake.seen.writtenBytes, 0);
  assert.deepEqual(chunks, []);
  assert.equal(sourceDestroyed, true);
});

test("safeFetch fails closed on redirects by default", async () => {
  const fake = fakeRequest(302, ["content-type", "text/plain"]);
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: fake.request
  });
  await assert.rejects(fetch("https://api.example.com/redirect"), error => error.code === "OUTBOUND_REDIRECT_BLOCKED");
});

test("safeFetch permits explicit local Ollama-style loopback HTTP and pins loopback DNS", async () => {
  const fake = fakeRequest();
  const fetch = createSafeFetch({
    lookupImpl: async host => {
      assert.equal(host, "localhost");
      return [
        { address: "127.0.0.1", family: 4 },
        { address: "::1", family: 6 }
      ];
    },
    httpRequest: fake.request
  });
  const response = await fetch("http://localhost:11434/api/tags");
  assert.equal(response.status, 200);
  assert.deepEqual(fake.seen.pinnedAddress, { address: "127.0.0.1", family: 4 });
});


test("safeFetch enforces a byte cap on streamed responses and stops reading oversized bodies", async () => {
  const fake = fakeRequest();
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: fake.request,
    maxResponseBodyBytes: 4
  });
  const response = await fetch("https://api.example.com/large-response");
  await assert.rejects(response.text(), error => error.code === "OUTBOUND_RESPONSE_TOO_LARGE");
});

test("safeFetch rejects a response with an oversized declared content length before returning it", async () => {
  const fake = fakeRequest(200, ["content-type", "application/json", "content-length", "9999"]);
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: fake.request,
    maxResponseBodyBytes: 32
  });
  await assert.rejects(
    fetch("https://api.example.com/declared-large-response"),
    error => error.code === "OUTBOUND_RESPONSE_TOO_LARGE"
  );
});

test("safeFetch overrides caller compression preferences so response caps apply to parsed bytes", async () => {
  const fake = fakeRequest();
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    httpsRequest: fake.request
  });
  const response = await fetch("https://api.example.com/compression", {
    headers: { "accept-encoding": "gzip" }
  });
  assert.equal(fake.seen.options.headers["accept-encoding"], "identity");
  await response.text();
});

test("safeFetch applies a default network deadline to requests that never receive a response", async () => {
  const fetch = createSafeFetch({
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    timeoutMs: 1000,
    httpsRequest: (_url, options) => {
      const req = new EventEmitter();
      req.end = () => {};
      req.destroy = error => {
        if (error) req.emit("error", error);
        return req;
      };
      options.signal.addEventListener("abort", () => {
        req.emit("error", options.signal.reason || Object.assign(new Error("Aborted"), { code: "ABORT_ERR" }));
      }, { once: true });
      return req;
    }
  });
  await assert.rejects(
    fetch("https://api.example.com/hangs"),
    error => error.code === "OUTBOUND_TIMEOUT"
  );
});
