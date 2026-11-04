/**
 * ULTRON AI — BYOX Watchdog Resilience & Health Monitoring Engine
 *
 * Derived from Build Your Own X concepts:
 * - AOSA: A Continuous Integration System (Task execution, failure isolation)
 * - xmonader: Writing a MiniTest Framework (Assertions, test runners)
 * - citw.dev: Create a CLI tool in Javascript (Telemetry & formatting)
 *
 * Implements rolling percentile latency metrics (p50, p95, p99),
 * multi-process watchdog supervision with auto-healing, and chaos fault injection.
 */

export class ByoxWatchdogResilience {
  constructor(options = {}) {
    this.sampleWindowSize = options.sampleWindowSize || 500;
    this.latencySamples = [];

    this.supervisedServices = new Map(); // name -> { lastHeartbeat, timeoutMs, restartHandler, status }
    this.stats = {
      restartsTriggered: 0,
      heartbeatsReceived: 0,
      faultsInjected: 0
    };
  }

  /**
   * Record operation latency in milliseconds.
   */
  recordLatency(durationMs) {
    if (typeof durationMs !== 'number' || durationMs < 0) return;

    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > this.sampleWindowSize) {
      this.latencySamples.shift();
    }
  }

  /**
   * Compute rolling p50, p95, p99 percentiles.
   */
  getLatencyPercentiles() {
    if (this.latencySamples.length === 0) {
      return { count: 0, p50: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const count = sorted.length;

    const p50Idx = Math.floor(count * 0.50);
    const p95Idx = Math.floor(count * 0.95);
    const p99Idx = Math.floor(count * 0.99);

    const sum = sorted.reduce((acc, v) => acc + v, 0);

    return {
      count,
      min: sorted[0],
      max: sorted[count - 1],
      avg: Math.round((sum / count) * 100) / 100,
      p50: sorted[p50Idx],
      p95: sorted[p95Idx],
      p99: sorted[p99Idx]
    };
  }

  /**
   * Register a service for watchdog heartbeat monitoring.
   */
  registerService(name, timeoutMs = 5000, restartHandler = null) {
    if (!name) throw new Error('Service name required');

    this.supervisedServices.set(name, {
      name,
      timeoutMs,
      restartHandler,
      lastHeartbeat: Date.now(),
      status: 'HEALTHY',
      consecutiveMisses: 0
    });
  }

  /**
   * Receive heartbeat from a supervised service.
   */
  sendHeartbeat(name) {
    const service = this.supervisedServices.get(name);
    if (!service) return false;

    service.lastHeartbeat = Date.now();
    service.status = 'HEALTHY';
    service.consecutiveMisses = 0;
    this.stats.heartbeatsReceived++;
    return true;
  }

  /**
   * Watchdog check tick to detect and restart stalled services.
   */
  async checkServices(now = Date.now()) {
    const alerts = [];

    for (const [name, service] of this.supervisedServices.entries()) {
      const elapsed = now - service.lastHeartbeat;

      if (elapsed > service.timeoutMs) {
        service.consecutiveMisses++;
        service.status = 'DEGRADED';

        alerts.push({
          service: name,
          elapsedMs: elapsed,
          timeoutMs: service.timeoutMs,
          status: 'STALLED'
        });

        // Trigger self-healing restart
        if (typeof service.restartHandler === 'function') {
          try {
            await service.restartHandler(name);
            service.status = 'RESTARTED';
            service.lastHeartbeat = Date.now();
            this.stats.restartsTriggered++;
          } catch (err) {
            service.status = 'FAILED_RESTART';
            alerts.push({
              service: name,
              error: err.message,
              status: 'RESTART_ERROR'
            });
          }
        }
      }
    }

    return alerts;
  }

  /**
   * Chaos Fault Injection: conditionally inject latency or errors for resilience testing.
   */
  async maybeInjectFault(faultConfig = {}) {
    // faultConfig: { errorRate: 0.2, latencyMs: 200 }
    if (faultConfig.errorRate && Math.random() < faultConfig.errorRate) {
      this.stats.faultsInjected++;
      throw new Error('CHAOS_INJECTED_FAULT: simulated subsystem failure');
    }

    if (faultConfig.latencyMs && faultConfig.latencyMs > 0) {
      this.stats.faultsInjected++;
      await new Promise(r => setTimeout(r, faultConfig.latencyMs));
    }
  }

  /**
   * Get holistic resilience summary.
   */
  getHealthReport() {
    return {
      latencies: this.getLatencyPercentiles(),
      services: Array.from(this.supervisedServices.values()).map(s => ({
        name: s.name,
        status: s.status,
        lastHeartbeatAgeMs: Date.now() - s.lastHeartbeat
      })),
      stats: { ...this.stats }
    };
  }
}
