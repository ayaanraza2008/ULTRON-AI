/**
 * ULTRON AI — DSH-GOD Privacy & Security Policy Module
 * 
 * Enforces strict key redaction, third-party privacy notices,
 * and data logging disclosures across all model lanes.
 */

export const THIRD_PARTY_LOGGING_DISCLOSURES = {
  kilo: {
    serviceName: 'Kilo AI Free Pool',
    endpoint: 'https://api.kilo.ai/api/gateway',
    policy: 'Prompts sent to Kilo AI free pool models may be logged and inspected by upstream providers to improve models and services. Do NOT send confidential credentials, API keys, or private sensitive data through this lane.',
    isFree: true,
    optInRequired: false,
  },
  openCode: {
    serviceName: 'OpenCode Zen / Inference v1',
    endpoint: 'https://opencode.ai/inference/v1',
    policy: 'Inference traffic on the OpenCode free tier passes through OpenCode infrastructure. Do not use for secret keys or classified system data.',
    isFree: true,
    optInRequired: false,
  },
};

const REDACTION_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,
  /(?:api[_-]?key|secret|token|password|auth)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{12,})["']?/gi,
];

/**
 * Redact sensitive secrets, keys, and tokens from text or payloads
 */
export function redact(text) {
  if (typeof text !== 'string') return text;
  let redacted = text;
  redacted = redacted.replace(/sk-[a-zA-Z0-9_\-]{20,}/g, '[REDACTED_KEY]');
  redacted = redacted.replace(/Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, 'Bearer [REDACTED_KEY]');
  redacted = redacted.replace(/(?:api[_\-]?key|secret|token|password|auth)["']?\s*[:=]\s*["']?([a-zA-Z0-9_\-\.]{12,})["']?/gi, (match, p1) => {
    return match.replace(p1, '[REDACTED_SECRET]');
  });
  return redacted;
}

/**
 * Deep redaction for JSON payloads or error objects
 */
export function redactObject(obj) {
  if (obj === null || typeof obj !== 'object') {
    return typeof obj === 'string' ? redact(obj) : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item));
  }
  const clean = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('key') || lowerKey.includes('secret') || lowerKey.includes('token') || lowerKey.includes('password') || lowerKey.includes('auth')) {
      clean[key] = '[REDACTED]';
    } else {
      clean[key] = redactObject(val);
    }
  }
  return clean;
}

/**
 * Validate prompt safety before dispatching to free lanes
 */
export function checkPrivacyClearance(lane, promptText = '') {
  const disclosure = THIRD_PARTY_LOGGING_DISCLOSURES[lane];
  const containsLikelySecret = /(?:-----BEGIN [A-Z ]+ PRIVATE KEY-----|sk-[a-zA-Z0-9]{20,}|password\s*[:=])/i.test(promptText);
  
  return {
    lane,
    allowed: !containsLikelySecret,
    warning: containsLikelySecret ? 'Potentially sensitive private key or credential detected in prompt payload. Blocking free-tier egress.' : null,
    disclosure: disclosure ? disclosure.policy : null,
  };
}
