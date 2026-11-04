/**
 * ULTRON AI — BYOX Tensor Reasoner & Local Semantic Embedding Engine
 *
 * Derived from Build Your Own X concepts:
 * - rasbt/LLMs-from-scratch (Vector embeddings & attention)
 * - Andrej Karpathy: Neural Networks Zero to Hero (Tensor math, softmax, norm)
 * - Victor Zhou: Implement a Neural Network from Scratch
 *
 * Provides pure-CPU vector mathematics, deterministic subword hash embeddings,
 * cosine similarity, and zero-shot intent classification without external models.
 */

export class ByoxTensorReasoner {
  constructor(options = {}) {
    this.dimensions = options.dimensions || 128;
    this.temperature = options.temperature ?? 0.05;
  }

  /**
   * Dot product of two equal-length numeric vectors.
   */
  dotProduct(vecA, vecB) {
    if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
      throw new Error(`Dimension mismatch: vecA (${vecA?.length}) vs vecB (${vecB?.length})`);
    }
    let sum = 0;
    for (let i = 0; i < vecA.length; i++) {
      sum += vecA[i] * vecB[i];
    }
    return sum;
  }

  /**
   * Euclidean (L2) norm of a vector.
   */
  vectorNorm(vec) {
    if (!Array.isArray(vec)) return 0;
    return Math.sqrt(this.dotProduct(vec, vec));
  }

  /**
   * L2-normalize a vector in-place or return a new normalized vector.
   */
  normalizeVector(vec) {
    const norm = this.vectorNorm(vec);
    if (norm === 0) return new Array(vec.length).fill(0);
    return vec.map(v => v / norm);
  }

  /**
   * Cosine similarity between two vectors (-1.0 to 1.0).
   */
  cosineSimilarity(vecA, vecB) {
    const normA = this.vectorNorm(vecA);
    const normB = this.vectorNorm(vecB);
    if (normA === 0 || normB === 0) return 0;
    return this.dotProduct(vecA, vecB) / (normA * normB);
  }

  /**
   * Numerically stable Softmax with temperature scaling.
   */
  softmax(logits, temperature = this.temperature) {
    const temp = Math.max(0.001, temperature);
    const scaled = logits.map(l => l / temp);
    const maxVal = Math.max(...scaled);
    const expVals = scaled.map(v => Math.exp(v - maxVal));
    const sumExp = expVals.reduce((acc, v) => acc + v, 0);
    return expVals.map(v => (sumExp === 0 ? 0 : v / sumExp));
  }

  /**
   * Deterministic 32-bit FNV-1a hash of a token string.
   */
  fnv1aHash(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash;
  }

  /**
   * Extract word and character n-grams from text.
   */
  tokenize(text) {
    if (typeof text !== 'string') return [];
    const normalized = text.toLowerCase().trim();
    const words = normalized.split(/[\s,.;:!?'"()\[\]{}<>\/\\~`@#$%^&*+=|_-]+/).filter(Boolean);
    const tokens = [...words];

    // Add character 3-grams for subword robustness (Hinglish, typos, morphology)
    for (const word of words) {
      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          tokens.push(`_${word.slice(i, i + 3)}_`);
        }
      }
    }

    // Add word 2-grams (bigrams) for contextual phrasing
    for (let i = 0; i < words.length - 1; i++) {
      tokens.push(`${words[i]}~${words[i + 1]}`);
    }

    return tokens;
  }

  /**
   * Encode a text string into a deterministic dense vector.
   */
  embed(text) {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = this.tokenize(text);

    if (tokens.length === 0) {
      return vector;
    }

    for (let pos = 0; pos < tokens.length; pos++) {
      const token = tokens[pos];
      const h1 = this.fnv1aHash(token);
      const h2 = this.fnv1aHash(`${token}#salt`);

      const index = Math.abs(h1 % this.dimensions);
      const sign = (h2 & 1) === 0 ? 1 : -1;
      // Positional decay weighting
      const posWeight = 1.0 / (1.0 + 0.05 * pos);
      vector[index] += sign * posWeight;

      // Secondary projection for dispersion
      const index2 = Math.abs(h2 % this.dimensions);
      const sign2 = (h1 & 2) === 0 ? 1 : -1;
      vector[index2] += sign2 * 0.5 * posWeight;
    }

    return this.normalizeVector(vector);
  }

  /**
   * Zero-shot intent classification against candidate intent descriptions.
   */
  classifyIntent(query, candidateIntents) {
    if (!query || !Array.isArray(candidateIntents) || candidateIntents.length === 0) {
      return { topIntent: null, confidence: 0, rankings: [] };
    }

    const queryVec = this.embed(query);
    const scoredCandidates = candidateIntents.map(candidate => {
      const intentName = typeof candidate === 'string' ? candidate : candidate.name;
      const description = typeof candidate === 'string' ? candidate : candidate.description || candidate.name;
      const candidateVec = this.embed(description);
      const similarity = this.cosineSimilarity(queryVec, candidateVec);
      return {
        intent: intentName,
        rawSimilarity: similarity,
        metadata: typeof candidate === 'object' ? candidate : {}
      };
    });

    // Compute softmax probabilities
    const rawScores = scoredCandidates.map(c => Math.max(0, c.rawSimilarity));
    const probabilities = this.softmax(rawScores, this.temperature);

    const rankings = scoredCandidates.map((c, idx) => ({
      ...c,
      confidence: Math.round(probabilities[idx] * 1000) / 1000
    })).sort((a, b) => b.confidence - a.confidence);

    const top = rankings[0];
    const runnerUp = rankings[1];
    const margin = runnerUp ? Math.round((top.confidence - runnerUp.confidence) * 1000) / 1000 : top.confidence;

    return {
      topIntent: top ? top.intent : null,
      confidence: top ? top.confidence : 0,
      marginOfConfidence: margin,
      rankings
    };
  }
}
