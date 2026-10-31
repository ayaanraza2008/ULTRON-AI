import test from "node:test";
import assert from "node:assert/strict";
import {
  connectionController,
  ConnectionController,
  CONNECTIVITY_MODES
} from "../system/connection-controller.js";

test("ConnectionController: initial state is online with full local and cloud catalog", () => {
  const controller = new ConnectionController();
  assert.equal(controller.mode, CONNECTIVITY_MODES.ONLINE);
  assert.equal(controller.isOnline, true);
  assert.ok(controller.localCapabilities.has("kokoro_tts"));
  assert.ok(controller.localCapabilities.has("local_llm_inference"));
  assert.ok(controller.localCapabilities.has("robotics_motion_control"));
  assert.ok(controller.onlineOnlyCapabilities.has("web_search_tavily"));
});

test("ConnectionController: mode switching and forced offline transition", () => {
  const controller = new ConnectionController();
  
  const offlineResult = controller.setForcedMode(CONNECTIVITY_MODES.OFFLINE);
  assert.equal(offlineResult.success, true);
  assert.equal(controller.mode, CONNECTIVITY_MODES.OFFLINE);
  assert.equal(controller.isOnline, false);
  assert.ok(controller.offlineSince);

  const hybridResult = controller.setForcedMode(CONNECTIVITY_MODES.HYBRID);
  assert.equal(hybridResult.success, true);
  assert.equal(controller.mode, CONNECTIVITY_MODES.HYBRID);
  assert.equal(controller.isOnline, true);
  assert.equal(controller.offlineSince, null);

  const invalidResult = controller.setForcedMode("INVALID_SPACE_MODE");
  assert.equal(invalidResult.success, false);
  assert.equal(invalidResult.error, "INVALID_CONNECTIVITY_MODE");
});

test("ConnectionController: task routing logic in OFFLINE mode", () => {
  const controller = new ConnectionController({ forcedMode: CONNECTIVITY_MODES.OFFLINE });

  // Local task routes to LOCAL_CPU
  const localRoute = controller.evaluateTaskRoute("kokoro_tts");
  assert.equal(localRoute.canExecute, true);
  assert.equal(localRoute.route, "LOCAL_CPU");

  // Local robotics task routes to LOCAL_CPU
  const botRoute = controller.evaluateTaskRoute("robotics_motion_control");
  assert.equal(botRoute.canExecute, true);
  assert.equal(botRoute.route, "LOCAL_CPU");

  // Online only task is blocked with degraded alternative
  const cloudRoute = controller.evaluateTaskRoute("web_search_tavily");
  assert.equal(cloudRoute.canExecute, false);
  assert.equal(cloudRoute.route, "BLOCKED_OFFLINE");
  assert.ok(cloudRoute.degradedAlternative);
});

test("ConnectionController: task routing logic in HYBRID and ONLINE modes", () => {
  const controller = new ConnectionController({ forcedMode: CONNECTIVITY_MODES.HYBRID });

  // Local capability uses LOCAL_FIRST in HYBRID
  const localFirst = controller.evaluateTaskRoute("cognitive_memory_vault");
  assert.equal(localFirst.canExecute, true);
  assert.equal(localFirst.route, "LOCAL_FIRST");

  // External capability uses CLOUD_API in HYBRID
  const cloudFirst = controller.evaluateTaskRoute("cloud_ai_providers");
  assert.equal(cloudFirst.canExecute, true);
  assert.equal(cloudFirst.route, "CLOUD_API");

  // Switch to ONLINE
  controller.setForcedMode(CONNECTIVITY_MODES.ONLINE);
  const onlineCloud = controller.evaluateTaskRoute("web_search_duckduckgo");
  assert.equal(onlineCloud.canExecute, true);
  assert.equal(onlineCloud.route, "CLOUD_API");
});

test("ConnectionController: offline sync queue preserves items and flushes upon reconnection", () => {
  const controller = new ConnectionController({ forcedMode: CONNECTIVITY_MODES.OFFLINE });

  const item1 = controller.enqueueOfflineSync({ type: "DOCUMENT_EMBEDDING", docId: "doc-123" });
  const item2 = controller.enqueueOfflineSync({ type: "TELEMETRY_LOG", count: 42 });

  assert.equal(controller.offlineSyncQueue.length, 2);
  assert.equal(item1.status, "QUEUED_OFFLINE");
  assert.equal(item2.status, "QUEUED_OFFLINE");

  const status = controller.getStatus();
  assert.equal(status.queuedSyncItems, 2);
  assert.equal(status.mode, CONNECTIVITY_MODES.OFFLINE);

  // Flush queue
  const flushed = controller.flushSyncQueue();
  assert.equal(flushed.flushedCount, 2);
  assert.equal(controller.offlineSyncQueue.length, 0);
  assert.equal(flushed.items[0].item.docId, "doc-123");
});
