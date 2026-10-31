/**
 * ULTRON AI — DSH-GOD Provider Registry Module
 * 
 * Manages the 76 upstream providers, composite provider/model IDs,
 * filtering, searching, custom key storage, and endpoint resolution.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DSH_CONFIG } from './config.js';
import { redact } from './privacy-policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FORMAT_VALUES = Object.freeze(['openai-chat', 'openai-responses', 'anthropic-messages']);
export const AUTH_KINDS = Object.freeze(['apiKey', 'none', 'oauth', 'adc']);
export const CATEGORY_VALUES = Object.freeze(['apikey', 'free', 'free-tier', 'local', 'oauth']);

const DENIED_PATTERN = /workbuddy|codebuddy|huaweicloud|huawei[\s-]*cloud|modelarts|codearts|华为云|码道/i;

export function isDeniedChannel(id, text = '') {
  const combined = `${id} ${text}`.toLowerCase();
  return DENIED_PATTERN.test(combined);
}

// Load provider registry safely
let RAW_REGISTRY = [];
try {
  const rawData = fs.readFileSync(DSH_CONFIG.registryFile, 'utf8');
  RAW_REGISTRY = JSON.parse(rawData);
} catch (err) {
  console.warn('[DSH-REGISTRY] Warning: Could not read registry file directly, using fallback empty array:', err.message);
  RAW_REGISTRY = [];
}

// Filter out denied channels
const FILTERED_PROVIDERS = RAW_REGISTRY.filter(p => !isDeniedChannel(p.id, `${p.name} ${p.notes ?? ''} ${p.baseUrl ?? ''}`));

// Runtime provider state: enable/disable status and custom user keys/baseUrls
const runtimeState = new Map();

for (const p of FILTERED_PROVIDERS) {
  runtimeState.set(p.id, {
    enabled: true,
    customApiKey: null,
    customBaseUrl: null,
  });
}

/**
 * Get all offered providers
 */
export function getAllProviders() {
  return FILTERED_PROVIDERS.map(p => {
    const state = runtimeState.get(p.id) || { enabled: true };
    return {
      ...p,
      enabled: state.enabled,
      hasCustomKey: Boolean(state.customApiKey),
      effectiveBaseUrl: state.customBaseUrl || p.baseUrl,
    };
  });
}

/**
 * Get provider by ID
 */
export function getProvider(id) {
  if (!id || typeof id !== 'string') return null;
  const cleanId = id.trim().toLowerCase();
  const found = FILTERED_PROVIDERS.find(p => p.id.toLowerCase() === cleanId);
  if (!found) return null;
  const state = runtimeState.get(found.id) || { enabled: true };
  return {
    ...found,
    enabled: state.enabled,
    hasCustomKey: Boolean(state.customApiKey),
    customApiKey: state.customApiKey,
    effectiveBaseUrl: state.customBaseUrl || found.baseUrl,
  };
}

/**
 * Parse composite ID: "providerId/modelId"
 */
export function parseProviderModelId(compositeId) {
  if (!compositeId || typeof compositeId !== 'string') return null;
  const trimmed = compositeId.trim();
  const firstSlash = trimmed.indexOf('/');
  if (firstSlash <= 0) return null;
  
  const providerId = trimmed.slice(0, firstSlash);
  const modelId = trimmed.slice(firstSlash + 1);
  const provider = getProvider(providerId);
  if (!provider) return null;

  const model = (provider.models || []).find(m => m.id === modelId);
  return {
    providerId: provider.id,
    modelId,
    provider,
    model: model || { id: modelId, name: modelId },
  };
}

/**
 * Build composite ID
 */
export function makeProviderModelId(providerId, modelId) {
  return `${providerId}/${modelId}`;
}

/**
 * List providers with optional filtering
 */
export function listProviders({ category, authKind, format, search, enabledOnly = false } = {}) {
  let list = getAllProviders();

  if (category) {
    list = list.filter(p => p.category === category);
  }
  if (authKind) {
    list = list.filter(p => p.auth?.kind === authKind);
  }
  if (format) {
    list = list.filter(p => p.format === format);
  }
  if (enabledOnly) {
    list = list.filter(p => p.enabled);
  }
  if (search) {
    const query = search.toLowerCase();
    list = list.filter(p => {
      const matchName = p.name?.toLowerCase().includes(query);
      const matchId = p.id.toLowerCase().includes(query);
      const matchNotes = p.notes?.toLowerCase().includes(query);
      const matchModels = (p.models || []).some(m => m.id.toLowerCase().includes(query) || m.name?.toLowerCase().includes(query));
      return matchName || matchId || matchNotes || matchModels;
    });
  }

  return list;
}

/**
 * Update provider configuration (enable/disable, set API key, set custom base URL)
 */
export function configureProvider(id, { enabled, apiKey, baseUrl } = {}) {
  const provider = getProvider(id);
  if (!provider) throw new Error(`Provider not found: ${id}`);

  let state = runtimeState.get(provider.id);
  if (!state) {
    state = { enabled: true, customApiKey: null, customBaseUrl: null };
    runtimeState.set(provider.id, state);
  }

  if (typeof enabled === 'boolean') {
    state.enabled = enabled;
  }
  if (apiKey !== undefined) {
    state.customApiKey = apiKey ? apiKey.trim() : null;
  }
  if (baseUrl !== undefined) {
    state.customBaseUrl = baseUrl ? baseUrl.trim().replace(/\/+$/, '') : null;
  }

  return getProvider(provider.id);
}

/**
 * Resolve effective authorization header and base URL for a provider
 */
export function resolveProviderAuth(providerId) {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Provider not found: ${providerId}`);

  let apiKey = provider.customApiKey;
  if (!apiKey && provider.auth?.env) {
    apiKey = process.env[provider.auth.env] || null;
  }

  const headers = {};
  if (apiKey) {
    if (provider.auth?.header) {
      headers[provider.auth.header] = provider.auth.bearer ? `Bearer ${apiKey}` : apiKey;
    } else {
      headers['authorization'] = `Bearer ${apiKey}`;
    }
  }

  return {
    providerId: provider.id,
    baseUrl: provider.effectiveBaseUrl,
    format: provider.format,
    apiKey: apiKey ? redact(apiKey) : null,
    rawApiKey: apiKey,
    headers,
    authKind: provider.auth?.kind || 'apiKey',
  };
}

/**
 * Summary metrics of registered providers
 */
export function getProviderRegistryStats() {
  const all = getAllProviders();
  const byCategory = {};
  const byFormat = {};
  let totalModels = 0;

  for (const p of all) {
    byCategory[p.category] = (byCategory[p.category] || 0) + 1;
    byFormat[p.format] = (byFormat[p.format] || 0) + 1;
    totalModels += (p.models || []).length;
  }

  return {
    totalProviders: all.length,
    totalModels,
    byCategory,
    byFormat,
    enabledCount: all.filter(p => p.enabled).length,
  };
}
