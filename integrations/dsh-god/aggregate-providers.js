/**
 * ULTRON AI — DSH-GOD Aggregate Providers Dispatcher
 * 
 * Dispatches inference requests across all 76 catalog providers using:
 * - openai-chat wire (/chat/completions)
 * - openai-responses wire (/responses)
 * - anthropic-messages wire (/messages)
 * 
 * Enforces per-provider auth headers, custom base URLs, stream unfolding,
 * and zero secret leakage in error traces.
 */

import { getProvider, resolveProviderAuth, parseProviderModelId } from './provider-registry.js';
import { redact } from './privacy-policy.js';

export async function executeAggregateInference({
  providerId,
  modelId,
  messages = [],
  tools,
  tool_choice,
  temperature = 0.7,
  max_tokens = 4096,
  stream = false,
  signal,
} = {}) {
  const auth = resolveProviderAuth(providerId);
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  let endpointUrl = auth.baseUrl;
  if (!endpointUrl) {
    throw new Error(`Provider ${providerId} has no baseUrl configured.`);
  }

  // Construct target endpoint based on wire format
  let wire = provider.format || 'openai-chat';
  let targetUrl = endpointUrl;

  if (wire === 'openai-chat') {
    if (!targetUrl.endsWith('/chat/completions') && !targetUrl.includes('?')) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/chat/completions`;
    }
  } else if (wire === 'openai-responses') {
    if (!targetUrl.endsWith('/responses') && !targetUrl.includes('?')) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/responses`;
    }
  } else if (wire === 'anthropic-messages') {
    if (!targetUrl.endsWith('/messages') && !targetUrl.includes('?')) {
      targetUrl = `${targetUrl.replace(/\/+$/, '')}/messages`;
    }
  }

  // Build headers
  const headers = {
    'content-type': 'application/json',
    'accept': stream ? 'text/event-stream' : 'application/json',
    'user-agent': 'ultron-dsh-gateway/1.0',
    ...auth.headers,
  };

  if (wire === 'anthropic-messages') {
    headers['anthropic-version'] = '2023-06-01';
    if (auth.rawApiKey && !headers['x-api-key']) {
      headers['x-api-key'] = auth.rawApiKey;
    }
  }

  // Build payload
  let payload;
  if (wire === 'anthropic-messages') {
    // Separate system message if present
    let system = undefined;
    const cleanMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        cleanMessages.push(msg);
      }
    }
    payload = {
      model: modelId,
      messages: cleanMessages,
      system,
      max_tokens: max_tokens || 4096,
      temperature,
      stream,
    };
  } else {
    payload = {
      model: modelId,
      messages,
      tools,
      tool_choice,
      temperature,
      max_tokens,
      stream,
    };
  }

  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
  } catch (netErr) {
    throw new Error(`Connection to provider ${providerId} failed: ${redact(netErr.message)}`);
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Provider ${providerId} returned error (${response.status}): ${redact(errorBody.slice(0, 300))}`);
  }

  if (stream) {
    return response.body;
  }

  const result = await response.json();
  return result;
}

/**
 * High-level helper dispatching either composite "provider/model" or separate arguments
 */
export async function dispatchProviderTurn({
  target,
  providerId,
  modelId,
  messages,
  tools,
  tool_choice,
  temperature,
  max_tokens,
  stream,
  signal,
} = {}) {
  let effectiveProviderId = providerId;
  let effectiveModelId = modelId;

  if (target && !effectiveProviderId) {
    const parsed = parseProviderModelId(target);
    if (parsed) {
      effectiveProviderId = parsed.providerId;
      effectiveModelId = parsed.modelId;
    } else {
      throw new Error(`Invalid target format: expected "provider/model", got "${target}"`);
    }
  }

  return await executeAggregateInference({
    providerId: effectiveProviderId,
    modelId: effectiveModelId,
    messages,
    tools,
    tool_choice,
    temperature,
    max_tokens,
    stream,
    signal,
  });
}
