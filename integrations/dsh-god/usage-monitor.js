/**
 * ULTRON AI — DSH-GOD Usage Monitor & Real-Time Diagnostics
 * 
 * Tracks request metrics, latency, TTFT, token usage, error classification,
 * and throughput across all inference lanes.
 */

const MAX_RECENT_REQUESTS = 100;
const recentRequests = [];

const channelStats = {
  free: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
  kilo: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
  aggregate: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
  combo: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
  local: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
  unknown: { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, totalTokens: 0 },
};

const modelStats = new Map();

export function recordUsageTurn({
  model = 'unknown',
  underlyingModel,
  channel = 'unknown',
  latencyMs = 0,
  ttftMs = 0,
  success = true,
  tokens = {},
  error = null,
} = {}) {
  const normChannel = channelStats[channel] ? channel : 'unknown';
  const cStat = channelStats[normChannel];

  cStat.requests += 1;
  cStat.totalLatencyMs += latencyMs;
  if (success) {
    cStat.successes += 1;
  } else {
    cStat.failures += 1;
  }

  const promptTokens = Number(tokens?.prompt_tokens) || 0;
  const completionTokens = Number(tokens?.completion_tokens) || 0;
  const turnTokens = promptTokens + completionTokens;
  cStat.totalTokens += turnTokens;

  // Model-level stats
  let mStat = modelStats.get(model);
  if (!mStat) {
    mStat = { requests: 0, successes: 0, failures: 0, totalLatencyMs: 0, tokens: 0 };
    modelStats.set(model, mStat);
  }
  mStat.requests += 1;
  mStat.totalLatencyMs += latencyMs;
  if (success) mStat.successes += 1;
  else mStat.failures += 1;
  mStat.tokens += turnTokens;

  // Keep sliding window of recent requests
  const record = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    model,
    underlyingModel: underlyingModel || null,
    channel: normChannel,
    latencyMs: Math.round(latencyMs),
    ttftMs: ttftMs ? Math.round(ttftMs) : null,
    tokens: turnTokens,
    success,
    error: error || null,
  };

  recentRequests.unshift(record);
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.pop();
  }
}

export function getUsageSummary() {
  let totalReqs = 0;
  let totalSuccess = 0;
  let totalFailures = 0;
  let totalLat = 0;
  let grandTokens = 0;

  for (const c of Object.values(channelStats)) {
    totalReqs += c.requests;
    totalSuccess += c.successes;
    totalFailures += c.failures;
    totalLat += c.totalLatencyMs;
    grandTokens += c.totalTokens;
  }

  const avgLatency = totalReqs > 0 ? Math.round(totalLat / totalReqs) : 0;
  const successRate = totalReqs > 0 ? Math.round((totalSuccess / totalReqs) * 100) : 100;

  const modelsArray = [];
  for (const [mName, mData] of modelStats.entries()) {
    modelsArray.push({
      model: mName,
      requests: mData.requests,
      successRate: mData.requests > 0 ? Math.round((mData.successes / mData.requests) * 100) : 100,
      avgLatencyMs: mData.requests > 0 ? Math.round(mData.totalLatencyMs / mData.requests) : 0,
      totalTokens: mData.tokens,
    });
  }

  return {
    totalRequests: totalReqs,
    successfulRequests: totalSuccess,
    failedRequests: totalFailures,
    successRatePercent: successRate,
    averageLatencyMs: avgLatency,
    totalTokensUsed: grandTokens,
    channels: channelStats,
    models: modelsArray,
    recentRequests: recentRequests.slice(0, 20),
  };
}

export function getRecentRequests(limit = 20) {
  return recentRequests.slice(0, limit);
}

export function clearUsage() {
  recentRequests.length = 0;
  modelStats.clear();
  for (const c of Object.values(channelStats)) {
    c.requests = 0;
    c.successes = 0;
    c.failures = 0;
    c.totalLatencyMs = 0;
    c.totalTokens = 0;
  }
}
