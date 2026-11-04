/**
 * ULTRON AI — Next-Generation Autonomous Intelligence
 * Module: HUMAN INTELLIGENCE INTERFACE (intelligence/human-interface.js)
 *
 * Unifies multi-lingual conversation (English, Hindi, Roman Hinglish),
 * human emotional intelligence (HEI) understanding, dynamic Kokoro voice modulation,
 * persistent user interaction preferences, and responsive event streams.
 */

import crypto from "node:crypto";
import { ultronHEI } from "./hei/index.js";
import { kokoroEngine } from "../voice/kokoro-engine.js";
import { BrainRouter } from "../core/brain-router.js";

const VISUAL_THEMES = {
  CALM: { color: "#00E5FF", frequency: 1.0 },
  REASSURING: { color: "#00B0FF", frequency: 0.8 },
  ENERGETIC: { color: "#FFD600", frequency: 1.8 },
  FOCUSED: { color: "#76FF03", frequency: 1.2 },
  CAUTIONARY: { color: "#FF9100", frequency: 1.4 },
  CRITICAL: { color: "#FF1744", frequency: 2.2 }
};

export class HumanIntelligenceInterface {
  constructor(options = {}) {
    this.hei = options.hei || ultronHEI;
    this.brainRouter = options.brainRouter || new BrainRouter();
    this.ttsEngine = options.ttsEngine || kokoroEngine;
    this.userPreferences = new Map();
  }

  /**
   * User Preferences Management (Persistent per user/device ID)
   */
  setPreferences(userId, prefs = {}) {
    const existing = this.userPreferences.get(userId) || {
      preferredLanguage: "auto",
      preferredVoice: "am_onyx",
      voiceSpeed: 0.95,
      verbosity: "concise",
      emotionalEmpathy: true
    };

    const updated = {
      ...existing,
      ...prefs,
      updatedAt: new Date().toISOString()
    };
    this.userPreferences.set(userId, updated);
    return updated;
  }

  getPreferences(userId) {
    return this.userPreferences.get(userId) || this.setPreferences(userId);
  }

  /**
   * Complete Human Interaction Pipeline:
   * 1. Detects language (English, Hindi, Hinglish).
   * 2. Evaluates emotional state and conversational triggers.
   * 3. Adapts vocal parameters and personality directive.
   * 4. Prepares client UI payload for desktop and mobile companions.
   */
  async processInteraction(userId, utterance, context = {}) {
    const text = String(utterance || "").trim();
    const prefs = this.getPreferences(userId);

    // 1. Language detection
    const langAnalysis = this.brainRouter.detectLanguage(text);
    const activeLanguage = prefs.preferredLanguage !== "auto" ? prefs.preferredLanguage : langAnalysis.language;

    // 2. Emotional intelligence analysis
    const heiOutcome = this.hei.processUtterance(text, {
      ...context,
      userPreferences: prefs,
      detectedLanguage: activeLanguage
    });

    // 3. Dynamic voice modulation
    const baseSpeed = prefs.voiceSpeed || 0.95;
    const heiSpeed = heiOutcome.vocalSettings?.speed || baseSpeed;
    const modulatedSpeed = Number(Math.max(0.80, Math.min(1.20, heiSpeed)).toFixed(2));

    const vocalProfile = {
      voiceId: prefs.preferredVoice || "am_onyx",
      engine: "kokoro",
      speed: modulatedSpeed,
      personalityMode: heiOutcome.vocalSettings?.personalityMode || "NORMAL",
      emotionalMode: heiOutcome.assessment.primaryEmotion,
      resonanceTuning: "authoritative_chest_200hz"
    };

    // 4. Determine visual theme for desktop/mobile UI pulse
    const visualStateStr = typeof heiOutcome.coreVisualState === "string" ? heiOutcome.coreVisualState : "CALM";
    const visualProfile = VISUAL_THEMES[visualStateStr] || VISUAL_THEMES.CALM;

    // 5. Formulate responsive event payload
    const responsePayload = {
      sessionId: context.sessionId || "session-" + crypto.randomBytes(4).toString("hex"),
      userId,
      input: {
        text,
        language: activeLanguage,
        dialect: langAnalysis.dialect
      },
      emotionalIntelligence: {
        primaryEmotion: heiOutcome.assessment.primaryEmotion,
        intensity: heiOutcome.assessment.intensity,
        valence: heiOutcome.assessment.valence,
        systemDirective: heiOutcome.systemDirective,
        coreVisualState: visualStateStr
      },
      vocalProfile,
      uiEvent: {
        visualState: visualStateStr,
        themeColor: visualProfile.color,
        waveformFrequency: visualProfile.frequency,
        statusText: `ULTRON [${heiOutcome.assessment.primaryEmotion.toUpperCase()}]: ${langAnalysis.dialect}`
      },
      timestamp: new Date().toISOString()
    };

    return responsePayload;
  }

  /**
   * Synthesize Speech with modulated Kokoro am_onyx voice profile
   */
  async synthesizeVoice(userId, textToSpeak, vocalProfileOverride = null) {
    const prefs = this.getPreferences(userId);
    const speed = vocalProfileOverride?.speed || prefs.voiceSpeed || 0.95;
    const voice = vocalProfileOverride?.voiceId || prefs.preferredVoice || "am_onyx";

    return await this.ttsEngine.synthesize(textToSpeak, {
      voice,
      speed
    });
  }
}

export const humanInterface = new HumanIntelligenceInterface();
