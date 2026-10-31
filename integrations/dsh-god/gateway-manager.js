/**
 * ULTRON AI — DSH-GOD Universal API Gateway Manager
 * 
 * Runs a local/LAN HTTP server exposing standard OpenAI and Anthropic API endpoints:
 * - GET  /v1/models
 * - POST /v1/chat/completions
 * - POST /v1/responses
 * - POST /v1/messages
 * - POST /v1/messages/count_tokens
 * - GET  /health
 * 
 * Enforces constant-time key validation, tool reindexing from 0,
 * fingerprint tool suppression, and cross-format translation.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { DSH_CONFIG } from './config.js';
import { getUnifiedCatalog } from './model-discovery.js';
import { executeInference } from './inference-router.js';
import { redact } from './privacy-policy.js';

let serverInstance = null;
let isRunning = false;

function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function authenticateRequest(req) {
  const expectedKey = DSH_CONFIG.gateway.apiKey;
  if (!expectedKey) return true; // Open gateway if no key set

  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';

  let bearer = '';
  if (authHeader.startsWith('Bearer ')) {
    bearer = authHeader.slice(7).trim();
  }

  const presented = bearer || apiKeyHeader;
  return constantTimeCompare(presented, expectedKey);
}

function parseJsonBody(req, maxBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        const str = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(str));
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

export function createGatewayHandler() {
  return async function handleGatewayRequest(req, res) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
      });
      return res.end();
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname.replace(/\/+$/, '') || '/';

    // Health check endpoint (public)
    if (pathname === '/health' && req.method === 'GET') {
      return sendJson(res, 200, {
        status: 'online',
        service: 'ULTRON DSH-GOD Gateway',
        version: DSH_CONFIG.version,
        timestamp: new Date().toISOString(),
      });
    }

    // Authenticate all /v1 endpoints
    if (!authenticateRequest(req)) {
      return sendJson(res, 401, {
        error: {
          message: 'Unauthorized: Invalid or missing API key',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      });
    }

    try {
      // GET /v1/models
      if (pathname === '/v1/models' && req.method === 'GET') {
        const { catalog } = await getUnifiedCatalog();
        const modelsList = catalog.map(m => ({
          id: m.id,
          object: 'model',
          created: 1700000000,
          owned_by: m.channel,
          permission: [],
          root: m.id,
          parent: null,
          context_window: m.contextLength,
          is_free: m.isFree,
        }));
        return sendJson(res, 200, { object: 'list', data: modelsList });
      }

      // POST /v1/chat/completions or /v1/responses
      if ((pathname === '/v1/chat/completions' || pathname === '/v1/responses') && req.method === 'POST') {
        const body = await parseJsonBody(req);
        const result = await executeInference(body);

        // Sanitize tool calls: renumber index from 0 and suppress fingerprint tools
        if (result?.choices && Array.isArray(result.choices)) {
          for (const choice of result.choices) {
            if (choice.message?.tool_calls && Array.isArray(choice.message.tool_calls)) {
              choice.message.tool_calls = choice.message.tool_calls
                .filter(tc => tc.function?.name !== 'read' && tc.function?.name !== 'shell')
                .map((tc, idx) => ({ ...tc, index: idx }));
            }
          }
        }

        return sendJson(res, 200, result);
      }

      // POST /v1/messages (Anthropic Wire)
      if (pathname === '/v1/messages' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        // Translate Anthropic format to OpenAI internal format
        const messages = [];
        if (body.system) {
          messages.push({ role: 'system', content: body.system });
        }
        if (Array.isArray(body.messages)) {
          messages.push(...body.messages);
        }

        const result = await executeInference({
          model: body.model,
          messages,
          max_tokens: body.max_tokens,
          temperature: body.temperature,
          stream: false,
        });

        // Translate response back to Anthropic shape
        const textContent = result.choices?.[0]?.message?.content || '';
        const anthropicResp = {
          id: `msg_${Date.now()}`,
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: textContent }],
          model: body.model,
          stop_reason: 'end_turn',
          usage: {
            input_tokens: result.usage?.prompt_tokens || 0,
            output_tokens: result.usage?.completion_tokens || 0,
          },
        };
        return sendJson(res, 200, anthropicResp);
      }

      // POST /v1/messages/count_tokens
      if (pathname === '/v1/messages/count_tokens' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        let totalChars = 0;
        if (body.system) totalChars += body.system.length;
        if (Array.isArray(body.messages)) {
          for (const m of body.messages) totalChars += String(m.content || '').length;
        }
        const estTokens = Math.ceil(totalChars / 4);
        return sendJson(res, 200, { input_tokens: estTokens });
      }

      return sendJson(res, 404, {
        error: { message: `Path not found: ${pathname}`, type: 'invalid_request_error' },
      });
    } catch (err) {
      return sendJson(res, 500, {
        error: { message: redact(err.message), type: 'internal_error' },
      });
    }
  };
}

export function startGatewayServer({ port, host } = {}) {
  if (isRunning && serverInstance) {
    return { status: 'already_running', port: DSH_CONFIG.gateway.port, host: DSH_CONFIG.gateway.host };
  }

  const effectivePort = port || DSH_CONFIG.gateway.port;
  const effectiveHost = host || (DSH_CONFIG.gateway.allowLan ? '0.0.0.0' : DSH_CONFIG.gateway.host);

  const handler = createGatewayHandler();
  serverInstance = http.createServer(handler);

  return new Promise((resolve, reject) => {
    serverInstance.listen(effectivePort, effectiveHost, () => {
      isRunning = true;
      DSH_CONFIG.gateway.port = effectivePort;
      DSH_CONFIG.gateway.host = effectiveHost;
      resolve({
        status: 'started',
        port: effectivePort,
        host: effectiveHost,
        endpoint: `http://${effectiveHost}:${effectivePort}/v1`,
      });
    });
    serverInstance.on('error', err => {
      reject(err);
    });
  });
}

export function stopGatewayServer() {
  if (!serverInstance || !isRunning) {
    return Promise.resolve({ status: 'not_running' });
  }

  return new Promise((resolve) => {
    serverInstance.close(() => {
      isRunning = false;
      serverInstance = null;
      resolve({ status: 'stopped' });
    });
  });
}

export function getGatewayStatus() {
  return {
    isRunning,
    port: DSH_CONFIG.gateway.port,
    host: DSH_CONFIG.gateway.host,
    allowLan: DSH_CONFIG.gateway.allowLan,
    endpoints: {
      models: `http://${DSH_CONFIG.gateway.host}:${DSH_CONFIG.gateway.port}/v1/models`,
      chatCompletions: `http://${DSH_CONFIG.gateway.host}:${DSH_CONFIG.gateway.port}/v1/chat/completions`,
      messages: `http://${DSH_CONFIG.gateway.host}:${DSH_CONFIG.gateway.port}/v1/messages`,
    },
  };
}
