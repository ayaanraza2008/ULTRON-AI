(() => {
  "use strict";

  function getAvailableSpeechVoices(synth) {
    try {
      const voices = synth?.getVoices?.();
      return voices ? Array.from(voices).filter(voice => voice && typeof voice === "object") : [];
    } catch {
      return [];
    }
  }

  function waitForSpeechVoices(synth, {
    timeoutMs = 1000,
    signal,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
  } = {}) {
    const initial = getAvailableSpeechVoices(synth);
    if (initial.length || !synth || typeof synth.addEventListener !== "function" || signal?.aborted) {
      return Promise.resolve(initial);
    }

    const boundedTimeout = Number.isFinite(Number(timeoutMs))
      ? Math.max(0, Math.min(3000, Number(timeoutMs)))
      : 1000;

    return new Promise(resolve => {
      let settled = false;
      let timer = null;

      const finish = () => {
        if (settled) return;
        settled = true;
        try { synth.removeEventListener("voiceschanged", onVoicesChanged); } catch {}
        try { signal?.removeEventListener?.("abort", finish); } catch {}
        if (timer !== null) {
          try { clearTimeoutImpl(timer); } catch {}
        }
        resolve(getAvailableSpeechVoices(synth));
      };

      const onVoicesChanged = () => {
        if (getAvailableSpeechVoices(synth).length) finish();
      };

      try {
        synth.addEventListener("voiceschanged", onVoicesChanged);
        if (signal) signal.addEventListener("abort", finish, { once: true });
        timer = setTimeoutImpl(finish, boundedTimeout);
        onVoicesChanged();
      } catch {
        finish();
      }
    });
  }

  function chooseSpeechVoice(voices, language) {
    if (!Array.isArray(voices) || !voices.length) return null;
    const wanted = String(language || "en-IN").toLowerCase();
    const base = wanted.split("-")[0];
    const preferredLocale = base === "hi" ? "hi-in" : "en-in";
    const maleVoiceName = /\b(prabhat|ravi|madhur|hemant|david|mark|guy|daniel|alex|james|thomas|aaron|ryan|matthew|male)\\b/i;
    const femaleVoiceName = /\b(zira|samantha|victoria|karen|hazel|heera|lekha|swara|kavya|pallavi|priya|neerja|reena|female|woman)\\b/i;
    const naturalVoiceName = /natural|neural|online|enhanced|premium/i;
    const scoreVoice = voice => {
      const lang = String(voice.lang || "").toLowerCase().replaceAll("_", "-");
      let score = 0;
      if (lang === preferredLocale) score += 120;
      else if (lang.startsWith(base + "-")) score += 75;
      else if (lang === base) score += 65;
      else if (base === "en" && /^en-(gb|us|au|ca)/.test(lang)) score += 45;
      else score -= 35;
      if (naturalVoiceName.test(voice.name || "")) score += 35;
      if (maleVoiceName.test(voice.name || "")) score += 45;
      if (femaleVoiceName.test(voice.name || "")) score -= 70;
      if (voice.localService === false) score += 12;
      if (voice.default) score += 2;
      return score;
    };
    return voices.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
  }

  globalThis.ULTRONSpeechVoices = Object.freeze({
    getAvailableSpeechVoices,
    waitForSpeechVoices,
    chooseSpeechVoice
  });
})();
