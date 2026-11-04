/**
 * ULTRON AI — Ego Lite Browser Integration: Constants & State Definitions
 * Module: integrations/browser/ego-lite/ego-constants.js
 *
 * Defines runtime states, permission boundaries, TaskSpace ownership models,
 * element actions, resource thresholds, and official upstream references.
 */

export const EGO_BROWSER_STATE = {
  BROWSER_OFFLINE: "BROWSER_OFFLINE",
  CONNECTING: "CONNECTING",
  READY: "READY",
  TASK_RUNNING: "TASK_RUNNING",
  OBSERVING: "OBSERVING",
  NAVIGATING: "NAVIGATING",
  INTERACTING: "INTERACTING",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  RECOVERING: "RECOVERING",
  COMPLETED: "COMPLETED",
  ERROR: "ERROR"
};

export const TASKSPACE_OWNERSHIP = {
  AGENT: "agent",
  USER: "user",
  SHARED: "shared"
};

export const PAGE_SCOPE = {
  VIEWPORT: "viewport",
  FULL_PAGE: "full_page",
  SUBTREE: "subtree"
};

export const LOAD_STATES = {
  LOAD: "load",
  DOMCONTENTLOADED: "domcontentloaded",
  NETWORKIDLE: "networkidle"
};

export const ROUTING_TARGET = {
  EGO_LITE_DESKTOP: "EGO_LITE_DESKTOP",
  EGO_BROWSER_CLI: "EGO_BROWSER_CLI",
  DIRECT_CHROMIUM_CDP: "DIRECT_CHROMIUM_CDP",
  BROWSER_USE: "BROWSER_USE",
  HTTP_SEARCH: "HTTP_SEARCH",
  // Backward compatibility alias:
  EGO_LITE: "EGO_LITE"
};

export const DRIVER_TYPE = {
  EGO_LITE_DESKTOP: "EGO_LITE_DESKTOP",
  EGO_BROWSER_CLI: "EGO_BROWSER_CLI",
  DIRECT_CHROMIUM_CDP: "DIRECT_CHROMIUM_CDP",
  BROWSER_USE: "BROWSER_USE",
  HTTP_SEARCH: "HTTP_SEARCH",
  TEST_DOUBLE: "TEST_DOUBLE"
};

export const EGO_ACTIONS = {
  NAVIGATE: "navigate",
  SNAPSHOT: "snapshot",
  SCREENSHOT: "screenshot",
  CLICK: "click",
  DBLCLICK: "dblclick",
  HOVER: "hover",
  DRAG_AND_DROP: "dragAndDrop",
  FILL: "fill",
  SELECT_OPTION: "selectOption",
  FOCUS: "focus",
  PRESS: "press",
  INPUT_FILES: "setInputFiles",
  WAIT_FOR_URL: "waitForURL",
  WAIT_FOR_SELECTOR: "waitForSelector",
  WAIT_FOR_LOAD_STATE: "waitForLoadState",
  WAIT_FOR_FUNCTION: "waitForFunction",
  EVALUATE: "evaluate",
  FETCH: "fetch",
  CDP: "cdp",
  HAND_OFF: "handOff",
  FINISH: "finish"
};

export const PERMISSION_LEVELS = {
  LEVEL_1_OBSERVE: 1,   // Read-only snapshots, page metadata, search, navigation
  LEVEL_2_INTERACT: 2,  // Clicks, non-sensitive form input, hovering, tab management
  LEVEL_3_SENSITIVE: 3, // File downloads/uploads, authenticated dashboard interaction
  LEVEL_4_CRITICAL: 4   // Form submission with side effects, messaging, purchases, account changes
};

export const RESOURCE_BUDGETS = {
  MAX_CONCURRENT_TASKSPACES: 3, // Safe limit for 8 GB RAM host
  MAX_PAGES_PER_TASKSPACE: 5,   // Prevents runaway tab proliferation
  DEFAULT_TIMEOUT_MS: 30000,
  CDP_TIMEOUT_MS: 15000,
  MAX_SNAPSHOT_BYTES: 1024 * 1024, // 1 MB snapshot ceiling
  MAX_MEMORY_MB: 1024           // Per-subsystem memory allowance
};

export const UPSTREAM_CONFIG = {
  OFFICIAL_APP_URL: "https://lite.ego.app/",
  OFFICIAL_DOCS_URL: "https://lite.ego.app/document/",
  OFFICIAL_GITHUB_REPO: "https://github.com/citrolabs/ego-lite",
  WINDOWS_INSTALLER_URL: "https://cdn.ego.app/setup/windows/x64/egoliteSetup-Y7MbxKIuhzFB.exe",
  UPSTREAM_VERSION: "2.1.0"
};
