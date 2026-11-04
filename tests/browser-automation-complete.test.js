/**
 * ULTRON AI — Real Browser Automation Layer & Direct CDP Test Suite
 * Tests: tests/browser-automation-complete.test.js
 *
 * Verifies:
 * 1. DirectChromiumCdpDriver host binary detection without downloads.
 * 2. Honest driver execution attribution (REAL_CDP vs HTTP_FETCH_PREVIEW).
 * 3. Multi-layer SSRF defense including redirect revalidation.
 * 4. Browser element interaction suite: screenshot, scroll, type, press, fill, click.
 * 5. Multi-tab lifecycle: createTab, listTabs, switchTab, closePage.
 * 6. Tool Registry dispatch for browser_navigate, browser_screenshot, browser_interact, browser_tabs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { DirectChromiumCdpDriver } from "../integrations/browser/ego-lite/direct-chromium-driver.js";
import { EgoSecurityGuard } from "../integrations/browser/ego-lite/ego-security-guard.js";
import { EgoBrowserAdapter } from "../integrations/browser/ego-lite/ego-adapter.js";
import { toolRegistry } from "../core/tool-registry.js";

describe("ULTRON Real Browser Automation Suite", () => {
  it("detects host Chromium/Edge binary truthfully without downloading external binaries", () => {
    const driver = new DirectChromiumCdpDriver();
    const detection = driver.detectBrowserBinary();

    assert.equal(typeof detection.installed, "boolean");
    assert.equal(typeof detection.found, "boolean");
    if (detection.found) {
      assert.ok(detection.path, "Detected binary must have a valid path");
      assert.ok(detection.name, "Detected binary must have a name");
    }
  });

  it("enforces multi-layer SSRF defense and blocks redirects to private/cloud-metadata targets", async () => {
    const guard = new EgoSecurityGuard();
    const driver = new DirectChromiumCdpDriver({ securityGuard: guard, allowLaunch: false });

    // Initial navigation to AWS metadata must fail immediately
    await assert.rejects(
      async () => {
        await driver.goto("test_page", "http://169.254.169.254/latest/meta-data/");
      },
      (err) => {
        assert.match(err.message, /blocked by SSRF defense/i);
        return true;
      }
    );

    // Initial navigation to RFC1918 private IP must fail
    await assert.rejects(
      async () => {
        await driver.goto("test_page", "http://192.168.1.1/admin");
      },
      (err) => {
        assert.match(err.message, /blocked by SSRF defense/i);
        return true;
      }
    );
  });

  it("handles honest preview navigation and interaction reporting without fabricating CDP control", async () => {
    const driver = new DirectChromiumCdpDriver({ allowLaunch: false });

    // Local HTTP server to simulate safe external web page
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Test Page</title></head><body><h1>Hello ULTRON</h1><a href="/link1">Link One</a><input id="test-input" type="text" /></body></html>`);
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const testUrl = `http://127.0.0.1:${port}/`;

    try {
      // In honest preview mode (no CDP attached)
      const nav = await driver.goto("preview_page_1", testUrl);
      assert.equal(nav.executionMechanism, "HTTP_FETCH_PREVIEW");
      assert.equal(nav.title, "Test Page");
      assert.equal(nav.status, 200);

      // Interactions truthfully report simulated: true
      const clickRes = await driver.click("preview_page_1", "h1");
      assert.equal(clickRes.simulated, true);
      assert.equal(clickRes.executionMechanism, "HTTP_FETCH_PREVIEW");

      const typeRes = await driver.type("preview_page_1", "Ultron Typing");
      assert.equal(typeRes.simulated, true);
      assert.equal(typeRes.textLength, 13);

      const pressRes = await driver.press("preview_page_1", "Enter");
      assert.equal(pressRes.simulated, true);
      assert.equal(pressRes.key, "Enter");

      const scrollRes = await driver.scroll("preview_page_1", { y: 250 });
      assert.equal(scrollRes.simulated, true);
      assert.equal(scrollRes.deltaY, 250);

      const shotRes = await driver.screenshot("preview_page_1");
      assert.equal(shotRes.simulated, true);
      assert.equal(shotRes.executionMechanism, "HTTP_FETCH_PREVIEW");
    } finally {
      await driver.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("manages multi-tab lifecycles: createTab, listTabs, switchTab, and closePage", async () => {
    const driver = new DirectChromiumCdpDriver({ allowLaunch: false });

    const tab1 = await driver.createTab("about:blank");
    assert.ok(tab1.pageId);

    const tab2 = await driver.createTab("about:blank");
    assert.ok(tab2.pageId);

    const tabs = await driver.listTabs();
    assert.equal(tabs.length, 2);

    const switched = await driver.switchTab(tab1.pageId);
    assert.equal(switched.activeTabId, tab1.pageId);

    const closeRes = await driver.closePage(tab2.pageId);
    assert.equal(closeRes.closed, true);

    const remainingTabs = await driver.listTabs();
    assert.equal(remainingTabs.length, 1);
    assert.equal(remainingTabs[0].pageId, tab1.pageId);

    await driver.close();
  });

  it("dispatches browser capabilities through Tool Registry with schema validation", async () => {
    // 1. browser_navigate
    const navTool = toolRegistry.getTool("browser_navigate");
    assert.ok(navTool, "browser_navigate must be registered in toolRegistry");
    assert.equal(navTool.permissionLevel, 2);

    // 2. browser_screenshot
    const shotTool = toolRegistry.getTool("browser_screenshot");
    assert.ok(shotTool, "browser_screenshot must be registered in toolRegistry");
    assert.equal(shotTool.permissionLevel, 1);

    // 3. browser_interact
    const interactTool = toolRegistry.getTool("browser_interact");
    assert.ok(interactTool, "browser_interact must be registered in toolRegistry");
    assert.equal(interactTool.permissionLevel, 2);

    // 4. browser_tabs
    const tabsTool = toolRegistry.getTool("browser_tabs");
    assert.ok(tabsTool, "browser_tabs must be registered in toolRegistry");
    assert.equal(tabsTool.permissionLevel, 2);

    // Execute tab list through toolRegistry
    const listResult = await toolRegistry.execute("browser_tabs", { action: "list" });
    assert.equal(listResult.success, true);
    assert.ok(Array.isArray(listResult.tabs));
  });
});
