import test from 'node:test';
import assert from 'node:assert/strict';
import { ByoxWatchdogResilience } from '../system/byox-watchdog-resilience.js';

test('ByoxWatchdogResilience: compute exact latency percentiles p50, p95, p99', () => {
  const watchdog = new ByoxWatchdogResilience();

  for (let i = 1; i <= 100; i++) {
    watchdog.recordLatency(i);
  }

  const p = watchdog.getLatencyPercentiles();
  assert.equal(p.count, 100);
  assert.equal(p.min, 1);
  assert.equal(p.max, 100);
  assert.equal(p.p50, 51);
  assert.equal(p.p95, 96);
  assert.equal(p.p99, 100);
});

test('ByoxWatchdogResilience: watchdog triggers self-healing restart on stalled service', async () => {
  const watchdog = new ByoxWatchdogResilience();
  let restarted = false;

  watchdog.registerService('desktop_companion_daemon', 100, async (name) => {
    restarted = true;
  });

  // Advance time by 200ms
  const futureNow = Date.now() + 200;
  const alerts = await watchdog.checkServices(futureNow);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].service, 'desktop_companion_daemon');
  assert.equal(restarted, true);
  assert.equal(watchdog.stats.restartsTriggered, 1);
});

test('ByoxWatchdogResilience: chaos fault injection triggers simulated errors', async () => {
  const watchdog = new ByoxWatchdogResilience();

  // 100% error rate
  await assert.rejects(
    async () => {
      await watchdog.maybeInjectFault({ errorRate: 1.0 });
    },
    /CHAOS_INJECTED_FAULT/
  );

  assert.equal(watchdog.stats.faultsInjected, 1);
});
