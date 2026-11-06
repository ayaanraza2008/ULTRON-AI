const DEFAULT_INTERVAL_MS = 60_000;
const MIN_SIGNAL_INTERVAL_MS = 12_000;

export function normalizeHealthchecksPingUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    const uuid = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (url.protocol !== "https:" || url.hostname !== "hc-ping.com" ||
        url.port || url.username || url.password || url.search || url.hash ||
        !uuid.test(url.pathname)) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * Optional Healthchecks.io heartbeat for a long-running worker.
 * Sends no task data, identifiers, logs, or credentials; the ping URL itself
 * is the secret and is never included in diagnostics.
 */
export function createHealthchecksHeartbeat({
  url,
  fetchImpl = fetch,
  logger = console,
  now = Date.now,
  intervalMs = DEFAULT_INTERVAL_MS,
  minSignalIntervalMs = MIN_SIGNAL_INTERVAL_MS,
  timeoutMs = 3000
} = {}) {
  const baseUrl = normalizeHealthchecksPingUrl(url);
  let lastAttemptAt = null;
  let lastSignal = null;
  let inFlight = null;

  async function signal(kind) {
    if (!baseUrl || !["success", "failure"].includes(kind)) return false;
    if (inFlight) return inFlight;
    const time = now();
    const elapsed = lastAttemptAt === null ? Infinity : Math.max(0, time - lastAttemptAt);
    if (lastSignal === kind && elapsed < intervalMs) return false;
    if (lastSignal !== null && lastSignal !== kind && elapsed < minSignalIntervalMs) return false;

    lastAttemptAt = time;
    lastSignal = kind;
    const target = kind === "failure" ? baseUrl + "/fail" : baseUrl;
    inFlight = (async () => {
      try {
        const response = await fetchImpl(target, {
          method: "HEAD",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response?.ok) {
          logger.warn?.("Healthchecks.io heartbeat was rejected.", { status: Number(response?.status) || 0 });
          return false;
        }
        lastSignal = kind;
        return true;
      } catch (error) {
        logger.warn?.("Healthchecks.io heartbeat request failed.", { name: error?.name || "Error" });
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    enabled: Boolean(baseUrl),
    success: () => signal("success"),
    failure: () => signal("failure")
  };
}
