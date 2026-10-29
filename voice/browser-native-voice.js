export const ULTRON_FREE_VOICE_PROFILE = Object.freeze({
  id: "ultron-authoritative-male",
  name: "ULTRON Authoritative Male",
  provider: "browser-native",
  preferredVoiceNames: Object.freeze([
    "Microsoft David",
    "Google UK English Male",
    "Microsoft Mark",
    "Microsoft Guy",
    "Microsoft Hemant",
    "Microsoft Ravi",
    "Microsoft Arjun",
    "Daniel",
    "Alex",
    "David",
    "Rishi",
    "Madhur"
  ]),
  preferredLocales: Object.freeze(["en-US", "en-GB", "en-IN", "hi-IN"]),
  rate: 1.05,
  pitch: 0.82,
  volume: 1,
  style: "calm, resonant, confident, clear, authoritative"
});

function normalizeLocale(language) {
  const raw = typeof language === "string" ? language.trim().replace(/_/g, "-") : "";
  if (!raw || /^auto$/i.test(raw)) return "en-US";
  if (/^hinglish$/i.test(raw)) return "en-IN";
  if (/^(hi|hindi)(-|$)/i.test(raw)) return "hi-IN";
  if (/^english$/i.test(raw)) return "en-US";
  if (/^en(-[a-z0-9]+)?$/i.test(raw)) return raw.toLowerCase() === "en" ? "en-US" : raw;
  if (/^hi(-[a-z0-9]+)?$/i.test(raw)) return raw.toLowerCase() === "hi" ? "hi-IN" : raw;
  return raw;
}

function boundedNumber(value, fallback, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

/**
 * Select a voice from the browser/OS voice catalog.
 * Preference is given to a matching language and known male-sounding voice names.
 * If the platform exposes no recognizable male voice, the best available voice is used.
 */
export function chooseUltronVoice(voices, options = {}) {
  const list = Array.isArray(voices)
    ? voices.filter(voice => voice && typeof voice.name === "string")
    : [];
  if (!list.length) return null;

  const locale = normalizeLocale(options.language || "en-US");
  const languageTag = locale.toLowerCase().split("-")[0];
  const sameLanguage = list.filter(voice =>
    typeof voice.lang === "string" && voice.lang.toLowerCase().split("-")[0] === languageTag
  );
  const englishFallback = list.filter(voice =>
    typeof voice.lang === "string" && voice.lang.toLowerCase().startsWith("en-")
  );
  const candidates = sameLanguage.length ? sameLanguage : englishFallback.length ? englishFallback : list;
  const requestedNames = Array.isArray(options.preferredVoiceNames)
    ? options.preferredVoiceNames
    : ULTRON_FREE_VOICE_PROFILE.preferredVoiceNames;

  for (const preferredName of requestedNames) {
    if (typeof preferredName !== "string" || !preferredName.trim()) continue;
    const wanted = preferredName.toLocaleLowerCase();
    const found = candidates.find(voice => voice.name.toLocaleLowerCase().includes(wanted));
    if (found) return found;
  }

  const masculineNameHint = candidates.find(voice =>
    /\b(male|masculine|david|mark|guy|daniel|alex|hemant|ravi|arjun|rishi|madhur)\b/i.test(voice.name)
  );
  if (masculineNameHint) return masculineNameHint;

  const preferredLocales = Array.isArray(options.preferredLocales)
    ? options.preferredLocales
    : ULTRON_FREE_VOICE_PROFILE.preferredLocales;
  for (const preferredLocale of preferredLocales) {
    const found = candidates.find(voice =>
      typeof voice.lang === "string" && voice.lang.toLowerCase() === String(preferredLocale).toLowerCase()
    );
    if (found) return found;
  }

  return candidates[0] || null;
}

/**
 * Speak locally with the browser's built-in speech engine.
 * No HTTP requests, API keys, or model downloads are used.
 */
export function speakWithUltronVoice(text, options = {}) {
  const spokenText = typeof text === "string" ? text.trim() : "";
  if (!spokenText) throw new TypeError("Speech text must be a non-empty string.");

  const synthesis = options.speechSynthesis ?? globalThis.speechSynthesis;
  const Utterance = options.SpeechSynthesisUtterance ?? globalThis.SpeechSynthesisUtterance;
  if (!synthesis || typeof synthesis.speak !== "function" || typeof Utterance !== "function") {
    return {
      provider: "browser-native",
      presetId: ULTRON_FREE_VOICE_PROFILE.id,
      state: "unavailable",
      message: "This browser does not expose speech synthesis. Use a browser/OS with built-in speech voices."
    };
  }

  const language = normalizeLocale(options.language || "en-US");
  const availableVoices = typeof synthesis.getVoices === "function" ? synthesis.getVoices() : [];
  const voice = options.voice && typeof options.voice.name === "string"
    ? options.voice
    : chooseUltronVoice(availableVoices, { language });
  const rate = boundedNumber(options.rate, ULTRON_FREE_VOICE_PROFILE.rate, 0.5, 2);
  const pitch = boundedNumber(options.pitch, ULTRON_FREE_VOICE_PROFILE.pitch, 0, 2);
  const volume = boundedNumber(options.volume, ULTRON_FREE_VOICE_PROFILE.volume, 0, 1);

  const utterance = new Utterance(spokenText);
  utterance.lang = voice?.lang || language;
  utterance.rate = rate;
  utterance.pitch = pitch;
  utterance.volume = volume;
  if (voice) utterance.voice = voice;
  if (typeof options.onEnd === "function") utterance.onend = options.onEnd;
  if (typeof options.onError === "function") utterance.onerror = options.onError;

  try { synthesis.cancel?.(); } catch {}
  try {
    synthesis.speak(utterance);
    return {
      provider: "browser-native",
      presetId: ULTRON_FREE_VOICE_PROFILE.id,
      state: "speaking",
      voiceName: voice?.name || null,
      language: utterance.lang,
      rate,
      pitch,
      volume
    };
  } catch {
    return {
      provider: "browser-native",
      presetId: ULTRON_FREE_VOICE_PROFILE.id,
      state: "failed",
      message: "The browser could not start speech synthesis."
    };
  }
}
