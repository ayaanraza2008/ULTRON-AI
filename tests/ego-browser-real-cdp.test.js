/**
 * ULTRON AI — Real Chromium / CDP Live Control Verification
 * File: tests/ego-browser-real-cdp.test.js
 *
 * Verifies GENUINE browser control through the DevTools Protocol:
 * 1. Launch real headless Chromium family browser (ephemeral port, temp profile).
 * 2. Genuinely navigate to a public page and read the real title/status.
 * 3. Genuinely extract semantic elements from the live DOM.
 * 4. Genuinely interact: inject content via CDP, fill an input, read back its value.
 * 5. Genuinely evaluate JavaScript in the live page.
 * 6. Clean up: kill browser process, remove temporary profile.
 *
 * HONESTY: if no browser binary exists on the host, tests are skipped with an
 * explicit reason. No fake "browser control" claims are ever made.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { DRIVER_TYPE } from "../integrations/browser/ego-lite/ego-constants.js";
import { EgoSecurityGuard } from "../integrations/browser/ego-lite/ego-security-guard.js";
import { DirectChromiumCdpDriver } from "../integrations/browser/ego-lite/direct-chromium-driver.js";

const winChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const winEdgeX86 = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const winEdge = "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe";

function detectRealBrowser() {
  const candidates = process.platform === "win32"
    ? [process.env.ULTRON_CHROME_BIN, winChrome, winEdgeX86, winEdge].filter(Boolean)
    : [process.env.ULTRON_CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

const realBrowserPath = detectRealBrowser();
const suiteAvailable = Boolean(realBrowserPath) && process.env.ULTRON_SKIP_CDP_LIVE_TESTS !== "1";

describe("ULTRON AI — Real Chromium/CDP Live Control", { skip: suiteAvailable ? false : "Real browser binary not available on this host (honest evidence level: L1 only)" }, () => {

  test("launches real headless browser and reports REAL_CDP mechanism", async () => {
    assert.ok(realBrowserPath, "precondition");
    const guard = new EgoSecurityGuard({ allowTestLoopback: true });
    const driver = new DirectChromiumCdpDriver({ securityGuard: guard, executablePath: realBrowserPath });

    const launch = await driver.launch();
    assert.equal(launch.launched, true, `launch must succeed: ${launch.reason || ""}; browser=${realBrowserPath}; stderr=${launch.stderrPreview || "not captured"}`);
    assert.equal(fs.existsSync(launch.isolatedProfile), true, "isolated temp profile must exist");
    assert.equal(driver.capabilityStatus, "REAL_CHROMIUM_CDP");

    try {
      const nav = await driver.goto("cdp-live-page", "https://example.com");
      assert.equal(nav.executionDriver, DRIVER_TYPE.DIRECT_CHROMIUM_CDP);
      assert.equal(nav.executionMechanism, "REAL_CDP", "genuine CDP navigation must be labeled REAL_CDP");
      assert.equal(nav.status, 200);
      assert.match(nav.title, /Example Domain/i);
      assert.match(nav.url, /example\.com\/?/);
      // Real sanitized cross-check via live DOM evaluation:
      const domTitle = await driver.evaluate("cdp-live-page", "document.title");
      assert.match(domTitle.result, /Example Domain/i, "in-page title must match the live page");
    } finally {
      await driver.close();
    }

    assert.equal(driver.capabilityStatus, "NO_BROWSER_ATTACHED", "capability must reset after close");
    assert.equal(fs.existsSync(launch.isolatedProfile), false, "temp profile must be removed on close");
  });

  test("extracts semantic elements from the REAL live DOM", async () => {
    const guard = new EgoSecurityGuard({ allowTestLoopback: true });
    const driver = new DirectChromiumCdpDriver({ securityGuard: guard, executablePath: realBrowserPath });
    await driver.launch();

    try {
      await driver.goto("cdp-pages-page", "https://example.com");
      const elements = await driver.getSnapshotElements({ pageId: "cdp-pages-page" });
      // The live page content varies over time; assert genuine extraction evidence.
      const hasHeading = elements.some((el) => el.role === "heading");
      const hasBodyContent =
        elements.some((el) => el.role === "link" && el.href) ||
        elements.some((el) => el.role === "paragraph" && (el.name || "").length > 20);
      assert.ok(hasHeading || hasBodyContent, "real semantic elements must be extracted from the live DOM");
    } finally {
      await driver.close();
    }
  });

  test("performs REAL interaction: inject content over CDP, fill, verify value round-trip", async () => {
    const guard = new EgoSecurityGuard({ allowTestLoopback: true });
    const driver = new DirectChromiumCdpDriver({ securityGuard: guard, executablePath: realBrowserPath });
    await driver.launch();

    try {
      const pageId = "cdp-interact-page";
      await driver.goto(pageId, "about:blank");

      // Genuinely build a form in the live page through CDP evaluation.
      const injected = await driver.evaluate(
        pageId,
        `document.body.innerHTML = '<form><input id="ultron-cdp-test-input" type="text" placeholder="seed"/></form>'; document.body.innerHTML.length > 0`
      );
      assert.equal(injected.result, true, "live DOM injection must succeed");

      const filled = await driver.fill(pageId, "#ultron-cdp-test-input", "TonyStark");
      assert.equal(filled.filled, true, "fill must succeed via REAL_CDP");
      assert.equal(filled.executionMechanism, "REAL_CDP");

      const readBack = await driver.evaluate(pageId, "document.getElementById('ultron-cdp-test-input').value");
      assert.equal(readBack.result, "TonyStark", "filled value must be real in the live page");

      const clickMiss = await driver.click(pageId, "#no-such-element-xyz");
      assert.equal(clickMiss.clicked, false, "click on nonexistent element must honestly fail");

      const present = await driver.evaluate(pageId, "document.querySelector('#ultron-cdp-test-input') !== null");
      assert.equal(present.result, true);
    } finally {
      await driver.close();
    }
  });
});

test("honest capability status without launch (no fake browser claims)", async () => {
  const guard = new EgoSecurityGuard();
  const driver = new DirectChromiumCdpDriver({ securityGuard: guard, allowLaunch: false });

  const launch = await driver.launch();
  assert.equal(launch.launched, false, "launch disabled must be honored");

  // Without a browser, interactions must honestly report the simulation:
  const fillResult = await driver.fill("some-page", "#input", "value");
  assert.equal(fillResult.filled, false);
  assert.equal(fillResult.simulated, true);
  assert.equal(fillResult.executionMechanism, "HTTP_FETCH_PREVIEW");

  // Navigation still works through the honest bounded preview:
  const nav = await driver.goto("preview-page", "https://example.com");
  assert.equal(nav.executionMechanism, "HTTP_FETCH_PREVIEW");
  assert.equal(nav.status, 200);
  assert.match(nav.title, /Example Domain/i);
});
