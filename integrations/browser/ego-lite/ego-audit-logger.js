/**
 * ULTRON AI — Ego Lite Audit Logger
 * Module: integrations/browser/ego-lite/ego-audit-logger.js
 *
 * Maintains an auditable, sanitized log of all browser interactions,
 * tracking performance, error rates, memory impact, verified execution driver,
 * and redacting sensitive data.
 */

export class EgoAuditLogger {
  /**
   * @param {Object} options
   * @param {number} [options.maxEntries=500]
   */
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 500;
    this.entries = [];
    this.totalLogged = 0;
    this.errorCount = 0;
  }

  /**
   * Log an action
   * @param {Object} entry
   */
  log(entry) {
    const memoryMB = Math.round(process.memoryUsage().heapUsed / (1024 * 1024));

    const sanitized = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      action: entry.action || "unknown",
      taskSpaceId: entry.taskSpaceId || null,
      pageId: entry.pageId || null,
      target: this._sanitizeTarget(entry.target),
      executionDriver: entry.executionDriver || "TEST_DOUBLE",
      driverVerified: entry.driverVerified !== false,
      durationMs: entry.durationMs || 0,
      success: entry.success !== false,
      error: entry.error ? String(entry.error) : null,
      memoryMB
    };

    if (!sanitized.success) {
      this.errorCount += 1;
    }

    this.entries.push(sanitized);
    this.totalLogged += 1;

    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    return sanitized;
  }

  /**
   * Sanitize target to avoid logging full credentials
   * @private
   */
  _sanitizeTarget(target) {
    if (!target) return null;
    const str = String(target);
    // Redact password or secret query params in URLs
    return str.replace(/(password|token|key|secret)=([^&]+)/gi, "$1=[REDACTED]");
  }

  /**
   * Get recent entries
   * @param {number} [limit=50]
   */
  getRecentLogs(limit = 50) {
    const count = Math.min(limit, this.entries.length);
    return this.entries.slice(-count);
  }

  /**
   * Get summary statistics
   */
  getStats() {
    const recent = this.entries.slice(-50);
    const avgDuration =
      recent.length > 0
        ? Math.round(recent.reduce((acc, curr) => acc + (curr.durationMs || 0), 0) / recent.length)
        : 0;

    return {
      totalLogged: this.totalLogged,
      bufferedEntries: this.entries.length,
      errorCount: this.errorCount,
      successRate:
        this.totalLogged > 0
          ? `${(((this.totalLogged - this.errorCount) / this.totalLogged) * 100).toFixed(1)}%`
          : "100%",
      avgDurationRecentMs: avgDuration,
      currentHeapMB: Math.round(process.memoryUsage().heapUsed / (1024 * 1024))
    };
  }

  /**
   * Clear all logs
   */
  clear() {
    this.entries = [];
    this.totalLogged = 0;
    this.errorCount = 0;
  }
}
