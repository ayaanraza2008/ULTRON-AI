/**
 * ULTRON AI — DSH-GOD 10 Account Channels Adapter & Audit Registry
 * 
 * Provides unified interface and state management for the 10 standalone account channels:
 * 1. LobsterAI
 * 2. Qoder
 * 3. Qoder China
 * 4. TRAE
 * 5. Cline
 * 6. Loomy
 * 7. Raccoon
 * 8. MiniMax Code
 * 9. ZCode
 * 10. Gemini Channel
 */

import { redact } from './privacy-policy.js';

export const ACCOUNT_CHANNELS = [
  {
    id: 'lobsterai',
    name: 'LobsterAI',
    authType: 'oauth',
    status: 'audited',
    models: ['lobster-general', 'lobster-coder'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'LobsterAI coding assistant account integration.',
  },
  {
    id: 'qoder',
    name: 'Qoder International',
    authType: 'token',
    status: 'audited',
    models: ['qoder-code-32k', 'qoder-agent'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'Qoder developer platform channel.',
  },
  {
    id: 'qoder-cn',
    name: 'Qoder China',
    authType: 'token',
    status: 'audited',
    models: ['qoder-cn-fast', 'qoder-cn-pro'],
    requiresCaptcha: true,
    hardwareProfile: 'pure-js',
    notes: 'Qoder China regional coding plan.',
  },
  {
    id: 'trae',
    name: 'TRAE IDE Channel',
    authType: 'oauth',
    status: 'audited',
    models: ['claude-3-5-sonnet', 'gpt-4o', 'deepseek-v3'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'ByteDance TRAE AI workspace channel.',
  },
  {
    id: 'cline',
    name: 'Cline Account Channel',
    authType: 'token',
    status: 'audited',
    models: ['claude-3-7-sonnet', 'claude-3-5-haiku'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'Autonomous coding agent account channel.',
  },
  {
    id: 'loomy',
    name: 'Loomy AI',
    authType: 'session-cookie',
    status: 'audited',
    models: ['loomy-chat-v1'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'Interactive generative dialog lane.',
  },
  {
    id: 'raccoon',
    name: 'Raccoon Assistant',
    authType: 'qr-login',
    status: 'audited',
    models: ['raccoon-coder-v2'],
    requiresCaptcha: true,
    hardwareProfile: 'pure-js',
    notes: 'Sensetime Raccoon intelligent coding channel.',
  },
  {
    id: 'minimax-code',
    name: 'MiniMax Code',
    authType: 'api-key',
    status: 'audited',
    models: ['abab6.5s-chat', 'abab7-chat-preview'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'MiniMax high-performance long-context models.',
  },
  {
    id: 'zcode',
    name: 'ZCode / GLM Studio',
    authType: 'oauth-token',
    status: 'audited',
    models: ['glm-4-plus', 'glm-4-air', 'codegeex-4'],
    requiresCaptcha: true,
    hardwareProfile: 'pure-js',
    notes: 'Zhipu ZCode professional coding suite.',
  },
  {
    id: 'gemini-channel',
    name: 'Google Gemini Pro Channel',
    authType: 'oauth-adc',
    status: 'audited',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    requiresCaptcha: false,
    hardwareProfile: 'pure-js',
    notes: 'Native Google Gemini account integration lane.',
  },
];

const channelCredentials = new Map();

export function listAccountChannels() {
  return ACCOUNT_CHANNELS.map(ch => ({
    ...ch,
    configured: channelCredentials.has(ch.id),
  }));
}

export function getAccountChannel(id) {
  const found = ACCOUNT_CHANNELS.find(ch => ch.id.toLowerCase() === id.toLowerCase());
  if (!found) return null;
  return {
    ...found,
    configured: channelCredentials.has(found.id),
  };
}

export function configureAccountChannel(id, credentials = {}) {
  const channel = getAccountChannel(id);
  if (!channel) throw new Error(`Unknown account channel: ${id}`);

  channelCredentials.set(channel.id, {
    ...credentials,
    configuredAt: new Date().toISOString(),
  });

  return getAccountChannel(channel.id);
}

export function removeAccountChannel(id) {
  return channelCredentials.delete(id);
}

export function getAccountChannelStatusReport() {
  const channels = listAccountChannels();
  return {
    totalChannels: channels.length,
    configuredCount: channels.filter(ch => ch.configured).length,
    channels,
  };
}
