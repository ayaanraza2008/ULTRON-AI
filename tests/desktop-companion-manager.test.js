import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { DesktopCompanionManager, COMPANION_STATES, TRAY_ACTIONS } from "../system/desktop-companion-manager.js";

describe("Desktop Companion Manager Suite", () => {
  const testDir = path.join(os.tmpdir(), "ultron_companion_test_" + Date.now());

  test("initializes with default clamped coordinates and standby state", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir });
    await mgr.initialize();

    assert.equal(mgr.isInitialized, true);
    assert.equal(mgr.state, COMPANION_STATES.STANDBY);
    assert.equal(mgr.isWindowVisible, true);
    assert.equal(mgr.emergencyHalted, false);

    const pos = mgr.getOrbPosition();
    assert.ok(typeof pos.x === "number" && pos.x > 0);
    assert.ok(typeof pos.y === "number" && pos.y > 0);
  });

  test("persists and restores orb coordinates across restarts", async () => {
    const mgr1 = new DesktopCompanionManager({ configDir: testDir });
    await mgr1.initialize();

    await mgr1.setOrbPosition(450, 620);
    assert.deepEqual(mgr1.getOrbPosition(), { x: 450, y: 620 });

    // Second instance loading from same directory
    const mgr2 = new DesktopCompanionManager({ configDir: testDir });
    await mgr2.initialize();
    assert.deepEqual(mgr2.getOrbPosition(), { x: 450, y: 620 });
  });

  test("clamps coordinates strictly within multi-monitor display bounds", () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir, orbSize: 100 });

    // Negative coordinates clamped to minimum padding
    const neg = mgr.clampToDisplay(-50, -100, 1920, 1080);
    assert.equal(neg.x, 10);
    assert.equal(neg.y, 10);

    // Overflown coordinates clamped to screen width - size - margin
    const over = mgr.clampToDisplay(2500, 1500, 1920, 1080);
    assert.equal(over.x, 1920 - 100 - 10);
    assert.equal(over.y, 1080 - 100 - 10);
  });

  test("supports multi-monitor custom bounds with negative virtual desktop coordinates", () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir, orbSize: 100 });
    const bounds = { minX: -1920, minY: 0, maxX: 1920, maxY: 1080 };

    // Clamps within secondary left monitor
    const leftMonitor = mgr.clampToDisplay(-1000, 400, 1920, 1080, bounds);
    assert.equal(leftMonitor.x, -1000);
    assert.equal(leftMonitor.y, 400);

    // Overflown left monitor coordinate clamped to minX + margin
    const tooFarLeft = mgr.clampToDisplay(-2500, 400, 1920, 1080, bounds);
    assert.equal(tooFarLeft.x, -1920 + 10);
  });

  test("calculates optimal window anchor coordinates relative to floating orb", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir, orbSize: 100 });
    await mgr.initialize();
    await mgr.setOrbPosition(1000, 800);

    const anchor = mgr.getAnchoredWindowPosition(800, 600, 1920, 1080);
    assert.equal(anchor.anchoredToOrb, true);
    assert.equal(anchor.width, 800);
    assert.equal(anchor.height, 600);
    assert.ok(anchor.x >= 20 && anchor.x <= 1920 - 800 - 20);
    assert.ok(anchor.y >= 20 && anchor.y <= 1080 - 600 - 20);
  });

  test("handles all tray context menu actions accurately", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir });
    await mgr.initialize();

    // Toggle
    const t1 = mgr.handleTrayAction(TRAY_ACTIONS.TOGGLE);
    assert.equal(t1.visible, false);
    assert.equal(mgr.state, COMPANION_STATES.MINIMIZED_TO_TRAY);

    const t2 = mgr.handleTrayAction(TRAY_ACTIONS.TOGGLE);
    assert.equal(t2.visible, true);
    assert.equal(mgr.state, COMPANION_STATES.STANDBY);

    // Show & Hide
    mgr.handleTrayAction(TRAY_ACTIONS.HIDE);
    assert.equal(mgr.isWindowVisible, false);
    mgr.handleTrayAction(TRAY_ACTIONS.SHOW);
    assert.equal(mgr.isWindowVisible, true);

    // Settings
    let settingsFired = false;
    mgr.on("navigate_settings", () => { settingsFired = true; });
    mgr.handleTrayAction(TRAY_ACTIONS.SETTINGS);
    assert.equal(settingsFired, true);

    // Emergency Stop and Reset
    mgr.handleTrayAction(TRAY_ACTIONS.EMERGENCY_STOP, { reason: "User manual halt" });
    assert.equal(mgr.emergencyHalted, true);
    assert.equal(mgr.state, COMPANION_STATES.HALTED);

    mgr.handleTrayAction(TRAY_ACTIONS.RESET_EMERGENCY_STOP);
    assert.equal(mgr.emergencyHalted, false);
    assert.equal(mgr.state, COMPANION_STATES.STANDBY);
  });

  test("intercepts window close to minimize to system tray", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir });
    await mgr.initialize();

    const res = mgr.handleWindowCloseRequest();
    assert.equal(res.preventDefault, true);
    assert.equal(res.action, "minimized_to_tray");
    assert.equal(mgr.isWindowVisible, false);
    assert.equal(mgr.state, COMPANION_STATES.MINIMIZED_TO_TRAY);
  });

  test("responds to global shortcuts Ctrl+Shift+U and Ctrl+Shift+J", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir });
    await mgr.initialize();

    // Primary shortcut
    const res1 = mgr.handleGlobalShortcut("Ctrl+Shift+U");
    assert.equal(res1.success, true);
    assert.equal(mgr.isWindowVisible, false);

    // Alias shortcut
    const res2 = mgr.handleGlobalShortcut("ctrl + shift + j");
    assert.equal(res2.success, true);
    assert.equal(mgr.isWindowVisible, true);

    // Unrecognized shortcut
    const res3 = mgr.handleGlobalShortcut("Ctrl+Alt+Del");
    assert.equal(res3.triggered, false);
  });

  test("truthfully declares headless REST state manager status without native window claim", async () => {
    const mgr = new DesktopCompanionManager({ configDir: testDir });
    await mgr.initialize();

    const status = mgr.getStatus();
    assert.equal(status.nativeWindowImplemented, false);
    assert.equal(status.nativeTrayImplemented, false);
    assert.equal(status.nativeGlobalShortcutsHooked, false);
    assert.equal(status.implementationType, "headless_rest_state_manager");
  });
});
