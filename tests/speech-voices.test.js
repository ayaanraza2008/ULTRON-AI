import test from "node:test";
import assert from "node:assert/strict";
import "../public/speech-voices.js";

const speechVoices = globalThis.ULTRONSpeechVoices;

class FakeSpeechSynthesis extends EventTarget {
  constructor(voices = []) {
    super();
    this.voices = voices;
    this.addedVoiceListeners = 0;
    this.removedVoiceListeners = 0;
  }

  addEventListener(type, listener, options) {
    if (type === "voiceschanged") this.addedVoiceListeners += 1;
    return super.addEventListener(type, listener, options);
  }

  removeEventListener(type, listener, options) {
    if (type === "voiceschanged") this.removedVoiceListeners += 1;
    return super.removeEventListener(type, listener, options);
  }

  getVoices() {
    return this.voices;
  }

  setVoices(voices) {
    this.voices = voices;
    this.dispatchEvent(new Event("voiceschanged"));
  }
}

test("speech voice reader accepts array-like browser voice lists", () => {
  const voice = { name: "Ravi Natural", lang: "hi-IN" };
  const synth = { getVoices: () => ({ 0: voice, length: 1 }) };
  assert.deepEqual(speechVoices.getAvailableSpeechVoices(synth), [voice]);
});

test("speech voice reader safely handles missing, throwing and empty APIs", () => {
  assert.deepEqual(speechVoices.getAvailableSpeechVoices(null), []);
  assert.deepEqual(speechVoices.getAvailableSpeechVoices({ getVoices() { throw new Error("unavailable"); } }), []);
  assert.deepEqual(speechVoices.getAvailableSpeechVoices({ getVoices: () => null }), []);
});

test("voice chooser prefers a natural male-leaning voice for the requested Indian locale", () => {
  const female = { name: "Microsoft Heera", lang: "hi-IN", localService: true };
  const generic = { name: "Hindi", lang: "hi-IN", localService: true };
  const naturalMale = { name: "Microsoft Ravi Online (Natural)", lang: "hi-IN", localService: false };
  assert.equal(speechVoices.chooseSpeechVoice([female, generic, naturalMale], "hi-IN"), naturalMale);
});

test("voice chooser applies named male preference when locale and other scores are equal", () => {
  const female = { name: "Microsoft Zira", lang: "en-IN", localService: true };
  const male = { name: "Microsoft David", lang: "en-IN", localService: true };
  assert.equal(speechVoices.chooseSpeechVoice([female, male], "en-IN"), male);
});

test("voice chooser applies the female-name penalty when locale and other scores are equal", () => {
  const female = { name: "Microsoft Zira", lang: "en-IN", localService: true };
  const neutral = { name: "Microsoft Voice", lang: "en-IN", localService: true };
  assert.equal(speechVoices.chooseSpeechVoice([female, neutral], "en-IN"), neutral);
});

test("voice chooser selects English independently from Hindi and handles an empty list", () => {
  const hindi = { name: "Ravi", lang: "hi-IN" };
  const english = { name: "Microsoft David Online (Natural)", lang: "en-IN", localService: false };
  assert.equal(speechVoices.chooseSpeechVoice([hindi, english], "en-IN"), english);
  assert.equal(speechVoices.chooseSpeechVoice([], "en-IN"), null);
});

test("voice readiness resolves immediately when the browser list is already available", async () => {
  const voice = { name: "English", lang: "en-IN" };
  const synth = new FakeSpeechSynthesis([voice]);
  const result = await speechVoices.waitForSpeechVoices(synth, { timeoutMs: 50 });
  assert.deepEqual(result, [voice]);
});

test("voice readiness waits for voiceschanged and removes its listener", async () => {
  const synth = new FakeSpeechSynthesis();
  const pending = speechVoices.waitForSpeechVoices(synth, { timeoutMs: 500 });
  const voice = { name: "Ravi", lang: "hi-IN" };
  synth.setVoices([voice]);
  assert.deepEqual(await pending, [voice]);
  assert.equal(synth.addedVoiceListeners, 1);
  assert.equal(synth.removedVoiceListeners, 1);
});

test("voice readiness can be cancelled before its timeout", async () => {
  const synth = new FakeSpeechSynthesis();
  const controller = new AbortController();
  let timerCleared = false;
  const pending = speechVoices.waitForSpeechVoices(synth, {
    timeoutMs: 2000,
    signal: controller.signal,
    setTimeoutImpl: () => 1,
    clearTimeoutImpl: () => { timerCleared = true; }
  });
  controller.abort();
  assert.deepEqual(await pending, []);
  assert.equal(timerCleared, true);
});

test("voice readiness uses a bounded timeout when the browser never emits voiceschanged", async () => {
  const synth = new FakeSpeechSynthesis();
  const started = Date.now();
  const result = await speechVoices.waitForSpeechVoices(synth, { timeoutMs: 10 });
  assert.deepEqual(result, []);
  assert.ok(Date.now() - started < 1000);
});
