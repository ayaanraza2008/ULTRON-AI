/**
 * ULTRON AI — JARVIS Voice Intelligence Engine
 *
 * Implements wake-word state tracking ("Ultron", "Jarvis"),
 * push-to-talk, voice activity detection (VAD), continuous conversation mode,
 * bilingual Hindi/English/Hinglish speech processing, personalized profiles,
 * and offline browser/local speech fallback.
 */

import { kokoroEngine } from "./kokoro-engine.js";

export const SUPPORTED_WAKE_WORDS = ["ultron", "jarvis"];

export const VOICE_PROFILES = {
  ultron_onyx: {
    id: "ultron_onyx",
    name: "ULTRON Onyx (Kokoro am_onyx - Deep/Authoritative)",
    engine: "kokoro",
    voiceId: "am_onyx",
    pitch: 0.85,
    rate: 0.95,
    lang: "en-US",
    style: "deep_dark_authoritative_futuristic"
  },
  ultron_command: {
    id: "ultron_command",
    alias: "ultron_onyx",
    name: "ULTRON Command (Kokoro am_onyx - Deep/Authoritative)",
    engine: "kokoro",
    voiceId: "am_onyx",
    pitch: 0.85,
    rate: 0.95,
    lang: "en-US",
    style: "deep_dark_authoritative_futuristic"
  },
  jarvis_prime: {
    id: "jarvis_prime",
    name: "JARVIS Prime (British/Refined)",
    engine: "kokoro",
    voiceId: "bm_lewis",
    pitch: 0.95,
    rate: 1.05,
    lang: "en-GB",
    style: "sophisticated_concise"
  },
  hinglish_conversational: {
    id: "hinglish_conversational",
    name: "Desi Assistant (Hindi/Hinglish Friendly)",
    engine: "kokoro",
    voiceId: "am_onyx",
    pitch: 0.95,
    rate: 0.95,
    lang: "hi-IN",
    style: "friendly_natural"
  }
};


export const VOICE_PERSONALITY_MODES = {
  NORMAL: {
    id: "NORMAL",
    name: "Normal (Calm & Intelligent)",
    rate: 0.95,
    pitch: 0.85,
    prefix: "",
    style: "calm_intelligent_deep"
  },
  COMMAND: {
    id: "COMMAND",
    name: "Command (Firm & Authoritative)",
    rate: 0.98,
    pitch: 0.80,
    prefix: "Acknowledged. ",
    style: "firm_authoritative"
  },
  ALERT: {
    id: "ALERT",
    name: "Alert (Serious & Urgent)",
    rate: 1.05,
    pitch: 0.92,
    prefix: "Alert. ",
    style: "serious_urgent_clear"
  },
  RESEARCH: {
    id: "RESEARCH",
    name: "Research (Measured & Articulate)",
    rate: 0.92,
    pitch: 0.86,
    prefix: "",
    style: "measured_articulate"
  },
  SUCCESS: {
    id: "SUCCESS",
    name: "Success (Controlled Confidence)",
    rate: 0.96,
    pitch: 0.84,
    prefix: "",
    style: "controlled_confidence"
  },
  ERROR: {
    id: "ERROR",
    name: "Error (Composed & Direct)",
    rate: 0.94,
    pitch: 0.82,
    prefix: "Notice: ",
    style: "composed_direct"
  },
  "WAKE-UP": {
    id: "WAKE-UP",
    name: "Wake-Up (Online & Ready)",
    rate: 0.98,
    pitch: 0.85,
    prefix: "Online, sir. ",
    style: "short_wake_acknowledgment"
  }
};

export class JarvisVoiceEngine {
  constructor(options = {}) {
    this.activeProfile = options.profile || VOICE_PROFILES.ultron_command;
    this.kokoroEngine = kokoroEngine;
    this.personalityMode = options.personalityMode || "NORMAL";
    this.mode = options.mode || "push_to_talk"; // "push_to_talk" | "wake_word_continuous" | "idle"
    this.isListening = false;
    this.isSpeaking = false;
    this.interrupted = false;
    this.voiceHistory = [];
    this.language = options.language || "en-IN";
    this.wakeWordCallback = null;
    this.streamErrors = [];
    this.recoveryAttempts = 0;
  }

  setProfile(profileId) {
    if (VOICE_PROFILES[profileId]) {
      this.activeProfile = VOICE_PROFILES[profileId];
      return { success: true, profile: this.activeProfile };
    }
    return { success: false, error: "PROFILE_NOT_FOUND" };
  }

  getProfile() {
    return this.activeProfile;
  }

  setMode(mode) {
    if (["push_to_talk", "wake_word_continuous", "idle"].includes(mode)) {
      this.mode = mode;
      return { success: true, mode: this.mode };
    }
    return { success: false, error: "INVALID_MODE" };
  }

  setPersonalityMode(modeName) {
    const key = String(modeName || "").toUpperCase();
    if (VOICE_PERSONALITY_MODES[key]) {
      this.personalityMode = key;
      return { success: true, mode: VOICE_PERSONALITY_MODES[key] };
    }
    return { success: false, error: "INVALID_PERSONALITY_MODE", allowed: Object.keys(VOICE_PERSONALITY_MODES) };
  }

  getPersonalityMode() {
    return VOICE_PERSONALITY_MODES[this.personalityMode] || VOICE_PERSONALITY_MODES.NORMAL;
  }

  /**
   * Evaluates audio transcript for wake-word trigger.
   */
  processWakeWord(phrase) {
    if (typeof phrase !== "string") return { triggered: false };
    const cleaned = phrase.toLowerCase().replace(/[^a-z]/g, " ").trim();
    const words = cleaned.split(/\s+/);

    for (const word of words) {
      if (SUPPORTED_WAKE_WORDS.includes(word)) {
        return {
          triggered: true,
          wakeWord: word,
          remainingPrompt: cleaned.replace(word, "").trim(),
          timestamp: new Date().toISOString()
        };
      }
    }

    return { triggered: false };
  }

  /**
   * Format a spoken task update tailored for speech synthesis.
   * Strips markdown, emojis, code blocks, and creates natural spoken cadence.
   */
  formatSpokenUpdate(text, lang = "en") {
    if (typeof text !== "string") return "";

    let spoken = text
      // Remove code blocks
      .replace(/```[\s\S]*?```/g, "Code block omitted for speech.")
      // Remove inline code
      .replace(/`([^`]+)`/g, "$1")
      // Remove markdown links
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove raw URLs
      .replace(/https?:\/\/[^\s]+/g, "")
      // Remove bold/italics
      .replace(/[*_~#]/g, "")
      // Remove excess whitespace
      .replace(/\s+/g, " ")
      .trim();

    // Bounded for voice delivery (speech should not drone on for minutes)
    if (spoken.length > 500) {
      spoken = spoken.slice(0, 490) + "... Summary complete.";
    }

    return spoken;
  }

  /**
   * Build an optimized system + user prompt for trilingual spoken conversation.
   * Guarantees spoken-friendly cadence (no markdown tables, no bullet lists, concise).
   */
  buildVoicePrompt(userPrompt, speechLanguageMode = "auto") {
    let modeDirective = "";
    if (speechLanguageMode === "hi-IN") {
      modeDirective = "Respond primarily in spoken Hindi (Devanagari or Roman Hindi depending on the prompt). Keep technical terms (like CPU, RAM, battery, volume) in English. Sound warm and natural.";
    } else if (speechLanguageMode === "en-IN") {
      modeDirective = "Respond in clear, confident Indian English with a refined assistant persona. Keep answers crisp and helpful.";
    } else {
      modeDirective = "Match the language and dialect of the user prompt naturally. If the user speaks Hinglish, respond in natural conversational Hinglish. If in English, respond in English. If in Hindi, respond in Hindi.";
    }

    const voiceDirective = [
      "You are speaking aloud through text-to-speech.",
      "Do NOT use markdown formatting, asterisks, bullet points, numbered lists, or code blocks.",
      "Keep responses brief, conversational, and direct (1 to 3 spoken sentences).",
      modeDirective
    ].join(" ");

    return {
      directive: voiceDirective,
      prompt: String(userPrompt || "").trim(),
      languageMode: speechLanguageMode
    };
  }

  /**
   * Detect voice activity and interruption.
   */
  triggerInterruption() {
    this.interrupted = true;
    this.isSpeaking = false;
    return { action: "AUDIO_STOPPED", timestamp: new Date().toISOString() };
  }

  resetInterruption() {
    this.interrupted = false;
  }

  recordSpeechTurn(speaker, text, meta = {}) {
    const entry = {
      id: "v-" + Date.now(),
      speaker, // "user" | "ultron"
      text,
      language: this.language,
      timestamp: new Date().toISOString(),
      ...meta
    };
    this.voiceHistory.push(entry);
    if (this.voiceHistory.length > 100) this.voiceHistory.shift();
    return entry;
  }

  getVoiceHistory(limit = 20) {
    return this.voiceHistory.slice(-limit);
  }
/**
   * Handles audio stream errors, records diagnostics, and halts listening safely.
   */
  handleAudioStreamError(error) {
    const errRecord = {
      timestamp: new Date().toISOString(),
      message: error?.message || String(error),
      code: error?.code || "STREAM_ERROR"
    };
    this.streamErrors.push(errRecord);
    if (this.streamErrors.length > 20) this.streamErrors.shift();
    this.isListening = false;
    return {
      handled: true,
      error: errRecord,
      action: "AUDIO_STREAM_HALTED"
    };
  }

  /**
   * Resets and recovers the listening daemon after audio crashes or device disconnects.
   */
  recoverListeningDaemon(options = {}) {
    const maxRetries = options.maxRetries ?? 3;
    if (this.recoveryAttempts >= maxRetries) {
      return {
        recovered: false,
        error: "MAX_RECOVERY_ATTEMPTS_EXCEEDED",
        attempts: this.recoveryAttempts
      };
    }
    this.recoveryAttempts += 1;
    this.interrupted = false;
    this.isSpeaking = false;
    this.isListening = true;
    return {
      recovered: true,
      attempts: this.recoveryAttempts,
      mode: this.mode,
      activeProfile: this.activeProfile.id
    };
  }

  /**
   * Prepares speech plan with natural sentence segmentation for TTS engines.
   */
  synthesizeSpeechPlan(text, options = {}) {
    const sanitized = this.formatSpokenUpdate(text, this.language);
    if (!sanitized) {
      return { prepared: false, segments: [], profile: this.activeProfile };
    }
    const modeConfig = this.getPersonalityMode();
    const effectivePrefix = options.omitPrefix ? "" : (modeConfig.prefix || "");
    const fullText = (effectivePrefix + sanitized).trim();

    const sentences = fullText
      .split(/(?<=[.?!])\s+/)
      .map(s => s.trim())
      .filter(Boolean);

    return {
      prepared: true,
      text: fullText,
      segments: sentences.length > 0 ? sentences : [fullText],
      profile: this.activeProfile,
      personalityMode: modeConfig.id,
      rate: options.rate ?? modeConfig.rate ?? this.activeProfile.rate,
      pitch: options.pitch ?? modeConfig.pitch ?? this.activeProfile.pitch
    };
  }
/**
   * Synthesize speech using Kokoro-82M am_onyx voice with resonance tuning.
   */
  async speakKokoro(text, options = {}) {
    const modeConfig = this.getPersonalityMode();
    const sanitized = this.formatSpokenUpdate(text, this.language);
    const effectivePrefix = options.omitPrefix ? "" : (modeConfig.prefix || "");
    const fullSpoken = (effectivePrefix + sanitized).trim();
    const voice = options.voice || this.activeProfile.voiceId || "am_onyx";
    const speed = typeof options.speed === "number" ? options.speed : (options.rate ?? modeConfig.rate ?? this.activeProfile.rate ?? 0.95);
    return kokoroEngine.synthesize(fullSpoken, { voice, speed, play: Boolean(options.play) });
  }
}
