import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createSafeFetch } from "../outbound-transport.js";

function fakeRequest(status = 200, headers = ["content-type", "application/json"]) {
  const seen = { calls: 0, options: null, pinnedAddress: null };
  const request = (url, options, callback) => {
    seen.calls += 1;
    seen.options = options;
    const req = new EventEmitter();
    req.write = () => true;
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
    headers: { authorization: "Bearer test" },
    body: "{\"test\":true}"
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(fake.seen.pinnedAddress, { address: "93.184.216.34", family: 4 });
  assert.equal(fake.seen.options.headers.host, "api.example.com");
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
