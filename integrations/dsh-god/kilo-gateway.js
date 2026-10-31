/**
 * ULTRON AI — DSH-GOD Kilo AI Free Pool Gateway
 * 
 * Interacts with Kilo AI gateway (https://api.kilo.ai/api/gateway):
 * - Keyless free pool inference
 * - Dynamic model discovery filtered by isFree === true
 * - Privacy notice compliance (prompts may be logged for provider training)
 * - Standard OpenAI-compatible wire
 */

import { DSH_CONFIG } from './config.js';
import { redact, THIRD_PARTY_LOGGING_DISCLOSURES } from './privacy-policy.js';

let cachedFreeModels = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute

/**
 * Fetch available models from Kilo gateway, filtering for isFree: true
 */
export async function listKiloFreeModels({ forceRefresh = false, signal } = {}) {
  const now = Date.now();
  if (!forceRefresh && cachedFreeModels && (now - lastCacheTime < CACHE_TTL_MS)) {
    return cachedFreeModels;
  }

  const url = `${DSH_CONFIG.kilo.baseUrl}/models`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'user-agent': 'ultron-dsh-gateway',
    },
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Kilo AI models listing failed (${response.status}): ${redact(errorText.slice(0, 200))}`);
  }

  const data = await response.json();
  const rawList = Array.isArray(data) ? data : (data.data || []);
  
  // Filter for free pool models
  const freeModels = rawList
    .filter(m => m.isFree === true || m.id?.includes(':free') || m.pricing?.prompt === 0)
    .map(m => ({
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length || m.contextLength || 4096,
      isFree: true,
      description: m.description || '',
    }));

  cachedFreeModels = freeModels;
  lastCacheTime = now;
  return freeModels;
}

/**
 * Send completion request to Kilo AI Free Gateway
 */
export async function postKiloChat({
  model,
  messages = [],
  temperature,
  max_tokens,
  stream = false,
  signal,
} = {}) {
  const url = `${DSH_CONFIG.kilo.baseUrl}/chat/completions`;

  const payload = {
    model,
    messages,
    temperature,
    max_tokens,
    stream,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'accept': stream ? 'text/event-stream' : 'application/json',
      'user-agent': 'ultron-dsh-gateway',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Kilo AI request failed (${response.status}): ${redact(errorText.slice(0, 300))}`);
  }

  if (stream) {
    return response.body;
  }

  return await response.json();
}

/**
 * Returns metadata and privacy disclosure for Kilo AI
 */
export function getKiloStatus() {
  return {
    lane: 'kilo-free-pool',
    endpoint: DSH_CONFIG.kilo.baseUrl,
    enabled: DSH_CONFIG.kilo.enabled,
    disclosure: THIRD_PARTY_LOGGING_DISCLOSURES.kilo.policy,
  };
}
