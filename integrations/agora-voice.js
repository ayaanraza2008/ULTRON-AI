import express from "express";
import crypto from "node:crypto";
import { safeServiceBase } from "../network-safety.js";

const DEFAULT_BASE = "https://api.agora.io";
const clean = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : "";

function config(env = process.env) {
  const appId = clean(env.AGORA_APP_ID, 128);
  const customerId = clean(env.AGORA_CUSTOMER_ID, 256);
  const customerSecret = clean(env.AGORA_CUSTOMER_SECRET, 512);
  const pipelineId = clean(env.AGORA_PIPELINE_ID, 256);
  const channel = clean(env.AGORA_DEFAULT_CHANNEL, 128);
  const base = safeServiceBase(clean(env.AGORA_API_BASE_URL || DEFAULT_BASE, 500));
  return { appId, customerId, customerSecret, pipelineId, channel, base,
    configured: Boolean(appId && customerId && customerSecret && pipelineId && channel && base && clean(env.AGORA_RTC_TOKEN, 4096)) };
}

function authHeader(cfg) {
  return "Basic " + Buffer.from(cfg.customerId + ":" + cfg.customerSecret).toString("base64");
}

export function agoraVoiceReadiness(env = process.env) {
  const cfg = config(env);
  return {
    provider: "agora",
    configured: cfg.configured,
    state: cfg.configured ? "configured_unverified" : "missing_credentials_or_agent_configuration",
    appIdConfigured: Boolean(cfg.appId),
    customerCredentialsConfigured: Boolean(cfg.customerId && cfg.customerSecret),
    pipelineConfigured: Boolean(cfg.pipelineId),
    channelConfigured: Boolean(cfg.channel),
    capabilities: ["realtime_conversational_voice", "agent_session_start", "agent_session_stop"],
    note: "Agora requires a valid RTC token for the agent. Configure a current token server-side; tokens expire and must be rotated. This adapter does not expose Agora secrets or issue client RTC tokens."
  };
}

export function createAgoraVoiceRouter({ env = process.env, fetchImpl = fetch, requireSupabaseUser }) {
  const router = express.Router();
  const activeSessions = new Map();
  const ownerId = clean(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);

  function ownerOnly(req, res, next) {
    if (!ownerId) return res.status(503).json({ error: { code: "INTEGRATION_OWNER_NOT_CONFIGURED", message: "Configure ULTRON_INTEGRATION_OWNER_USER_ID." } });
    const userId = clean(req.supabaseUser?.id, 100);
    if (!userId) return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Sign in to use Agora voice." } });
    if (userId !== ownerId) return res.status(403).json({ error: { code: "INTEGRATION_OWNER_ONLY", message: "Agora voice is restricted to the ULTRON owner." } });
    return next();
  }

  async function agoraRequest(url, options) {
    const response = await fetchImpl(url, { ...options, redirect: "error", signal: AbortSignal.timeout(20000) });
    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const error = new Error("Agora request failed.");
      error.status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      error.code = "AGORA_UPSTREAM_FAILED";
      throw error;
    }
    return data;
  }

  router.get("/integrations/agora/status", requireSupabaseUser, ownerOnly, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    return res.status(config(env).configured ? 200 : 503).json(agoraVoiceReadiness(env));
  });

  router.post("/integrations/agora/start", requireSupabaseUser, ownerOnly, async (req, res) => {
    const cfg = config(env);
    if (!cfg.configured) return res.status(503).json({ error: { code: "AGORA_NOT_CONFIGURED", message: "Configure Agora credentials, published pipeline ID, and default channel on the backend." } });
    const remoteUid = clean(req.body?.remoteRtcUid, 32);
    const token = clean(env.AGORA_RTC_TOKEN, 4096);
    if (!remoteUid || !/^[0-9]+$/.test(remoteUid)) return res.status(400).json({ error: { code: "AGORA_REMOTE_UID_REQUIRED", message: "Provide the signed-in client's numeric Agora RTC UID." } });
    if (!token) {
      return res.status(503).json({ error: { code: "AGORA_RTC_TOKEN_REQUIRED", message: "Agora requires a valid, unexpired RTC token for the agent. Configure AGORA_RTC_TOKEN or a server-side token issuer before starting sessions." } });
    }
    const sessionName = "ultron-" + crypto.randomUUID();
    const agentUid = clean(env.AGORA_AGENT_RTC_UID || "0", 32);
    const body = {
      name: sessionName,
      pipeline_id: cfg.pipelineId,
      properties: {
        channel: cfg.channel,
        token,
        agent_rtc_uid: agentUid,
        remote_rtc_uids: [remoteUid],
        enable_string_uid: false,
        idle_timeout: 60
      }
    };
    try {
      const result = await agoraRequest(cfg.base + "/api/conversational-ai-agent/v2/projects/" + encodeURIComponent(cfg.appId) + "/join", {
        method: "POST",
        headers: { Authorization: authHeader(cfg), "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body)
      });
      const agentId = clean(result.agent_id, 256);
      if (!agentId) return res.status(502).json({ error: { code: "AGORA_AGENT_ID_MISSING", message: "Agora accepted the request but returned no agent ID." } });
      activeSessions.set(agentId, { ownerId, createdAt: Date.now(), channel: cfg.channel });
      return res.status(201).json({ provider: "agora", agentId, channel: cfg.channel, status: "starting" });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(status >= 400 && status <= 599 ? status : 502).json({ error: { code: clean(error?.code, 80) || "AGORA_UNAVAILABLE", message: "Agora voice session could not be started. Check credentials, published pipeline, RTC token, and quota." } });
    }
  });

  router.post("/integrations/agora/:agentId/stop", requireSupabaseUser, ownerOnly, async (req, res) => {
    const cfg = config(env);
    const agentId = clean(req.params.agentId, 256);
    if (!cfg.configured) return res.status(503).json({ error: { code: "AGORA_NOT_CONFIGURED", message: "Agora is not configured." } });
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(agentId) || !activeSessions.has(agentId)) {
      return res.status(404).json({ error: { code: "AGORA_SESSION_NOT_FOUND", message: "No active ULTRON Agora session was found for this owner." } });
    }
    try {
      await agoraRequest(cfg.base + "/api/conversational-ai-agent/v2/projects/" + encodeURIComponent(cfg.appId) + "/agents/" + encodeURIComponent(agentId) + "/leave", {
        method: "POST", headers: { Authorization: authHeader(cfg), Accept: "application/json" }
      });
      activeSessions.delete(agentId);
      return res.json({ provider: "agora", agentId, status: "stopped" });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(status >= 400 && status <= 599 ? status : 502).json({ error: { code: clean(error?.code, 80) || "AGORA_STOP_FAILED", message: "Agora voice session could not be stopped." } });
    }
  });

  return router;
}
