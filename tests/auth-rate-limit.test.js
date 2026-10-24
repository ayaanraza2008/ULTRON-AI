import test from "node:test";
import assert from "node:assert/strict";
import { createAuthRateLimiter } from "../server.js";

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

test("auth rate limiter permits the configured burst and then returns retry guidance", () => {
  let now = 1_000;
  const limiter = createAuthRateLimiter({ now: () => now, limit: 2, windowMs: 60_000 });
  const req = { ip: "203.0.113.7" };
  let nextCalls = 0;

  for (let i = 0; i < 2; i += 1) {
    const res = responseRecorder();
    limiter(req, res, () => { nextCalls += 1; });
    assert.equal(res.statusCode, 200);
  }
  const limited = responseRecorder();
  limiter(req, limited, () => { nextCalls += 1; });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.body.error.code, "AUTH_RATE_LIMITED");
  assert.equal(limited.headers["Retry-After"], "60");
  assert.equal(limited.headers["Cache-Control"], "no-store");
  assert.equal(nextCalls, 2);

  now += 60_001;
  const afterWindow = responseRecorder();
  limiter(req, afterWindow, () => { nextCalls += 1; });
  assert.equal(afterWindow.statusCode, 200);
  assert.equal(nextCalls, 3);
});

test("auth rate limiter isolates client addresses", () => {
  const limiter = createAuthRateLimiter({ now: () => 5_000, limit: 1, windowMs: 60_000 });
  const first = { ip: "203.0.113.7" };
  const second = { ip: "203.0.113.8" };
  const firstResponse = responseRecorder();
  limiter(first, firstResponse, () => {});
  const blocked = responseRecorder();
  limiter(first, blocked, () => {});
  const otherClient = responseRecorder();
  limiter(second, otherClient, () => {});
  assert.equal(blocked.statusCode, 429);
  assert.equal(otherClient.statusCode, 200);
});
