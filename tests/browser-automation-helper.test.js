import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BrowserAutomationHelper } from "../integrations/browser-automation-helper.js";

describe("Browser Automation Helper Suite", () => {
  const helper = new BrowserAutomationHelper();

  test("normalizes empty string to about:blank", () => {
    assert.equal(helper.normalizeUrl(""), "about:blank");
    assert.equal(helper.normalizeUrl("   "), "about:blank");
  });

  test("preserves fully qualified HTTP/HTTPS URLs", () => {
    assert.equal(helper.normalizeUrl("https://github.com/ayaanraza2008/ULTRON-AI"), "https://github.com/ayaanraza2008/ULTRON-AI");
    assert.equal(helper.normalizeUrl("http://example.com/test"), "http://example.com/test");
  });

  test("expands bare words into domain .com URLs", () => {
    assert.equal(helper.normalizeUrl("github"), "https://github.com");
    assert.equal(helper.normalizeUrl("reddit"), "https://reddit.com");
    assert.equal(helper.normalizeUrl("youtube"), "https://youtube.com");
  });

  test("prefixes domain strings with https", () => {
    assert.equal(helper.normalizeUrl("wikipedia.org"), "https://wikipedia.org");
    assert.equal(helper.normalizeUrl("news.ycombinator.com"), "https://news.ycombinator.com");
  });

  test("converts multi-word queries to search engine URLs", () => {
    const search = helper.normalizeUrl("how to build an ai agent");
    assert.ok(search.startsWith("https://duckduckgo.com/?q="));
    assert.ok(search.includes("how%20to%20build%20an%20ai%20agent"));
  });

  test("validates URL safety and blocks SSRF / private networks", () => {
    // Safe public domains
    const safe1 = helper.validateUrlSafety("https://github.com");
    assert.equal(safe1.safe, true);

    const safe2 = helper.validateUrlSafety("wikipedia.org");
    assert.equal(safe2.safe, true);

    // Blocked localhost / loopback
    const badLocal = helper.validateUrlSafety("http://localhost:3000");
    assert.equal(badLocal.safe, false);
    assert.ok(badLocal.reason.includes("localhost"));

    const bad127 = helper.validateUrlSafety("http://127.0.0.1:8080/admin");
    assert.equal(bad127.safe, false);
    assert.ok(bad127.reason.includes("anti-SSRF"));

    // Blocked cloud metadata
    const badMeta = helper.validateUrlSafety("http://169.254.169.254/latest/meta-data");
    assert.equal(badMeta.safe, false);
    assert.ok(badMeta.reason.includes("anti-SSRF"));

    // Blocked private subnets
    const bad10 = helper.validateUrlSafety("http://10.0.0.1");
    assert.equal(bad10.safe, false);

    const bad192 = helper.validateUrlSafety("http://192.168.1.1");
    assert.equal(bad192.safe, false);

    // Blocked unsafe protocol
    const badProto = helper.validateUrlSafety("file:///etc/passwd");
    assert.equal(badProto.safe, false);
    assert.ok(badProto.reason.includes("Only HTTP and HTTPS"));
  });

  test("discovers browser profile directories on Windows host", async () => {
    const profiles = await helper.findBrowserProfileDirs();
    assert.ok(Array.isArray(profiles));
    // On Windows, either Edge or Chrome or Brave is present
    if (process.platform === "win32") {
      assert.ok(profiles.length >= 1, "At least one browser profile directory should be detected on host");
    }
  });
});
