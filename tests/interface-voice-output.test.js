import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("settings exposes a browser voice output selector", () => {
  assert.match(html, /id="voice-output-select"/);
  assert.match(html, /Voice output/);
});

test("speech output uses the saved voice name and language when available", () => {
  assert.match(app, /window\.speechSynthesis\.getVoices\(\)/);
  assert.match(app, /voice\.name === state\.preferences\.voice_output_name/);
  assert.match(app, /voice\.lang === state\.preferences\.voice_output_lang/);
  assert.match(app, /utterance\.voice = matching/);
});

test("voice selection is loaded and persisted through account preferences", () => {
  assert.match(app, /accountPreferences\.voice_output_name/);
  assert.match(app, /accountPreferences\.voice_output_lang/);
  assert.match(app, /voice_output_name: state\.preferences\.voice_output_name/);
  assert.match(app, /voice_output_lang: state\.preferences\.voice_output_lang/);
  assert.match(app, /refreshSpeechVoices\(\)/);
});
