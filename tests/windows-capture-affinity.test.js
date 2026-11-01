import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DISPLAY_AFFINITY,
  WindowsCaptureAffinityManager
} from "../system/windows-capture-affinity.js";

describe("Windows Capture-Exclusion & Display Affinity Subsystem", () => {
  test("DISPLAY_AFFINITY constants match Win32 specifications", () => {
    assert.equal(DISPLAY_AFFINITY.WDA_NONE, 0x00000000);
    assert.equal(DISPLAY_AFFINITY.WDA_MONITOR, 0x00000001);
    assert.equal(DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE, 0x00000011);
  });

  test("Evaluates Windows 10/11 build >= 19041 as supported", () => {
    const manager = new WindowsCaptureAffinityManager({
      platform: "win32",
      osRelease: "10.0.22631" // Windows 11 23H2
    });
    const check = manager.isCaptureExclusionSupported();
    assert.equal(check.supported, true);
    assert.equal(check.build, 22631);
    assert.equal(check.affinityValue, DISPLAY_AFFINITY.WDA_EXCLUDEFROMCAPTURE);
  });

  test("Evaluates legacy Windows build < 19041 as unsupported with fallback", () => {
    const manager = new WindowsCaptureAffinityManager({
      platform: "win32",
      osRelease: "10.0.17763" // Windows 10 1809
    });
    const check = manager.isCaptureExclusionSupported();
    assert.equal(check.supported, false);
    assert.equal(check.reason, "OS_BUILD_PRE_19041");
    assert.equal(check.fallback, "MANUAL_HIDE_OVERLAY");
  });

  test("Evaluates non-Windows platforms with fallback", () => {
    const manager = new WindowsCaptureAffinityManager({
      platform: "linux",
      osRelease: "5.15.0-generic"
    });
    const check = manager.isCaptureExclusionSupported();
    assert.equal(check.supported, false);
    assert.equal(check.reason, "NON_WINDOWS_HOST");
    assert.equal(check.fallback, "MANUAL_HIDE_OVERLAY");
  });

  test("Reports overlay protection status and config correctly", () => {
    const manager = new WindowsCaptureAffinityManager({
      platform: "win32",
      osRelease: "10.0.26100" // Windows 11 24H2
    });
    const status = manager.getOverlayProtectionStatus();
    assert.equal(status.supported, true);
    assert.equal(status.platform, "win32");
    assert.equal(status.stealthTarget, "SNIPPING_TOOL_PRINTSCREEN_OBS_MEET_ZOOM");

    const config = manager.createOverlayConfig({ width: 120, height: 120 });
    assert.equal(config.width, 120);
    assert.equal(config.height, 120);
    assert.equal(config.aspectRatio, "1:1");
    assert.equal(config.alwaysOnTop, true);
    assert.equal(config.excludeFromCapture, true);
  });
});
