/**
 * ULTRON AI — Content Authenticity & Statistical Provenance Analyzer
 * Evaluates and integrates text analysis & writing provenance from udaysharmadev/Not-Ai
 *
 * Computes calibrated burstiness, vocabulary entropy, sentence-length variance,
 * and repetitive n-gram ratios. Strictly reports calibrated uncertainty; NEVER
 * claims absolute certainty in identifying synthetic vs. human authorship.
 */

export class ContentProvenanceAnalyzer {
  /**
   * Analyzes text passage for linguistic variance, burstiness, and repetitive patterns.
   */
  analyzeTextProvenance(text = "") {
    const clean = String(text).trim();
    if (clean.length < 50) {
      return {
        analyzed: false,
        reason: "INSUFFICIENT_TEXT_LENGTH",
        message: "Text must be at least 50 characters for meaningful statistical analysis."
      };
    }

    const sentences = clean.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    const words = clean.toLowerCase().match(/\b[a-z0-9'-]+\b/g) || [];

    if (sentences.length < 2 || words.length < 15) {
      return {
        analyzed: false,
        reason: "INSUFFICIENT_SENTENCE_SAMPLE",
        message: "At least 2 complete sentences required."
      };
    }

    // 1. Calculate Burstiness (Variance in sentence lengths in words)
    const sentenceLengths = sentences.map(s => (s.match(/\b[a-z0-9'-]+\b/gi) || []).length).filter(l => l > 0);
    const meanLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance = sentenceLengths.reduce((sum, l) => sum + Math.pow(l - meanLength, 2), 0) / sentenceLengths.length;
    const stdDev = Math.sqrt(variance);
    const burstinessScore = Number((stdDev / (meanLength || 1)).toFixed(3)); // Coefficient of variation

    // 2. Vocabulary Diversity (Type-Token Ratio TTR)
    const uniqueWords = new Set(words);
    const typeTokenRatio = Number((uniqueWords.size / words.length).toFixed(3));

    // 3. Repeated Trigrams Analysis
    const trigrams = new Map();
    for (let i = 0; i < words.length - 2; i++) {
      const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      trigrams.set(tri, (trigrams.get(tri) || 0) + 1);
    }
    let repeatedTrigramCount = 0;
    for (const count of trigrams.values()) {
      if (count > 1) repeatedTrigramCount += (count - 1);
    }
    const trigramRepetitionRatio = Number((repeatedTrigramCount / Math.max(1, words.length - 2)).toFixed(3));

    // 4. Synthesizer Advisory Classification (Always Calibrated & Uncertain)
    // High burstiness + high TTR correlates with natural human variation; low burstiness + uniform flow correlates with LLM defaults.
    let likelihood = "MIXED_OR_UNCERTAIN";
    let syntheticProbability = 0.50;

    if (burstinessScore > 0.65 && typeTokenRatio > 0.62) {
      likelihood = "LIKELY_HUMAN_AUTHORED";
      syntheticProbability = 0.28;
    } else if (burstinessScore < 0.32 && typeTokenRatio < 0.48) {
      likelihood = "LIKELY_SYNTHETIC_ASSISTED";
      syntheticProbability = 0.74;
    }

    return {
      analyzed: true,
      textLengthChars: clean.length,
      wordCount: words.length,
      sentenceCount: sentences.length,
      metrics: {
        burstinessCoefficient: burstinessScore,
        averageSentenceWords: Number(meanLength.toFixed(1)),
        sentenceStdDev: Number(stdDev.toFixed(2)),
        vocabularyDiversityTtr: typeTokenRatio,
        trigramRepetitionRatio
      },
      assessment: {
        likelihood,
        syntheticProbabilityEstimate: syntheticProbability,
        confidenceLevel: "ADVISORY_UNCERTAIN"
      },
      disclaimer: "Statistical metrics cannot definitively prove authorship or identify AI generation. Human writers often produce uniform text, and modern LLMs can exhibit high burstiness. Treat as advisory heuristic only."
    };
  }
}

export const contentProvenanceAnalyzer = new ContentProvenanceAnalyzer();

export function analyzeContentProvenance(text = "") {
  const result = contentProvenanceAnalyzer.analyzeTextProvenance(text);
  if (!result.analyzed) {
    return {
      status: "INSUFFICIENT_TEXT",
      aiProbabilityScore: 0.5,
      burstiness: 0,
      typeTokenRatio: 0,
      trigramRepetition: 0,
      disclaimer: "Statistical heuristics are indicative only and cannot serve as definitive forensic proof."
    };
  }
  return {
    status: "ANALYZED",
    burstiness: result.metrics.burstinessCoefficient,
    typeTokenRatio: result.metrics.vocabularyDiversityTtr,
    trigramRepetition: result.metrics.trigramRepetitionRatio,
    aiProbabilityScore: result.assessment.syntheticProbabilityEstimate,
    disclaimer: result.disclaimer
  };
}

