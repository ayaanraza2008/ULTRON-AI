/**
 * ULTRON AI — DSH-GOD Virtual Combo Router
 * 
 * Implements virtual model chains ("combo:") that route, rotate, and fall back
 * seamlessly across multiple underlying providers and models:
 * - Strategies: fallback, round-robin, smart, usage, pace
 * - Capability intersection: honest context bounds & vision enforcement
 * - Transparent retry on quota wall, rate limit, or upstream failure
 */

import { createHash } from 'node:crypto';

export const COMBO_PREFIX = 'combo:';
export const COMBO_STRATEGIES = Object.freeze(['fallback', 'round-robin', 'smart', 'usage', 'pace']);

// In-memory combo store and rotation state
const comboStore = new Map();
const rotationState = new Map(); // comboId -> { cursor, turnsOnCurrent }
const latencyHistory = new Map(); // modelId -> [latencies]

// Default pre-configured combos
const DEFAULT_COMBOS = [
  {
    id: 'combo:fast-free',
    name: 'Fast Free Inference Chain',
    models: ['opencode:deepseek-chat', 'kilo:free-qwen', 'opencode:glm-4-9b'],
    strategy: 'fallback',
    stickyLimit: 1,
    enabled: true,
  },
  {
    id: 'combo:smart-code',
    name: 'Smart Coding Master Combo',
    models: ['opencode:deepseek-coder', 'groq/llama-3.3-70b-versatile', 'kilo:free-coder'],
    strategy: 'smart',
    stickyLimit: 2,
    enabled: true,
  },
  {
    id: 'combo:balanced-general',
    name: 'Balanced General Reasoning Combo',
    models: ['opencode:deepseek-chat', 'kilo:free-mistral', 'groq/mixtral-8x7b-32768'],
    strategy: 'round-robin',
    stickyLimit: 3,
    enabled: true,
  },
];

for (const combo of DEFAULT_COMBOS) {
  comboStore.set(combo.id, { ...combo });
}

export function isComboId(id) {
  return typeof id === 'string' && id.startsWith(COMBO_PREFIX);
}

export function createComboSlug(name) {
  const norm = String(name || '').trim().toLowerCase();
  if (!norm) return '';
  const slug = norm.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const hash = createHash('sha256').update(norm).digest('hex').slice(0, 8);
  return `${COMBO_PREFIX}${slug || 'custom'}-${hash}`;
}

export function listCombos({ enabledOnly = false } = {}) {
  const list = Array.from(comboStore.values());
  return enabledOnly ? list.filter(c => c.enabled) : list;
}

export function getCombo(id) {
  return comboStore.get(id) || null;
}

export function registerOrUpdateCombo(comboData = {}) {
  const name = String(comboData.name || '').trim() || 'Custom Combo';
  const id = (comboData.id && comboData.id.startsWith(COMBO_PREFIX)) ? comboData.id : createComboSlug(name);
  
  const models = Array.isArray(comboData.models)
    ? [...new Set(comboData.models.map(m => String(m).trim()).filter(m => m && m !== id))]
    : [];

  if (models.length === 0) {
    throw new Error('A combo must specify at least one valid model candidate.');
  }

  const strategy = COMBO_STRATEGIES.includes(comboData.strategy) ? comboData.strategy : 'fallback';
  const stickyLimit = Number.isFinite(Number(comboData.stickyLimit)) && Number(comboData.stickyLimit) > 0
    ? Math.trunc(Number(comboData.stickyLimit))
    : 1;

  const entry = {
    id,
    name,
    models,
    strategy,
    stickyLimit,
    enabled: comboData.enabled !== false,
    updatedAt: new Date().toISOString(),
  };

  comboStore.set(id, entry);
  return entry;
}

export function deleteCombo(id) {
  return comboStore.delete(id);
}

/**
 * Compute capability intersection for a combo given candidate catalog metadata
 */
export function computeComboIntersection(combo, candidateMetadataMap = new Map()) {
  let minContext = 128000;
  let supportsVision = true;
  let supportsTools = true;

  for (const modelId of combo.models) {
    const meta = candidateMetadataMap.get(modelId);
    if (meta) {
      if (meta.contextLength && meta.contextLength < minContext) {
        minContext = meta.contextLength;
      }
      if (meta.supportsVision === false) {
        supportsVision = false;
      }
      if (meta.supportsTools === false) {
        supportsTools = false;
      }
    }
  }

  return {
    id: combo.id,
    name: combo.name,
    strategy: combo.strategy,
    models: [...combo.models],
    candidateCount: combo.models.length,
    contextLength: minContext,
    supportsVision,
    supportsTools,
  };
}

/**
 * Record model turn latency for smart routing
 */
export function recordModelLatency(modelId, latencyMs) {
  let hist = latencyHistory.get(modelId);
  if (!hist) {
    hist = [];
    latencyHistory.set(modelId, hist);
  }
  hist.push(latencyMs);
  if (hist.length > 50) hist.shift();
}

/**
 * Get average latency for a model
 */
function getAvgLatency(modelId) {
  const hist = latencyHistory.get(modelId);
  if (!hist || hist.length === 0) return 1000;
  const sum = hist.reduce((a, b) => a + b, 0);
  return sum / hist.length;
}

/**
 * Order candidate models for a given combo turn based on strategy
 */
export function selectCandidateSequence(comboId) {
  const combo = getCombo(comboId);
  if (!combo || !combo.enabled || combo.models.length === 0) {
    throw new Error(`Combo not found or empty: ${comboId}`);
  }

  const models = [...combo.models];
  const strategy = combo.strategy;

  if (strategy === 'fallback') {
    return models;
  }

  if (strategy === 'round-robin') {
    let state = rotationState.get(comboId) || { cursor: 0, turnsOnCurrent: 0 };
    state.turnsOnCurrent += 1;
    if (state.turnsOnCurrent > combo.stickyLimit) {
      state.cursor = (state.cursor + 1) % models.length;
      state.turnsOnCurrent = 1;
    }
    rotationState.set(comboId, state);

    // Reorder starting from state.cursor
    const ordered = [];
    for (let i = 0; i < models.length; i++) {
      ordered.push(models[(state.cursor + i) % models.length]);
    }
    return ordered;
  }

  if (strategy === 'smart' || strategy === 'pace') {
    // Sort candidates by lowest average latency
    return models.sort((a, b) => getAvgLatency(a) - getAvgLatency(b));
  }

  return models;
}
