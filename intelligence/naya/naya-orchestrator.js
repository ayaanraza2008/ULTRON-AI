/**
 * ULTRON AI — NAYA Master Unified Orchestrator
 * Module: intelligence/naya/naya-orchestrator.js
 *
 * Provides a unified facade uniting:
 * - 20-Mode ERA-Inspired Personality System (`nayaPersonalitySystem`)
 * - Multi-tier Persistent & Isolated Memory (`nayaMemorySystem`)
 * - Trilingual Neural Voice Intelligence (`nayaVoiceIntelligence`)
 * - Full 5-Level Autonomous Agent Architecture (`nayaAutonomousAgent`)
 * - Integration with ULTRON's 45+ tools, PC Companion, Android Companion, Vision & Communications
 */

import { nayaPersonalitySystem, NAYA_PERSONALITY_MODES, NAYA_MODE_METADATA } from "./naya-personality-system.js";
import { nayaMemorySystem, MEMORY_CATEGORIES } from "./naya-memory.js";
import { nayaVoiceIntelligence, VOICE_STATES } from "./naya-voice.js";
import { nayaAutonomousAgent, NAYA_AUTONOMY_LEVELS, TASK_STATUS } from "./naya-agent.js";
import { toolRegistry } from "../../core/tool-registry.js";

export class NayaMasterOrchestrator {
  constructor(options = {}) {
    this.personality = options.personality || nayaPersonalitySystem;
    this.memory = options.memory || nayaMemorySystem;
    this.voice = options.voice || nayaVoiceIntelligence;
    this.agent = options.agent || nayaAutonomousAgent;
    this.toolRegistry = options.toolRegistry || toolRegistry;
  }

  /**
   * Complete end-to-end processing of a user message to NAYA
   */
  async processUserMessage(rawText, context = {}) {
    const text = String(rawText || "").trim();
    if (!text) {
      throw new Error("User message cannot be empty.");
    }

    const userId = context.userId || "default_owner";

    // 1. Check Voice Wake-Word and Audio Silence Protocol
    const wakeAnalysis = this.voice.detectWakeWord(text);
    const shouldIgnore = this.voice.shouldIgnoreAudio(text);
    if (shouldIgnore && context.isVoiceStream && !wakeAnalysis.detected) {
      return {
        ignored: true,
        reason: "SILENCE_PROTOCOL_AMBIENT_MEDIA",
        textResponse: ""
      };
    }

    // 2. Short-term memory turn capture
    this.memory.recordTurn(userId, "user", text, { mode: this.personality.getMode() });

    // 3. Determine Personality Mode (manual selection or intent-aware auto selection)
    const effectiveMode = context.mode || this.personality.detectBestMode(text);
    if (context.mode) {
      this.personality.setMode(context.mode);
      this.memory.setPreference(userId, "activeMode", context.mode);
    }

    // 4. Check for Autonomous Task Execution Intent
    const isExecutionRequest = this.isActionGoal(text) && context.autonomyLevel !== 0;
    let executionResult = null;

    if (isExecutionRequest) {
      executionResult = await this.agent.executeGoal(text, {
        userId,
        autonomyLevel: context.autonomyLevel || this.agent.getAutonomyLevel(),
        approvalTokens: context.approvalTokens
      });

      // If task executed or needs approval, record in task history
      this.memory.recordTaskExecution(userId, {
        goal: text,
        intent: "AUTONOMOUS_EXECUTION",
        status: executionResult.status,
        stepsCount: executionResult.stepsExecuted || 0,
        verified: executionResult.verified,
        evidence: executionResult.evidence
      });
    }

    // 5. Generate System Directives and Retrieve Memory Context
    const systemPrompt = this.personality.generateSystemPrompt({
      mode: effectiveMode,
      userText: text,
      customInstructions: context.customInstructions
    });
    const memoryBlock = this.memory.buildPromptMemoryBlock(userId, text);
    const vocalParams = this.voice.getVocalParameters(effectiveMode);

    // 6. Formulate Response
    let responseText = "";
    if (executionResult && executionResult.textResponse) {
      responseText = executionResult.textResponse;
    } else {
      // Natural conversational response tailored by mode
      responseText = this.synthesizeConversationalResponse(text, effectiveMode, context);
    }

    // 7. Record assistant turn into short-term memory
    this.memory.recordTurn(userId, "assistant", responseText, { mode: effectiveMode });

    return {
      persona: "naya",
      mode: effectiveMode,
      modeMetadata: NAYA_MODE_METADATA[effectiveMode],
      systemPrompt,
      memoryBlock,
      vocalSettings: vocalParams,
      textResponse: responseText,
      executionResult,
      isActionGoal: isExecutionRequest
    };
  }

  /**
   * Detects whether an utterance is an actionable command vs conversation
   */
  isActionGoal(text) {
    const lower = text.toLowerCase();
    const actionKeywords = [
      "check vitals", "battery", "cpu status", "hardware",
      "search for", "find out", "research",
      "find file", "list files", "search files",
      "lock pc", "lock workstation", "lock screen",
      "phone status", "mobile status", "open app",
      "run workflow", "execute goal", "deploy"
    ];
    return actionKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Synthesizes conversational response structure respecting response length protocols
   */
  synthesizeConversationalResponse(text, mode, context = {}) {
    const lower = text.toLowerCase();

    // Hindi / Hinglish detection
    const isHindi = /[\u0900-\u097F]/.test(text) || /\b(namaste|kaise|haal|karo|batao|shukriya|achha|aaj|kya|hai|haan|theek|kuch|nahi|chalo|suno|bhai|yaar|dost)\b/i.test(lower);

    if (isHindi) {
      if (mode === NAYA_PERSONALITY_MODES.BEST_FRIEND) {
        return "Sab theek hai dost! Batao aaj kya plan hai?";
      }
      if (mode === NAYA_PERSONALITY_MODES.STRICT_MENTOR) {
        return "Baatein kam, kaam shuru karo. Aaj ka target kya hai?";
      }
      return "Main NAYA hoon. Kaam bataiye, turant execute karti hoon.";
    }

    if (mode === NAYA_PERSONALITY_MODES.MINIMAL_RESPONSE) {
      return "Ready. Awaiting command.";
    }

    if (mode === NAYA_PERSONALITY_MODES.STRICT_MENTOR) {
      return "Less talk, more execution. State your primary objective.";
    }

    if (mode === NAYA_PERSONALITY_MODES.BEST_FRIEND) {
      return "Hey! Ready to dive in. What are we tackling first?";
    }

    return "NAYA online and ready. How can I assist you, Sir?";
  }

  /**
   * Returns comprehensive operational status of NAYA
   */
  getStatus(userId = "default_owner") {
    const prefs = this.memory.getPreferences(userId);
    return {
      persona: "naya",
      version: "3.0.0-ERA",
      activeMode: this.personality.getMode(),
      availableModesCount: Object.keys(NAYA_PERSONALITY_MODES).length,
      autonomyLevel: this.agent.getAutonomyLevel(),
      emergencyHalted: this.agent.emergencyHalted,
      vocalVoice: "af_bella",
      userPreferences: prefs,
      memoryStats: {
        shortTermTurns: this.memory.getRecentTurns(userId, 50).length,
        longTermMemories: this.memory.retrieveContextMemories(userId).length,
        taskHistoryCount: this.memory.getTaskHistory(userId, 50).length,
        decisionsCount: this.memory.getDecisions(userId, 50).length
      }
    };
  }
}

export const nayaOrchestrator = new NayaMasterOrchestrator();
