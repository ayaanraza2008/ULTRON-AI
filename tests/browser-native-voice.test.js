import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseUltronVoice,
  speakWithUltronVoice,
  ULTRON_FREE_VOICE_PROFILE
} from "../voice/browser-native-voice.js";

test("free voice profile prefers an installed authoritative male-style English voice", () => {
  const voices = [
    { name: "Microsoft Zira Desktop", lang: "en-US" },
    { name: "Microsoft David Desktop - English (United States)", lang: "en-US" },
    { name: "Google UK English Male", lang: "en-GB" }
  ];
  const selected = chooseUltronVoice(voices, { language: "en-US" });
  assert.equal(selected.name, "Microsoft David Desktop - English (United States)");
  assert.equal(ULTRON_FREE_VOICE_PROFILE.id, "ultron-authoritative-male");
  assert.equal(ULTRON_FREE_VOICE_PROFILE.provider, "browser-native");
});

test("automatic language falls back to the default authoritative English voice", () => {
  const voices = [
    { name: "Microsoft Zira Desktop", lang: "en-US" },
    { name: "Microsoft David Desktop", lang: "en-US" }
  ];
  assert.equal(chooseUltronVoice(voices, { language: "auto" }).name, "Microsoft David Desktop");
});

test("voice selection follows Hindi locale when a matching voice is installed", () => {
  const voices = [
    { name: "Microsoft David Desktop", lang: "en-US" },
    { name: "Microsoft Hemant", lang: "hi-IN" }
  ];
  assert.equal(chooseUltronVoice(voices, { language: "Hindi" }).name, "Microsoft Hemant");
  assert.equal(chooseUltronVoice(voices, { language: "Hinglish" }).name, "Microsoft David Desktop");
});

test("speech helper uses native synthesis without a provider call and applies the profile", () => {
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  let utterance;
  let cancellations = 0;
  let speaks = 0;
  const speechSynthesis = {
    getVoices: () => [
      { name: "Microsoft David Desktop - English (United States)", lang: "en-US" },
      { name: "Microsoft Zira Desktop", lang: "en-US" }
    ],
    cancel() { cancellations += 1; },
    speak(value) { speaks += 1; utterance = value; }
  };
  const onEnd = () => {};
  const result = speakWithUltronVoice("Systems nominal.", {
    speechSynthesis,
    SpeechSynthesisUtterance: FakeUtterance,
    language: "en-US",
    onEnd
  });
  assert.equal(result.state, "speaking");
  assert.equal(result.provider, "browser-native");
  assert.equal(result.voiceName, "Microsoft David Desktop - English (United States)");
  assert.equal(result.rate, 1.05);
  assert.equal(result.pitch, 0.82);
  assert.equal(cancellations, 1);
  assert.equal(speaks, 1);
  assert.equal(utterance.text, "Systems nominal.");
  assert.equal(utterance.rate, 1.05);
  assert.equal(utterance.pitch, 0.82);
  assert.equal(utterance.volume, 1);
  assert.equal(utterance.onend, onEnd);
});

test("speech helper reports unavailable when browser-native synthesis is missing", () => {
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const result = speakWithUltronVoice("Hello.", {
    speechSynthesis: {},
    SpeechSynthesisUtterance: FakeUtterance
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.provider, "browser-native");
});

test("speech helper rejects empty text instead of synthesizing silence", () => {
  assert.throws(() => speakWithUltronVoice("   ", {
    speechSynthesis: { speak() {} },
    SpeechSynthesisUtterance: class {}
  }), /non-empty string/);
});
