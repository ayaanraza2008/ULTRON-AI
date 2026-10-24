const DEFAULT_WAKE_WORD = "ultron";
const DEFAULT_COOLDOWN_MS = 2500;

function normalizeTranscript(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsWakeWord(transcript, wakeWord) {
  const words = normalizeTranscript(transcript).split(" ").filter(Boolean);
  const target = normalizeTranscript(wakeWord).split(" ").filter(Boolean);
  if (!target.length || !words.length || target.length > words.length) return false;
  for (let i = 0; i <= words.length - target.length; i += 1) {
    if (target.every((word, offset) => words[i + offset] === word)) return true;
  }
  return false;
}

/**
 * Opt-in, local-client wake-word listener built on the browser Web Speech API.
 * The host app must call start() only after a user gesture and microphone consent,
 * show a visible listening indicator, and call stop() when the user disables it.
 * Speech recognition support/continuous background operation varies by browser/OS.
 */
export class UltronWakeWordListener {
  constructor({
    Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition,
    wakeWord = DEFAULT_WAKE_WORD,
    lang = "en-IN",
    cooldownMs = DEFAULT_COOLDOWN_MS,
    onWake = () => {},
    onState = () => {},
    onError = () => {},
    now = Date.now
  } = {}) {
    this.Recognition = Recognition;
    this.wakeWord = normalizeTranscript(wakeWord);
    this.lang = lang;
    this.cooldownMs = Math.max(0, Number(cooldownMs) || 0);
    this.onWake = onWake;
    this.onState = onState;
    this.onError = onError;
    this.now = now;
    this.recognition = null;
    this.enabled = false;
    this.started = false;
    this.lastWakeAt = -Infinity;
    this.restartTimer = null;
    this.generation = 0;
  }

  start() {
    if (this.enabled) return { ok: true, state: "listening" };
    if (typeof this.Recognition !== "function") {
      const error = { code: "WAKE_WORD_UNSUPPORTED", message: "This browser does not support continuous speech recognition. Use a supported browser or the future desktop companion." };
      this.onError(error);
      return { ok: false, ...error };
    }
    this.enabled = true;
    this.generation += 1;
    this._startRecognition(this.generation);
    return { ok: true, state: "starting" };
  }

  stop() {
    this.enabled = false;
    this.generation += 1;
    if (this.restartTimer !== null) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try { recognition.stop(); } catch { /* already stopped */ }
    }
    this.started = false;
    this.onState({ state: "stopped", listening: false });
    return { ok: true, state: "stopped" };
  }

  _startRecognition(generation) {
    if (!this.enabled || generation !== this.generation) return;
    let recognition;
    try {
      recognition = new this.Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = this.lang;
      recognition.maxAlternatives = 1;
      this.recognition = recognition;
      recognition.onstart = () => {
        if (!this.enabled || generation !== this.generation) return;
        this.started = true;
        this.onState({ state: "listening", listening: true, wakeWord: this.wakeWord });
      };
      recognition.onresult = (event) => {
        if (!this.enabled || generation !== this.generation) return;
        for (let i = event.resultIndex || 0; i < (event.results || []).length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript || "";
          if (!containsWakeWord(transcript, this.wakeWord)) continue;
          const now = this.now();
          if (now - this.lastWakeAt < this.cooldownMs) continue;
          this.lastWakeAt = now;
          this.onWake({ wakeWord: this.wakeWord, transcript: String(transcript).slice(0, 500), timestamp: now });
          break;
        }
      };
      recognition.onerror = (event) => {
        if (!this.enabled || generation !== this.generation) return;
        const code = String(event?.error || "recognition_error").slice(0, 80);
        // Permission/service failures cannot be fixed by tight retry loops.
        this.onError({ code: code === "not-allowed" || code === "service-not-allowed" ? "MICROPHONE_PERMISSION_DENIED" : "WAKE_WORD_RECOGNITION_FAILED", detail: code });
        if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") this.stop();
      };
      recognition.onend = () => {
        if (this.recognition === recognition) this.recognition = null;
        this.started = false;
        if (!this.enabled || generation !== this.generation) return;
        this.onState({ state: "reconnecting", listening: false });
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this._startRecognition(generation);
        }, 500);
      };
      recognition.start();
    } catch (error) {
      this.onError({ code: "WAKE_WORD_START_FAILED", detail: String(error?.name || "start_error").slice(0, 80) });
      if (this.enabled && generation === this.generation) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this._startRecognition(generation);
        }, 1500);
      }
    }
  }
}

export { containsWakeWord, normalizeTranscript };
