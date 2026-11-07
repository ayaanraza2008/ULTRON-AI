import express from "express";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { safeServiceBase } from "../network-safety.js";

const require = createRequire(import.meta.url);
const { ConvoAITokenBuilder, RtcTokenBuilder, RtcRole } = require("agora-token");
const DEFAULT_BASE = "https://api.agora.io";
const TOKEN_TTL_SECONDS = 86400;
const clean = (value, max = 512) => typeof value === "string" ? value.trim().slice(0, max) : "";

function config(env = process.env) {
  const appId = clean(env.AGORA_APP_ID, 64);
  const appCertificate = clean(env.AGORA_APP_CERTIFICATE, 64);
  const pipelineId = clean(env.AGORA_PIPELINE_ID, 256);
  const channel = clean(env.AGORA_DEFAULT_CHANNEL, 40);
  const base = safeServiceBase(clean(env.AGORA_API_BASE_URL || DEFAULT_BASE, 500));
  const validAgoraIds = /^[a-f0-9]{32}$/i;
  const validChannel = /^[A-Za-z0-9_-]{1,40}$/;
  return {
    appId, appCertificate, pipelineId, channel, base,
    configured: Boolean(validAgoraIds.test(appId) && validAgoraIds.test(appCertificate)
      && pipelineId && validChannel.test(channel) && base)
  };
}

function issueSessionTokens(cfg, channel, agentUid, clientUid) {
  const agentToken = ConvoAITokenBuilder.buildToken(
    cfg.appId, cfg.appCertificate, channel, String(agentUid),
    TOKEN_TTL_SECONDS, TOKEN_TTL_SECONDS
  );
  const clientToken = RtcTokenBuilder.buildTokenWithUid(
    cfg.appId, cfg.appCertificate, channel, clientUid, RtcRole.PUBLISHER,
    TOKEN_TTL_SECONDS, TOKEN_TTL_SECONDS
  );
  if (!agentToken || !clientToken || !agentToken.startsWith("007") || !clientToken.startsWith("007")) {
    throw new Error("Agora token generation failed.");
  }
  return { agentToken, clientToken };
}

export function agoraVoiceReadiness(env = process.env) {
  const cfg = config(env);
  return {
    provider: "agora",
    configured: cfg.configured,
    state: cfg.configured ? "configured_unverified" : "missing_app_id_certificate_or_pipeline",
    appIdConfigured: Boolean(cfg.appId),
    appCertificateConfigured: Boolean(cfg.appCertificate),
    pipelineConfigured: Boolean(cfg.pipelineId),
    channelConfigured: Boolean(cfg.channel),
    tokenIssuerConfigured: cfg.configured,
    capabilities: ["realtime_conversational_voice", "browser_microphone_publish", "agent_audio_playback", "agent_session_start", "agent_session_stop"],
    note: "Server-generated short-lived RTC and ConvoAI tokens are used. App Certificate and agent token remain server-side."
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

  router.post("/integrations/agora/start", requireSupabaseUser, ownerOnly, async (_req, res) => {
    const cfg = config(env);
    if (!cfg.configured) return res.status(503).json({ error: { code: "AGORA_NOT_CONFIGURED", message: "Configure a valid Agora App ID, App Certificate, published pipeline ID, and default channel on the backend." } });

    // Numeric UIDs are generated per session so different ULTRON sessions cannot collide.
    const agentUid = crypto.randomInt(100000, 4000000000);
    const clientUid = crypto.randomInt(100000, 4000000000);
    const channel = cfg.channel + "-" + crypto.randomUUID().slice(0, 8);
    const sessionName = "ultron-" + crypto.randomUUID();

    let tokens;
    try {
      tokens = issueSessionTokens(cfg, channel, agentUid, clientUid);
    } catch {
      return res.status(500).json({ error: { code: "AGORA_TOKEN_ISSUE_FAILED", message: "Agora session tokens could not be generated. Verify the App ID and App Certificate." } });
    }

    const body = {
      name: sessionName,
      pipeline_id: cfg.pipelineId,
      properties: {
        channel,
        token: tokens.agentToken,
        agent_rtc_uid: String(agentUid),
        remote_rtc_uids: [String(clientUid)],
        enable_string_uid: false,
        idle_timeout: 300
      }
    };

    try {
      const result = await agoraRequest(cfg.base + "/api/conversational-ai-agent/v2/projects/" + encodeURIComponent(cfg.appId) + "/join", {
        method: "POST",
        headers: {
          Authorization: 'agora token="' + tokens.agentToken + '"',
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });
      const agentId = clean(result.agent_id, 256);
      if (!agentId) return res.status(502).json({ error: { code: "AGORA_AGENT_ID_MISSING", message: "Agora accepted the request but returned no agent ID." } });
      activeSessions.set(agentId, {
        ownerId, createdAt: Date.now(), channel, agentToken: tokens.agentToken
      });
      // Never return the agent/ConvoAI token or App Certificate to the browser.
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({
        provider: "agora",
        agentId,
        appId: cfg.appId,
        channel,
        rtcUid: clientUid,
        rtcToken: tokens.clientToken,
        expiresIn: TOKEN_TTL_SECONDS,
        status: "starting"
      });
    } catch (error) {
      const status = Number(error?.status);
      return res.status(status >= 400 && status <= 599 ? status : 502).json({ error: { code: clean(error?.code, 80) || "AGORA_UNAVAILABLE", message: "Agora voice session could not be started. Check the published pipeline, project configuration, and Agora permissions." } });
    }
  });

  router.post("/integrations/agora/:agentId/stop", requireSupabaseUser, ownerOnly, async (req, res) => {
    const cfg = config(env);
    const agentId = clean(req.params.agentId, 256);
    const session = activeSessions.get(agentId);
    if (!cfg.configured) return res.status(503).json({ error: { code: "AGORA_NOT_CONFIGURED", message: "Agora is not configured." } });
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(agentId) || !session || session.ownerId !== ownerId) {
      return res.status(404).json({ error: { code: "AGORA_SESSION_NOT_FOUND", message: "No active ULTRON Agora session was found for this owner." } });
    }
    try {
      await agoraRequest(cfg.base + "/api/conversational-ai-agent/v2/projects/" + encodeURIComponent(cfg.appId) + "/agents/" + encodeURIComponent(agentId) + "/leave", {
        method: "POST",
        headers: { Authorization: 'agora token="' + session.agentToken + '"', Accept: "application/json" }
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
