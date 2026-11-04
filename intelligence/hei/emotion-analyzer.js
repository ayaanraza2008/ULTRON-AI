/**
 * ULTRON AI — Deep Emotional Analysis Engine (HEI)
 * 
 * Implements multi-signal contextual analysis:
 * - Explicit statement prioritization (2.5x weight)
 * - Linguistic patterns in English, Hindi, and Hinglish
 * - Sentence structure, punctuation, capitalization, and brevity cues
 * - Sarcasm and irony detection
 * - Hesitation, uncertainty, and indirect requests
 * - Mixed and complex emotion identification
 * - Multi-turn emotional trajectory tracking (improving/worsening/stable/volatile)
 * - Confidence and intensity estimation
 * - Ethical boundary and crisis safety detection
 */

import { EMOTIONS, getEmotionMetadata } from './emotion-taxonomy.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m);
}

// Crisis indicators requiring immediate ethical safety protocol
export const CRISIS_PATTERNS = Object.freeze([
  /\b(kill myself|end my life|commit suicide|want to die|suicidal)\b/i,
  /\b(hurt myself|self[- ]harm|cut myself|bleed out)\b/i,
  /\b(meri jaan lena|khudkushi|mar jana chahta hoon|mar jau)\b/i,
  /\b(in immediate danger|someone is attacking me|call the police now)\b/i,
]);

// Complex mixed-emotion canonical combinations
export const MIXED_EMOTION_PAIRS = Object.freeze([
  { primary: 'HAPPINESS', secondary: 'ANXIETY', label: 'Happy + Nervous' },
  { primary: 'EXCITEMENT', secondary: 'ANXIETY', label: 'Excited + Anxious' },
  { primary: 'ANGER', secondary: 'DISAPPOINTMENT', label: 'Angry + Disappointed' },
  { primary: 'SADNESS', secondary: 'HOPE', label: 'Sad + Hopeful' },
  { primary: 'LONELINESS', secondary: 'GRATITUDE', label: 'Lonely + Grateful' },
  { primary: 'PRIDE', secondary: 'OVERWHELMED', label: 'Proud + Overwhelmed' },
  { primary: 'FEAR', secondary: 'INTEREST', label: 'Fearful + Curious' },
  { primary: 'LOVE', secondary: 'JEALOUSY', label: 'Love + Jealousy' },
  { primary: 'RELIEF', secondary: 'APATHY', label: 'Relief + Exhaustion' },
  { primary: 'NOSTALGIA', secondary: 'MELANCHOLY', label: 'Nostalgia + Melancholy' },
  { primary: 'ANXIETY', secondary: 'EXCITEMENT', label: 'Anxiety + Excitement' },
  { primary: 'GRIEF', secondary: 'GRATITUDE', label: 'Grief + Gratitude' },
  { primary: 'EMBARRASSMENT', secondary: 'HAPPINESS', label: 'Embarrassment + Amusement' },
  { primary: 'RESENTMENT', secondary: 'VULNERABILITY', label: 'Resentment + Vulnerability' },
  { primary: 'HOPE', secondary: 'UNEASE', label: 'Hope + Uncertainty' }
]);

export class DeepEmotionalAnalyzer {
  constructor(options = {}) {
    this.confidenceThreshold = typeof options.confidenceThreshold === 'number' ? options.confidenceThreshold : 0.35;
    this.historyLength = options.historyLength || 10;
    this.contextHistory = [];
  }

  /**
   * Main analysis pipeline
   */
  analyze(text, options = {}) {
    const rawText = String(text || '').trim();
    if (!rawText) {
      return this.buildNeutralAssessment('empty_input');
    }

    // 1. Safety & Crisis check
    const crisisMatch = this.detectCrisis(rawText);
    if (crisisMatch.isCrisis) {
      return {
        isCrisis: true,
        crisisType: crisisMatch.type,
        primaryEmotion: 'FEAR',
        secondaryEmotions: ['ANXIETY', 'VULNERABILITY'],
        intensity: 0.95,
        valence: -0.95,
        arousal: 0.90,
        confidence: 0.99,
        trend: 'CRITICAL',
        recommendedStrategy: 'SAFETY_INTERVENTION',
        responseDirective: 'Express compassionate concern immediately, prioritize physical safety, and provide emergency contact helplines (e.g. 988 Suicide & Crisis Lifeline / 112 emergency).',
        discreetSummary: 'Crisis safety protocol triggered.'
      };
    }

    // 2. Structural & stylistic signal analysis
    const stylisticSignals = this.extractStylisticSignals(rawText);

    // 3. Sarcasm detection
    const sarcasmDetected = this.detectSarcasm(rawText, stylisticSignals);

    // 4. Multi-category scoring
    const scores = this.computeEmotionScores(rawText, stylisticSignals, sarcasmDetected);

    // 5. Select primary and secondary emotions
    const sorted = Object.entries(scores)
      .map(([key, score]) => ({ key, score, meta: EMOTIONS[key] }))
      .filter(item => item.score > 0.05)
      .sort((a, b) => b.score - a.score);

    if (sorted.length === 0 || sorted[0].score < this.confidenceThreshold) {
      const neutral = this.buildNeutralAssessment('low_confidence');
      this.recordContext(rawText, neutral);
      return neutral;
    }

    const primary = sorted[0];
    const secondaryList = sorted.slice(1, 4).filter(s => s.score >= primary.score * 0.30 || s.score >= 0.40);

    // 6. Compute intensity, valence, arousal
    const intensity = this.computeIntensity(primary, stylisticSignals);
    let valence = primary.meta.valence;
    let arousal = primary.meta.arousal;

    // Blend secondary emotions into valence and arousal
    if (secondaryList.length > 0) {
      let totalWeight = 1.0;
      let blendedValence = valence;
      let blendedArousal = arousal;

      secondaryList.forEach(sec => {
        const weight = sec.score / primary.score * 0.5;
        totalWeight += weight;
        blendedValence += sec.meta.valence * weight;
        blendedArousal += sec.meta.arousal * weight;
      });

      valence = Number((blendedValence / totalWeight).toFixed(2));
      arousal = Number((blendedArousal / totalWeight).toFixed(2));
    }

    // Adjust for stylistic markers (ALL CAPS, exclamations)
    if (stylisticSignals.isAllCaps || stylisticSignals.exclamationCount >= 2) {
      arousal = Math.min(1.0, arousal + 0.15);
    }
    if (stylisticSignals.ellipsisCount >= 1 || stylisticSignals.hesitationDetected) {
      arousal = Math.max(0.1, arousal - 0.15);
    }

    // 7. Detect complex mixed emotion label if applicable
    const mixedLabel = this.identifyMixedPair(primary.key, secondaryList.map(s => s.key));

    // 8. Confidence calculation
    const confidence = this.computeConfidence(primary, secondaryList, rawText);

    // 9. Emotional trajectory across history
    const trend = this.evaluateTrend(valence, arousal);

    const assessment = {
      isCrisis: false,
      primaryEmotion: primary.key,
      primaryName: primary.meta.name,
      secondaryEmotions: secondaryList.map(s => s.key),
      secondaryNames: secondaryList.map(s => s.meta.name),
      isMixed: secondaryList.length > 0,
      mixedEmotionLabel: mixedLabel,
      intensity: Number(intensity.toFixed(2)),
      valence: Number(valence.toFixed(2)),
      arousal: Number(arousal.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      trend,
      signals: {
        sarcasm: sarcasmDetected,
        hesitation: stylisticSignals.hesitationDetected,
        brevity: stylisticSignals.isVeryShort,
        repetition: stylisticSignals.repetitionDetected,
      },
      recommendedStrategy: primary.meta.responsePolicy.strategy,
      suggestedTone: primary.meta.responsePolicy.tone,
      dos: primary.meta.responsePolicy.dos,
      donts: primary.meta.responsePolicy.donts,
      vocalModulation: primary.meta.vocalSettings,
      coreVisualState: primary.meta.coreVisualState
    };

    this.recordContext(rawText, assessment);
    return assessment;
  }

  detectCrisis(text) {
    for (const pattern of CRISIS_PATTERNS) {
      if (pattern.test(text)) {
        return { isCrisis: true, type: 'CRITICAL_SAFETY' };
      }
    }
    return { isCrisis: false };
  }

  extractStylisticSignals(text) {
    const isAllCaps = text.length > 4 && text === text.toUpperCase() && /[A-Z]/.test(text);
    const exclamationCount = (text.match(/!/g) || []).length;
    const questionCount = (text.match(/\?/g) || []).length;
    const interrobangCount = (text.match(/\?!|\!\?/g) || []).length;
    const ellipsisCount = (text.match(/\.{2,}/g) || []).length;
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);
    const isVeryShort = words.length <= 2 && text.length <= 12;

    const hesitationDetected = (
      /\b(um|uh|hmm|i guess|maybe|not sure|kind of|shyad|pata nahi)\b/i.test(text) ||
      ellipsisCount > 0
    );

    const repetitionDetected = (
      /\b(again and again|baar baar|tried everything|keeps failing|nothing works|over and over)\b/i.test(text)
    );

    return {
      isAllCaps,
      exclamationCount,
      questionCount,
      interrobangCount,
      ellipsisCount,
      wordCount: words.length,
      isVeryShort,
      hesitationDetected,
      repetitionDetected
    };
  }

  detectSarcasm(text, signals) {
    // Sarcastic phrases like "oh wonderful, another bug", "great, just what i needed"
    const lower = text.toLowerCase();
    const sarcasmKeywords = [
      /oh\s+(?:great|wonderful|perfect|fantastic|brilliant)[,.!\s]+(?:another|it\s+crashed|failed|broke|error)/i,
      /(?:just\s+what\s+i\s+needed|thanks\s+for\s+nothing|kamaal\s+hai\s+phir\s+se\s+crash)/i,
      /(?:wow|great),?\s+(?:nothing\s+works|it\s+died|broken\s+again)/i
    ];
    return sarcasmKeywords.some(rx => rx.test(lower));
  }

  computeEmotionScores(text, signals, isSarcastic) {
    const lower = text.toLowerCase();
    const scores = {};

    // Initialize all 51 emotions
    Object.keys(EMOTIONS).forEach(k => { scores[k] = 0.0; });

    // If sarcasm is detected, direct points to FRUSTRATION / BITTERNESS / ANGER with SARCASM
    if (isSarcastic) {
      scores.FRUSTRATION += 0.85;
      scores.BITTERNESS += 0.65;
      scores.SARCASM = (scores.SARCASM || 0) + 0.80;
      scores.ANGER += 0.50;
      return scores;
    }

    // Check for explicit feeling statements (e.g. "I feel angry", "I am frustrated", "I don't feel good today")
    for (const [key, meta] of Object.entries(EMOTIONS)) {
      // Check explicit emotion name or any indicator in feeling statements
      const candidates = [meta.name.toLowerCase(), ...meta.indicators.map(i => i.toLowerCase())];
      for (const cand of candidates) {
        if (cand.length < 3) continue;
        const candEsc = escapeRegex(cand);
        const explicitRx1 = new RegExp(`\\b(?:i feel|feeling|i am|i'm)\\s+(?:so\\s+|really\\s+|extremely\\s+|very\\s+|mostly\\s+|deeply\\s+|also\\s+)?${candEsc}\\b`, 'i');
        const explicitRx2 = new RegExp(`\\b(?:mujhe|main)\\s+(?:bahut\\s+)?${candEsc}\\b`, 'i');
        if (explicitRx1.test(lower) || explicitRx2.test(lower)) {
          scores[key] += 1.20; // 2.5x standard indicator weight
          break;
        }
      }

      // Check indicators
      for (const ind of meta.indicators) {
        const indLower = ind.toLowerCase();
        if (lower.includes(indLower)) {
          scores[key] += 0.45;
        }
      }
    }

    // Special contextual rules
    // 1. "tired of this", "nothing works", "again and again" -> FRUSTRATION, OVERWHELMED
    if (signals.repetitionDetected) {
      scores.FRUSTRATION += 0.70;
      scores.OVERWHELMED += 0.45;
      scores.APATHY += 0.25;
    }

    // 2. "don't feel good today", "feeling low" -> SADNESS
    if (/\b(dont feel good today|don't feel good today|feeling low|mood off)\b/i.test(lower)) {
      scores.SADNESS += 0.85;
      scores.MELANCHOLY += 0.45;
    }

    // 3. "finally works", "it works!" -> EXCITEMENT, RELIEF, SATISFACTION
    if (/\b(finally works|it finally works|it works!|solved it)\b/i.test(lower)) {
      scores.EXCITEMENT += 0.80;
      scores.RELIEF += 0.65;
      scores.SATISFACTION += 0.55;
    }

    // 4. "nobody understands me", "feel so alone" -> LONELINESS, ISOLATION
    if (/\b(nobody understands me|feel so alone|all alone|no one cares)\b/i.test(lower)) {
      scores.LONELINESS += 0.90;
      scores.ISOLATION += 0.70;
      scores.SADNESS += 0.50;
    }

    // 5. Short curt answers like "fine.", "whatever." -> SUBTLE_TONE_SHIFT
    if (signals.isVeryShort && /^(fine\.?|whatever\.?|k\.?|sure\.?|theek hai\.?)$/i.test(lower.trim())) {
      scores.SUBTLE_TONE_SHIFT = (scores.SUBTLE_TONE_SHIFT || 0) + 0.85;
      scores.APATHY += 0.50;
      scores.FRUSTRATION += 0.40;
    }

    // 6. Section 3.3 Contextual rules for specialized states
    if (/\b(confused|dont understand|don't understand|samajh nahi aaya|makes no sense|what does this mean|puzzled|baffled)\b/i.test(lower)) {
      scores.CONFUSION = (scores.CONFUSION || 0) + 0.85;
    }
    if (/\b(gabhrahat|jitters|darr lag raha hai|butterflies|sweating bullets)\b/i.test(lower)) {
      scores.NERVOUSNESS = (scores.NERVOUSNESS || 0) + 0.85;
    }
    if (/\b(curious|how does it work|kaise kaam karta hai|under the hood|deep dive|explain the mechanism|fascinating)\b/i.test(lower)) {
      scores.CURIOSITY = (scores.CURIOSITY || 0) + 0.85;
    }
    if (/\b(let's do this|let's build|chalo karte hain|motivated|pumped|crush it|unstoppable|locked in)\b/i.test(lower)) {
      scores.MOTIVATION = (scores.MOTIVATION || 0) + 0.90;
    }
    if (/\b(exhausted|burnt out|thak gaya hoon|drained|no energy left|brain is fried|mentally tired)\b/i.test(lower)) {
      scores.EMOTIONAL_EXHAUSTION = (scores.EMOTIONAL_EXHAUSTION || 0) + 0.90;
    }
    if (/\b(mixed feelings|bittersweet|khatte meethe|excited but terrified|happy and sad)\b/i.test(lower)) {
      scores.MIXED_EMOTIONS = (scores.MIXED_EMOTIONS || 0) + 0.90;
    }

    // 6. Hesitation and ellipses with uncertain language -> ANXIETY, UNEASE, VULNERABILITY
    if (signals.hesitationDetected) {
      scores.UNEASE += 0.35;
      scores.ANXIETY += 0.30;
      scores.VULNERABILITY += 0.25;
    }

    return scores;
  }

  computeIntensity(primary, signals) {
    let base = 0.55;
    if (signals.isAllCaps) base += 0.25;
    if (signals.exclamationCount > 0) base += Math.min(0.20, signals.exclamationCount * 0.08);
    if (signals.interrobangCount > 0) base += 0.15;
    if (signals.repetitionDetected) base += 0.20;
    return Math.min(1.0, Math.max(0.1, base));
  }

  computeConfidence(primary, secondaryList, text) {
    let conf = 0.50;
    if (primary.score >= 1.0) conf += 0.35; // explicit statement
    else if (primary.score >= 0.7) conf += 0.20;

    // Word count / context boost
    if (text.length > 20) conf += 0.10;
    // Ambiguity penalty if top two scores are almost identical
    if (secondaryList.length > 0 && Math.abs(primary.score - secondaryList[0].score) < 0.1) {
      conf -= 0.15;
    }
    return Math.min(0.98, Math.max(0.25, conf));
  }

  identifyMixedPair(primKey, secKeys) {
    for (const pair of MIXED_EMOTION_PAIRS) {
      if (
        (pair.primary === primKey && secKeys.includes(pair.secondary)) ||
        (pair.secondary === primKey && secKeys.includes(pair.primary))
      ) {
        return pair.label;
      }
    }
    if (secKeys.length > 0) {
      const primName = EMOTIONS[primKey]?.name || primKey;
      const secName = EMOTIONS[secKeys[0]]?.name || secKeys[0];
      return `${primName} + ${secName}`;
    }
    return null;
  }

  evaluateTrend(currentValence, currentArousal) {
    if (this.contextHistory.length === 0) return 'STABLE';
    const last = this.contextHistory[this.contextHistory.length - 1].assessment;
    const diff = currentValence - last.valence;

    if (diff >= 0.3) return 'IMPROVING';
    if (diff <= -0.3) return 'WORSENING';
    if (Math.abs(currentArousal - last.arousal) >= 0.4) return 'VOLATILE';
    return 'STABLE';
  }

  recordContext(text, assessment) {
    this.contextHistory.push({
      timestamp: Date.now(),
      text,
      assessment
    });
    if (this.contextHistory.length > this.historyLength) {
      this.contextHistory.shift();
    }
  }

  buildNeutralAssessment(reason = 'neutral') {
    return {
      isCrisis: false,
      primaryEmotion: 'CALMNESS',
      primaryName: 'Calmness',
      secondaryEmotions: [],
      secondaryNames: [],
      isMixed: false,
      mixedEmotionLabel: null,
      intensity: 0.30,
      valence: 0.10,
      arousal: 0.20,
      confidence: 0.40,
      trend: 'STABLE',
      reason,
      signals: {
        sarcasm: false,
        hesitation: false,
        brevity: false,
        repetition: false,
      },
      recommendedStrategy: 'Maintain balanced, natural, and efficient communication.',
      suggestedTone: 'SERENE_BALANCED',
      dos: ['be clear and responsive', 'proceed productively'],
      donts: ['overcomplicate simple answers', 'inject artificial drama'],
      vocalModulation: { speed: 0.95, personalityMode: 'NORMAL' },
      coreVisualState: 'CALM'
    };
  }

  clearHistory() {
    this.contextHistory = [];
  }
}

export const deepEmotionalAnalyzer = new DeepEmotionalAnalyzer();
