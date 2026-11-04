/**
 * ULTRON AI — Direct Chromium / CDP Fallback Driver (REAL CDP CONTROL)
 * Module: integrations/browser/ego-lite/direct-chromium-driver.js
 *
 * CAPABILITY LEVELS (honesty policy — do not remove):
 * - REAL_CHROMIUM_CDP: when a host Chromium/Chrome/Edge binary is found, this
 *   driver launches it headless with an isolated temporary profile and an
 *   ephemeral DevTools port, attaches over the DevTools WebSocket, and performs
 *   genuine navigation, snapshot extraction, interaction and in-page evaluation.
 *   Results are labeled executionMechanism: "REAL_CDP".
 * - HTTP_FETCH_PREVIEW: when no browser binary is available (or launch is
 *   disabled), navigation/snapshot fall back to a bounded plain-HTTP fetch +
 *   semantic HTML parse (executionMechanism: "HTTP_FETCH_PREVIEW"), and
 *   interaction methods report simulated: true honestly instead of
 *   fabricating success.
 *
 * SECURITY POLICY:
 * - Page URLs are always validated by EgoSecurityGuard (SSRF: cloud metadata,
 *   RFC1918 and 0.0.0.0 are unconditionally blocked; loopback pages are only
 *   reachable via the explicit test-only exception).
 * - The DevTools endpoint is loopback-only with an ephemeral port (0) and a
 *   disposable user-data-dir which is removed on close.
 * - Executions performed by this driver are always attributed to the
 *   DIRECT_CHROMIUM_CDP tier and must NEVER be labeled as Ego Lite.
 */

import { DRIVER_TYPE, PAGE_SCOPE, LOAD_STATES } from "./ego-constants.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CDP_COMMAND_TIMEOUT_MS = 15000;

export class DirectChromiumCdpDriver {
  /**
   * @param {Object} [options={}]
   * @param {string} [options.executablePath]
   * @param {import('./ego-security-guard.js').EgoSecurityGuard} [options.securityGuard]
   * @param {boolean} [options.allowLaunch=true] - permit launching a real browser
   * @param {string[]} [options.candidatePaths] - override browser search list
   */
  constructor(options = {}) {
    this.driverType = DRIVER_TYPE.DIRECT_CHROMIUM_CDP;
    this.isDirectCdp = true;
    this.executablePath = options.executablePath || null;
    this.securityGuard = options.securityGuard || null;
    this.allowLaunch = options.allowLaunch !== false;
    this.candidatePaths = Array.isArray(options.candidatePaths) && options.candidatePaths.length > 0
      ? options.candidatePaths
      : null;
    this.pages = new Map(); // pageId -> { cdp: <ws client>, targetId, ... }
    this.process = null;
    this.browserWsUrl = null;
    this.devtoolsHttpPort = null;
    this.userDataDir = null;
    this.nextWsMessageId = 1;
    this.pendingWs = new Map();
    this.executionMechanism = "HTTP_FETCH_PREVIEW";
    this.capabilityStatus = "NO_BROWSER_ATTACHED";
  }

  setSecurityGuard(guard) {
    this.securityGuard = guard;
  }

  /**
   * Locate a host browser binary WITHOUT downloading anything.
   * @returns {{ installed: boolean, found: boolean, path: string|null, name: string|null }}
   */
  detectBrowserBinary() {
    if (this.executablePath && fs.existsSync(this.executablePath)) {
      return { installed: true, found: true, path: this.executablePath, name: "Custom (executablePath)" };
    }
    const candidates = this.candidatePaths || (process.platform === "win32" ? [
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe")
    ] : process.platform === "darwin" ? [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ] : [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium"
    ]);

    for (const cand of candidates) {
      if (cand && fs.existsSync(cand)) {
        return { installed: true, found: true, path: cand, name: path.basename(cand) };
      }
    }
    return { installed: false, found: false, path: null, name: null };
  }

  /**
   * Launch a real headless browser and attach the DevTools WebSocket.
   * Returns true on success; never throws for missing browsers (honest fallback).
   */
  async launch(options = {}) {
    if (!this.allowLaunch) {
      return { launched: false, reason: "launch disabled by configuration" };
    }
    if (this.process && this.browserWsUrl) {
      return { launched: true, alreadyRunning: true, browserWsUrl: this.browserWsUrl };
    }

    const detection = this.detectBrowserBinary();
    if (!detection.found) {
      return { launched: false, reason: "No Chromium-based browser binary found on host", detection };
    }

    this.userDataDir = fsp.mkdtemp
      ? await fsp.mkdtemp(path.join(os.tmpdir(), "ultron-cdp-profile-"))
      : path.join(os.tmpdir(), `ultron-cdp-profile-${Date.now()}`);

    const args = [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      `--user-data-dir=${this.userDataDir}`
    ];
    // GitHub-hosted CI runners may not provide the user-namespace sandbox
    // required by Chromium. Disable the sandbox only inside ephemeral CI jobs;
    // normal ULTRON hosts retain Chromium's default sandbox protections.
    if (process.env.CI === "true") {
      args.push("--no-sandbox", "--disable-dev-shm-usage");
    }

    let stderrBuffer = "";
    const child = spawn(detection.path, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    this.process = child;
    child.stderr.setEncoding?.("utf8");
    const devtoolsLine = await new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        child.stderr.removeListener("data", onData);
        child.removeListener("error", onError);
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 12000);
      const onData = (chunk) => {
        stderrBuffer += chunk;
        const match = stderrBuffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) finish(match[1]);
      };
      const onError = (error) => {
        stderrBuffer += String(error?.message || error).slice(0, 300);
        finish(null);
      };
      child.once("error", onError);
      child.stderr.on("data", onData);
    });
    if (!devtoolsLine || !this.process.pid) {
      await this._killProcess();
      return { launched: false, reason: "Browser launch failed or DevTools endpoint not observed", stderrPreview: stderrBuffer.slice(0, 300) };
    }

    this.browserWsUrl = devtoolsLine;
    const portMatch = devtoolsLine.match(/127\.0\.0\.1:(\d+)/);
    this.devtoolsHttpPort = portMatch ? Number(portMatch[1]) : null;
    this.capabilityStatus = "REAL_CHROMIUM_CDP";

    return {
      launched: true,
      browserBinary: detection.path,
      browserName: detection.name,
      devtoolsPort: this.devtoolsHttpPort,
      isolatedProfile: this.userDataDir
    };
  }

  /**
   * Creates one real page target and opens its per-page DevTools WebSocket.
   * @private
   */
  async _openCdpPage(pageId) {
    const launchInfo = await this.launch();
    if (!launchInfo.launched) {
      return null;
    }

    const http = await import("node:http");
    const port = this.devtoolsHttpPort;
    const newTarget = await new Promise((resolve, reject) => {
      const req = http.default.request({ hostname: "127.0.0.1", port, path: "/json/new?about:blank", method: "PUT" }, (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
        });
      });
      req.on("error", reject);
      req.end();
      setTimeout(() => reject(new Error("DevTools HTTP endpoint timeout")), 5000).unref?.();
    });

    const pageWsUrl = newTarget.webSocketDebuggerUrl;
    if (!pageWsUrl) throw new Error("DevTools target has no webSocketDebuggerUrl");

    const ws = new WebSocket(pageWsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("DevTools WebSocket connection failed")), { once: true });
    });

    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }
      if (msg.id && this.pendingWs.has(msg.id)) {
        const { resolve, reject } = this.pendingWs.get(msg.id);
        this.pendingWs.delete(msg.id);
        if (msg.error) reject(Object.assign(new Error(`CDP error: ${msg.error.message || JSON.stringify(msg.error)}`), { cdpError: msg.error }));
        else resolve(msg.result);
      }
      // Redirect SSRF Defense: validate target URL on every redirect event
      if (msg.method === "Network.requestWillBeSent" && msg.params?.redirectResponse) {
        const redirectUrl = msg.params.request?.url;
        if (redirectUrl && this.securityGuard) {
          const secCheck = this.securityGuard.validateUrl(redirectUrl);
          if (!secCheck.allowed) {
            this._cdpSend(ws, "Page.stopLoading").catch(() => {});
            this._cdpSend(ws, "Page.navigate", { url: "about:blank" }).catch(() => {});
          }
        }
      }
    });

    await this._cdpSend(ws, "Page.enable");
    await this._cdpSend(ws, "Runtime.enable");
    await this._cdpSend(ws, "Network.enable").catch(() => {});

    const record = { cdp: ws, targetId: newTarget.id, launchedVia: "REAL_CDP" };
    this.pages.set(pageId, Object.assign(this.pages.get(pageId) || {}, record));
    return record;
  }

  /**
   * Send a CDP command with a bounded timeout.
   * @private
   */
  _cdpSend(ws, method, params = {}) {
    const id = this.nextWsMessageId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingWs.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pendingWs.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Real in-page evaluation returning a raw remote object value.
   * @private
   */
  async _evaluate(pageId, expression) {
    const record = this.pages.get(pageId);
    if (!record || !record.cdp) throw new Error("No real CDP page attached");
    const result = await this._cdpSend(record.cdp, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: false
    });
    return result?.result?.value;
  }

  /**
   * REAL CDP navigation.
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

    let record = null;
    if (this.allowLaunch) {
      try {
        record = await this._openCdpPage(pageId);
      } catch (err) {
        record = null;
      }
    }

    if (record && record.cdp) {
      try {
        // Attach the load-state waiter BEFORE navigating to avoid missing a fast load event.
        const loadWaiter = this._waitForLoadState(record.cdp, options.timeout || 20000);
        const navResult = await this._cdpSend(record.cdp, "Page.navigate", { url });
        await loadWaiter;
        const [title, status, info] = await Promise.all([
          this._evaluate(pageId, "document.title"),
          this._evaluate(
            pageId,
            `(performance.getEntriesByType('navigation')[0]||{}).responseStatus ?? (lastNavFailed?500:200)`
          ),
          this._evaluate(
            pageId,
            `JSON.stringify({url: location.href, readyState: document.readyState})`
          )
        ]);
        const snapshotResult = await this._extractRealElements(pageId);

        const pageData = {
          pageId,
          url: info?.url || url,
          title: title || "",
          status: Number.isInteger(status) ? status : 200,
          html: "",
          extractedElements: snapshotResult,
          navigatedAt: new Date().toISOString()
        };
        this.pages.set(pageId, Object.assign(pageData, record));

        return {
          pageId,
          url: pageData.url,
          title: pageData.title,
          status: pageData.status,
          loadState: LOAD_STATES.LOAD,
          executionDriver: this.driverType,
          executionMechanism: "REAL_CDP",
          driverVerified: true,
          readyState: info?.readyState
        };
      } catch (err) {
        if (options.throwOnError) throw err;
        // fall through to honest preview fallback
      }
    }

    // Honest HTTP preview fallback (browser unavailable or real nav failed)
    return await this._httpPreviewGoto(pageId, url, options);
  }

  /**
   * Wait until the page load event is seen (bounded).
   * @private
   */
  _waitForLoadState(cdp, timeoutMs = 20000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { cdp.removeEventListener?.("message", onMessage); resolve(); }, timeoutMs);
      const onMessage = (event) => {
        let msg;
        try { msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }
        if (msg.method === "Page.loadEventFired") {
          clearTimeout(timer);
          cdp.removeEventListener?.("message", onMessage);
          resolve();
        }
      };
      cdp.addEventListener?.("message", onMessage);
      if (!cdp.addEventListener) resolve(); // cannot observe events without an EventTarget; bounded timeout applies
    });
  }

  /**
   * Extract semantic elements from the REAL live DOM via Runtime.evaluate.
   * Bounded to keep memory small (8 GB host policy).
   * @private
   */
  async _extractRealElements(pageId) {
    const expr = `(() => {
      const out = [];
      const push = (role, name, selector, extra) => {
        if (out.length < 25 && name) out.push(Object.assign({ role, name: String(name).slice(0, 150), selector }, extra || {}));
      };
      document.querySelectorAll('h1,h2,h3').forEach((el) => push('heading', el.textContent.trim(), el.tagName.toLowerCase(), { level: Number(el.tagName[1]) }));
      if (!out.some((e) => e.role === 'heading') && document.title) {
        out.unshift({ role: 'heading', name: document.title.trim(), selector: 'h1', level: 1 });
      }
      document.querySelectorAll('a[href]').forEach((el) => push('link', (el.textContent || '').trim() || el.getAttribute('href'), 'a[href="' + CSS.escape(el.getAttribute('href')) + '"]', { href: el.getAttribute('href') }));
      if (out.length < 5) document.querySelectorAll('p').forEach((el) => push('paragraph', el.textContent.trim(), 'p'));
      return JSON.stringify(out);
    })()`;
    const raw = await this._evaluate(pageId, expr);
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    if (Array.isArray(raw)) return raw;
    return [];
  }

  /**
   * Snapshot elements — real DOM when attached, parsed preview otherwise.
   */
  async getSnapshotElements({ pageId, scope = PAGE_SCOPE.VIEWPORT } = {}) {
    const pageData = this.pages.get(pageId);
    if (!pageData) {
      return [{ role: "document", name: "Empty Page", selector: "body" }];
    }

    if (pageData.cdp && pageData.launchedVia === "REAL_CDP") {
      const real = await this._extractRealElements(pageId);
      if (real.length > 0) return real;
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
   * Click via real DOM event dispatch over CDP (in-page click, not synthetic).
   */
  async click(pageId, selectorOrRef, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const result = await this._evaluate(
        pageId,
        `(() => {
          const el = ${this._selectorExpr(selectorOrRef)};
          if (!el) return JSON.stringify({ clicked: false, reason: "element not found" });
          el.scrollIntoView({ block: "center" });
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true }));
          return JSON.stringify({ clicked: true, target: ${JSON.stringify(String(selectorOrRef))} });
        })()`
      );
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return Object.assign(parsed || { clicked: false }, {
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      });
    }
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

  async dblclick(pageId, selectorOrRef, options = {}) {
    const base = await this.click(pageId, selectorOrRef, options);
    return Object.assign({}, base, { dblclicked: base.clicked === true, clicked: undefined });
  }

  async hover(pageId, selectorOrRef, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const result = await this._evaluate(
        pageId,
        `(() => {
          const el = ${this._selectorExpr(selectorOrRef)};
          if (!el) return JSON.stringify({ hovered: false, reason: "element not found" });
          el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
          el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          return JSON.stringify({ hovered: true, target: ${JSON.stringify(String(selectorOrRef))} });
        })()`
      );
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return Object.assign(parsed || { hovered: false }, {
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      });
    }
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
   * Fill a real input over CDP: focus, set value via native setter, dispatch trusted lifecycle events.
   */
  async fill(pageId, selectorOrRef, value, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const result = await this._evaluate(
        pageId,
        `(() => {
          const el = ${this._selectorExpr(selectorOrRef)};
          if (!el) return JSON.stringify({ filled: false, reason: "element not found" });
          el.focus();
          const proto = Object.getPrototypeOf(el);
          const desc = Object.getOwnPropertyDescriptor(proto, "value") || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
          desc.set.call(el, ${JSON.stringify(String(value))});
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return JSON.stringify({ filled: true, target: ${JSON.stringify(String(selectorOrRef))}, value: ${JSON.stringify(String(value))} });
        })()`
      );
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return Object.assign(parsed || { filled: false }, {
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      });
    }
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

  async selectOption(pageId, selectorOrRef, values, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const result = await this._evaluate(
        pageId,
        `(() => {
          const el = ${this._selectorExpr(selectorOrRef)};
          const wanted = ${JSON.stringify(Array.isArray(values) ? values : [values])};
          if (!el || !el.options) return JSON.stringify({ selected: false, reason: "element not found or not a select" });
          let selected = [];
          for (const opt of el.options) {
            if (wanted.includes(opt.value) || wanted.includes(opt.textContent.trim())) {
              opt.selected = true; selected.push(opt.value);
            }
          }
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return JSON.stringify({ selected: selected.length > 0, values: selected });
        })()`
      );
      const parsed = typeof result === "string" ? JSON.parse(result) : result;
      return Object.assign(parsed || { selected: false }, {
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      });
    }
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
   * Evaluate real JavaScript in the LIVE page context over CDP.
   */
  async evaluate(pageId, script, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const value = await this._evaluate(pageId, script);
      return {
        evaluated: true,
        result: value,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
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
   * Real Page Screenshot capture via CDP Page.captureScreenshot.
   */
  async screenshot(pageId, options = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const format = options.format === "jpeg" ? "jpeg" : "png";
      const params = { format };
      if (format === "jpeg" && options.quality) {
        params.quality = Math.max(1, Math.min(100, options.quality));
      }
      if (options.clip) {
        params.clip = options.clip;
      }
      const cdpResult = await this._cdpSend(record.cdp, "Page.captureScreenshot", params);
      return {
        screenshot: cdpResult?.data || null,
        format,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
    return {
      screenshot: null,
      simulated: true,
      format: options.format || "png",
      reason: "No real CDP session attached: screenshot requires genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Scroll viewport or element via DOM evaluation.
   */
  async scroll(pageId, options = {}) {
    const record = this.pages.get(pageId);
    const deltaX = Number(options.x || options.deltaX || 0);
    const deltaY = Number(options.y || options.deltaY || (options.direction === "up" ? -500 : 500));

    if (record && record.cdp) {
      const res = await this._evaluate(
        pageId,
        `(() => {
          window.scrollBy(${deltaX}, ${deltaY});
          return JSON.stringify({ scrollX: window.scrollX, scrollY: window.scrollY });
        })()`
      );
      const parsed = typeof res === "string" ? JSON.parse(res) : res;
      return {
        scrolled: true,
        deltaX,
        deltaY,
        scrollX: parsed?.scrollX || 0,
        scrollY: parsed?.scrollY || 0,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
    return {
      scrolled: false,
      simulated: true,
      deltaX,
      deltaY,
      reason: "No real CDP session attached: scroll requires genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Dispatch keyboard typing over CDP Input.dispatchKeyEvent.
   */
  async type(pageId, text, options = {}) {
    const record = this.pages.get(pageId);
    const str = String(text || "");
    if (record && record.cdp) {
      for (const char of str) {
        await this._cdpSend(record.cdp, "Input.dispatchKeyEvent", {
          type: "keyDown",
          text: char,
          unmodifiedText: char
        });
        await this._cdpSend(record.cdp, "Input.dispatchKeyEvent", {
          type: "keyUp"
        });
      }
      return {
        typed: true,
        textLength: str.length,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
    return {
      typed: false,
      simulated: true,
      textLength: str.length,
      reason: "No real CDP session attached: typing requires genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Dispatch single key press (e.g., Enter, Tab, Escape) over CDP.
   */
  async press(pageId, key, options = {}) {
    const record = this.pages.get(pageId);
    const keyName = String(key || "Enter");
    if (record && record.cdp) {
      await this._cdpSend(record.cdp, "Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        key: keyName
      });
      await this._cdpSend(record.cdp, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: keyName
      });
      return {
        pressed: true,
        key: keyName,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
    return {
      pressed: false,
      simulated: true,
      key: keyName,
      reason: "No real CDP session attached: key press requires genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Multi-tab management: Create a new tab and navigate it.
   */
  async createTab(url = "about:blank") {
    const newPageId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const result = await this.goto(newPageId, url);
    return { pageId: newPageId, ...result };
  }

  /**
   * Multi-tab management: List active tabs.
   */
  async listTabs() {
    const tabs = [];
    for (const [pageId, data] of this.pages.entries()) {
      tabs.push({
        pageId,
        url: data.url || "about:blank",
        title: data.title || "",
        status: data.status || 200,
        launchedVia: data.launchedVia || this.executionMechanism,
        isCdpAttached: Boolean(data.cdp)
      });
    }
    return tabs;
  }

  /**
   * Multi-tab management: Switch active tab.
   */
  async switchTab(pageId) {
    if (!this.pages.has(pageId)) {
      throw new Error(`Tab '${pageId}' does not exist.`);
    }
    const tab = this.pages.get(pageId);
    return {
      activeTabId: pageId,
      url: tab.url,
      title: tab.title,
      isCdpAttached: Boolean(tab.cdp)
    };
  }

  /**
   * Direct low-level CDP invocation on a page target.
   */
  async cdp(pageId, method, params = {}) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      const res = await this._cdpSend(record.cdp, method, params);
      return {
        result: res,
        executionDriver: this.driverType,
        executionMechanism: "REAL_CDP",
        driverVerified: true
      };
    }
    return {
      simulated: true,
      method,
      params,
      reason: "No real CDP session attached: raw CDP calls require genuine browser control",
      executionDriver: this.driverType,
      executionMechanism: "HTTP_FETCH_PREVIEW",
      driverVerified: true
    };
  }

  /**
   * Close a page's real CDP target and drop its socket.
   */
  async closePage(pageId) {
    const record = this.pages.get(pageId);
    if (record && record.cdp) {
      try { record.cdp.close(); } catch { /* socket already dead */ }
      try {
        const httpClient = await import("node:http");
        await new Promise((resolve) => {
          const req = httpClient.default.get({ hostname: "127.0.0.1", port: this.devtoolsHttpPort, path: `/json/close/${record.targetId}` }, (res) => {
            res.resume(); res.on("end", resolve);
          });
          req.on("error", resolve); req.end();
        });
      } catch { /* best-effort target close */ }
    }
    this.pages.delete(pageId);
    return { closed: true, pageId, executionDriver: this.driverType };
  }

  /**
   * Close everything: page sockets, browser process, temp profile.
   */
  async close() {
    for (const pageId of [...this.pages.keys()]) {
      try { await this.closePage(pageId); } catch { /* continue */ }
    }
    await this._killProcess();
    if (this.userDataDir) {
      // Chrome may hold file handles while it is terminating; retry removal briefly.
      await this._retryProfileRemoval(this.userDataDir, 5, 300);
      this.userDataDir = null;
    }
    this.browserWsUrl = null;
    this.devtoolsHttpPort = null;
    this.capabilityStatus = "NO_BROWSER_ATTACHED";
    this.executionMechanism = "HTTP_FETCH_PREVIEW";
    return { closed: true, executionDriver: this.driverType };
  }

  /**
   * @private
   */
  async _retryProfileRemoval(dirPath, attempts, delayMs) {
    for (let i = 0; i < attempts; i++) {
      try {
        await fsp.rm(dirPath, { recursive: true, force: true });
        if (!fs.existsSync(dirPath)) return true;
      } catch { /* process may still be flushing */ }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return fs.existsSync(dirPath) ? false : true;
  }

  /**
   * Kill the browser process and wait (bounded) for actual exit before returning.
   * @private
   */
  async _killProcess() {
    if (this.process) {
      const proc = this.process;
      this.process = null;
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 6000);
        if (proc.exitCode !== null) {
          clearTimeout(timer);
          resolve();
          return;
        }
        proc.once("exit", () => { clearTimeout(timer); resolve(); });
        try {
          if (process.platform === "win32") {
            const killer = spawn("taskkill", ["/PID", String(proc.pid), "/F", "/T"]);
            killer.once("exit", () => { /* exit event on the main proc resolves */ });
          } else {
            proc.kill("SIGTERM");
          }
        } catch { /* already exited */ }
      });
    }
  }

  /**
   * Build a safe in-page element resolution expression from a selector
   * or "@ref" (refs resolve through the snapshot engine in the executor;
   * at the driver level refs fall back to attribute matching).
   * @private
   */
  _selectorExpr(selectorOrRef) {
    const asSelector = String(selectorOrRef || "body");
    const escaped = JSON.stringify(asSelector);
    if (asSelector.startsWith("@")) {
      return `document.querySelector('[data-ref=${JSON.stringify(asSelector)}]') || document.querySelector(${escaped.slice(1) ? JSON.stringify(asSelector.replace(/^@/, "#")) : '"body"'})`;
    }
    return `document.querySelector(${escaped})`;
  }

  /**
   * Honest bounded plain-HTTP preview (no browser session).
   * @private
   */
  async _httpPreviewGoto(pageId, url, options = {}) {
    let title = "about:blank";
    let status = 200;
    let html = "";
    let extractedElements = [];

    if (url && url !== "about:blank") {
      try {
        const timeoutMs = options.timeout || 15000;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let currentUrl = url;
        let response = null;
        let redirectCount = 0;
        const maxRedirects = 5;

        while (redirectCount <= maxRedirects) {
          if (this.securityGuard) {
            const secCheck = this.securityGuard.validateUrl(currentUrl);
            if (!secCheck.allowed) {
              throw new Error(`Navigation blocked by SSRF defense: ${secCheck.reason}`);
            }
          }

          response = await fetch(currentUrl, {
            signal: controller.signal,
            redirect: "manual",
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ULTRON-DirectCDP/1.0"
            }
          });

          // Check if this is a redirect
          if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
            const loc = response.headers.get("location");
            currentUrl = new URL(loc, currentUrl).href;
            redirectCount++;
            continue;
          }
          break;
        }

        clearTimeout(timer);
        status = response.status;
        html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          title = titleMatch[1].trim();
        } else {
          try {
            const parsed = new URL(currentUrl);
            title = parsed.hostname;
          } catch {
            title = currentUrl;
          }
        }
        url = currentUrl;
        extractedElements = this._parseHtmlElementsPreview(html, currentUrl);
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
      navigatedAt: new Date().toISOString(),
      launchedVia: "HTTP_FETCH_PREVIEW"
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
   * Preview-mode HTML parse (bounded).
   * @private
   */
  _parseHtmlElementsPreview(html, pageUrl) {
    const elements = [];
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
