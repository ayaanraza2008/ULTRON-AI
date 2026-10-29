# Free browser-native ULTRON voice

ULTRON's default voice option is local browser/operating-system speech synthesis. It requires no Fish Audio key, no external TTS account, no model identifier, and no model download.

## Profile

The backend advertises `providers.speech.freeVoicePreset` at `GET /api/capabilities`. The profile ID is `ultron-authoritative-male`, with a slightly faster rate (`1.05`) and lower pitch setting (`0.82`) for a calm, authoritative delivery. The helper in `voice/browser-native-voice.js` selects a matching installed voice, preferring recognized male-sounding voice names in the requested language, then falling back to the best available voice.

The name is a style preference, not a guarantee that a particular neural or premium voice is installed. Available voice names and quality vary by browser, operating system, installed language packs, and device. No audio is sent to a speech provider by this helper.

## Client usage

Import `speakWithUltronVoice` into the browser-side ULTRON client and call it in response to a user action or after the assistant response is ready:

```js
import { speakWithUltronVoice } from "./voice/browser-native-voice.js";

const result = speakWithUltronVoice(replyText, {
  language: detectedLanguage // e.g. "en-US", "hi-IN", or "Hinglish"
});
if (result.state !== "speaking") {
  // Show a fallback message or leave the reply available as text.
}
```

Browsers generally require a user gesture before starting audio. If `speechSynthesis.getVoices()` initially returns an empty list, the caller may retry after the browser's `voiceschanged` event. For speech input, keep using the client's native `SpeechRecognition` where available; browser recognition coverage is also device-dependent.

## Optional server-side audio

The backend's authenticated `POST /api/speech/synthesize` and `POST /api/speech/transcribe` endpoints are optional adapters for OpenAI-compatible providers. They are not needed for the free client-side voice. Their server-side keys remain secret and must not be placed into the browser bundle.

## Verification

Run `node --test tests/browser-native-voice.test.js tests/features.test.js`. Tests mock the browser speech API; they do not prove that a particular device has the preferred voice installed or that its voice sounds premium.
