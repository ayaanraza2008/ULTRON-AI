# ULTRON wake word

The reusable listener is in `voice/wake-word.js`. It recognizes **“Ultron”** as a whole word (including “Hey, Ultron”), applies a cooldown to avoid repeated activations, reports microphone errors, and attempts to restart recognition if the browser ends a session.

## Safety and reliability

- The client must explicitly call `listener.start()` after a user gesture and microphone consent. The server cannot hear a device microphone on its own.
- Keep a visible listening indicator and a clear stop control. The listener should be stopped when the user disables it.
- Browser Web Speech Recognition may send audio to a browser/vendor speech service. This implementation is not guaranteed to be on-device or offline.
- “Always listening” is only best-effort while the app is open, permitted, and the browser/OS allows microphone access. Mobile browsers can suspend it; it does not reliably listen after the app is closed or the device is locked.
- Reliable Windows background wake word and Android always-on behavior require a native companion/service and preferably an on-device wake-word engine. This module alone does not provide those OS-level capabilities.

## Integration

Import `UltronWakeWordListener` into the eventual client shell and wire `onWake` to the assistant activation state. Do not auto-send a conversation or execute PC actions solely because a wake word was detected; normal intent and permission checks still apply.

## Verification

Run `node --test tests/wake-word.test.js` and `npm run check`. Tests mock the recognition engine and do not prove microphone permissions or background behavior on a real device.
