/**
 * ULTRON AI — Master Human Emotional Intelligence (HEI) Orchestrator
 * Project Codename: ULTRON SINGULARITY & ETERNAL
 * 
 * Provides unified integration across:
 * - Complete A–Z 51-emotion taxonomy
 * - Deep multi-signal contextual emotion analysis
 * - Adaptive personality & conversational strategy engine
 * - Emotional memory, preferences, and ethical privacy manager
 * - Living Energy Core emotional visual modulation
 * - Voice engine & speech synthesis adaptation (Kokoro am_onyx)
 */

import { EMOTIONS, getAllEmotionKeys, getEmotionMetadata, EMOTION_LETTERS } from './emotion-taxonomy.js';
import { deepEmotionalAnalyzer, DeepEmotionalAnalyzer, MIXED_EMOTION_PAIRS } from './emotion-analyzer.js';
import { adaptivePersonalityEngine, AdaptivePersonalityEngine, COMMUNICATION_STYLES } from './adaptive-personality-engine.js';
import { emotionalMemoryManager, EmotionalMemoryManager, DEFAULT_HEI_PREFERENCES } from './emotional-memory-manager.js';

export {
  EMOTIONS,
  getAllEmotionKeys,
  getEmotionMetadata,
  EMOTION_LETTERS,
  MIXED_EMOTION_PAIRS,
  COMMUNICATION_STYLES,
  DEFAULT_HEI_PREFERENCES,
  DeepEmotionalAnalyzer,
  AdaptivePersonalityEngine,
  EmotionalMemoryManager
};

export class UltronHumanEmotionalIntelligence {
  constructor(options = {}) {
    this.analyzer = options.analyzer || deepEmotionalAnalyzer;
    this.personalityEngine = options.personalityEngine || adaptivePersonalityEngine;
    this.memoryManager = options.memoryManager || emotionalMemoryManager;
  }

  /**
   * Complete emotional processing cycle for an incoming user utterance
   */
  processUtterance(text, options = {}) {
    const prefs = this.memoryManager.getPreferences();

    // If HEI is completely disabled by user in settings
    if (!prefs.heiEnabled) {
      return {
        enabled: false,
        assessment: this.analyzer.buildNeutralAssessment('hei_disabled'),
        systemDirective: '',
        vocalSettings: { speed: 0.95, personalityMode: 'NORMAL' },
        coreVisualState: 'CALM'
      };
    }

    // Perform deep emotional analysis
    const assessment = this.analyzer.analyze(text, {
      confidenceThreshold: prefs.confidenceThreshold,
      ...options
    });

    // Generate adaptive LLM system directive
    const systemDirective = this.personalityEngine.generateSystemDirective(assessment, prefs);

    // Generate vocal modulation settings for TTS
    const vocalSettings = this.personalityEngine.getVocalParameters(assessment);

    // Determine emotional visual feedback state for Living Energy Core
    const coreVisualState = assessment.coreVisualState || 'CALM';

    return {
      enabled: true,
      assessment,
      systemDirective,
      vocalSettings,
      coreVisualState
    };
  }

  /**
   * Records completed conversational turn
   */
  recordTurn(userText, assistantText, assessment) {
    if (assessment && assessment.primaryEmotion) {
      this.memoryManager.recordInteraction(userText, assistantText, assessment);
    }
  }

  getPreferences() {
    return this.memoryManager.getPreferences();
  }

  updatePreferences(updates) {
    return this.memoryManager.updatePreferences(updates);
  }

  clearContext() {
    this.analyzer.clearHistory();
    return this.memoryManager.clearCurrentContext();
  }

  deleteMemory() {
    this.analyzer.clearHistory();
    return this.memoryManager.deleteEmotionalMemory();
  }

  getStatus() {
    const prefs = this.memoryManager.getPreferences();
    const activeContext = this.memoryManager.getActiveContext();
    return {
      enabled: prefs.heiEnabled,
      taxonomySize: Object.keys(EMOTIONS).length,
      preferences: prefs,
      activeContextTurns: activeContext.length,
      latestEmotion: activeContext.length > 0 ? activeContext[activeContext.length - 1].primaryEmotion : 'CALMNESS',
      timestamp: new Date().toISOString()
    };
  }
}

export const ultronHEI = new UltronHumanEmotionalIntelligence();
