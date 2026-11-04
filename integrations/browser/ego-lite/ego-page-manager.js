/**
 * ULTRON AI — Ego Lite Page Manager
 * Module: integrations/browser/ego-lite/ego-page-manager.js
 *
 * Manages Page lifecycles, tab enumeration, tab switching, and navigation waits
 * within TaskSpaces following Ego Lite architecture.
 */

import { LOAD_STATES, RESOURCE_BUDGETS } from "./ego-constants.js";

export class EgoPageManager {
  /**
   * @param {Object} options
   * @param {import('./ego-taskspace-manager.js').EgoTaskSpaceManager} [options.taskSpaceManager]
   * @param {import('./ego-security-guard.js').EgoSecurityGuard} [options.securityGuard]
   * @param {Object} [options.driver] - Optional underlying CDP/Ego driver instance
   */
  constructor(options = {}) {
    this.taskSpaceManager = options.taskSpaceManager || null;
    this.securityGuard = options.securityGuard || null;
    this.driver = options.driver || null;

    /** @type {Map<string, Map<string, Object>>} taskSpaceId -> (pageId -> PageState) */
    this.spacePages = new Map();
    /** @type {Map<string, string>} taskSpaceId -> activePageId */
    this.activePageBySpace = new Map();
    this.pageCounter = 0;
  }

  setTaskSpaceManager(manager) {
    this.taskSpaceManager = manager;
  }

  setSecurityGuard(guard) {
    this.securityGuard = guard;
  }

  setDriver(driver) {
    this.driver = driver;
  }

  /**
   * Get pages map for a taskSpace
   * @private
   */
  _getPagesForSpace(taskSpaceId) {
    if (!this.spacePages.has(taskSpaceId)) {
      this.spacePages.set(taskSpaceId, new Map());
    }
    return this.spacePages.get(taskSpaceId);
  }

  /**
   * Create a new page in a task space
   * @param {string} taskSpaceId
   * @param {string} [initialUrl="about:blank"]
   * @returns {Promise<Object>}
   */
  async newPage(taskSpaceId, initialUrl = "about:blank") {
    if (!taskSpaceId) {
      throw new Error("TaskSpaceId is required to create a new page");
    }

    const pages = this._getPagesForSpace(taskSpaceId);
    if (pages.size >= RESOURCE_BUDGETS.MAX_PAGES_PER_TASKSPACE) {
      throw new Error(
        `TaskSpace ${taskSpaceId} has reached the maximum of ${RESOURCE_BUDGETS.MAX_PAGES_PER_TASKSPACE} pages`
      );
    }

    if (this.securityGuard && initialUrl !== "about:blank") {
      const secCheck = this.securityGuard.validateUrl(initialUrl);
      if (!secCheck.allowed) {
        throw new Error(`Navigation blocked by security policy: ${secCheck.reason}`);
      }
    }

    this.pageCounter += 1;
    const pageId = `page_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const label = `p${pages.size + 1}`;

    const pageState = {
      id: pageId,
      label,
      taskSpaceId,
      url: initialUrl,
      title: initialUrl === "about:blank" ? "Blank Page" : initialUrl,
      loadState: LOAD_STATES.LOAD,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      closed: false,
      history: [initialUrl]
    };

    if (this.driver && typeof this.driver.createPage === "function") {
      const driverResult = await this.driver.createPage({ taskSpaceId, initialUrl });
      pageState.targetId = driverResult?.targetId || pageId;
    }

    pages.set(pageId, pageState);
    this.activePageBySpace.set(taskSpaceId, pageId);

    // If taskSpaceManager is wired, also reflect page label in taskSpace state
    if (this.taskSpaceManager) {
      const space = this.taskSpaceManager.getTaskSpace(taskSpaceId);
      if (space && space.pages) {
        if (space.pages instanceof Map) {
          if (!space.pages.has(label)) {
            space.pages.set(label, { label, spaceId: taskSpaceId, targetId: pageState.targetId, url: initialUrl, openedBy: "agent", active: true });
          }
        } else if (Array.isArray(space.pages)) {
          if (!space.pages.includes(label)) {
            space.pages.push(label);
          }
        }
      }
    }

    return { ...pageState };
  }

  /**
   * Resolve page by ID or label ('p1', 'p2', etc.)
   * @param {string} taskSpaceId
   * @param {string} [pageIdOrLabel]
   * @returns {Object}
   */
  resolvePage(taskSpaceId, pageIdOrLabel) {
    const pages = this._getPagesForSpace(taskSpaceId);
    if (!pageIdOrLabel) {
      const activeId = this.activePageBySpace.get(taskSpaceId);
      if (activeId && pages.has(activeId)) {
        return pages.get(activeId);
      }
      if (pages.size > 0) {
        return Array.from(pages.values())[0];
      }
      throw new Error(`No pages found in TaskSpace: ${taskSpaceId}`);
    }

    // Lookup by ID
    if (pages.has(pageIdOrLabel)) {
      return pages.get(pageIdOrLabel);
    }

    // Lookup by label (p1, p2, etc.)
    for (const page of pages.values()) {
      if (page.label.toLowerCase() === pageIdOrLabel.toLowerCase()) {
        return page;
      }
    }

    throw new Error(`Page not found: ${pageIdOrLabel} in TaskSpace: ${taskSpaceId}`);
  }

  /**
   * List all open pages in a TaskSpace
   * @param {string} taskSpaceId
   * @returns {Array<Object>}
   */
  listPages(taskSpaceId) {
    const pages = this._getPagesForSpace(taskSpaceId);
    const activeId = this.activePageBySpace.get(taskSpaceId);

    return Array.from(pages.values()).map((p) => ({
      id: p.id,
      label: p.label,
      url: p.url,
      title: p.title,
      loadState: p.loadState,
      isActive: p.id === activeId,
      createdAt: p.createdAt
    }));
  }

  /**
   * Set active page
   * @param {string} taskSpaceId
   * @param {string} pageIdOrLabel
   */
  selectPage(taskSpaceId, pageIdOrLabel) {
    const page = this.resolvePage(taskSpaceId, pageIdOrLabel);
    this.activePageBySpace.set(taskSpaceId, page.id);
    page.lastAccessedAt = new Date().toISOString();
    return { ...page, isActive: true };
  }

  /**
   * Navigate page to URL
   * @param {string} taskSpaceId
   * @param {string} url
   * @param {Object} [options={}]
   * @param {string} [options.pageIdOrLabel]
   * @param {string} [options.waitUntil="load"]
   * @param {number} [options.timeout=30000]
   */
  async goto(taskSpaceId, url, options = {}) {
    if (!url) {
      throw new Error("Target URL is required for goto");
    }

    if (this.securityGuard) {
      const secCheck = this.securityGuard.validateUrl(url);
      if (!secCheck.allowed) {
        throw new Error(`Navigation blocked: ${secCheck.reason}`);
      }
    }

    let page;
    try {
      page = this.resolvePage(taskSpaceId, options.pageIdOrLabel);
    } catch {
      // Auto-create initial page if none exists
      page = await this.newPage(taskSpaceId, url);
      return {
        pageId: page.id,
        label: page.label,
        url: page.url,
        title: page.title,
        status: 200,
        loadState: options.waitUntil || LOAD_STATES.LOAD
      };
    }

    page.loadState = "navigating";
    page.lastAccessedAt = new Date().toISOString();

    let title = url;
    let status = 200;

    if (this.driver && typeof this.driver.goto === "function") {
      const driverRes = await this.driver.goto(page.id, url, options);
      if (driverRes?.title) title = driverRes.title;
      if (driverRes?.status) status = driverRes.status;
    } else {
      // Default URL title formatting
      try {
        const parsed = new URL(url);
        title = `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      } catch {
        title = url;
      }
    }

    page.url = url;
    page.title = title;
    page.loadState = options.waitUntil || LOAD_STATES.LOAD;
    page.history.push(url);

    return {
      pageId: page.id,
      label: page.label,
      url: page.url,
      title: page.title,
      status,
      loadState: page.loadState
    };
  }

  /**
   * Reload current page
   * @param {string} taskSpaceId
   * @param {Object} [options={}]
   */
  async reload(taskSpaceId, options = {}) {
    const page = this.resolvePage(taskSpaceId, options.pageIdOrLabel);
    page.lastAccessedAt = new Date().toISOString();

    if (this.driver && typeof this.driver.reload === "function") {
      await this.driver.reload(page.id, options);
    }

    page.loadState = options.waitUntil || LOAD_STATES.LOAD;
    return {
      pageId: page.id,
      label: page.label,
      url: page.url,
      status: 200
    };
  }

  /**
   * Wait for URL to match string or RegExp
   * @param {string} taskSpaceId
   * @param {string|RegExp} pattern
   * @param {Object} [options={}]
   */
  async waitForURL(taskSpaceId, pattern, options = {}) {
    const timeout = options.timeout || RESOURCE_BUDGETS.DEFAULT_TIMEOUT_MS;
    const startTime = Date.now();
    const pollInterval = 100;

    const page = this.resolvePage(taskSpaceId, options.pageIdOrLabel);

    while (Date.now() - startTime < timeout) {
      const currentUrl = page.url;
      const matched =
        typeof pattern === "string"
          ? currentUrl.includes(pattern)
          : pattern instanceof RegExp
            ? pattern.test(currentUrl)
            : false;

      if (matched) {
        return { matched: true, url: currentUrl };
      }

      await this.waitForTimeout(pollInterval);
    }

    throw new Error(`Timeout waiting for URL to match '${pattern}' (current: ${page.url})`);
  }

  /**
   * Wait for page load state
   * @param {string} taskSpaceId
   * @param {string} state
   * @param {Object} [options={}]
   */
  async waitForLoadState(taskSpaceId, state = LOAD_STATES.LOAD, options = {}) {
    const page = this.resolvePage(taskSpaceId, options.pageIdOrLabel);
    if (this.driver && typeof this.driver.waitForLoadState === "function") {
      await this.driver.waitForLoadState(page.id, state, options);
    }
    page.loadState = state;
    return { pageId: page.id, state };
  }

  /**
   * Wait for custom browser-side function
   * @param {string} taskSpaceId
   * @param {string} fnString
   * @param {Object} [options={}]
   */
  async waitForFunction(taskSpaceId, fnString, options = {}) {
    const page = this.resolvePage(taskSpaceId, options.pageIdOrLabel);
    if (this.driver && typeof this.driver.waitForFunction === "function") {
      return await this.driver.waitForFunction(page.id, fnString, options);
    }
    return { pageId: page.id, evaluated: true };
  }

  /**
   * Non-blocking delay helper
   * @param {number} ms
   */
  async waitForTimeout(ms) {
    const safeMs = Math.max(0, Math.min(ms, 60000));
    return new Promise((resolve) => setTimeout(resolve, safeMs));
  }

  /**
   * Close a page
   * @param {string} taskSpaceId
   * @param {string} [pageIdOrLabel]
   */
  async closePage(taskSpaceId, pageIdOrLabel) {
    const pages = this._getPagesForSpace(taskSpaceId);
    const page = this.resolvePage(taskSpaceId, pageIdOrLabel);

    if (this.driver && typeof this.driver.closePage === "function") {
      await this.driver.closePage(page.id);
    }

    page.closed = true;
    pages.delete(page.id);

    // If active page was closed, update active page pointer
    if (this.activePageBySpace.get(taskSpaceId) === page.id) {
      const remaining = Array.from(pages.keys());
      if (remaining.length > 0) {
        this.activePageBySpace.set(taskSpaceId, remaining[0]);
      } else {
        this.activePageBySpace.delete(taskSpaceId);
      }
    }

    if (this.taskSpaceManager) {
      const space = this.taskSpaceManager.getTaskSpace(taskSpaceId);
      if (space) {
        space.pages = space.pages.filter((l) => l !== page.label);
      }
    }

    return { closed: true, pageId: page.id, label: page.label };
  }

  /**
   * Clean up all pages for a taskSpace
   * @param {string} taskSpaceId
   */
  async closeAllPagesForSpace(taskSpaceId) {
    const pages = this._getPagesForSpace(taskSpaceId);
    for (const pageId of Array.from(pages.keys())) {
      await this.closePage(taskSpaceId, pageId).catch(() => {});
    }
    this.spacePages.delete(taskSpaceId);
    this.activePageBySpace.delete(taskSpaceId);
  }
}
