import test from "node:test";
import assert from "node:assert/strict";
import { createApiRateLimiter } from "../server.js";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test("API limiter blocks excess requests and resets after its window", () => {
  let now = 10_000;
  const limiter = createApiRateLimiter({ now: () => now, windowMs: 60_000, maxRequests: 1 });
  let nextCalls = 0;
  const req = { ip: "192.0.2.1" };
  limiter(req, responseRecorder(), () => { nextCalls += 1; });
  const blocked = responseRecorder();
  limiter(req, blocked, () => { nextCalls += 1; });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
  assert.equal(blocked.headers["Cache-Control"], "no-store");
  assert.equal(nextCalls, 1);
  now += 60_001;
  limiter(req, responseRecorder(), () => { nextCalls += 1; });
  assert.equal(nextCalls, 2);
});

test("API limiter bounds memory when many distinct source addresses arrive", () => {
  const limiter = createApiRateLimiter({ now: () => 10_000, windowMs: 60_000, maxRequests: 30, maxBuckets: 10 });
  for (let i = 0; i < 100; i += 1) {
    limiter({ ip: "192.0.2." + i }, responseRecorder(), () => {});
  }
  assert.ok(limiter.getBucketCount() <= 10);
});
