/**
 * ULTRON AI — Direct Chromium / CDP Fallback Driver (PREVIEW)
 * Module: integrations/browser/ego-lite/direct-chromium-driver.js
 *
 * HONEST CAPABILITY STATEMENT (do not remove):
 * This driver does NOT yet attach to a real Chromium DevTools Protocol session.
 * Navigation and snapshot extraction are performed with a bounded plain-HTTP
 * fetch + semantic HTML parse (executionMechanism: HTTP_FETCH_PREVIEW).
 * Interaction methods (click/fill/hover/select/evaluate) CANNOT execute without
 * a real CDP attachment and therefore report simulated: true honestly instead
 * of fabricating success.
 *
 * Attribution policy:
 * Executions performed by this driver are always labeled 'DIRECT_CHROMIUM_CDP'
 * (indicating the driver tier that owns the task), must NEVER be labeled as Ego
 * Lite, and always carry their true executionMechanism so callers can
 * distinguish real browser control from HTTP preview.
 */

import { DRIVER_TYPE, PAGE_SCOPE, LOAD_STATES } from "./ego-constants.js";

export class DirectChromiumCdpDriver {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.executablePath]
   * @param {import('./ego-security-guard.js').EgoSecurityGuard} [options.securityGuard]
   */
  constructor(options = {}) {
    this.driverType = DRIVER_TYPE.DIRECT_CHROMIUM_CDP;
    this.isDirectCdp = true;
    this.executablePath = options.executablePath || null;
    this.securityGuard = options.securityGuard || null;
    this.pages = new Map(); // pageId -> pageData
  }

  setSecurityGuard(guard) {
    this.securityGuard = guard;
  }

  /**
   * Navigate to a URL
   * @param {string} pageId
   * @param {string} url
   * @param {Object} [options={}]
   */
  async goto(pageId, url, options = {}) {
    if (this.securityGuard) {
      const secCheck = this.securityGuard.validateUrl(url);
      if (!secCheck.allowed) {
        throw new Error(`Navigation blocked by SSRF defense: ${secCheck.reason}`);
      }
    }

    let title = "about:blank";
    let status = 200;
    let html = "";
    let extractedElements = [];

    if (url && url !== "about:blank") {
      try {
        const timeoutMs = options.timeout || 15000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ULTRON-DirectCDP/1.0"
          }
        });
        clearTimeout(timer);

        status = response.status;
        html = await response.text();

        // Extract title
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else {
          try {
            const parsed = new URL(url);
            title = parsed.hostname;
          } catch {
            title = url;
          }
        }

        // Extract basic semantic DOM elements (headings, links, paragraphs, buttons)
        extractedElements = this._parseHtmlElements(html, url);
      } catch (err) {
        if (options.throwOnError) throw err;
        title = `Error: ${err.message}`;
        status = 500;
      }
    }

    this.pages.set(pageId, {
      pageId,
      url,
      title,
      status,
      html,
      extractedElements,
      navigatedAt: new Date().toISOString()
    });

    return {
      pageId,
      url,
      title,
      status,
      loadState: options.waitUntil || LOAD_STATES.LOAD,
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Fetch snapshot elements for a page
   */
  async getSnapshotElements({ pageId, scope = PAGE_SCOPE.VIEWPORT }) {
    const pageData = this.pages.get(pageId);
    if (!pageData) {
      return [
        { role: "document", name: "Empty Page", selector: "body" }
      ];
    }

    if (pageData.extractedElements && pageData.extractedElements.length > 0) {
      return pageData.extractedElements;
    }

    return [
      { role: "heading", name: pageData.title || "Document", selector: "h1" },
      { role: "document", name: pageData.url, selector: "body" }
    ];
  }

  /**
   * Click element.
   * HONESTY: without a real CDP attachment this driver cannot interact with
   * live page elements. It reports honestly instead of fabricating success.
   */
  async click(pageId, selectorOrRef, options = {}) {
    return {
      clicked: false,
      simulated: true,
      target: selectorOrRef,
      reason: "No real CDP session attached: interactive actions require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Double-click element (honest no-CDP-session report, see click()).
   */
  async dblclick(pageId, selectorOrRef, options = {}) {
    return {
      dblclicked: false,
      simulated: true,
      target: selectorOrRef,
      reason: "No real CDP session attached: interactive actions require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Hover element (honest no-CDP-session report, see click()).
   */
  async hover(pageId, selectorOrRef, options = {}) {
    return {
      hovered: false,
      simulated: true,
      target: selectorOrRef,
      reason: "No real CDP session attached: interactive actions require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Fill input element (honest no-CDP-session report, see click()).
   */
  async fill(pageId, selectorOrRef, value, options = {}) {
    return {
      filled: false,
      simulated: true,
      target: selectorOrRef,
      value,
      reason: "No real CDP session attached: interactive actions require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Select dropdown option (honest no-CDP-session report, see click()).
   */
  async selectOption(pageId, selectorOrRef, values, options = {}) {
    return {
      selected: false,
      simulated: true,
      target: selectorOrRef,
      values,
      reason: "No real CDP session attached: interactive actions require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Evaluate JavaScript in page context.
   * HONESTY: without a real CDP attachment no script can run inside a page.
   * This reports honestly instead of fabricating an evaluation result.
   */
  async evaluate(pageId, script, options = {}) {
    return {
      evaluated: false,
      simulated: true,
      scriptPreview: typeof script === "string" ? script.slice(0, 100) : String(script).slice(0, 100),
      reason: "No real CDP session attached: in-page evaluation requires genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Internal parser extracting semantic elements from HTML string
   * @private
   */
  _parseHtmlElements(html, pageUrl) {
    const elements = [];

    // Extract headings
    const headingMatches = html.matchAll(/<h([1-3])[^>]*>([^<]+)<\/h[1-3]>/gi);
    for (const match of headingMatches) {
      const text = match[2].trim();
      if (text) {
        elements.push({
          role: "heading",
          name: text,
          selector: `h${match[1]}`,
          level: parseInt(match[1], 10)
        });
      }
    }

    // If no explicit <h1>-<h3> headings found in HTML body, extract document <title> as heading
    const hasHeading = elements.some((el) => el.role === "heading");
    if (!hasHeading) {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        const titleText = titleMatch[1].trim();
        if (titleText) {
          elements.unshift({
            role: "heading",
            name: titleText,
            selector: "h1",
            level: 1
          });
        }
      }
    }

    // Extract links
    const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([^<]*)<\/a>/gi);
    for (const match of linkMatches) {
      const href = match[1];
      const text = match[2].trim() || href;
      elements.push({
        role: "link",
        name: text,
        href,
        selector: `a[href="${href}"]`
      });
      if (elements.length >= 25) break; // Bounded extraction
    }

    // Extract paragraphs if few elements
    if (elements.length < 5) {
      const pMatches = html.matchAll(/<p[^>]*>([^<]+)<\/p>/gi);
      for (const match of pMatches) {
        const text = match[1].trim();
        if (text) {
          elements.push({
            role: "paragraph",
            name: text.slice(0, 150),
            selector: "p"
          });
        }
        if (elements.length >= 10) break;
      }
    }

    return elements;
  }
}
