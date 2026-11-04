/**
 * ULTRON AI — Mobile Task Planner & Intent Decomposition Engine
 *
 * Converts natural-language user commands into safe, verifiable, multi-step mobile execution DAGs.
 * Maps high-level instructions (e.g. "open YouTube and search for AI tutorials") into
 * structured sequential steps with explicit state verification criteria.
 */

import { ACTION_PERMISSION_TIERS, MOBILE_PERMISSION_LEVELS } from "./mobile-permission-engine.js";

// Common package name resolver for standard Android applications
export const COMMON_APP_PACKAGES = {
  youtube: "com.google.android.youtube",
  chrome: "com.android.chrome",
  browser: "com.android.chrome",
  settings: "com.android.settings",
  maps: "com.google.android.apps.maps",
  camera: "com.android.camera2",
  calculator: "com.google.android.calculator",
  clock: "com.google.android.deskclock",
  gmail: "com.google.android.gm",
  whatsapp: "com.whatsapp",
  telegram: "org.telegram.messenger",
  spotify: "com.spotify.music"
};

export class MobileTaskPlanner {
  constructor(options = {}) {
    this.packageMap = { ...COMMON_APP_PACKAGES, ...(options.customPackageMap || {}) };
  }

  /**
   * Plan from natural language intent with DAG IDs and dependencies.
   */
  async planFromIntent(goal, context = {}) {
    const p = this.plan(goal, context);
    if (!p.id) p.id = "plan-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    p.steps = p.steps.map((s, idx) => ({
      id: s.id || `step-${idx + 1}`,
      dependsOn: s.dependsOn || (idx > 0 ? [`step-${idx}`] : []),
      ...s
    }));
    return p;
  }

  /**
   * Validates DAG step dependencies for cycle detection.
   */
  validateDag(steps = []) {
    const visited = new Set();
    const visiting = new Set();
    const adj = new Map();
    for (const step of steps) {
      adj.set(step.id, step.dependsOn || []);
    }

    const hasCycle = (nodeId) => {
      visiting.add(nodeId);
      const deps = adj.get(nodeId) || [];
      for (const dep of deps) {
        if (visiting.has(dep)) return true;
        if (!visited.has(dep) && hasCycle(dep)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    };

    for (const step of steps) {
      if (!visited.has(step.id)) {
        if (hasCycle(step.id)) return { valid: false, error: "CYCLE_DETECTED" };
      }
    }
    return { valid: true };
  }

  /**
   * Parse user intent and generate a verifiable execution plan.
   */
  plan(naturalGoal, context = {}) {
    const rawGoal = String(naturalGoal || "").trim();
    const lower = rawGoal.toLowerCase();
    const targetDevice = context.deviceId || null;

    // Intent 1: Device Discovery / Status
    if (
      lower.includes("show my connected devices") ||
      lower.includes("list devices") ||
      lower.includes("connect my phone") ||
      lower.includes("find my phone") ||
      lower.includes("mobile status")
    ) {
      return {
        goal: rawGoal,
        intent: "DEVICE_DISCOVERY",
        deviceId: targetDevice,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_list_available_devices",
            params: {},
            description: "Scan for available physical and virtual Android/iOS devices.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_list_available_devices,
            verify: { checkDeviceCount: true }
          }
        ]
      };
    }

    // Intent 2: Take Screenshot / What's visible
    if (
      lower.includes("take a screenshot") ||
      lower.includes("capture screen") ||
      lower.includes("what is visible on my phone") ||
      lower.includes("look at my phone") ||
      lower.includes("screen preview")
    ) {
      return {
        goal: rawGoal,
        intent: "SCREEN_INSPECTION",
        deviceId: targetDevice,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_take_screenshot",
            params: { device: targetDevice },
            description: "Capture high-resolution screenshot from active device screen.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_take_screenshot,
            verify: { requireImage: true }
          }
        ]
      };
    }

    // Intent 3: Inspect Accessibility Elements
    if (
      lower.includes("list elements") ||
      lower.includes("read screen") ||
      lower.includes("inspect ui") ||
      lower.includes("help me navigate this app")
    ) {
      return {
        goal: rawGoal,
        intent: "UI_HIERARCHY_INSPECTION",
        deviceId: targetDevice,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_list_elements_on_screen",
            params: { device: targetDevice },
            description: "Read UI element hierarchy, labels, coordinates, and short refs.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_list_elements_on_screen,
            verify: { requireElements: true }
          }
        ]
      };
    }

    // Intent: Open URL on Phone (evaluated before generic app launch)
    const urlMatch = rawGoal.match(/(?:open|navigate\s+to|visit)\s+(https?:\/\/[^\s]+)/i);
    if (urlMatch) {
      const targetUrl = urlMatch[1];
      return {
        goal: rawGoal,
        intent: "OPEN_URL",
        deviceId: targetDevice,
        targetUrl,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_open_url",
            params: { device: targetDevice, url: targetUrl },
            description: `Open URL '${targetUrl}' in mobile browser.`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_open_url,
            verify: { checkBrowserLaunch: true }
          }
        ]
      };
    }

    // Intent 4: Multi-Step Search: "open [app] and search for [query]"
    const searchMatch = lower.match(/open\s+([a-z0-9_-]+)(?:\s+on\s+my\s+phone|\s+on\s+phone|\s+on\s+device)?\s+and\s+search\s+(?:for\s+)?["']?([^"']+)["']?/i);
    if (searchMatch) {
      const appName = searchMatch[1].toLowerCase();
      const query = searchMatch[2].trim();
      const packageName = this.resolvePackageName(appName);

      return {
        goal: rawGoal,
        intent: "APP_SEARCH_WORKFLOW",
        deviceId: targetDevice,
        targetApp: appName,
        targetPackage: packageName,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_launch_app",
            params: { device: targetDevice, package: packageName },
            description: `Launch application ${appName} (${packageName}).`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_launch_app,
            verify: { expectedForegroundPackage: packageName }
          },
          {
            stepIndex: 2,
            action: "mobile_list_elements_on_screen",
            params: { device: targetDevice },
            description: `Inspect ${appName} UI hierarchy to locate search bar or icon.`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_list_elements_on_screen,
            verify: { requireElements: true }
          },
          {
            stepIndex: 3,
            action: "mobile_type_keys",
            params: { device: targetDevice, text: query },
            description: `Type search query '${query}' into active input element.`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_type_keys,
            verify: { verifyInput: true }
          },
          {
            stepIndex: 4,
            action: "mobile_press_button",
            params: { device: targetDevice, button: "ENTER" },
            description: "Submit search query via ENTER key.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_press_button,
            verify: { checkKeySuccess: true }
          },
          {
            stepIndex: 5,
            action: "mobile_take_screenshot",
            params: { device: targetDevice },
            description: "Capture screenshot to visually verify search results screen.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_take_screenshot,
            verify: { requireImage: true }
          }
        ]
      };
    }

    // Intent 5: App Launch: "open [app]", "launch [app]", or "[app] open karo"
    let targetApp = null;
    const knownApps = Object.keys(this.packageMap);
    for (const app of knownApps) {
      const reg = new RegExp(`\\b${app}\\b`, "i");
      if (reg.test(lower) && /\b(open|launch|kholo|chalao|start)\b/i.test(lower)) {
        targetApp = app;
        break;
      }
    }
    if (!targetApp) {
      const launchMatch = lower.match(/(?:open|launch)\s+([a-z0-9_.-]+)/i);
      if (launchMatch && !["karo", "kijiye", "karna", "please"].includes(launchMatch[1].toLowerCase())) {
        targetApp = launchMatch[1].toLowerCase();
      } else {
        const reverseMatch = lower.match(/([a-z0-9_.-]+)\s+(?:open|kholo|chalao)/i);
        if (reverseMatch && !["phone", "par", "pe", "mein"].includes(reverseMatch[1].toLowerCase())) {
          targetApp = reverseMatch[1].toLowerCase();
        }
      }
    }
    if (targetApp) {
      const appName = targetApp;
      const packageName = this.resolvePackageName(appName);
      return {
        goal: rawGoal,
        intent: "APP_LAUNCH",
        deviceId: targetDevice,
        targetApp: appName,
        targetPackage: packageName,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_launch_app",
            params: { device: targetDevice, package: packageName },
            description: `Launch application ${appName} (${packageName}).`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_launch_app,
            verify: { expectedForegroundPackage: packageName }
          }
        ]
      };
    }

    // Intent 6: Scrolling / Navigation: "scroll down", "scroll up", "swipe left", "swipe right"
    if (lower.includes("scroll down") || lower.includes("swipe down") || lower.includes("scroll up") || lower.includes("swipe up") || lower.includes("swipe left") || lower.includes("swipe right")) {
      let dir = "down";
      if (lower.includes("up")) dir = "up";
      if (lower.includes("left")) dir = "left";
      if (lower.includes("right")) dir = "right";

      return {
        goal: rawGoal,
        intent: "SCREEN_NAVIGATION",
        deviceId: targetDevice,
        direction: dir,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_swipe_on_screen",
            params: { device: targetDevice, direction: dir },
            description: `Perform ${dir}ward swipe navigation on screen.`,
            permissionTier: ACTION_PERMISSION_TIERS.mobile_swipe_on_screen,
            verify: { checkStateShift: true }
          }
        ]
      };
    }

    // Intent 7: Navigation Keys: "go home", "go back", "press home", "press back"
    if (lower.includes("go home") || lower.includes("press home")) {
      return {
        goal: rawGoal,
        intent: "BUTTON_NAVIGATION",
        deviceId: targetDevice,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_press_button",
            params: { device: targetDevice, button: "HOME" },
            description: "Press device HOME hardware/navigation key.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_press_button,
            verify: { checkKeySuccess: true }
          }
        ]
      };
    }

    if (lower.includes("go back") || lower.includes("press back")) {
      return {
        goal: rawGoal,
        intent: "BUTTON_NAVIGATION",
        deviceId: targetDevice,
        steps: [
          {
            stepIndex: 1,
            action: "mobile_press_button",
            params: { device: targetDevice, button: "BACK" },
            description: "Press device BACK key.",
            permissionTier: ACTION_PERMISSION_TIERS.mobile_press_button,
            verify: { checkKeySuccess: true }
          }
        ]
      };
    }

    // Default: Generic single action
    return {
      goal: rawGoal,
      intent: "GENERIC_MOBILE_REQUEST",
      deviceId: targetDevice,
      steps: []
    };
  }

  /**
   * Resolve an application name (e.g. "youtube") to an Android package name.
   */
  resolvePackageName(appName) {
    const clean = String(appName || "").toLowerCase().trim();
    if (clean.includes(".")) {
      // Already a package name (e.g. com.example.app)
      return clean;
    }
    return this.packageMap[clean] || `com.${clean}`;
  }
}

export const mobileTaskPlanner = new MobileTaskPlanner();
