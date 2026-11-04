import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  FLOATING_CORE_STATES,
  FloatingLivingEnergyCore
} from "../public/floating-core.js";

describe("Always-On Floating Living Energy Core", () => {
  test("Defines all 10 real-time visual energy states", () => {
    const expected = [
      "STANDBY",
      "LISTENING",
      "THINKING",
      "SPEAKING",
      "EXECUTING",
      "SELF_UPGRADING",
      "VISION_ACTIVE",
      "ERROR",
      "OFFLINE",
      "MUTED"
    ];

    expected.forEach(state => {
      assert.ok(FLOATING_CORE_STATES[state], `State ${state} must exist in FLOATING_CORE_STATES`);
      assert.equal(FLOATING_CORE_STATES[state], state);
    });
    assert.equal(Object.keys(FLOATING_CORE_STATES).length, 10);
  });

  test("Maintains 1:1 aspect ratio sizing within [80, 240] px boundaries", () => {
    const core = new FloatingLivingEnergyCore({ size: 120 });
    assert.equal(core.size, 120);
    assert.equal(core.minSize, 80);
    assert.equal(core.maxSize, 240);
    assert.equal(core.currentState, FLOATING_CORE_STATES.STANDBY);
  });

  test("Transitions through visual states accurately", () => {
    const core = new FloatingLivingEnergyCore();
    
    core.setVisualState(FLOATING_CORE_STATES.LISTENING, "Mic Active");
    assert.equal(core.currentState, FLOATING_CORE_STATES.LISTENING);

    core.setVisualState(FLOATING_CORE_STATES.THINKING, "Cognitive processing");
    assert.equal(core.currentState, FLOATING_CORE_STATES.THINKING);

    core.setVisualState(FLOATING_CORE_STATES.SELF_UPGRADING, "Recompiling matrix");
    assert.equal(core.currentState, FLOATING_CORE_STATES.SELF_UPGRADING);

    core.setVisualState(FLOATING_CORE_STATES.ERROR, "Critical warning");
    assert.equal(core.currentState, FLOATING_CORE_STATES.ERROR);

    // Rejects invalid states
    core.setVisualState("INVALID_STATE");
    assert.equal(core.currentState, FLOATING_CORE_STATES.ERROR);
  });

  test("Clamps audio reactivity levels between 0.0 and 1.0", () => {
    const core = new FloatingLivingEnergyCore();
    core.setAudioReactivity(0.5);
    assert.equal(core.audioLevel, 0.5);

    core.setAudioReactivity(2.5); // Overshoot
    assert.equal(core.audioLevel, 1.0);

    core.setAudioReactivity(-0.4); // Undershoot
    assert.equal(core.audioLevel, 0.0);
  });

  test("Toggles voice listening state on double-click trigger", () => {
    const core = new FloatingLivingEnergyCore();
    assert.equal(core.currentState, FLOATING_CORE_STATES.STANDBY);

    core.toggleVoice();
    assert.equal(core.currentState, FLOATING_CORE_STATES.LISTENING);

    core.toggleVoice();
    assert.equal(core.currentState, FLOATING_CORE_STATES.STANDBY);
  });

  test("Exposes active Screen-Capture Exclusion shield status", () => {
    const core = new FloatingLivingEnergyCore();
    assert.equal(core.captureShieldActive, true);
  });
});
