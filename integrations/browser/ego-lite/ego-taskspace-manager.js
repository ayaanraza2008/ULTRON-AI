/**
 * ULTRON AI — Ego Lite TaskSpace Manager
 * Module: integrations/browser/ego-lite/ego-taskspace-manager.js
 *
 * Responsibilities:
 * 1. Implements TaskSpace lifecycle: creation, selection, handoff, and teardown.
 * 2. Enforces ownership: agent-owned vs user-owned spaces.
 * 3. Enforces Resource Budget: Maximum 3 concurrent TaskSpaces (for 8 GB RAM host).
 * 4. Manages Page allocation: `p1`, `p2`, ... with max 5 pages per space.
 * 5. Adopts or releases unmanaged tabs into/out of TaskSpaces.
 */

import {
  EGO_BROWSER_STATE,
  TASKSPACE_OWNERSHIP,
  RESOURCE_BUDGETS
} from "./ego-constants.js";

export class EgoTaskSpaceManager {
  constructor(options = {}) {
    this.maxConcurrentSpaces = options.maxConcurrentSpaces || RESOURCE_BUDGETS.MAX_CONCURRENT_TASKSPACES;
    this.maxPagesPerSpace = options.maxPagesPerSpace || RESOURCE_BUDGETS.MAX_PAGES_PER_TASKSPACE;
    this.spaces = new Map(); // spaceId -> SpaceObject
    this.nextSpaceId = 1;
    this.activeSpaceId = null;
  }

  /**
   * Retrieves or creates a TaskSpace by name or ID.
   * Matches upstream `taskSpace(nameOrId)` semantics.
   */
  async taskSpace(nameOrId, options = {}) {
    // 1. Check if nameOrId matches an existing space by ID
    if (this.spaces.has(nameOrId)) {
      this.activeSpaceId = nameOrId;
      return this._formatSpaceHandle(this.spaces.get(nameOrId));
    }

    const numericId = typeof nameOrId === "number" ? nameOrId : parseInt(nameOrId, 10);
    if (!isNaN(numericId) && this.spaces.has(numericId)) {
      this.activeSpaceId = numericId;
      return this._formatSpaceHandle(this.spaces.get(numericId));
    }

    // 2. Check if nameOrId matches an existing space by Name
    const spaceName = String(nameOrId || "default");
    for (const space of this.spaces.values()) {
      if (space.name === spaceName) {
        this.activeSpaceId = space.spaceId;
        return this._formatSpaceHandle(space);
      }
    }

    // 3. Check resource budget
    const activeAgentSpaces = [...this.spaces.values()].filter(
      (s) => s.status === "ACTIVE" && s.ownership === TASKSPACE_OWNERSHIP.AGENT
    );
    if (activeAgentSpaces.length >= this.maxConcurrentSpaces) {
      throw new Error(
        `EGO_RESOURCE_BUDGET_EXCEEDED: Budget exceeded. Cannot create TaskSpace '${spaceName}'. Max active spaces (${this.maxConcurrentSpaces}) reached for 8GB RAM host.`
      );
    }

    // 4. Create new space
    const id = this.nextSpaceId++;
    const newSpace = {
      spaceId: id,
      name: spaceName,
      ownership: options.ownership || TASKSPACE_OWNERSHIP.AGENT,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      pages: new Map(), // label -> PageData
      tabs: new Map(), // targetId -> TabData
      nextPageNumber: 1,
      controlledBy: "agent"
    };

    // Auto-create initial default page p1
    const p1Label = "p1";
    const p1TargetId = `target-${id}-1`;
    const initialPage = {
      label: p1Label,
      spaceId: id,
      targetId: p1TargetId,
      url: "about:blank",
      title: "New Tab",
      openedBy: "agent",
      createdAt: new Date().toISOString(),
      active: true
    };
    newSpace.pages.set(p1Label, initialPage);
    newSpace.tabs.set(p1TargetId, { ...initialPage });

    this.spaces.set(id, newSpace);
    this.activeSpaceId = id;
    return this._formatSpaceHandle(newSpace);
  }

  /**
   * Allocates a new Page inside an existing TaskSpace.
   */
  async newPage(spaceId, options = {}) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) throw new Error(`TaskSpace ${spaceId} not found.`);

    if (space.pages.size >= this.maxPagesPerSpace) {
      throw new Error(
        `EGO_PAGE_BUDGET_EXCEEDED: TaskSpace ${spaceId} reached maximum of ${this.maxPagesPerSpace} pages. Close unused pages.`
      );
    }

    space.nextPageNumber += 1;
    const label = `p${space.nextPageNumber}`;
    const targetId = `target-${space.spaceId}-${space.nextPageNumber}`;

    const pageData = {
      label,
      spaceId: space.spaceId,
      targetId,
      url: options.url || "about:blank",
      title: "New Tab",
      openedBy: options.openedBy || "agent",
      createdAt: new Date().toISOString(),
      active: true
    };

    space.pages.set(label, pageData);
    space.tabs.set(targetId, { ...pageData });
    return { ...pageData };
  }

  /**
   * Adopts an unmanaged browser tab into the TaskSpace with an agent label.
   */
  async adopt(spaceId, targetId, options = {}) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) throw new Error(`TaskSpace ${spaceId} not found.`);

    const tab = space.tabs.get(targetId);
    if (!tab) {
      throw new Error(`Tab ${targetId} not found in TaskSpace ${spaceId}.`);
    }

    if (tab.label) {
      return space.pages.get(tab.label);
    }

    space.nextPageNumber += 1;
    const label = options.as || `p${space.nextPageNumber}`;
    tab.label = label;
    tab.openedBy = tab.openedBy || "user";

    space.pages.set(label, tab);
    return { ...tab };
  }

  /**
   * Releases an unknown/user-owned page from agent management without closing the tab.
   */
  async release(spaceId, label) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) throw new Error(`TaskSpace ${spaceId} not found.`);

    const page = space.pages.get(label);
    if (!page) return false;

    // Remove from managed pages, retain in unmanaged tabs
    space.pages.delete(label);
    const tab = space.tabs.get(page.targetId);
    if (tab) {
      delete tab.label;
    }
    return true;
  }

  /**
   * Hands off control of the TaskSpace to the human user.
   */
  async handOff(spaceId, reason = "") {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) throw new Error(`TaskSpace ${spaceId} not found.`);

    space.controlledBy = "user";
    space.ownership = TASKSPACE_OWNERSHIP.USER;
    space.status = "HANDED_OFF";
    return {
      spaceId: space.spaceId,
      status: "HANDED_OFF",
      ownership: TASKSPACE_OWNERSHIP.USER,
      state: EGO_BROWSER_STATE.WAITING_FOR_USER,
      reason,
      message: `Control of TaskSpace '${space.name}' handed off to user.`
    };
  }

  /**
   * Resumes or claims control of a user-owned or handed-off space.
   */
  async takeOverTaskSpace(spaceId) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) throw new Error(`TaskSpace ${spaceId} not found.`);

    space.controlledBy = "agent";
    space.ownership = TASKSPACE_OWNERSHIP.AGENT;
    space.status = "ACTIVE";
    return {
      spaceId: space.spaceId,
      status: "ACTIVE",
      ownership: TASKSPACE_OWNERSHIP.AGENT,
      state: EGO_BROWSER_STATE.TASK_RUNNING,
      message: `Agent assumed control of TaskSpace '${space.name}'.`
    };
  }

  /**
   * Finishes and cleans up a TaskSpace:
   * - Agent-created pages are closed
   * - User-owned tabs are preserved
   */
  async finish(spaceId, options = {}) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    const space = this.spaces.get(numericId) || this.spaces.get(spaceId);
    if (!space) return false;

    const closedPages = [];
    const preservedTabs = [];

    for (const [label, page] of space.pages.entries()) {
      if (page.openedBy === "agent" && !options.keepPages) {
        space.pages.delete(label);
        space.tabs.delete(page.targetId);
        closedPages.push(label);
      } else {
        preservedTabs.push(label);
      }
    }

    space.status = "FINISHED";
    this.spaces.delete(space.spaceId);

    return {
      spaceId: space.spaceId,
      status: "FINISHED",
      closedPages,
      preservedTabs
    };
  }

  /**
   * Get raw TaskSpace by ID
   */
  getTaskSpace(spaceId) {
    const numericId = typeof spaceId === "number" ? spaceId : parseInt(spaceId, 10);
    return this.spaces.get(numericId) || this.spaces.get(spaceId) || null;
  }

  /**
   * Lists all known TaskSpaces.
   */
  listTaskSpaces() {
    return [...this.spaces.values()].map((s) => ({
      spaceId: s.spaceId,
      id: String(s.spaceId),
      name: s.name,
      ownership: s.ownership,
      status: s.status,
      controlledBy: s.controlledBy,
      pageCount: s.pages.size,
      tabCount: s.tabs.size,
      createdAt: s.createdAt,
      lastAccessedAt: s.lastAccessedAt
    }));
  }

  _formatSpaceHandle(space) {
    const pageList = [...space.pages.values()];
    return {
      id: String(space.spaceId),
      spaceId: space.spaceId,
      name: space.name,
      ownership: space.ownership,
      pages: pageList,
      page: (label = "p1") => space.pages.get(label) || null,
      getPages: async () => [...space.pages.values()],
      tabs: async () => [...space.tabs.values()],
      newPage: (opts) => this.newPage(space.spaceId, opts),
      adopt: (pageHandle, opts) => this.adopt(space.spaceId, pageHandle.targetId || pageHandle, opts),
      release: (label) => this.release(space.spaceId, label),
      handOff: (reason) => this.handOff(space.spaceId, reason),
      takeOver: () => this.takeOverTaskSpace(space.spaceId),
      finish: (opts) => this.finish(space.spaceId, opts)
    };
  }
}
