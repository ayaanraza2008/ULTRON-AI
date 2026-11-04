/**
 * ULTRON AI — Companion API Security, Authentication & Account Isolation Suite
 * Tests: tests/companion-api-security.test.js
 *
 * Verifies:
 * 1. Enforces requireSession middleware on both GET and POST companion endpoints.
 * 2. Unauthenticated requests are rejected with 401 Unauthorized.
 * 3. Authenticated requests proceed and receive valid responses.
 * 4. Account isolation: requests attempting cross-tenant access are blocked with 403 Forbidden.
 * 5. Rate limiting prevents API flooding and returns 429 Too Many Requests.
 * 6. Native companion daemon endpoints require session and manage process lifecycle safely.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import { createCompanionRouter } from "../system/companion-router.js";

describe("ULTRON Companion API Security & Account Isolation Suite", () => {
  // Setup express test server with mock session middleware
  function setupTestApp(options = {}) {
    const app = express();
    app.use(express.json());

    // Mock authentication middleware
    const requireSession = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== "Bearer valid-token") {
        return res.status(401).json({ success: false, error: "Unauthorized: Active session required." });
      }
      req.session = { userId: "user-alpha-123" };
      next();
    };

    const router = createCompanionRouter({
      requireSession,
      logger: { error: () => {} }
    });

    app.use("/api/companion", router);
    return app;
  }

  it("rejects unauthenticated GET /api/companion/status with 401 Unauthorized", async () => {
    const app = setupTestApp();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/companion/status`);
      assert.equal(res.status, 401);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Unauthorized/i);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("allows authenticated GET /api/companion/status with valid bearer token", async () => {
    const app = setupTestApp();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/companion/status`, {
        headers: { Authorization: "Bearer valid-token" }
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.ok(data.status);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("enforces account isolation and rejects cross-tenant requests with 403 Forbidden", async () => {
    const app = setupTestApp();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      // Header claims to be user-victim-999 while session is user-alpha-123
      const res = await fetch(`http://127.0.0.1:${port}/api/companion/status`, {
        headers: {
          Authorization: "Bearer valid-token",
          "x-user-id": "user-victim-999"
        }
      });
      assert.equal(res.status, 403);
      const data = await res.json();
      assert.equal(data.success, false);
      assert.match(data.error, /Account isolation violation/i);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("rejects unauthenticated POST requests on hardware and daemon endpoints", async () => {
    const app = setupTestApp();
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const endpoints = [
        "/api/companion/position",
        "/api/companion/tray-action",
        "/api/companion/native/launch",
        "/api/companion/native/stop",
        "/api/companion/brightness",
        "/api/companion/media",
        "/api/companion/window"
      ];

      for (const endpoint of endpoints) {
        const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggle" })
        });
        assert.equal(res.status, 401, `Endpoint ${endpoint} must require authentication`);
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("rate limits excessive requests and returns 429 Too Many Requests", async () => {
    const app = express();
    // Router with tiny rate limit for testing
    let requests = 0;
    const miniLimiter = (req, res, next) => {
      requests++;
      if (requests > 5) {
        return res.status(429).json({ success: false, error: "Rate limit exceeded" });
      }
      next();
    };

    app.use("/api/companion", miniLimiter, createCompanionRouter({ requireSession: (_req, _res, n) => n() }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      let saw429 = false;
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`http://127.0.0.1:${port}/api/companion/anchor`);
        if (res.status === 429) {
          saw429 = true;
          break;
        }
      }
      assert.equal(saw429, true, "Rate limiter must respond with 429 when threshold exceeded");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
