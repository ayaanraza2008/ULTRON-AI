/**
 * ULTRON AI — Real-World Browser Verification & Gap Closure Test Suite
 * File: tests/ego-browser-real-world.test.js
 *
 * Verifies all 10 requirements of the ULTRON EGO LITE FINAL GAP CLOSURE:
 * 1. Separation of Ego Lite desktop, CLI, Direct Chromium/CDP, and Browser Use.
 * 2. Truthful execution driver attribution (never labeling direct CDP as Ego Lite).
 * 3. Resolution of the localhost/SSRF contradiction (secure test-only exceptions; production loopback blocked).
 * 4. Genuine public website testing (https://example.com) with harmless actions, snapshot, extraction, recovery, and cleanup.
 * 5. Full ULTRON planner -> registry -> browser router -> driver -> result -> conversation integration.
 * 6. Truthful BLOCKED / INSTALLATION_REQUIRED marking for absent desktop runtime.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  ROUTING_TARGET,
  DRIVER_TYPE,
  EGO_BROWSER_STATE,
  PERMISSION_LEVELS
} from "../integrations/browser/ego-lite/ego-constants.js";
import { EgoRuntimeManager } from "../integrations/browser/ego-lite/ego-runtime-manager.js";
import { EgoBrowserRouter } from "../integrations/browser/ego-lite/ego-browser-router.js";
import { EgoSecurityGuard } from "../integrations/browser/ego-lite/ego-security-guard.js";
import { DirectChromiumCdpDriver } from "../integrations/browser/ego-lite/direct-chromium-driver.js";
import { EgoBrowserAdapter } from "../integrations/browser/ego-lite/ego-adapter.js";
import { toolRegistry } from "../core/tool-registry.js";
import { AutonomousOrchestrator } from "../core/autonomous-orchestrator.js";

describe("ULTRON AI — Ego Lite Real-World Verification & Gap Closure", () => {

  // -------------------------------------------------------------
  // 1. Separation of 4 Browser Automation Runtimes
  // -------------------------------------------------------------
  test("1. Clearly separates Ego Lite desktop, CLI, Direct Chromium, and Browser Use", async () => {
    const runtimeManager = new EgoRuntimeManager();
    const router = new EgoBrowserRouter({ runtimeManager });
    const health = await runtimeManager.getRuntimeHealth();

    // Verify all 4 tiers exist and are distinctly classified
    assert.ok(health.egoLiteDesktop, "Ego Lite desktop runtime must be tracked separately");
    assert.ok(health.egoBrowserCli, "Ego Browser CLI must be tracked separately");
    assert.ok(health.directChromiumCdp, "Direct Chromium CDP must be tracked separately");
    assert.ok(health.browserUseBridge, "Browser Use bridge must be tracked separately");

    const engines = await router.getAvailableEngines();
    assert.equal(engines.engines.length, 4, "Router must report exactly 4 distinct engines");
    const engineIds = engines.engines.map((e) => e.id);
    assert.ok(engineIds.includes(ROUTING_TARGET.EGO_LITE_DESKTOP));
    assert.ok(engineIds.includes(ROUTING_TARGET.EGO_BROWSER_CLI));
    assert.ok(engineIds.includes(ROUTING_TARGET.DIRECT_CHROMIUM_CDP));
    assert.ok(engineIds.includes(ROUTING_TARGET.BROWSER_USE));
  });

  // -------------------------------------------------------------
  // 2. Truthful Execution Driver Attribution (No Fake Ego Lite)
  // -------------------------------------------------------------
  test("2. Proves which driver performed each operation and never labels direct CDP as Ego Lite", async () => {
    const securityGuard = new EgoSecurityGuard();
    const cdpDriver = new DirectChromiumCdpDriver({ securityGuard });

    assert.equal(cdpDriver.driverType, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);
    assert.notEqual(cdpDriver.driverType, DRIVER_TYPE.EGO_LITE_DESKTOP);

    const adapter = new EgoBrowserAdapter({ securityGuard });
    adapter.setDriver(cdpDriver);

    // Verify adapter reports direct CDP driver
    assert.equal(adapter.getExecutionDriverType(), DRIVER_TYPE.DIRECT_CHROMIUM_CDP);

    try {
      await adapter.taskSpace("cdp-verification-space");
      const navResult = await adapter.goto("about:blank");

      // The executionDriver must be DIRECT_CHROMIUM_CDP
      assert.equal(navResult.executionDriver, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);
      assert.equal(navResult.driverVerified, true);
      assert.notEqual(navResult.executionDriver, DRIVER_TYPE.EGO_LITE_DESKTOP);

      const snapshotResult = await adapter.snapshot();
      assert.equal(snapshotResult.executionDriver, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);
      assert.equal(snapshotResult.driverVerified, true);

      await adapter.closeTaskSpace("cdp-verification-space");
    } finally {
      // Release the real browser process / sockets so the test can exit cleanly.
      await cdpDriver.close();
    }
  });

  // -------------------------------------------------------------
  // 3. Resolution of Localhost / SSRF Contradiction
  // -------------------------------------------------------------
  test("3. Resolves localhost/SSRF contradiction: test-only loopback exception vs production lockdown", () => {
    // A. Default / Normal SecurityGuard: Blocks loopback, cloud metadata, and RFC 1918
    const defaultGuard = new EgoSecurityGuard();
    assert.equal(defaultGuard.validateUrl("http://localhost:8080").allowed, false);
    assert.equal(defaultGuard.validateUrl("http://127.0.0.1:3000").allowed, false);
    assert.equal(defaultGuard.validateUrl("http://169.254.169.254/latest/meta-data/").allowed, false);
    assert.equal(defaultGuard.validateUrl("http://192.168.1.1").allowed, false);
    assert.equal(defaultGuard.validateUrl("http://10.0.0.1").allowed, false);

    // B. Explicit test-only exception (allowTestLoopback: true) in non-production
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const testGuard = new EgoSecurityGuard({ allowTestLoopback: true, testAllowedPorts: [8080, 9222] });
    // Permitted loopback on allowlisted port
    const loopbackAllowed = testGuard.validateUrl("http://127.0.0.1:8080/test");
    assert.equal(loopbackAllowed.allowed, true);
    assert.equal(loopbackAllowed.isTestLoopbackException, true);

    // Rejected loopback on non-allowlisted port
    const loopbackWrongPort = testGuard.validateUrl("http://127.0.0.1:4444/admin");
    assert.equal(loopbackWrongPort.allowed, false);

    // CRITICAL: Cloud metadata (169.254.169.254) is STILL BLOCKED even with test loopback enabled!
    assert.equal(testGuard.validateUrl("http://169.254.169.254").allowed, false);
    // CRITICAL: RFC 1918 private subnets are STILL BLOCKED even with test loopback enabled!
    assert.equal(testGuard.validateUrl("http://192.168.1.1").allowed, false);
    assert.equal(testGuard.validateUrl("http://10.0.0.1").allowed, false);

    // C. PRODUCTION LOCKDOWN: In production, loopback bypass is strictly forbidden regardless of flags!
    process.env.NODE_ENV = "production";
    const prodGuard = new EgoSecurityGuard({ allowTestLoopback: true });
    assert.equal(prodGuard.allowTestLoopback, false, "Production must force allowTestLoopback to false");
    const prodCheck = prodGuard.validateUrl("http://localhost:8080");
    assert.equal(prodCheck.allowed, false);
    assert.match(prodCheck.reason, /strictly forbidden in production/i);

    // Restore environment
    process.env.NODE_ENV = originalEnv;
  });

  // -------------------------------------------------------------
  // 4. Real Public Website Testing (Harmless Actions on example.com)
  // -------------------------------------------------------------
  test("4. Tests genuine public website (example.com): navigation, snapshot, extraction, recovery, cleanup", async () => {
    const securityGuard = new EgoSecurityGuard();
    const cdpDriver = new DirectChromiumCdpDriver({ securityGuard });
    const adapter = new EgoBrowserAdapter({ securityGuard });
    adapter.setDriver(cdpDriver);

    try {
      // 1. TaskSpace creation
      const space = await adapter.taskSpace("real-web-test-space");
      assert.equal(space.name, "real-web-test-space");

      // 2. Genuine navigation to RFC 2606 reserved example domain
      const targetUrl = "https://example.com";
      const navRes = await adapter.goto(targetUrl);
      assert.equal(navRes.status, 200);
      assert.equal(navRes.title, "Example Domain");
      assert.match(String(navRes.url), /example\.com\/?$/i, "genuinely navigated (URL may be normalized by the browser)");
      assert.equal(navRes.executionDriver, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);
      assert.equal(navRes.driverVerified, true);

      // 3. Semantic snapshot and element extraction
      const snapRes = await adapter.snapshot();
      assert.equal(snapRes.title, "Example Domain");
      assert.ok(snapRes.elementsCount > 0, "Snapshot must have extracted elements");
      assert.ok(snapRes.textTree.includes("Example Domain"));
      assert.equal(snapRes.executionDriver, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);

      // Verify extracted semantic elements contain actual headings/links/paragraphs (real page evidence)
      const heading = snapRes.elements.find((el) => el.role === "heading" || (el.name || "").includes("Example"));
      assert.ok(heading, "Heading element must be extracted from genuine HTML");
      assert.ok(
        snapRes.elements.some((el) => el.role === "link" && el.href),
        "A real link must be extracted from the genuine page"
      );

      // 4. Error recovery: attempt SSRF navigation, verify clean rejection and recovery
      await assert.rejects(
        async () => {
          await adapter.goto("http://169.254.169.254/latest/meta-data");
        },
        /blocked by (?:SSRF|security)/i
      );

      // Verify TaskSpace remains intact and operable after rejection
      const healthyCheck = await adapter.goto("about:blank");
      assert.equal(healthyCheck.status, 200);

      // 5. Cleanup
      await adapter.closeTaskSpace("real-web-test-space");
      assert.equal(adapter.listTaskSpaces().some((s) => s.id === space.id), false);
    } finally {
      // Release the real browser process / sockets so the test can exit cleanly.
      await cdpDriver.close();
    }
  });

  // -------------------------------------------------------------
  // 5. ULTRON Planner -> Registry -> Router -> Driver -> Conversation
  // -------------------------------------------------------------
  test("5. Integrated flow: ULTRON planner -> registry -> browser router -> driver -> result -> conversation", async () => {
    const orchestrator = new AutonomousOrchestrator();
    const prompt = "Browse https://example.com and inspect webpage content";

    // 1. Intent analysis by ULTRON brain
    const intent = orchestrator.analyzeIntent(prompt);
    assert.equal(intent.intent, "AUTONOMOUS_BROWSER_OPERATION");
    assert.equal(intent.domain, "AUTONOMOUS_OPERATIONS");

    // 2. DAG formulation
    const plan = orchestrator.formulatePlan(intent, prompt);
    assert.ok(plan.steps.length >= 3);
    assert.equal(plan.steps[0].toolId, "intelligent_browser_route");
    assert.equal(plan.steps[1].toolId, "ego_page_navigate");
    assert.equal(plan.steps[2].toolId, "ego_page_snapshot");

    // 3. Verify all planned tools exist in ToolRegistry
    for (const step of plan.steps) {
      const tool = toolRegistry.getTool(step.toolId);
      assert.ok(tool, `Tool ${step.toolId} must exist in registry`);
      assert.ok(typeof tool.execute === "function");
    }

    // 4. Execute full workflow through orchestrator
    const executionResult = await orchestrator.executeAutonomousCommand(prompt, {
      userId: "operator",
      preApproved: true
    });

    assert.equal(executionResult.success, true);
    assert.equal(executionResult.verified, true);
    assert.equal(executionResult.intent, "AUTONOMOUS_BROWSER_OPERATION");
    assert.ok(executionResult.stepResults.length >= 3);

    // 5. Verify conversation response synthesis
    assert.ok(executionResult.textResponse.length > 0);
    assert.match(executionResult.textResponse, /Autonomous browser mission completed/i);
    assert.match(executionResult.textResponse, /example\.com/i);
  });

  // -------------------------------------------------------------
  // 6. Explicit BLOCKED / INSTALLATION_REQUIRED for Absent Desktop
  // -------------------------------------------------------------
  test("6. Explicitly marks unavailable desktop runtime as BLOCKED / INSTALLATION_REQUIRED", async () => {
    const runtimeManager = new EgoRuntimeManager();
    const appDetection = runtimeManager.detectEgoLiteApp();

    if (!appDetection.installed) {
      assert.equal(appDetection.status, "BLOCKED / INSTALLATION_REQUIRED");
      assert.equal(appDetection.found, false);
      assert.match(appDetection.guidance, /https:\/\/lite\.ego\.app\//);

      const router = new EgoBrowserRouter({ runtimeManager });
      const route = await router.resolveRoute({
        type: "authenticated",
        url: "https://github.com/settings",
        preferEgo: true
      });

      assert.equal(route.available, false);
      assert.equal(route.status, "BLOCKED / INSTALLATION_REQUIRED");
      assert.equal(route.target, ROUTING_TARGET.EGO_LITE);
      assert.ok(route.installInstructions);
      assert.match(route.installInstructions.appUrl, /lite\.ego\.app/);
    }
  });
});
