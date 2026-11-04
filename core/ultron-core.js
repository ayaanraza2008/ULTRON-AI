/**
 * ULTRON AI — Next-Generation Autonomous Intelligence Core
 * Module: ULTRON CORE (core/ultron-core.js)
 *
 * Implements unified model orchestration, multi-provider intelligence,
 * reasoning & verification engine, dual-tier memory management,
 * context compaction, multimodal context assembly, and circuit-broken fallback.
 *
 * Designed for pure CPU execution on AMD Ryzen 7 5700U with 8 GB RAM bounds.
 */

import crypto from "node:crypto";
import { BrainRouter } from "./brain-router.js";

export const MODEL_TIERS = {
  ROUTINE: "fast_lightweight",
  ANALYTICAL: "balanced_chat",
  CODING: "reasoning_code",
  COMPLEX: "strategic_reasoning",
  MULTIMODAL: "vision_multimodal"
};

export class UltronCore {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.brainRouter = options.brainRouter || new BrainRouter({ env: this.env });
    this.shortTermMemory = [];
    this.longTermMemory = new Map();
    this.maxShortTermTurns = options.maxShortTermTurns || 20;
    this.maxContextTokens = options.maxContextTokens || 4096;
    this.activeSessionId = options.sessionId || "ultron-session-" + crypto.randomUUID();
  }

  /**
   * Token estimation: ~4 characters per token for English/code, ~2 for multilingual.
   */
  estimateTokenCount(text) {
    if (typeof text !== "string") return 0;
    return Math.ceil(text.length / 3.8);
  }

  /**
   * Context Management: Formats, compacts, and bounds conversational context.
   */
  prepareContext(prompt, options = {}) {
    const rawPrompt = String(prompt || "").trim();
    const media = options.media || [];
    const systemPrompt = options.systemPrompt || "You are ULTRON, an autonomous, highly intelligent AI operating system.";
    
    // Retrieve relevant long-term memories
    const relevantMemories = this.recallMemories(rawPrompt, { limit: 3 });

    // Build short-term history window within token budget
    let tokenBudget = this.maxContextTokens - this.estimateTokenCount(systemPrompt) - this.estimateTokenCount(rawPrompt) - 200;
    const historyWindow = [];

    for (let i = this.shortTermMemory.length - 1; i >= 0; i--) {
      const turn = this.shortTermMemory[i];
      const turnTokens = this.estimateTokenCount(turn.content);
      if (tokenBudget - turnTokens < 0) break;
      tokenBudget -= turnTokens;
      historyWindow.unshift(turn);
    }

    return {
      sessionId: this.activeSessionId,
      systemPrompt,
      prompt: rawPrompt,
      history: historyWindow,
      relevantMemories,
      mediaAttachments: media.map(m => ({
        type: m.type || "image/png",
        dataUrl: m.dataUrl || null,
        description: m.description || "multimodal_input"
      })),
      estimatedTotalTokens: this.maxContextTokens - tokenBudget,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Short-term memory: Append conversational turn with automatic sliding-window compaction.
   */
  recordTurn(role, content, metadata = {}) {
    const entry = {
      id: "turn-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
      role: role === "user" ? "user" : "assistant",
      content: String(content || "").trim(),
      metadata,
      timestamp: new Date().toISOString()
    };

    this.shortTermMemory.push(entry);
    if (this.shortTermMemory.length > this.maxShortTermTurns) {
      const evicted = this.shortTermMemory.shift();
      // If evicted turn has high importance, promote summary to long-term memory
      if (evicted.metadata?.important) {
        this.storeMemory(`Summary: ${evicted.content.slice(0, 100)}`, ["auto_compacted", evicted.role]);
      }
    }
    return entry;
  }

  /**
   * Long-term semantic memory storage with keyword/tag indexing.
   */
  storeMemory(keyFact, tags = []) {
    const memoryId = "mem-" + crypto.randomBytes(6).toString("hex");
    const entry = {
      id: memoryId,
      fact: String(keyFact).trim(),
      tags: Array.isArray(tags) ? tags.map(t => String(t).toLowerCase()) : [],
      accessCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.longTermMemory.set(memoryId, entry);
    return entry;
  }

  /**
   * Recall long-term memories ranked by relevance to query keywords.
   */
  recallMemories(query, options = {}) {
    const limit = options.limit || 5;
    const queryTokens = String(query || "").toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (queryTokens.length === 0 || this.longTermMemory.size === 0) return [];

    const scored = [];
    for (const [id, mem] of this.longTermMemory.entries()) {
      let score = 0;
      const factLower = mem.fact.toLowerCase();
      for (const token of queryTokens) {
        if (factLower.includes(token)) score += 2;
        if (mem.tags.some(tag => tag.includes(token))) score += 3;
      }
      if (score > 0) {
        mem.accessCount += 1;
        mem.updatedAt = new Date().toISOString();
        scored.push({ ...mem, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Reasoning and Verification Engine:
   * Analyzes an assertion or response, decomposes it into claims,
   * calculates an uncertainty score, and determines verification readiness.
   */
  verifyReasoning(statement, context = {}) {
    const text = String(statement || "").trim();
    if (!text) {
      return { verified: false, score: 0, claims: [], reason: "Empty statement" };
    }

    // Split into atomic claims by punctuation
    const rawClaims = text
      .split(/(?<=[.?!])\s+/)
      .map(c => c.trim())
      .filter(c => c.length > 10);

    const confidenceEval = this.brainRouter.evaluateConfidence(text);
    const verifiedClaims = [];

    // Speculative word matching across claims
    const speculativeRegex = /\b(might|could|maybe|possibly|perhaps|guess|unconfirmed|speculative|i think|not sure)\b/gi;
    const allMatches = text.match(speculativeRegex) || [];

    for (const claim of rawClaims) {
      let claimConfidence = confidenceEval.confidence;
      const matches = claim.match(speculativeRegex);
      if (matches && matches.length > 0) {
        claimConfidence = Math.max(0.1, Number((claimConfidence - (matches.length * 0.20)).toFixed(2)));
      }
      verifiedClaims.push({
        claim,
        confidence: claimConfidence,
        requiresToolVerification: claimConfidence < 0.65
      });
    }

    const hasUnverifiedClaims = verifiedClaims.some(c => c.requiresToolVerification);
    const isFlagged = confidenceEval.flagged || allMatches.length >= 2 || hasUnverifiedClaims;
    const finalConfidence = allMatches.length > 0 
      ? Math.max(0.1, Number((confidenceEval.confidence - (allMatches.length * 0.15)).toFixed(2)))
      : confidenceEval.confidence;
    const finalUncertainty = Number((1.0 - finalConfidence).toFixed(2));
    const overallVerified = finalConfidence >= 0.70 && !isFlagged && !hasUnverifiedClaims;

    return {
      statement: text.slice(0, 200),
      verified: overallVerified,
      confidenceScore: finalConfidence,
      uncertaintyScore: finalUncertainty,
      claims: verifiedClaims,
      recommendation: isFlagged ? "verify_with_tools_or_sources" : "sufficient_confidence",
      flagged: isFlagged
    };
  }

  /**
   * Unified Model Orchestration:
   * Selects optimal model tier, handles automatic fallback cascade,
   * tracks provider latencies, and circuit-breaks failing endpoints.
   */
  async orchestrateInference(prompt, options = {}) {
    const context = this.prepareContext(prompt, options);
    const complexity = this.brainRouter.classifyComplexity(prompt, {
      hasMedia: context.mediaAttachments.length > 0,
      preferredProvider: options.preferredProvider
    });

    const candidateChain = this.brainRouter.selectProviderChain(complexity);
    const executionTrace = [];
    let successfulResult = null;

    for (const provider of candidateChain) {
      const t0 = performance.now();
      try {
        let responsePayload;
        if (typeof options.inferenceRunner === "function") {
          responsePayload = await options.inferenceRunner(provider, context);
        } else {
          responsePayload = {
            text: `[ULTRON Core via ${provider.name} (${provider.model})] Processed prompt: ${prompt.slice(0, 60)}...`,
            model: provider.model,
            provider: provider.name
          };
        }

        const latencyMs = Math.round(performance.now() - t0);
        this.brainRouter.recordAttempt(provider.name, true, latencyMs);

        executionTrace.push({
          provider: provider.name,
          model: provider.model,
          latencyMs,
          status: "success"
        });

        const verification = this.verifyReasoning(responsePayload.text);

        successfulResult = {
          success: true,
          content: responsePayload.text,
          provider: provider.name,
          model: provider.model,
          complexity,
          verification,
          executionTrace,
          sessionId: context.sessionId
        };

        this.recordTurn("user", prompt);
        this.recordTurn("assistant", responsePayload.text, { provider: provider.name, model: provider.model });

        break;
      } catch (err) {
        const latencyMs = Math.round(performance.now() - t0);
        this.brainRouter.recordAttempt(provider.name, false, latencyMs);
        executionTrace.push({
          provider: provider.name,
          model: provider.model,
          latencyMs,
          status: "failed",
          error: err.message
        });
      }
    }

    if (!successfulResult) {
      return {
        success: false,
        error: "All candidate inference providers in chain failed or circuit-broken.",
        executionTrace,
        sessionId: context.sessionId
      };
    }

    return successfulResult;
  }
}

export const ultronCore = new UltronCore();
