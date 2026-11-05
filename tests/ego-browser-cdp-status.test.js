import test from "node:test";
import assert from "node:assert/strict";
import { DirectChromiumCdpDriver } from "../integrations/browser/ego-lite/direct-chromium-driver.js";

function createFakeCdp() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) || new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    emit(type, data) {
      for (const listener of listeners.get(type) || []) listener({ data: JSON.stringify(data) });
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    }
  };
}

function createDriver({ responseStatus = null, finalUrl = "https://example.com/missing", readyState = "complete" } = {}) {
  const driver = new DirectChromiumCdpDriver({ allowLaunch: true });
  const cdp = createFakeCdp();
  driver._openCdpPage = async () => ({ cdp, targetId: "test-target", launchedVia: "REAL_CDP" });
  driver._waitForLoadState = async () => {};
  driver._cdpSend = async (_socket, method) => {
    if (method === "Page.navigate") {
      if (responseStatus !== null) {
        cdp.emit("message", {
          method: "Network.responseReceived",
          params: {
            type: "Document",
            frameId: "main-frame",
            response: { status: responseStatus }
          }
        });
      }
      return { frameId: "main-frame" };
    }
    return {};
  };
  driver._evaluate = async (_pageId, expression) => {
    if (expression === "document.title") return "Test page";
    if (expression.includes("responseStatus")) return 0;
    if (expression.startsWith("JSON.stringify")) return JSON.stringify({ url: finalUrl, readyState });
    throw new Error("Unexpected evaluation expression");
  };
  driver._extractRealElements = async () => [];
  return { driver, cdp };
}

test("CDP main-document status wins when Performance responseStatus is zero", async () => {
  const { driver, cdp } = createDriver({ responseStatus: 404 });
  const result = await driver.goto("status-404", "https://example.com/missing");

  assert.equal(result.status, 404);
  assert.equal(result.url, "https://example.com/missing");
  assert.equal(result.readyState, "complete");
  assert.equal(result.executionMechanism, "REAL_CDP");
  assert.equal(cdp.listenerCount("message"), 0, "temporary response listener is removed");
});

test("browser-internal navigation reports status zero instead of inventing HTTP 200", async () => {
  const { driver } = createDriver({ finalUrl: "about:blank" });
  const result = await driver.goto("blank-page", "about:blank");

  assert.equal(result.status, 0);
  assert.equal(result.url, "about:blank");
  assert.equal(result.executionMechanism, "REAL_CDP");
});

test("missing HTTP response evidence fails closed when throwOnError is requested", async () => {
  const { driver } = createDriver({ responseStatus: null });
  let previewCalls = 0;
  driver._httpPreviewGoto = async () => {
    previewCalls += 1;
    return { status: 200, executionMechanism: "HTTP_FETCH_PREVIEW" };
  };

  await assert.rejects(
    driver.goto("missing-status", "https://example.com/", { throwOnError: true }),
    /Could not observe the main-frame HTTP response status/
  );
  assert.equal(previewCalls, 0, "strict real-browser request must not silently switch to preview");
});
