/**
 * ULTRON AI — BYOX Hybrid RAG Search Engine
 *
 * Derived from Build Your Own X concepts:
 * - langchain-ai/rag-from-scratch (Chunking, retrieval, generation)
 * - Boyter: Building a Vector Space Indexing Engine in Python
 * - Steven Loria: Finding Important Words in Text Using TF-IDF / BM25
 *
 * Implements sliding-window chunking, inverted index with BM25 ranking,
 * dense vector cosine retrieval, and Reciprocal Rank Fusion (RRF).
 */

import { ByoxTensorReasoner } from '../core/byox-tensor-reasoner.js';

export class ByoxRagSearch {
  constructor(options = {}) {
    this.k1 = options.k1 ?? 1.2;
    this.b = options.b ?? 0.75;
    this.rrfK = options.rrfK ?? 60;
    this.chunkSize = options.chunkSize ?? 250;
    this.chunkOverlap = options.chunkOverlap ?? 50;

    this.tensorReasoner = new ByoxTensorReasoner({ dimensions: 128 });

    // Inverted Index structures
    this.documents = new Map(); // id -> { id, text, metadata, tokens, length, vector }
    this.invertedIndex = new Map(); // term -> Map(docId -> termFrequency)
    this.totalDocLength = 0;
  }

  /**
   * Split long text into overlapping chunks.
   */
  chunkText(text, metadata = {}) {
    if (!text || typeof text !== 'string') return [];
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length <= this.chunkSize) {
      return [{
        text: words.join(' '),
        chunkIndex: 0,
        totalChunks: 1,
        metadata
      }];
    }

    const chunks = [];
    let start = 0;
    let chunkIndex = 0;

    while (start < words.length) {
      const end = Math.min(start + this.chunkSize, words.length);
      const chunkWords = words.slice(start, end);
      chunks.push({
        text: chunkWords.join(' '),
        chunkIndex,
        metadata: { ...metadata, chunkStart: start, chunkEnd: end }
      });
      chunkIndex++;
      if (end >= words.length) break;
      start += (this.chunkSize - this.chunkOverlap);
    }

    chunks.forEach(c => { c.totalChunks = chunks.length; });
    return chunks;
  }

  /**
   * Index a document or text passage.
   */
  indexDocument(id, text, metadata = {}) {
    if (!id || !text || typeof text !== 'string') {
      throw new Error('Valid id and text string required for indexing');
    }

    // Remove existing if re-indexing
    if (this.documents.has(id)) {
      this.removeDocument(id);
    }

    const tokens = this.tensorReasoner.tokenize(text);
    const vector = this.tensorReasoner.embed(text);
    const docLength = tokens.length;

    // Count term frequencies
    const tfMap = new Map();
    for (const token of tokens) {
      tfMap.set(token, (tfMap.get(token) || 0) + 1);
    }

    // Update inverted index
    for (const [token, count] of tfMap.entries()) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Map());
      }
      this.invertedIndex.get(token).set(id, count);
    }

    this.documents.set(id, {
      id,
      text,
      metadata,
      tokens,
      length: docLength,
      vector,
      tfMap
    });

    this.totalDocLength += docLength;
  }

  /**
   * Remove a document from the index.
   */
  removeDocument(id) {
    const doc = this.documents.get(id);
    if (!doc) return false;

    for (const token of doc.tfMap.keys()) {
      const posting = this.invertedIndex.get(token);
      if (posting) {
        posting.delete(id);
        if (posting.size === 0) {
          this.invertedIndex.delete(token);
        }
      }
    }

    this.totalDocLength -= doc.length;
    this.documents.delete(id);
    return true;
  }

  /**
   * Average document length across all indexed items.
   */
  get avgDocLength() {
    if (this.documents.size === 0) return 0;
    return this.totalDocLength / this.documents.size;
  }

  /**
   * Compute BM25 score for all candidate documents.
   */
  scoreBm25(queryTokens) {
    const scores = new Map();
    const N = this.documents.size;
    if (N === 0) return scores;
    const avgdl = Math.max(1, this.avgDocLength);

    for (const token of queryTokens) {
      const postings = this.invertedIndex.get(token);
      if (!postings) continue;

      const n_q = postings.size; // Document frequency of term
      // Standard Robertson-Sparck Jones IDF with smoothing
      const idf = Math.log(1 + (N - n_q + 0.5) / (n_q + 0.5));

      for (const [docId, f_td] of postings.entries()) {
        const doc = this.documents.get(docId);
        if (!doc) continue;

        const docLen = doc.length;
        const numerator = f_td * (this.k1 + 1);
        const denominator = f_td + this.k1 * (1 - this.b + this.b * (docLen / avgdl));
        const tokenScore = idf * (numerator / denominator);

        scores.set(docId, (scores.get(docId) || 0) + tokenScore);
      }
    }

    return scores;
  }

  /**
   * Compute dense vector cosine similarities for all documents.
   */
  scoreDense(queryVector) {
    const scores = new Map();
    for (const [docId, doc] of this.documents.entries()) {
      const sim = this.tensorReasoner.cosineSimilarity(queryVector, doc.vector);
      if (sim > 0) {
        scores.set(docId, sim);
      }
    }
    return scores;
  }

  /**
   * Hybrid Search using Reciprocal Rank Fusion (RRF).
   */
  search(query, options = {}) {
    const topK = options.topK || 5;
    const weightBm25 = options.weightBm25 ?? 0.5;
    const weightDense = options.weightDense ?? 0.5;

    if (!query || this.documents.size === 0) {
      return [];
    }

    const queryTokens = this.tensorReasoner.tokenize(query);
    const queryVector = this.tensorReasoner.embed(query);

    // BM25 Ranking
    const bm25Scores = this.scoreBm25(queryTokens);
    const rankedBm25 = Array.from(bm25Scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // Dense Vector Ranking
    const denseScores = this.scoreDense(queryVector);
    const rankedDense = Array.from(denseScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // Reciprocal Rank Fusion (RRF)
    const rrfScores = new Map();

    rankedBm25.forEach((docId, rank) => {
      const rrf = weightBm25 / (this.rrfK + rank + 1);
      rrfScores.set(docId, (rrfScores.get(docId) || 0) + rrf);
    });

    rankedDense.forEach((docId, rank) => {
      const rrf = weightDense / (this.rrfK + rank + 1);
      rrfScores.set(docId, (rrfScores.get(docId) || 0) + rrf);
    });

    // Sort final results by RRF score
    const finalResults = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([docId, score]) => {
        const doc = this.documents.get(docId);
        return {
          id: docId,
          score: Math.round(score * 10000) / 10000,
          bm25Score: Math.round((bm25Scores.get(docId) || 0) * 1000) / 1000,
          denseScore: Math.round((denseScores.get(docId) || 0) * 1000) / 1000,
          text: doc.text,
          metadata: doc.metadata
        };
      });

    return finalResults;
  }
}
