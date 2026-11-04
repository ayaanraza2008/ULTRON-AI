/**
 * ULTRON AI — BYOX Secure Network Pipeline & Resilient HTTP Client
 *
 * Derived from Build Your Own X concepts:
 * - build-your-own.org: Build Your Own Web Server From Scratch in JavaScript
 * - codeburst: Building a Simple Single Sign-On (SSO) Server
 * - tokio.rs: Resilient Network Client & Circuit Breakers
 *
 * Implements HMAC-SHA256 request authentication, nonce replay prevention,
 * and a circuit-breaker HTTP client with full-jitter exponential backoff.
 */

import crypto from 'crypto';

export class ByoxSecureNetworkPipeline {
  constructor(options = {}) {
    this.secret = options.secret || 'ultron-secure-default-signing-key';
    this.timestampToleranceMs = options.timestampToleranceMs || 60000; // +/- 60 seconds
    this.seenNonces = new Map(); // nonce -> timestamp

    // Circuit breaker state
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeoutMs = options.resetTimeoutMs || 5000;
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.lastStateChange = Date.now();
  }

  /**
   * Clean expired nonces from memory cache.
   */
  pruneNonces() {
    const now = Date.now();
    for (const [nonce, ts] of this.seenNonces.entries()) {
      if (now - ts > this.timestampToleranceMs * 2) {
        this.seenNonces.delete(nonce);
      }
    }
  }

  /**
   * Build canonical request string for signing.
   */
  buildCanonicalString(method, path, timestamp, nonce, body = '') {
    const bodyHash = crypto.createHash('sha256').update(typeof body === 'string' ? body : JSON.stringify(body)).digest('hex');
    return `${method.toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
  }

  /**
   * Generate signature headers for an outgoing request.
   */
  signRequest(method, path, body = '') {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const canonical = this.buildCanonicalString(method, path, timestamp, nonce, body);

    const signature = crypto.createHmac('sha256', this.secret).update(canonical).digest('hex');

    return {
      'x-ultron-timestamp': timestamp,
      'x-ultron-nonce': nonce,
      'x-ultron-signature': signature
    };
  }

  /**
   * Verify signature headers of an incoming request.
   */
  verifyRequest(method, path, headers, body = '') {
    const timestamp = headers['x-ultron-timestamp'];
    const nonce = headers['x-ultron-nonce'];
    const signature = headers['x-ultron-signature'];

    if (!timestamp || !nonce || !signature) {
      return { valid: false, reason: 'MISSING_SIGNATURE_HEADERS' };
    }

    // 1. Check timestamp freshness
    const reqTime = parseInt(timestamp, 10);
    const now = Date.now();
    if (isNaN(reqTime) || Math.abs(now - reqTime) > this.timestampToleranceMs) {
      return { valid: false, reason: 'TIMESTAMP_EXPIRED_OR_DRIFT' };
    }

    // 2. Check replay attack via nonce
    this.pruneNonces();
    if (this.seenNonces.has(nonce)) {
      return { valid: false, reason: 'REPLAY_ATTACK_DETECTED' };
    }

    // 3. Recompute and constant-time compare HMAC signature
    const canonical = this.buildCanonicalString(method, path, timestamp, nonce, body);
    const expected = crypto.createHmac('sha256', this.secret).update(canonical).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const signatureBuf = Buffer.from(signature, 'hex');

    if (expectedBuf.length !== signatureBuf.length || !crypto.timingSafeEqual(expectedBuf, signatureBuf)) {
      return { valid: false, reason: 'INVALID_SIGNATURE' };
    }

    this.seenNonces.set(nonce, now);
    return { valid: true };
  }

  /**
   * Circuit breaker state management.
   */
  getCircuitState() {
    const now = Date.now();
    if (this.circuitState === 'OPEN' && (now - this.lastStateChange > this.resetTimeoutMs)) {
      this.circuitState = 'HALF_OPEN';
      this.lastStateChange = now;
    }
    return this.circuitState;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.circuitState = 'CLOSED';
    this.lastStateChange = Date.now();
  }

  recordFailure() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.circuitState = 'OPEN';
      this.lastStateChange = Date.now();
    }
  }

  /**
   * Calculate full jitter backoff delay.
   */
  calculateJitterBackoff(attempt, baseDelayMs = 100, maxDelayMs = 2000) {
    const temp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
    return Math.floor(Math.random() * temp);
  }

  /**
   * Execute an async call protected by circuit breaker and retry with jitter.
   */
  async executeWithCircuitBreaker(asyncOperation, maxRetries = 2) {
    const state = this.getCircuitState();
    if (state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN — fast failing request');
    }

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await asyncOperation();
        this.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;
        this.recordFailure();

        if (attempt < maxRetries) {
          const delay = this.calculateJitterBackoff(attempt);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }

    throw lastError;
  }
}
