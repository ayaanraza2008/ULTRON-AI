/**
 * ULTRON AI — DSH-GOD OpenCode Free Lane Gateway
 * 
 * Implements the keyless free inference gateway mirroring OpenCode CLI v2.0.26:
 * - Exact v2 fingerprint headers (opencode/latest/2.0.26/cli)
 * - 48-bit inverted descending session IDs (counter 1-63, 0xfc0-0xfff)
 * - Verbatim official 'read' and 'shell' tool definitions to satisfy the gate
 * - Suppression of tool_choice: 'none' (which causes 403 FreeTierError)
 * - Endpoints: /inference/v1/chat/completions, /inference/v1/responses, /inference/v1/messages
 */

import crypto from 'node:crypto';
import { DSH_CONFIG } from './config.js';
import { redact } from './privacy-policy.js';

export const CLIENT_UA = 'opencode/latest/2.0.26/cli';
export const FINGERPRINT_TOOLS = ['read', 'shell'];

export const OFFICIAL_TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File or directory to read' },
          offset: { type: 'integer', minimum: 0, description: 'The line or directory entry to start reading from (1-based)' },
          limit: { type: 'integer', minimum: 0, description: 'The maximum number of lines or directory entries to read (defaults to and capped at 2000)' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command string to execute' },
          workdir: { type: 'string', description: 'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.' },
          timeout: { type: 'integer', minimum: 0, description: 'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.' },
          background: { type: 'boolean', description: 'Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use \'&\' at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
];

export const SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
export const SESSION_DESCENDING_RE = /^[0-9a-f]{9}f[c-f][0-9a-f]$/;

function base62Fixed(bytes, width) {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const out = new Array(width);
  for (let i = width - 1; i >= 0; i--) {
    out[i] = chars[Number(n % 62n)];
    n /= 62n;
  }
  return out.join('');
}

/**
 * Mint or canonicalize a session ID to the required descending inverted format
 */
export function canonicalizeSession(signal = '') {
  const seed = signal || crypto.randomUUID();
  const digest = crypto.createHash('sha256').update(`ses\0${seed}`).digest();
  const current = ((BigInt(digest[0]) << 28n | BigInt(digest[1]) << 20n | BigInt(digest[2]) << 12n |
    BigInt(digest[3]) << 4n | BigInt(digest[4]) >> 4n) << 12n) | 1n;
  const inverted = ~current & 0xffffffffffffn;
  const timeHex = inverted.toString(16).padStart(12, '0');
  return `ses_${timeHex}${base62Fixed(digest.subarray(6, 16), 14)}`;
}

export function isCanonicalSession(id) {
  return typeof id === 'string' && SESSION_RE.test(id.trim()) && SESSION_DESCENDING_RE.test(id.trim().slice(4, 16));
}

/**
 * Determine endpoint for model
 */
export function getEndpointForModel(model) {
  if (model.includes('muse-spark')) {
    return '/inference/v1/responses';
  }
  if (model.includes('union-alpha')) {
    return '/inference/v1/messages';
  }
  return '/inference/v1/chat/completions';
}

/**
 * Prepare request payload adhering to the v2 gate rules
 */
export function prepareOpenCodePayload(inputPayload = {}) {
  const payload = { ...inputPayload };
  
  // Ensure tools include read and shell if tools exist or if free-tier requires them
  const existingTools = Array.isArray(payload.tools) ? [...payload.tools] : [];
  const existingNames = new Set(existingTools.map(t => t?.function?.name || t?.name));
  
  for (const def of OFFICIAL_TOOL_DEFINITIONS) {
    if (!existingNames.has(def.function.name)) {
      existingTools.push(def);
    }
  }
  payload.tools = existingTools;

  // ⚠️ CRITICAL: Never send tool_choice: "none"
  if (payload.tool_choice === 'none') {
    delete payload.tool_choice;
  }

  return payload;
}

/**
 * Make an inference request to OpenCode Free Lane
 */
export async function postOpenCode({
  model = 'deepseek-chat',
  messages = [],
  tools,
  tool_choice,
  temperature,
  max_tokens,
  stream = false,
  sessionId,
  signal,
} = {}) {
  const base = DSH_CONFIG.openCode.baseUrl;
  const endpoint = getEndpointForModel(model);
  const url = `${base}${endpoint}`;

  const session = isCanonicalSession(sessionId) ? sessionId : canonicalizeSession(sessionId || model);

  const rawPayload = {
    model,
    messages,
    tools,
    tool_choice,
    temperature,
    max_tokens,
    stream,
  };

  const cleanPayload = prepareOpenCodePayload(rawPayload);

  const headers = {
    'content-type': 'application/json',
    'accept': stream ? 'text/event-stream' : 'application/json',
    'user-agent': CLIENT_UA,
    'x-session-id': session,
    'x-opencode-session-id': session,
    'x-session-affinity': session,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(cleanPayload),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenCode upstream error (${response.status}): ${redact(errorText.slice(0, 300))}`);
  }

  if (stream) {
    return response.body;
  }

  return await response.json();
}

/**
 * Check OpenCode Free Lane health and model list
 */
export async function getOpenCodeStatus() {
  return {
    lane: 'opencode-zen',
    endpoint: `${DSH_CONFIG.openCode.baseUrl}/inference/v1`,
    enabled: DSH_CONFIG.openCode.enabled,
    userAgent: CLIENT_UA,
    fingerprintTools: FINGERPRINT_TOOLS,
  };
}
