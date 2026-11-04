/**
 * ULTRON AI — Ego Lite Master Browser Adapter
 * Module: integrations/browser/ego-lite/ego-adapter.js
 *
 * Master facade integrating TaskSpace lifecycle, Page navigation,
 * semantic snapshots, interaction executor, site learnings, authenticated sessions,
 * security guardrails, audit logging, and intelligent routing.
 *
 * Enforces strict driver separation and verified execution metadata on all actions.
 */

import { EGO_BROWSER_STATE, RESOURCE_BUDGETS } from "./ego-constants.js";
import { EgoRuntimeManager } from "./ego-runtime-manager.js";
import { EgoTaskSpaceManager } from "./ego-taskspace-manager.js";
import { EgoPageManager } from "./ego-page-manager.js";
import { EgoSnapshotEngine } from "./ego-snapshot-engine.js";
import { EgoActionExecutor } from "./ego-action-executor.js";
import { EgoSessionManager } from "./ego-session-manager.js";
import { EgoLearningManager } from "./ego-learning-manager.js";
import { EgoSecurityGuard } from "./ego-security-guard.js";
import { EgoAuditLogger } from "./ego-audit-logger.js";
import { EgoBrowserRouter } from "./ego-browser-router.js";
import { DirectChromiumCdpDriver } from "./direct-chromium-driver.js";

export class EgoBrowserAdapter {
  /**
   * @param {Object} [options={}]
   */
  constructor(options = {}) {
    this.options = options;

    // 1. Instantiate core subsystems
    this.runtimeManager = new EgoRuntimeManager(options.runtimeOptions);
    this.taskSpaceManager = new EgoTaskSpaceManager(options.taskSpaceOptions);
    this.securityGuard = new EgoSecurityGuard(options.securityOptions);
    this.auditLogger = new EgoAuditLogger(options.auditOptions);
    this.sessionManager = new EgoSessionManager(options.sessionOptions);
    this.learningManager = new EgoLearningManager(options.learningOptions);
    this.snapshotEngine = new EgoSnapshotEngine({
      securityGuard: this.securityGuard,
      driver: options.driver
    });
    this.pageManager = new EgoPageManager({
      taskSpaceManager: this.taskSpaceManager,
      securityGuard: this.securityGuard,
      driver: options.driver
    });
    this.actionExecutor = new EgoActionExecutor({
      snapshotEngine: this.snapshotEngine,
      securityGuard: this.securityGuard,
      auditLogger: this.auditLogger,
      driver: options.driver,
      downloadsDir: options.downloadsDir
    });
    this.browserRouter = new EgoBrowserRouter({
      runtimeManager: this.runtimeManager,
      browserUseBridge: options.browserUseBridge,
      directChromiumDriver: options.driver
    });

    this.driver = options.driver || null;
    this.state = EGO_BROWSER_STATE.READY;
    this.activeTaskSpaceId = null;
    this.activePageId = null;
  }

  /**
   * Inject or update driver instance (real CDP or mock)
   * @param {Object} driver
   */
  setDriver(driver) {
    this.driver = driver;
    this.pageManager.setDriver(driver);
    this.snapshotEngine.setDriver(driver);
    this.actionExecutor.setDriver(driver);
    if (this.browserRouter) {
      this.browserRouter.setDirectChromiumDriver(driver);
    }
  }

  /**
   * Returns exact verified driver type executing browser actions
   */
  getExecutionDriverType() {
    if (this.driver) {
      if (this.driver.driverType) return this.driver.driverType;
      if (this.driver.isDirectCdp) return "DIRECT_CHROMIUM_CDP";
      // HONESTY: driver exists but provides no verifiable type — never claim CDP or Ego Lite.
      return "UNVERIFIED_DRIVER";
    }
    if (this.options?.runtimeOptions?.inMemoryDouble || this.runtimeManager?.inMemoryDouble) {
      return "TEST_DOUBLE";
    }
    return "TEST_DOUBLE";
  }

  /**
   * Get comprehensive status of the Ego Lite browser subsystem
   * @returns {Promise<Object>}
   */
  async getStatus() {
    const health = await this.runtimeManager.getRuntimeHealth();
    const taskSpaces = this.taskSpaceManager.listTaskSpaces();
    const auditStats = this.auditLogger.getStats();
    const learnings = await this.learningManager.listLearnings();

    let browserState = EGO_BROWSER_STATE.READY;
    if (!health.egoApp?.installed && !this.driver) {
      browserState = EGO_BROWSER_STATE.BROWSER_OFFLINE;
    } else if (this.securityGuard.emergencyStopEngaged) {
      browserState = EGO_BROWSER_STATE.ERROR;
    }

    return {
      state: browserState,
      runtime: health,
      activeDriver: this.getExecutionDriverType(),
      activeTaskSpaceId: this.activeTaskSpaceId,
      taskSpacesCount: taskSpaces.length,
      taskSpaces,
      siteLearningsCount: learnings.length,
      auditStats,
      emergencyStopEngaged: this.securityGuard.emergencyStopEngaged,
      resourceLimits: {
        maxTaskSpaces: RESOURCE_BUDGETS.MAX_CONCURRENT_TASKSPACES,
        maxPagesPerSpace: RESOURCE_BUDGETS.MAX_PAGES_PER_TASKSPACE
      }
    };
  }

  /**
   * Switch to or create a TaskSpace
   * @param {string} nameOrId
   * @param {Object} [options={}]
   */
  async taskSpace(nameOrId, options = {}) {
    const space = await this.taskSpaceManager.taskSpace(nameOrId, options);
    this.activeTaskSpaceId = space.id;

    // Ensure at least one page exists
    let pages = this.pageManager.listPages(space.id);
    if (pages.length === 0) {
      const page = await this.pageManager.newPage(space.id, options.initialUrl || "about:blank");
      this.activePageId = page.id;
    } else {
      this.activePageId = pages[0].id;
    }

    return space;
  }

  /**
   * List all active TaskSpaces
   */
  listTaskSpaces() {
    return this.taskSpaceManager.listTaskSpaces();
  }

  /**
   * Close a TaskSpace and all its associated pages
   * @param {string} [taskSpaceId]
   */
  async closeTaskSpace(taskSpaceId) {
    const target = taskSpaceId || this.activeTaskSpaceId;
    if (!target) {
      throw new Error("No active TaskSpace to close");
    }

    const space = this.taskSpaceManager.getTaskSpace(target);
    const targetId = space ? space.spaceId : target;

    await this.pageManager.closeAllPagesForSpace(targetId);
    const result = await this.taskSpaceManager.finish(targetId);

    if (this.activeTaskSpaceId === targetId || this.activeTaskSpaceId === target) {
      const remaining = this.taskSpaceManager.listTaskSpaces();
      this.activeTaskSpaceId = remaining.length > 0 ? remaining[0].id : null;
      this.activePageId = null;
    }

    return result;
  }

  /**
   * Create a new page / tab in a TaskSpace
   * @param {string} [taskSpaceId]
   * @param {string} [url="about:blank"]
   */
  async newPage(taskSpaceId, url = "about:blank") {
    const targetSpaceId = taskSpaceId || this.activeTaskSpaceId;
    if (!targetSpaceId) {
      // Auto-create default space
      const defaultSpace = await this.taskSpace("default");
      return await this.newPage(defaultSpace.id, url);
    }

    const page = await this.pageManager.newPage(targetSpaceId, url);
    this.activePageId = page.id;
    return page;
  }

  /**
   * Navigate page to URL
   * @param {string} url
   * @param {Object} [options={}]
   */
  async goto(url, options = {}) {
    const spaceId = options.taskSpaceId || this.activeTaskSpaceId;
    if (!spaceId) {
      await this.taskSpace("default");
    }
    const targetSpaceId = this.activeTaskSpaceId;
    const result = await this.pageManager.goto(targetSpaceId, url, options);
    this.activePageId = result.pageId;
    return result;
  }

  /**
   * Capture semantic snapshot with @N refs
   * @param {Object} [options={}]
   */
  async snapshot(options = {}) {
    const spaceId = options.taskSpaceId || this.activeTaskSpaceId;
    if (!spaceId) {
      throw new Error("Cannot capture snapshot without an active TaskSpace");
    }

    const page = this.pageManager.resolvePage(spaceId, options.pageIdOrLabel);
    return await this.snapshotEngine.snapshot({
      pageId: page.id,
      url: page.url,
      title: page.title,
      scope: options.scope,
      subtreeRoot: options.subtreeRoot,
      includeScreenshot: options.includeScreenshot,
      simulatedElements: options.simulatedElements
    });
  }

  /**
   * Click element by @N ref or selector
   */
  async click(refOrSelector, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for click");
    return await this.actionExecutor.click(pageId, refOrSelector, options);
  }

  /**
   * Double-click element
   */
  async dblclick(refOrSelector, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for dblclick");
    return await this.actionExecutor.dblclick(pageId, refOrSelector, options);
  }

  /**
   * Hover over element
   */
  async hover(refOrSelector, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for hover");
    return await this.actionExecutor.hover(pageId, refOrSelector, options);
  }

  /**
   * Fill input element
   */
  async fill(refOrSelector, value, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for fill");
    return await this.actionExecutor.fill(pageId, refOrSelector, value, options);
  }

  /**
   * Select dropdown option
   */
  async selectOption(refOrSelector, values, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for selectOption");
    return await this.actionExecutor.selectOption(pageId, refOrSelector, values, options);
  }

  /**
   * Drag and drop
   */
  async dragAndDrop(source, target, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for dragAndDrop");
    return await this.actionExecutor.dragAndDrop(pageId, source, target);
  }

  /**
   * Press key
   */
  async press(key, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for press");
    return await this.actionExecutor.press(pageId, key, options);
  }

  /**
   * Type text
   */
  async type(text, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for type");
    return await this.actionExecutor.type(pageId, text, options);
  }

  /**
   * Safe download file to UltronWorkspace/downloads
   */
  async download(downloadUrl, filename, options = {}) {
    const pageId = options?.pageId || this.activePageId;
    return await this.actionExecutor.downloadFile(pageId, downloadUrl, filename);
  }

  /**
   * Evaluate JavaScript in page context
   */
  async evaluate(script, ...args) {
    const pageId = this.activePageId;
    if (!pageId) throw new Error("No active page for evaluate");
    return await this.actionExecutor.evaluate(pageId, script, ...args);
  }

  /**
   * Browser-side fetch
   */
  async fetch(url, options = {}) {
    const pageId = this.activePageId;
    if (!pageId) throw new Error("No active page for fetch");
    return await this.actionExecutor.fetch(pageId, url, options);
  }

  /**
   * Capture screenshot of active page
   * @param {Object} [options={}]
   */
  async screenshot(options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for screenshot");
    return await this.actionExecutor.screenshot(pageId, options);
  }

  /**
   * Scroll active page viewport
   * @param {Object} [options={}]
   */
  async scroll(options = {}) {
    const pageId = options?.pageId || this.activePageId;
    if (!pageId) throw new Error("No active page for scroll");
    return await this.actionExecutor.scroll(pageId, options);
  }

  /**
   * Create a new tab
   * @param {string} [url="about:blank"]
   */
  async createTab(url = "about:blank") {
    if (this.driver && typeof this.driver.createTab === "function") {
      const res = await this.driver.createTab(url);
      if (res?.pageId) this.activePageId = res.pageId;
      return res;
    }
    return await this.newPage(this.activeTaskSpaceId, url);
  }

  /**
   * List open tabs
   */
  async listTabs() {
    if (this.driver && typeof this.driver.listTabs === "function") {
      return await this.driver.listTabs();
    }
    const spaceId = this.activeTaskSpaceId;
    return this.pageManager.listPages(spaceId);
  }

  /**
   * Switch active tab
   * @param {string} pageId
   */
  async switchTab(pageId) {
    if (this.driver && typeof this.driver.switchTab === "function") {
      const res = await this.driver.switchTab(pageId);
      this.activePageId = pageId;
      return res;
    }
    this.activePageId = pageId;
    return { activeTabId: pageId };
  }

  /**
   * Hand off control of TaskSpace to user
   */
  handOff(options = {}) {
    const spaceId = options?.taskSpaceId || this.activeTaskSpaceId;
    return this.taskSpaceManager.handOff(spaceId, options?.reason);
  }

  /**
   * Agent re-assumes control of TaskSpace
   */
  takeOver(options = {}) {
    const spaceId = options?.taskSpaceId || this.activeTaskSpaceId;
    return this.taskSpaceManager.takeOverTaskSpace(spaceId);
  }

  /**
   * List site learnings
   */
  async listLearnings() {
    return await this.learningManager.listLearnings();
  }

  /**
   * Get learning for URL
   */
  async getLearningForUrl(url) {
    return await this.learningManager.getLearningForUrl(url);
  }

  /**
   * Execute site learning tool
   */
  async executeSiteTool(siteId, toolName, args = {}) {
    return await this.learningManager.executeSiteTool(siteId, toolName, args);
  }

  /**
   * Intelligently evaluate task and route to best browser engine
   */
  async routeTask(task) {
    return await this.browserRouter.resolveRoute(task);
  }

  /**
   * Emergency stop
   */
  triggerEmergencyStop(reason) {
    return this.securityGuard.triggerEmergencyStop(reason);
  }

  /**
   * Reset emergency stop
   */
  resetEmergencyStop() {
    return this.securityGuard.resetEmergencyStop();
  }
}

// Export singleton
export const egoBrowserAdapter = new EgoBrowserAdapter(
  process.env.ULTRON_ENABLE_REAL_CDP === "1"
    ? {
        // Real Chromium/CDP control is opt-in (env ULTRON_ENABLE_REAL_CDP=1).
        // When enabled, the host browser launches lazily on first navigation.
        // When disabled (default), navigation uses the honest HTTP_FETCH_PREVIEW
        // path and interactions report simulated: true instead of fabricating.
        driver: new DirectChromiumCdpDriver({
          securityGuard: new EgoSecurityGuard()
        })
      }
    : {}
);
