/**
 * ULTRON AI — DSH-GOD Model Discovery & Unified Catalog
 * 
 * Aggregates all models across all lanes into a single queryable catalog:
 * - Free OpenCode Zen lane
 * - Free Kilo AI pool
 * - 76 Aggregate registered providers
 * - Virtual Combos
 */

import { getAllProviders, listProviders } from './provider-registry.js';
import { listCombos, computeComboIntersection } from './combo-router.js';
import { listKiloFreeModels } from './kilo-gateway.js';

const OPENCODE_CORE_MODELS = [
  { id: 'opencode:deepseek-chat', name: 'DeepSeek Chat (OpenCode Free)', channel: 'free', isFree: true, contextLength: 64000, supportsTools: true, supportsVision: false },
  { id: 'opencode:deepseek-coder', name: 'DeepSeek Coder (OpenCode Free)', channel: 'free', isFree: true, contextLength: 64000, supportsTools: true, supportsVision: false },
  { id: 'opencode:glm-4-9b', name: 'GLM-4 9B (OpenCode Free)', channel: 'free', isFree: true, contextLength: 32000, supportsTools: true, supportsVision: false },
  { id: 'opencode:union-alpha', name: 'Union Alpha (OpenCode Free)', channel: 'free', isFree: true, contextLength: 16000, supportsTools: false, supportsVision: false },
  { id: 'opencode:muse-spark-1.2-contributor-free', name: 'Muse Spark 1.2 (OpenCode Free)', channel: 'free', isFree: true, contextLength: 32000, supportsTools: false, supportsVision: false },
];

/**
 * Gather complete catalog of all models across all lanes
 */
export async function getUnifiedCatalog({ includeRemoteKilo = false, signal } = {}) {
  const catalog = [];
  const metaMap = new Map();

  // 1. OpenCode Free Models
  for (const m of OPENCODE_CORE_MODELS) {
    catalog.push(m);
    metaMap.set(m.id, m);
  }

  // 2. Kilo AI Free Pool
  if (includeRemoteKilo) {
    try {
      const kiloModels = await listKiloFreeModels({ signal });
      for (const km of kiloModels) {
        const entry = {
          id: `kilo:${km.id}`,
          name: km.name ? `${km.name} (Kilo Free)` : `kilo:${km.id}`,
          channel: 'kilo',
          isFree: true,
          contextLength: km.contextLength || 4096,
          supportsTools: false,
          supportsVision: false,
        };
        catalog.push(entry);
        metaMap.set(entry.id, entry);
      }
    } catch {
      // In offline or testing mode, register baseline Kilo free model stubs
      const fallbackKilo = [
        { id: 'kilo:free-qwen', name: 'Qwen 2.5 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
        { id: 'kilo:free-coder', name: 'Qwen 2.5 Coder 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
        { id: 'kilo:free-mistral', name: 'Mistral 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
      ];
      for (const km of fallbackKilo) {
        catalog.push(km);
        metaMap.set(km.id, km);
      }
    }
  } else {
    const fallbackKilo = [
      { id: 'kilo:free-qwen', name: 'Qwen 2.5 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
      { id: 'kilo:free-coder', name: 'Qwen 2.5 Coder 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
      { id: 'kilo:free-mistral', name: 'Mistral 7B (Kilo Free)', channel: 'kilo', isFree: true, contextLength: 32768, supportsTools: false, supportsVision: false },
    ];
    for (const km of fallbackKilo) {
      catalog.push(km);
      metaMap.set(km.id, km);
    }
  }

  // 3. Aggregate Providers
  const providers = getAllProviders();
  for (const p of providers) {
    if (!p.enabled) continue;
    for (const m of p.models || []) {
      const entry = {
        id: `${p.id}/${m.id}`,
        name: `${p.name}: ${m.name || m.id}`,
        channel: 'aggregate',
        providerId: p.id,
        isFree: p.category === 'free' || p.category === 'free-tier',
        contextLength: m.contextLength || 8192,
        supportsTools: Boolean(m.tools ?? true),
        supportsVision: Boolean(m.vision ?? false),
        format: p.format,
      };
      catalog.push(entry);
      metaMap.set(entry.id, entry);
    }
  }

  // 4. Virtual Combos
  const combos = listCombos({ enabledOnly: true });
  for (const c of combos) {
    const inter = computeComboIntersection(c, metaMap);
    const entry = {
      id: c.id,
      name: `${c.name} (Combo)`,
      channel: 'combo',
      strategy: c.strategy,
      models: c.models,
      isFree: c.models.every(mid => metaMap.get(mid)?.isFree),
      contextLength: inter.contextLength,
      supportsTools: inter.supportsTools,
      supportsVision: inter.supportsVision,
    };
    catalog.push(entry);
    metaMap.set(entry.id, entry);
  }

  return { catalog, metaMap };
}

/**
 * Filter catalog by search query, channel, or capability
 */
export async function searchCatalog({ query, channel, freeOnly = false, visionOnly = false } = {}) {
  const { catalog } = await getUnifiedCatalog();
  let results = catalog;

  if (channel) {
    results = results.filter(m => m.channel === channel);
  }
  if (freeOnly) {
    results = results.filter(m => m.isFree);
  }
  if (visionOnly) {
    results = results.filter(m => m.supportsVision);
  }
  if (query) {
    const q = query.toLowerCase();
    results = results.filter(m => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q));
  }

  return results;
}
