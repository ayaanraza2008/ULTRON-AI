import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxSecureNetworkPipeline } from '../system/byox-secure-network-pipeline.js';

test('ByoxSecureNetworkPipeline: sign and verify valid HMAC-SHA256 request', () => {
  const pipeline = new ByoxSecureNetworkPipeline({ secret: 'test-secret-key-1234' });
  const method = 'POST';
  const path = '/api/companion/command';
  const body = { action: 'lock_workstation' };

  const headers = pipeline.signRequest(method, path, body);
  assert.ok(headers['x-ultron-timestamp']);
  assert.ok(headers['x-ultron-nonce']);
  assert.ok(headers['x-ultron-signature']);

  const verification = pipeline.verifyRequest(method, path, headers, body);
  assert.equal(verification.valid, true);
});

test('ByoxSecureNetworkPipeline: replay attack detection rejects identical nonce', () => {
  const pipeline = new ByoxSecureNetworkPipeline({ secret: 'test-secret-key-1234' });
  const method = 'GET';
  const path = '/api/companion/status';

  const headers = pipeline.signRequest(method, path);
  const first = pipeline.verifyRequest(method, path, headers);
  assert.equal(first.valid, true);

  // Second presentation of same nonce should trigger replay rejection
  const second = pipeline.verifyRequest(method, path, headers);
  assert.equal(second.valid, false);
  assert.equal(second.reason, 'REPLAY_ATTACK_DETECTED');
});

test('ByoxSecureNetworkPipeline: circuit breaker trips upon consecutive failures and resets', async () => {
  const pipeline = new ByoxSecureNetworkPipeline({ failureThreshold: 2, resetTimeoutMs: 50 });

  let attempts = 0;
  const failingOp = async () => {
    attempts++;
    throw new Error('Connection refused');
  };

  await assert.rejects(
    async () => {
      await pipeline.executeWithCircuitBreaker(failingOp, 0);
    },
    /Connection refused/
  );

  await assert.rejects(
    async () => {
      await pipeline.executeWithCircuitBreaker(failingOp, 0);
    },
    /Connection refused/
  );

  // Circuit should now be OPEN
  assert.equal(pipeline.getCircuitState(), 'OPEN');

  // Next call should fast-fail without invoking failingOp
  const prevAttempts = attempts;
  await assert.rejects(
    async () => {
      await pipeline.executeWithCircuitBreaker(failingOp, 0);
    },
    /Circuit breaker is OPEN/
  );
  assert.equal(attempts, prevAttempts); // No network attempt executed
});
