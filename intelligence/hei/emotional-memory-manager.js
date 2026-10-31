/**
 * ULTRON AI — Emotional Memory & Privacy Personalization Manager (HEI)
 * 
 * Manages user-approved communication preferences and active conversation
 * emotional history while upholding strict privacy, consent, and ethical safeguards.
 * 
 * Rules:
 * - Temporary emotions are NEVER stored as permanent psychological traits.
 * - No unsolicited psychiatric profiling.
 * - Full user transparency: inspect, edit, clear, and permanently delete emotional data.
 */

export const DEFAULT_HEI_PREFERENCES = Object.freeze({
  heiEnabled: true,
  textAnalysisEnabled: true,
  voiceCuesEnabled: false, // strictly opt-in
  cameraCuesEnabled: false, // strictly opt-in
  confidenceThreshold: 0.35,
  empathyLevel: 0.8,
  conversationalEnergy: 0.7,
  preferredStyle: 'BALANCED', // BALANCED | DIRECT | EMPATHETIC | ANALYTICAL
  directAnswersWhenFrustrated: true,
  fewerQuestionsWhenOverwhelmed: true,
  gentleInDifficultConversations: true,
  enthusiasticWhenCelebrating: true,
  practicalOverGenericMotivation: true,
  languagePreference: 'auto',
  lastUpdatedAt: null
});

export class EmotionalMemoryManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'ultron_hei_preferences';
    this.preferences = { ...DEFAULT_HEI_PREFERENCES };
    this.activeConversationHistory = [];
    this.maxHistoryLength = options.maxHistoryLength || 15;
  }

  getPreferences() {
    return { ...this.preferences };
  }

  updatePreferences(updates = {}) {
    if (!updates || typeof updates !== 'object') return this.getPreferences();

    const allowedKeys = Object.keys(DEFAULT_HEI_PREFERENCES);
    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        if (key === 'confidenceThreshold' || key === 'empathyLevel' || key === 'conversationalEnergy') {
          const num = Number(value);
          if (!Number.isNaN(num) && num >= 0 && num <= 1.0) {
            this.preferences[key] = num;
          }
        } else if (typeof value === 'boolean') {
          this.preferences[key] = value;
        } else if (key === 'preferredStyle' || key === 'languagePreference') {
          this.preferences[key] = String(value);
        }
      }
    }
    this.preferences.lastUpdatedAt = new Date().toISOString();
    return this.getPreferences();
  }

  recordInteraction(userText, assistantText, assessment) {
    if (!this.preferences.heiEnabled) return;

    this.activeConversationHistory.push({
      timestamp: Date.now(),
      userText,
      assistantText,
      primaryEmotion: assessment.primaryEmotion,
      intensity: assessment.intensity,
      valence: assessment.valence,
      arousal: assessment.arousal,
      trend: assessment.trend
    });

    if (this.activeConversationHistory.length > this.maxHistoryLength) {
      this.activeConversationHistory.shift();
    }
  }

  getActiveContext() {
    return [...this.activeConversationHistory];
  }

  clearCurrentContext() {
    this.activeConversationHistory = [];
    return { cleared: true, timestamp: new Date().toISOString() };
  }

  deleteEmotionalMemory() {
    this.preferences = { ...DEFAULT_HEI_PREFERENCES, lastUpdatedAt: new Date().toISOString() };
    this.activeConversationHistory = [];
    return { deleted: true, resetToDefaults: true, timestamp: new Date().toISOString() };
  }

  setHEIEnabled(enabled) {
    this.preferences.heiEnabled = Boolean(enabled);
    if (!this.preferences.heiEnabled) {
      this.clearCurrentContext();
    }
    return this.preferences.heiEnabled;
  }
}

export const emotionalMemoryManager = new EmotionalMemoryManager();
