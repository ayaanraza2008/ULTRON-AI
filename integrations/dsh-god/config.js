/**
 * ULTRON AI — DSH-GOD Configuration Module
 * 
 * Central configuration for DSH-GOD gateway, provider routing,
 * free lanes, combos, token-saver, and network boundaries.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DSH_CONFIG = {
  version: '2.7.3-ultron',
  registryFile: path.join(__dirname, 'provider-registry.json'),
  gateway: {
    enabled: true,
    port: parseInt(process.env.DSH_GATEWAY_PORT || '8080', 10),
    host: process.env.DSH_GATEWAY_HOST || '127.0.0.1',
    apiKey: process.env.DSH_GATEWAY_KEY || 'sk-ultron-dsh-gateway',
    allowLan: process.env.DSH_ALLOW_LAN === 'true',
    maxBodyBytes: 16 * 1024 * 1024, // 16MB
    requestTimeoutMs: 180000, // 3 minutes
  },
  openCode: {
    enabled: true,
    baseUrl: (process.env.OUR_FREE_MODEL_BASE || 'https://opencode.ai').replace(/\/+$/, ''),
    userAgent: 'opencode/latest/2.0.26/cli',
    timeoutMs: 120000,
    listingTimeoutMs: 15000,
  },
  kilo: {
    enabled: true,
    baseUrl: (process.env.OUR_FREE_MODEL_KILO_BASE || 'https://api.kilo.ai/api/gateway').replace(/\/+$/, ''),
    timeoutMs: 180000,
    listingTimeoutMs: 15000,
    requirePrivacyAcknowledgment: false,
  },
  tokenSaver: {
    enabled: true,
    rtk: true,
    promptShaping: false, // off by default, opt-in
    maxHunkLines: 100,
    maxLogLines: 200,
    smartTruncateHead: 120,
    smartTruncateTail: 60,
  },
  combos: {
    defaultStrategy: 'fallback',
    rotationTtlMs: 3600000,
  },
  privacy: {
    redactKeysInLogs: true,
    discloseThirdPartyLogging: true,
  },
};

export function getDshConfig() {
  return { ...DSH_CONFIG };
}

export function updateDshConfig(updates = {}) {
  if (updates.gateway) Object.assign(DSH_CONFIG.gateway, updates.gateway);
  if (updates.openCode) Object.assign(DSH_CONFIG.openCode, updates.openCode);
  if (updates.kilo) Object.assign(DSH_CONFIG.kilo, updates.kilo);
  if (updates.tokenSaver) Object.assign(DSH_CONFIG.tokenSaver, updates.tokenSaver);
  if (updates.combos) Object.assign(DSH_CONFIG.combos, updates.combos);
  if (updates.privacy) Object.assign(DSH_CONFIG.privacy, updates.privacy);
  return getDshConfig();
}
