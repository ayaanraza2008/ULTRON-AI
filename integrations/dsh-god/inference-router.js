/**
 * ULTRON AI — DSH-GOD Unified Inference Router
 * 
 * Master dispatch router that intelligently resolves and executes requests across:
 * 1. Fast local heuristics
 * 2. Virtual Combos with automated candidate traversal and fallback
 * 3. Keyless OpenCode Free Lane
 * 4. Keyless Kilo AI Free Pool
 * 5. 76 Aggregate Catalog Providers
 * 
 * Automatically applies RTK token optimization, records execution latency,
 * and feeds diagnostics to the usage monitor.
 */

import { performance } from 'node:perf_hooks';
import { tryLocalAnswer } from './local-answers.js';
import { isComboId, selectCandidateSequence, recordModelLatency } from './combo-router.js';
import { postOpenCode } from './open-code-gateway.js';
import { postKiloChat } from './kilo-gateway.js';
import { dispatchProviderTurn } from './aggregate-providers.js';
import { optimizePayload } from './token-optimizer.js';
import { recordUsageTurn } from './usage-monitor.js';
import { checkPrivacyClearance } from './privacy-policy.js';

export async function executeInference(params = {}) {
  const started = performance.now();
  let { model = 'opencode:deepseek-chat', messages = [], stream = false, signal } = params;

  // 1. Check local fast-path heuristics
  const localAnswer = tryLocalAnswer(messages);
  if (localAnswer) {
    const latency = performance.now() - started;
    const result = {
      id: `local-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'local-fast-path',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: localAnswer.content },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 },
    };
    recordUsageTurn({
      model: 'local-fast-path',
      channel: 'local',
      latencyMs: latency,
      success: true,
      tokens: result.usage,
    });
    return result;
  }

  // 2. Token-saver optimization
  const optimized = optimizePayload(params);
  const effectivePayload = optimized.payload;

  // 3. Virtual Combo Routing
  if (isComboId(model)) {
    const candidates = selectCandidateSequence(model);
    const errors = [];

    for (const candidate of candidates) {
      const candidateStart = performance.now();
      try {
        const res = await dispatchSingleTarget({
          ...effectivePayload,
          model: candidate,
          signal,
        });
        const candLatency = performance.now() - candidateStart;
        recordModelLatency(candidate, candLatency);
        recordUsageTurn({
          model,
          underlyingModel: candidate,
          channel: 'combo',
          latencyMs: performance.now() - started,
          success: true,
        });
        return res;
      } catch (err) {
        errors.push({ candidate, error: err.message });
      }
    }

    // If all candidates failed:
    throw new Error(`All combo candidates for ${model} failed:\n${errors.map(e => `[${e.candidate}]: ${e.error}`).join('\n')}`);
  }

  // 4. Single Target Routing
  const targetStart = performance.now();
  try {
    const res = await dispatchSingleTarget({ ...effectivePayload, model, signal });
    const targetLatency = performance.now() - targetStart;
    recordModelLatency(model, targetLatency);
    recordUsageTurn({
      model,
      channel: detectChannel(model),
      latencyMs: targetLatency,
      success: true,
    });
    return res;
  } catch (err) {
    recordUsageTurn({
      model,
      channel: detectChannel(model),
      latencyMs: performance.now() - targetStart,
      success: false,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Dispatch to a specific underlying target (OpenCode, Kilo, or Aggregate)
 */
async function dispatchSingleTarget(params) {
  const { model, messages, tools, tool_choice, temperature, max_tokens, stream, signal } = params;

  // Channel: OpenCode Free Lane
  if (model.startsWith('opencode:') || model === 'deepseek-chat' || model === 'deepseek-coder') {
    const cleanModel = model.startsWith('opencode:') ? model.replace('opencode:', '') : model;
    
    // Privacy clearance check
    const promptText = messages.map(m => m.content).join(' ');
    const clearance = checkPrivacyClearance('openCode', promptText);
    if (!clearance.allowed) {
      throw new Error(clearance.warning);
    }

    return await postOpenCode({
      model: cleanModel,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens,
      stream,
      signal,
    });
  }

  // Channel: Kilo AI Free Pool
  if (model.startsWith('kilo:')) {
    const cleanModel = model.replace('kilo:', '');
    
    const promptText = messages.map(m => m.content).join(' ');
    const clearance = checkPrivacyClearance('kilo', promptText);
    if (!clearance.allowed) {
      throw new Error(clearance.warning);
    }

    return await postKiloChat({
      model: cleanModel,
      messages,
      temperature,
      max_tokens,
      stream,
      signal,
    });
  }

  // Channel: Aggregate Provider (provider/model)
  if (model.includes('/')) {
    return await dispatchProviderTurn({
      target: model,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens,
      stream,
      signal,
    });
  }

  // Fallback default: attempt OpenCode
  return await postOpenCode({
    model,
    messages,
    tools,
    tool_choice,
    temperature,
    max_tokens,
    stream,
    signal,
  });
}

function detectChannel(model) {
  if (isComboId(model)) return 'combo';
  if (model.startsWith('opencode:')) return 'free';
  if (model.startsWith('kilo:')) return 'kilo';
  if (model.includes('/')) return 'aggregate';
  return 'unknown';
}
