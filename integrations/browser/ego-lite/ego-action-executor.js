/**
 * ULTRON AI — Ego Lite Action Executor
 * Module: integrations/browser/ego-lite/ego-action-executor.js
 *
 * Executes browser interactions (click, fill, hover, select, mouse, keyboard),
 * safe file downloads to UltronWorkspace/downloads, CDP commands, and script evaluation.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { EGO_ACTIONS, PERMISSION_LEVELS } from "./ego-constants.js";

export class EgoActionExecutor {
  /**
   * @param {Object} options
   * @param {import('./ego-snapshot-engine.js').EgoSnapshotEngine} [options.snapshotEngine]
   * @param {import('./ego-security-guard.js').EgoSecurityGuard} [options.securityGuard]
   * @param {import('./ego-audit-logger.js').EgoAuditLogger} [options.auditLogger]
   * @param {Object} [options.driver]
   * @param {string} [options.downloadsDir]
   */
  constructor(options = {}) {
    this.snapshotEngine = options.snapshotEngine || null;
    this.securityGuard = options.securityGuard || null;
    this.auditLogger = options.auditLogger || null;
    this.driver = options.driver || null;
    this.downloadsDir =
      options.downloadsDir ||
      path.resolve(process.cwd(), "UltronWorkspace", "downloads");
  }

  setSnapshotEngine(engine) {
    this.snapshotEngine = engine;
  }

  setSecurityGuard(guard) {
    this.securityGuard = guard;
  }

  setAuditLogger(logger) {
    this.auditLogger = logger;
  }

  setDriver(driver) {
    this.driver = driver;
  }

  /**
   * Resolve target element from @ref or selector
   * @private
   */
  _resolveTarget(pageId, refOrSelector) {
    if (this.snapshotEngine) {
      const resolved = this.snapshotEngine.resolveElementRef(pageId, refOrSelector);
      if (resolved) return resolved;
    }
    return {
      ref: refOrSelector.startsWith("@") ? refOrSelector : null,
      selector: refOrSelector,
      role: "unknown",
      name: refOrSelector
    };
  }

  /**
   * Click element
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {Object} [options={}]
   */
  async click(pageId, refOrSelector, options = {}) {
    const startTime = Date.now();
    const target = this._resolveTarget(pageId, refOrSelector);

    if (this.securityGuard) {
      const secCheck = this.securityGuard.checkActionPermission(
        EGO_ACTIONS.CLICK,
        target,
        PERMISSION_LEVELS.LEVEL_2_INTERACT
      );
      if (!secCheck.allowed) {
        throw new Error(`Click blocked: ${secCheck.reason}`);
      }
    }

    let result = { clicked: true, target: target.ref || target.selector };

    if (this.driver && typeof this.driver.click === "function") {
      result = await this.driver.click(pageId, target.selector || target.ref, options);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.CLICK,
        target: target.ref || target.selector,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Double click element
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {Object} [options={}]
   */
  async dblclick(pageId, refOrSelector, options = {}) {
    const startTime = Date.now();
    const target = this._resolveTarget(pageId, refOrSelector);

    let result = { dblclicked: true, target: target.ref || target.selector };

    if (this.driver && typeof this.driver.dblclick === "function") {
      result = await this.driver.dblclick(pageId, target.selector || target.ref, options);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.DBLCLICK,
        target: target.ref || target.selector,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Hover over element
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {Object} [options={}]
   */
  async hover(pageId, refOrSelector, options = {}) {
    const startTime = Date.now();
    const target = this._resolveTarget(pageId, refOrSelector);

    let result = { hovered: true, target: target.ref || target.selector };

    if (this.driver && typeof this.driver.hover === "function") {
      result = await this.driver.hover(pageId, target.selector || target.ref, options);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.HOVER,
        target: target.ref || target.selector,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Fill input element with value
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {string} value
   * @param {Object} [options={}]
   */
  async fill(pageId, refOrSelector, value, options = {}) {
    const startTime = Date.now();
    const target = this._resolveTarget(pageId, refOrSelector);

    // Enforce sensitive input checks
    const isSensitive =
      target.role === "password" ||
      /password|secret|pin|cvv|token/i.test(target.name || "") ||
      /password|secret|pin|cvv|token/i.test(target.placeholder || "");

    if (this.securityGuard && isSensitive) {
      const secCheck = this.securityGuard.checkActionPermission(
        EGO_ACTIONS.FILL,
        target,
        PERMISSION_LEVELS.LEVEL_4_CRITICAL
      );
      if (!secCheck.allowed) {
        throw new Error(`Fill on sensitive field blocked: ${secCheck.reason}`);
      }
    }

    let result = { filled: true, target: target.ref || target.selector };

    if (this.driver && typeof this.driver.fill === "function") {
      result = await this.driver.fill(pageId, target.selector || target.ref, value, options);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.FILL,
        target: target.ref || target.selector,
        valueLength: value ? value.length : 0,
        isSensitive,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Select dropdown option
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {string|Array<string>} values
   * @param {Object} [options={}]
   */
  async selectOption(pageId, refOrSelector, values, options = {}) {
    const startTime = Date.now();
    const target = this._resolveTarget(pageId, refOrSelector);

    let result = { selected: true, target: target.ref || target.selector, values };

    if (this.driver && typeof this.driver.selectOption === "function") {
      result = await this.driver.selectOption(pageId, target.selector || target.ref, values, options);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.SELECT_OPTION,
        target: target.ref || target.selector,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Drag and drop
   * @param {string} pageId
   * @param {string} sourceRef
   * @param {string} targetRef
   */
  async dragAndDrop(pageId, sourceRef, targetRef) {
    const startTime = Date.now();
    let result = { dragDropped: true, source: sourceRef, target: targetRef };

    if (this.driver && typeof this.driver.dragAndDrop === "function") {
      result = await this.driver.dragAndDrop(pageId, sourceRef, targetRef);
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: EGO_ACTIONS.DRAG_AND_DROP,
        source: sourceRef,
        target: targetRef,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return result;
  }

  /**
   * Mouse click at coordinates
   * @param {string} pageId
   * @param {number} x
   * @param {number} y
   * @param {Object} [options={}]
   */
  async mouseClick(pageId, x, y, options = {}) {
    if (this.driver && typeof this.driver.mouseClick === "function") {
      return await this.driver.mouseClick(pageId, x, y, options);
    }
    return { mouseClicked: true, x, y };
  }

  /**
   * Mouse move to coordinates
   * @param {string} pageId
   * @param {number} x
   * @param {number} y
   */
  async mouseMove(pageId, x, y) {
    if (this.driver && typeof this.driver.mouseMove === "function") {
      return await this.driver.mouseMove(pageId, x, y);
    }
    return { mouseMoved: true, x, y };
  }

  /**
   * Mouse wheel scroll
   * @param {string} pageId
   * @param {number} deltaX
   * @param {number} deltaY
   */
  async mouseWheel(pageId, deltaX, deltaY) {
    if (this.driver && typeof this.driver.mouseWheel === "function") {
      return await this.driver.mouseWheel(pageId, deltaX, deltaY);
    }
    return { mouseWheeled: true, deltaX, deltaY };
  }

  /**
   * Type text via keyboard
   * @param {string} pageId
   * @param {string} text
   * @param {Object} [options={}]
   */
  async type(pageId, text, options = {}) {
    if (this.driver && typeof this.driver.type === "function") {
      return await this.driver.type(pageId, text, options);
    }
    return { typed: true, textLength: text.length };
  }

  /**
   * Press key (e.g. 'Enter', 'Tab', 'Escape')
   * @param {string} pageId
   * @param {string} key
   * @param {Object} [options={}]
   */
  async press(pageId, key, options = {}) {
    if (this.driver && typeof this.driver.press === "function") {
      return await this.driver.press(pageId, key, options);
    }
    return { pressed: true, key };
  }

  /**
   * Set input files for file upload
   * @param {string} pageId
   * @param {string} refOrSelector
   * @param {Array<string>} filePaths
   */
  async setInputFiles(pageId, refOrSelector, filePaths) {
    const target = this._resolveTarget(pageId, refOrSelector);
    // Verify file existence and security
    for (const fpath of filePaths) {
      const resolved = path.resolve(fpath);
      try {
        await fs.access(resolved);
      } catch {
        throw new Error(`File to upload does not exist: ${resolved}`);
      }
    }

    if (this.driver && typeof this.driver.setInputFiles === "function") {
      return await this.driver.setInputFiles(pageId, target.selector || target.ref, filePaths);
    }
    return { inputFilesSet: true, target: target.ref || target.selector, count: filePaths.length };
  }

  /**
   * Safe download handler saving into UltronWorkspace/downloads
   * @param {string} pageId
   * @param {string} downloadUrl
   * @param {string} filename
   * @returns {Promise<Object>}
   */
  async downloadFile(pageId, downloadUrl, filename) {
    const startTime = Date.now();

    // Prevent path traversal
    const safeBasename = path.basename(filename || "downloaded_file");
    if (!safeBasename || safeBasename === "." || safeBasename === "..") {
      throw new Error("Invalid download filename");
    }

    if (this.securityGuard) {
      const secCheck = this.securityGuard.validateUrl(downloadUrl);
      if (!secCheck.allowed) {
        throw new Error(`Download blocked by security: ${secCheck.reason}`);
      }
    }

    // Ensure download directory exists
    await fs.mkdir(this.downloadsDir, { recursive: true });
    const targetPath = path.join(this.downloadsDir, safeBasename);

    let fileSize = 0;
    if (this.driver && typeof this.driver.downloadFile === "function") {
      const res = await this.driver.downloadFile(pageId, downloadUrl, targetPath);
      fileSize = res?.fileSize || 0;
    } else {
      // In standalone/mock mode: write dummy record verifying directory and file creation
      const sampleContent = Buffer.from(`Downloaded from ${downloadUrl}\nTimestamp: ${new Date().toISOString()}`);
      await fs.writeFile(targetPath, sampleContent);
      fileSize = sampleContent.length;
    }

    const downloadInfo = {
      downloaded: true,
      filename: safeBasename,
      savedPath: targetPath,
      fileSize,
      downloadUrl
    };

    if (this.auditLogger) {
      this.auditLogger.log({
        pageId,
        action: "download",
        target: safeBasename,
        savedPath: targetPath,
        fileSize,
        durationMs: Date.now() - startTime,
        success: true
      });
    }

    return downloadInfo;
  }

  /**
   * Evaluate JavaScript in browser context
   * @param {string} pageId
   * @param {string} script
   * @param  {...any} args
   */
  async evaluate(pageId, script, ...args) {
    if (this.driver && typeof this.driver.evaluate === "function") {
      return await this.driver.evaluate(pageId, script, ...args);
    }
    return { evaluated: true, scriptSnippet: script.slice(0, 50) };
  }

  /**
   * Browser-side fetch keeping authenticated cookies/sessions
   * @param {string} pageId
   * @param {string} url
   * @param {Object} [options={}]
   */
  async fetch(pageId, url, options = {}) {
    if (this.securityGuard) {
      const secCheck = this.securityGuard.validateUrl(url);
      if (!secCheck.allowed) {
        throw new Error(`Fetch blocked: ${secCheck.reason}`);
      }
    }

    if (this.driver && typeof this.driver.fetch === "function") {
      return await this.driver.fetch(pageId, url, options);
    }

    return {
      status: 200,
      ok: true,
      url,
      data: { fetched: true, note: "simulated browser fetch" }
    };
  }

  /**
   * Direct Chrome DevTools Protocol call
   * @param {string} method
   * @param {Object} [params={}]
   */
  async cdp(method, params = {}) {
    if (this.driver && typeof this.driver.cdp === "function") {
      return await this.driver.cdp(method, params);
    }
    return { cdpMethod: method, params, status: "simulated" };
  }
}
