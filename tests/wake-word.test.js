import test from "node:test";
import assert from "node:assert/strict";
import { containsWakeWord, normalizeTranscript, UltronWakeWordListener } from "../voice/wake-word.js";

test("normalizes speech and matches ULTRON as a whole word", () => {
  assert.equal(normalizeTranscript(" ULTRON! "), "ultron");
  assert.equal(containsWakeWord("Hey, Ultron, are you there?", "ultron"), true);
  assert.equal(containsWakeWord("ultrasonic sensor", "ultron"), false);
  assert.equal(containsWakeWord("hello there", "ultron"), false);
});

test("listener reports unsupported browsers without throwing", () => {
  const errors = [];
  const listener = new UltronWakeWordListener({ Recognition: null, onError: (error) => errors.push(error) });
  assert.equal(listener.start().ok, false);
  assert.equal(errors[0].code, "WAKE_WORD_UNSUPPORTED");
});

test("listener starts continuous interim recognition and activates on the wake word", () => {
  const instances = [];
  class FakeRecognition {
    start() { this.onstart?.(); }
    stop() { this.stopped = true; }
  }
  const wakes = [];
  const states = [];
  let now = 10000;
  const listener = new UltronWakeWordListener({
    Recognition: class extends FakeRecognition { constructor() { super(); instances.push(this); } },
    onWake: (event) => wakes.push(event),
    onState: (state) => states.push(state),
    now: () => now
  });
  assert.equal(listener.start().ok, true);
  assert.equal(instances[0].continuous, true);
  assert.equal(instances[0].interimResults, true);
  instances[0].onresult({ resultIndex: 0, results: [[{ transcript: "hello Ultron" }]] });
  instances[0].onresult({ resultIndex: 0, results: [[{ transcript: "Ultron" }]] });
  assert.equal(wakes.length, 1, "cooldown suppresses duplicate activations");
  now += 3000;
  instances[0].onresult({ resultIndex: 0, results: [[{ transcript: "ULTRON" }]] });
  assert.equal(wakes.length, 2);
  assert.equal(states[0].state, "listening");
  listener.stop();
  assert.equal(listener.enabled, false);
  assert.equal(listener.recognition, null);
});

test("permission denial stops listening instead of retrying forever", () => {
  let instance;
  class FakeRecognition {
    start() { instance = this; this.onstart?.(); }
    stop() { this.stopped = true; }
  }
  const errors = [];
  const listener = new UltronWakeWordListener({ Recognition: FakeRecognition, onError: (error) => errors.push(error) });
  listener.start();
  instance.onerror({ error: "not-allowed" });
  assert.equal(listener.enabled, false);
  assert.equal(errors[0].code, "MICROPHONE_PERMISSION_DENIED");
});
