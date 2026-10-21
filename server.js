import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BASE_URL = "https://router.bynara.id/v1";
const SESSION_COOKIE = "ultron_session";

function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signSession(secret, issuedAt) {
  const payload = String(issuedAt);
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function verifySession(value, secret, maxAgeMs = 8 * 60 * 60 * 1000) {
  if (!value || !secret) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const issuedAt = Number(value.slice(0, dot));
  const signature = value.slice(dot + 1);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > maxAgeMs || issuedAt > Date.now() + 60_000) return false;
  const expected = crypto.createHmac("sha256", secret).update(String(issuedAt)).digest("hex");
  return safeEqual(signature, expected);
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try { out[key] = decodeURIComponent(value); } catch { /* ignore malformed cookie */ }
  }
  return out;
}

function normalizeBaseUrl(value) {
  const raw = (value || DEFAULT_BASE_URL).trim();
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("NARA_ROUTER_BASE_URL must use HTTPS outside localhost.");
  }
  return raw.replace(/\/+$/, "");
}

export function createApp({ fetchImpl = globalThis.fetch, env = process.env, logger = console } = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    next();
  });

  const limits = new Map();
  const windowMs = Math.max(10_000, Number(env.RATE_LIMIT_WINDOW_MS) || 60_000);
  const maxRequests = Math.max(1, Number(env.RATE_LIMIT_MAX_REQUESTS) || 30);
  app.use("/api", (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const current = limits.get(key);
    if (!current || now - current.start >= windowMs) {
      limits.set(key, { start: now, count: 1 });
    } else {
      current.count += 1;
      if (current.count > maxRequests) {
        res.setHeader("Retry-After", String(Math.ceil((windowMs - (now - current.start)) / 1000)));
        return res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many requests. Please wait and try again." } });
      }
    }
    if (limits.size > 5000) {
      for (const [ip, entry] of limits) if (now - entry.start > windowMs) limits.delete(ip);
    }
    next();
  });


  function supabaseConfig() {
    const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const key = String(env.SUPABASE_PUBLISHABLE_KEY || "").trim();
    if (!url || !key) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
      return { url, key };
    } catch { return null; }
  }
  function cookieOptions(maxAge) {
    return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${env.NODE_ENV === "production" ? "; Secure" : ""}`;
  }
  async function getSupabaseUser(req, res) {
    const config = supabaseConfig();
    const cookies = parseCookies(req.headers.cookie);
    let token = cookies["ultron_sb_access"];
    const refreshToken = cookies["ultron_sb_refresh"];
    if (!config) return null;
    try {
      if (token) {
        const response = await fetchImpl(config.url + "/auth/v1/user", {
          headers: { apikey: config.key, Authorization: "Bearer " + token, Accept: "application/json" }
        });
        if (response.ok) {
          const user = await response.json();
          if (user && typeof user.id === "string") return user;
        } else if (response.status !== 401 || !refreshToken) {
          return null;
        }
      }
      if (!refreshToken || !res) return null;
      const refreshed = await fetchImpl(config.url + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!refreshed.ok) return null;
      const payload = await refreshed.json();
      if (!setSupabaseCookies(res, payload)) return null;
      return payload.user && typeof payload.user.id === "string" ? payload.user : null;
    } catch { return null; }
  }
  async function supabaseAuthRequest(path, body) {
    const config = supabaseConfig();
    if (!config) throw Object.assign(new Error("Supabase authentication is not configured on the server."), { status: 503 });
    const response = await fetchImpl(config.url + path, {
      method: "POST",
      headers: { apikey: config.key, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body)
    });
    let payload = {};
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      const message = response.status === 400 || response.status === 422
        ? (payload.msg || payload.message || payload.error_description || payload.error || "Authentication was not accepted.")
        : response.status === 429 ? "Too many authentication attempts. Please wait and try again."
        : "Supabase authentication is temporarily unavailable.";
      throw Object.assign(new Error(String(message).slice(0, 240)), { status });
    }
    return payload;
  }
  function setSupabaseCookies(res, payload) {
    const access = typeof payload.access_token === "string" ? payload.access_token : "";
    const refresh = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
    if (!access || !refresh) return false;
    const accessSeconds = Math.min(3600, Math.max(60, Number(payload.expires_in) || 3600));
    res.append("Set-Cookie", `ultron_sb_access=${encodeURIComponent(access)}; ${cookieOptions(accessSeconds)}`);
    res.append("Set-Cookie", `ultron_sb_refresh=${encodeURIComponent(refresh)}; ${cookieOptions(60 * 60 * 24 * 30)}`);
    return true;
  }
  async function requireSupabaseUser(req, res, next) {
    const user = await getSupabaseUser(req, res);
    if (!user) return res.status(401).json({ error: { code: "SUPABASE_AUTH_REQUIRED", message: "Sign in to your ULTRON account to use saved data." } });
    req.supabaseUser = user;
    next();
  }
  async function supabaseRest(req, table, method, query = "", body) {
    const config = supabaseConfig();
    const token = parseCookies(req.headers.cookie)["ultron_sb_access"];
    const url = config.url + "/rest/v1/" + table + query;
    const response = await fetchImpl(url, {
      method,
      headers: {
        apikey: config.key,
        Authorization: "Bearer " + token,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json", Prefer: "return=representation" })
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      logger.warn?.("Supabase data request failed", { table, status: response.status });
      const status = response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 404 : 502;
      throw Object.assign(new Error(status === 403 ? "Database access was denied by authentication or row-level security." : "Could not save or load data from Supabase."), { status });
    }
    return payload;
  }

  function sessionSecret() {
    return env.SESSION_SECRET || env.APP_ACCESS_PASSWORD || "";
  }
  function hasValidSession(req) {
    const secret = sessionSecret();
    return Boolean(env.APP_ACCESS_PASSWORD && secret && verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE], secret));
  }
  async function requireSession(req, res, next) {
    if (hasValidSession(req)) return next();
    if (await getSupabaseUser(req, res)) return next();
    if (!env.APP_ACCESS_PASSWORD && !supabaseConfig()) {
      return res.status(503).json({ error: { code: "ACCESS_NOT_CONFIGURED", message: "Configure Supabase URL and publishable key, or set APP_ACCESS_PASSWORD and SESSION_SECRET." } });
    }
    return res.status(401).json({ error: { code: "AUTH_REQUIRED", message: "Please sign in to ULTRON first." } });
  }

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      app: "ULTRON AI",
      providerConfigured: Boolean(env.NARA_ROUTER_API_KEY && env.NARA_ROUTER_DEFAULT_MODEL),
      accessConfigured: Boolean(env.APP_ACCESS_PASSWORD || supabaseConfig()),
      supabaseConfigured: Boolean(supabaseConfig()),
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/models", requireSession, async (_req, res) => {
    if (!env.NARA_ROUTER_API_KEY) {
      return res.status(503).json({ error: { code: "PROVIDER_NOT_CONFIGURED", message: "NaraRouter API key is not configured on the server." } });
    }
    let baseUrl;
    try { baseUrl = normalizeBaseUrl(env.NARA_ROUTER_BASE_URL); }
    catch { return res.status(500).json({ error: { code: "PROVIDER_CONFIG_INVALID", message: "NaraRouter base URL configuration is invalid." } }); }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const upstream = await fetchImpl(baseUrl + "/models", {
        headers: { "Authorization": "Bearer " + env.NARA_ROUTER_API_KEY, "Accept": "application/json" },
        signal: controller.signal
      });
      if (!upstream.ok) {
        logger.warn?.("NaraRouter model discovery failed", { status: upstream.status });
        return res.status(upstream.status === 429 ? 429 : 502).json({ error: { code: upstream.status === 401 ? "PROVIDER_AUTH" : "MODEL_DISCOVERY_FAILED", message: upstream.status === 401 ? "NaraRouter rejected the API key." : "Could not load the models available to this API key." } });
      }
      const payload = await upstream.json();
      const models = Array.isArray(payload?.data) ? payload.data.map(item => item?.id).filter(id => typeof id === "string" && id.length > 0 && id.length <= 200) : [];
      if (!models.length) return res.status(502).json({ error: { code: "MODEL_LIST_INVALID", message: "NaraRouter returned an unexpected model list." } });
      res.json({ models, defaultModel: env.NARA_ROUTER_DEFAULT_MODEL || null });
    } catch (error) {
      const timedOut = error?.name === "AbortError";
      res.status(timedOut ? 504 : 502).json({ error: { code: timedOut ? "MODEL_DISCOVERY_TIMEOUT" : "MODEL_DISCOVERY_UNAVAILABLE", message: timedOut ? "Model discovery timed out." : "Could not connect to NaraRouter." } });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.get("/api/session", async (req, res) => {
    const configured = Boolean(env.APP_ACCESS_PASSWORD || supabaseConfig());
    if (!configured) return res.status(503).json({ authenticated: false, configured: false });
    if (hasValidSession(req)) return res.json({ authenticated: true, configured: true, authType: "access_gate" });
    const user = await getSupabaseUser(req, res);
    res.json({ authenticated: Boolean(user), configured: true, authType: user ? "supabase" : null, email: user?.email || null });
  });

  app.post("/api/auth/signup", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().slice(0, 320) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || password.length < 8 || password.length > 256) {
      return res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Enter a valid email and a password between 8 and 256 characters." } });
    }
    try {
      const payload = await supabaseAuthRequest("/auth/v1/signup", { email, password });
      if (setSupabaseCookies(res, payload)) return res.status(201).json({ authenticated: true, email: payload.user?.email || email });
      return res.status(202).json({ authenticated: false, confirmationRequired: true, message: "Check your email to confirm the account, then sign in." });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: "SIGNUP_FAILED", message: error.message } });
    }
  });

  app.post("/api/auth/signin", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().slice(0, 320) : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!email || !password || password.length > 256) return res.status(400).json({ error: { code: "INVALID_CREDENTIALS", message: "Enter your account email and password." } });
    try {
      const payload = await supabaseAuthRequest("/auth/v1/token?grant_type=password", { email, password });
      if (!setSupabaseCookies(res, payload)) return res.status(502).json({ error: { code: "AUTH_RESPONSE_INVALID", message: "Supabase returned an incomplete sign-in response." } });
      return res.json({ authenticated: true, email: payload.user?.email || email });
    } catch (error) {
      return res.status(error.status || 502).json({ error: { code: "SIGNIN_FAILED", message: error.message } });
    }
  });

  app.post("/api/auth/signout", (_req, res) => {
    res.append("Set-Cookie", `ultron_sb_access=; ${cookieOptions(0)}`);
    res.append("Set-Cookie", `ultron_sb_refresh=; ${cookieOptions(0)}`);
    res.json({ ok: true });
  });

  app.get("/api/conversations", requireSupabaseUser, async (req, res) => {
    try {
      const rows = await supabaseRest(req, "conversations", "GET", "?select=id,title,created_at,updated_at&order=updated_at.desc&limit=20");
      res.json({ conversations: Array.isArray(rows) ? rows : [] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "DATABASE_READ_FAILED", message: error.message } }); }
  });

  app.post("/api/conversations", requireSupabaseUser, async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 240) : "New conversation";
    try {
      const rows = await supabaseRest(req, "conversations", "POST", "?select=id,title,created_at,updated_at", { user_id: req.supabaseUser.id, title: title || "New conversation" });
      if (!Array.isArray(rows) || !rows[0]?.id) return res.status(502).json({ error: { code: "DATABASE_WRITE_FAILED", message: "Supabase did not return the new conversation." } });
      res.status(201).json({ conversation: rows[0] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "DATABASE_WRITE_FAILED", message: error.message } }); }
  });

  app.get("/api/conversations/:id/messages", requireSupabaseUser, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_CONVERSATION_ID", message: "Conversation ID is invalid." } });
    try {
      const query = "?select=id,conversation_id,role,content,model,created_at&conversation_id=eq." + encodeURIComponent(req.params.id) + "&order=created_at.asc&limit=200";
      const rows = await supabaseRest(req, "messages", "GET", query);
      res.json({ messages: Array.isArray(rows) ? rows : [] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "DATABASE_READ_FAILED", message: error.message } }); }
  });

  app.post("/api/conversations/:id/messages", requireSupabaseUser, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_CONVERSATION_ID", message: "Conversation ID is invalid." } });
    const role = req.body?.role;
    const content = req.body?.content;
    if (!["user", "assistant"].includes(role) || typeof content !== "string" || !content.trim() || content.length > 100000) {
      return res.status(400).json({ error: { code: "INVALID_MESSAGE", message: "Message role or content is invalid." } });
    }
    try {
      const rows = await supabaseRest(req, "messages", "POST", "?select=id,conversation_id,role,content,created_at", {
        conversation_id: req.params.id, user_id: req.supabaseUser.id, role, content
      });
      if (!Array.isArray(rows) || !rows[0]?.id) return res.status(502).json({ error: { code: "DATABASE_WRITE_FAILED", message: "Supabase did not return the saved message." } });
      res.status(201).json({ message: rows[0] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "DATABASE_WRITE_FAILED", message: error.message } }); }
  });

  app.post("/api/session", (req, res) => {
    if (!env.APP_ACCESS_PASSWORD) {
      return res.status(503).json({ error: { code: "ACCESS_NOT_CONFIGURED", message: "The owner must configure APP_ACCESS_PASSWORD on the server." } });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!safeEqual(password, env.APP_ACCESS_PASSWORD)) {
      return res.status(401).json({ error: { code: "INVALID_PASSWORD", message: "That access password was not accepted." } });
    }
    const secret = sessionSecret();
    if (secret.length < 32) {
      return res.status(503).json({ error: { code: "SESSION_SECRET_TOO_WEAK", message: "Set SESSION_SECRET to a random secret of at least 32 characters." } });
    }
    const token = signSession(secret, Date.now());
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    res.json({ authenticated: true });
  });

  app.post("/api/logout", (req, res) => {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${env.NODE_ENV === "production" ? "; Secure" : ""}`);
    res.json({ ok: true });
  });

  app.post("/api/chat", requireSession, async (req, res) => {
    const maxChars = Math.max(1000, Number(env.MAX_MESSAGE_CHARS) || 12_000);
    const { messages, stream = true } = req.body || {};
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) {
      return res.status(400).json({ error: { code: "INVALID_MESSAGES", message: "Send between 1 and 40 messages." } });
    }
    const cleanMessages = [];
    let totalChars = 0;
    for (const item of messages) {
      if (!item || !["system", "user", "assistant"].includes(item.role) || typeof item.content !== "string") {
        return res.status(400).json({ error: { code: "INVALID_MESSAGE", message: "Each message must have a supported role and text content." } });
      }
      totalChars += item.content.length;
      if (item.content.length > maxChars || totalChars > maxChars * 2) {
        return res.status(413).json({ error: { code: "MESSAGE_TOO_LARGE", message: "The conversation is too large. Shorten it and try again." } });
      }
      cleanMessages.push({ role: item.role, content: item.content });
    }
    if (!env.NARA_ROUTER_API_KEY) {
      return res.status(503).json({ error: { code: "PROVIDER_NOT_CONFIGURED", message: "NaraRouter API key is not configured on the server." } });
    }
    if (!env.NARA_ROUTER_DEFAULT_MODEL) {
      return res.status(503).json({ error: { code: "MODEL_NOT_CONFIGURED", message: "Set NARA_ROUTER_DEFAULT_MODEL to a model available to your API key." } });
    }

    let baseUrl;
    try { baseUrl = normalizeBaseUrl(env.NARA_ROUTER_BASE_URL); }
    catch { return res.status(500).json({ error: { code: "PROVIDER_CONFIG_INVALID", message: "NaraRouter base URL configuration is invalid." } }); }

    const timeoutSeconds = Math.min(120, Math.max(5, Number(env.NARA_ROUTER_TIMEOUT_SECONDS) || 60));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("Provider timeout")), timeoutSeconds * 1000);
    const abortUpstream = () => controller.abort(new Error("Client disconnected"));
    req.on("aborted", abortUpstream);
    res.on("close", () => { if (!res.writableEnded) abortUpstream(); });

    try {
      const upstream = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.NARA_ROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": stream ? "text/event-stream, application/json" : "application/json"
        },
        body: JSON.stringify({
          model: env.NARA_ROUTER_DEFAULT_MODEL,
          messages: cleanMessages,
          stream: Boolean(stream),
          temperature: 0.7
        }),
        signal: controller.signal
      });

      if (!upstream.ok) {
        const status = upstream.status;
        try { await upstream.arrayBuffer(); } catch { /* ignore provider error body */ }
        logger.warn?.("NaraRouter request failed", { status, code: status === 401 ? "PROVIDER_AUTH" : status === 402 ? "PROVIDER_CREDITS" : status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR" });
        const code = status === 401 ? "PROVIDER_AUTH" : status === 402 ? "PROVIDER_CREDITS" : status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR";
        return res.status(status === 401 ? 502 : status === 429 ? 429 : status === 402 ? 402 : 502).json({
          error: { code, message: status === 401 ? "NaraRouter rejected the API key." : status === 402 ? "NaraRouter reports insufficient credits or entitlement." : status === 429 ? "NaraRouter rate limit reached. Please retry later." : "NaraRouter could not complete the request." }
        });
      }

      if (!stream) {
        const data = await upstream.json();
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string") return res.status(502).json({ error: { code: "INVALID_PROVIDER_RESPONSE", message: "The provider returned an unexpected response format." } });
        return res.json({ content, model: data.model || env.NARA_ROUTER_DEFAULT_MODEL });
      }

      if (!upstream.body) return res.status(502).json({ error: { code: "EMPTY_PROVIDER_STREAM", message: "The provider returned no response stream." } });
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() || "";
          for (const line of parts) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            if (data === "[DONE]") {
              res.write("event: done\ndata: {}\n\n");
              continue;
            }
            try {
              const event = JSON.parse(data);
              const delta = event?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length) {
                res.write(`data: ${JSON.stringify({ delta })}\n\n`);
              } else if (event?.error) {
                res.write(`event: provider_error\ndata: ${JSON.stringify({ error: { code: "PROVIDER_STREAM_ERROR", message: "The AI provider interrupted the response." } })}\n\n`);
              }
            } catch {
              logger.warn?.("Skipped malformed NaraRouter stream event");
            }
          }
          if (res.writableNeedDrain) await new Promise(resolve => res.once("drain", resolve));
        }
        res.write("event: done\ndata: {}\n\n");
        res.end();
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (controller.signal.aborted && res.headersSent) {
        if (!res.destroyed) res.end();
      } else if (!res.headersSent) {
        const timedOut = error?.name === "AbortError" || /timeout/i.test(String(error?.message));
        res.status(timedOut ? 504 : 502).json({ error: { code: timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE", message: timedOut ? "The AI provider timed out. Please retry." : "Could not connect to NaraRouter. Check the server configuration and network." } });
      } else if (!res.destroyed) {
        res.write(`event: provider_error\ndata: ${JSON.stringify({ error: { code: "PROVIDER_STREAM_INTERRUPTED", message: "The response stream was interrupted." } })}\n\n`);
        res.end();
      }
      logger.warn?.("NaraRouter request exception", { name: error?.name || "Error" });
    } finally {
      clearTimeout(timeout);
      req.off("aborted", abortUpstream);
    }
  });

  app.use(express.static(path.join(__dirname, "public"), { index: "index.html", maxAge: env.NODE_ENV === "production" ? "1h" : 0 }));
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end();
    if (err?.type === "entity.too.large") return res.status(413).json({ error: { code: "BODY_TOO_LARGE", message: "Request body is too large." } });
    if (err instanceof SyntaxError && "body" in err) return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
    logger.error?.("Unhandled request error", { name: err?.name || "Error" });
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } });
  });
  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT) || 10000;
  const app = createApp();
  app.listen(port, "0.0.0.0", () => console.log(`ULTRON AI listening on port ${port}`));
}
