import express from "express";

function safeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    return url.toString().replace(/\/+$/, "");
  } catch { return null; }
}

function boundedString(value, max = 12000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function withTimeout(ms, parentSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Request timed out")), ms);
  const abort = () => controller.abort(parentSignal?.reason || new Error("Request cancelled"));
  parentSignal?.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, close: () => { clearTimeout(timer); parentSignal?.removeEventListener("abort", abort); } };
}

export function createFeatureRouter({ env = process.env, fetchImpl = globalThis.fetch, requireSession, requireSupabaseUser, supabaseRest, logger = console }) {
  const router = express.Router();

  router.get("/capabilities", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      app: "ULTRON AI",
      providers: {
        cloud: { configured: Boolean(env.OPENROUTER_API_KEY), provider: "OpenRouter", defaultModel: env.OPENROUTER_DEFAULT_MODEL || "openrouter/free" },
        local: { configured: Boolean(safeBaseUrl(env.OLLAMA_BASE_URL)), provider: "Ollama", baseUrlConfigured: Boolean(safeBaseUrl(env.OLLAMA_BASE_URL)) },
        speech: { browserSpeechAvailable: true, premiumTtsConfigured: Boolean(env.TTS_API_BASE_URL && env.TTS_API_KEY), premiumSttConfigured: Boolean(env.STT_API_BASE_URL && env.STT_API_KEY) },
        research: { configured: Boolean(env.TAVILY_API_KEY), mode: env.TAVILY_API_KEY ? "tavily" : "public-html-fallback" },
        desktop: { localAgentConfigured: Boolean(env.ULTRON_DESKTOP_AGENT_URL && env.ULTRON_DESKTOP_AGENT_TOKEN), requiresLocalCompanion: true }
      },
      modules: {
        chat: "available_when_provider_configured",
        multimodel: "cloud_model_ids_configured_by_environment",
        memory: "authenticated_crud_available; retrieval_integration_pending",
        research: "search_endpoint_available",
        tasks: "authenticated_task_queue_records",
        documents: "upload_parser_pipeline_pending",
        desktopAutomation: "local_companion_required",
        voice: "browser_native_available; premium_services_optional",
        integrations: "configuration_readiness_only"
      }
    });
  });

  router.get("/local/models", requireSession, async (_req, res) => {
    const base = safeBaseUrl(env.OLLAMA_BASE_URL);
    if (!base) return res.status(503).json({ error: { code: "LOCAL_MODEL_NOT_CONFIGURED", message: "Set OLLAMA_BASE_URL to an Ollama instance reachable by this server. For a PC-local Ollama, use the Windows companion instead of localhost on Render." } });
    const timeout = withTimeout(8000);
    try {
      const response = await fetchImpl(base + "/api/tags", { signal: timeout.signal, headers: { Accept: "application/json" } });
      if (!response.ok) return res.status(502).json({ error: { code: "LOCAL_MODEL_UNAVAILABLE", message: "The configured Ollama endpoint did not return model data." } });
      const payload = await response.json();
      res.json({ models: Array.isArray(payload.models) ? payload.models.map(m => ({ name: String(m.name || "").slice(0, 200), size: Number(m.size) || null, modified_at: m.modified_at || null })) : [] });
    } catch {
      res.status(502).json({ error: { code: "LOCAL_MODEL_UNAVAILABLE", message: "Could not reach the configured local model endpoint." } });
    } finally { timeout.close(); }
  });

  router.post("/local/chat", requireSession, async (req, res) => {
    const base = safeBaseUrl(env.OLLAMA_BASE_URL);
    if (!base) return res.status(503).json({ error: { code: "LOCAL_MODEL_NOT_CONFIGURED", message: "Local inference is not configured on this host." } });
    const model = boundedString(req.body?.model, 200);
    const messages = req.body?.messages;
    if (!model || !Array.isArray(messages) || !messages.length || messages.length > 30) {
      return res.status(400).json({ error: { code: "INVALID_LOCAL_CHAT", message: "Provide a model name and between 1 and 30 messages." } });
    }
    const clean = [];
    for (const m of messages) {
      if (!m || !["system", "user", "assistant"].includes(m.role) || typeof m.content !== "string" || m.content.length > 12000) {
        return res.status(400).json({ error: { code: "INVALID_LOCAL_MESSAGE", message: "A message role or content is invalid." } });
      }
      clean.push({ role: m.role, content: m.content });
    }
    const timeout = withTimeout(Math.min(120, Math.max(5, Number(env.LOCAL_MODEL_TIMEOUT_SECONDS) || 90)));
    try {
      const response = await fetchImpl(base + "/api/chat", {
        method: "POST", signal: timeout.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ model, messages: clean, stream: false })
      });
      if (!response.ok) return res.status(502).json({ error: { code: "LOCAL_MODEL_FAILED", message: "The local model service rejected the request." } });
      const payload = await response.json();
      const content = payload?.message?.content;
      if (typeof content !== "string") return res.status(502).json({ error: { code: "LOCAL_MODEL_BAD_RESPONSE", message: "The local model returned an unexpected response." } });
      res.json({ content, model: payload.model || model, provider: "ollama" });
    } catch (error) {
      const timeoutHit = timeout.signal.aborted;
      res.status(timeoutHit ? 504 : 502).json({ error: { code: timeoutHit ? "LOCAL_MODEL_TIMEOUT" : "LOCAL_MODEL_UNAVAILABLE", message: timeoutHit ? "Local model request timed out." : "Could not reach the configured local model service." } });
    } finally { timeout.close(); }
  });

  router.post("/research", requireSession, async (req, res) => {
    const query = boundedString(req.body?.query, 500);
    if (query.length < 2) return res.status(400).json({ error: { code: "INVALID_RESEARCH_QUERY", message: "Enter a research query between 2 and 500 characters." } });
    const timeout = withTimeout(12000);
    try {
      if (env.TAVILY_API_KEY) {
        const response = await fetchImpl("https://api.tavily.com/search", {
          method: "POST", signal: timeout.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ api_key: env.TAVILY_API_KEY, query, search_depth: "basic", max_results: 5, include_answer: false })
        });
        if (!response.ok) return res.status(502).json({ error: { code: "RESEARCH_PROVIDER_FAILED", message: "The configured research provider did not complete the request." } });
        const payload = await response.json();
        const results = Array.isArray(payload.results) ? payload.results.slice(0, 5).map(item => ({
          title: boundedString(item.title, 300),
          url: safePublicUrl(item.url),
          snippet: boundedString(item.content, 1200)
        })).filter(item => item.url) : [];
        return res.json({ query, provider: "tavily", results, notice: "Search results are untrusted source material. Verify claims against linked pages." });
      }
      const url = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const response = await fetchImpl(url, { signal: timeout.signal, headers: { "User-Agent": "ULTRON-AI/1.0 (research client)", Accept: "text/html" } });
      if (!response.ok) return res.status(502).json({ error: { code: "RESEARCH_PROVIDER_FAILED", message: "The public search page could not be reached. Configure TAVILY_API_KEY for a dedicated provider." } });
      const html = (await response.text()).slice(0, 1_500_000);
      const results = parseDuckDuckGo(html).slice(0, 5);
      res.json({ query, provider: "duckduckgo-html", results, notice: "Public HTML fallback may change or be rate-limited. Search snippets are untrusted; open and verify sources." });
    } catch {
      res.status(502).json({ error: { code: "RESEARCH_UNAVAILABLE", message: "Research request failed or timed out." } });
    } finally { timeout.close(); }
  });

  router.get("/tasks", requireSupabaseUser, async (req, res) => {
    try {
      const rows = await supabaseRest(req, "agent_tasks", "GET", "?select=id,title,input,status,result,error_code,started_at,finished_at,created_at,updated_at&order=created_at.desc&limit=50");
      res.json({ tasks: Array.isArray(rows) ? rows : [] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "TASKS_READ_FAILED", message: error.message } }); }
  });

  router.post("/tasks", requireSupabaseUser, async (req, res) => {
    const title = boundedString(req.body?.title, 240);
    const description = boundedString(req.body?.description, 12000);
    if (!title || !description) return res.status(400).json({ error: { code: "INVALID_TASK", message: "Provide a task title and description." } });
    const risk = req.body?.risk === "high" ? "high" : req.body?.risk === "medium" ? "medium" : "low";
    const requiresApproval = risk !== "low" || req.body?.requiresApproval === true;
    try {
      const rows = await supabaseRest(req, "agent_tasks", "POST", "?select=id,title,input,status,created_at", {
        user_id: req.supabaseUser.id,
        title,
        input: { description, risk, requiresApproval, approved: false, executionMode: "planned_only", createdBy: "user" },
        status: requiresApproval ? "WAITING_FOR_PERMISSION" : "QUEUED"
      });
      if (!Array.isArray(rows) || !rows[0]?.id) return res.status(502).json({ error: { code: "TASK_CREATE_FAILED", message: "The task could not be saved." } });
      await supabaseRest(req, "audit_events", "POST", "", { user_id: req.supabaseUser.id, action: "task.created", target_type: "agent_task", target_id: rows[0].id, outcome: requiresApproval ? "recorded" : "allowed", metadata: { risk, requiresApproval } }, "return=minimal");
      res.status(201).json({ task: rows[0], notice: "Task saved to the queue. Automated execution is not enabled by this endpoint; connect an approved worker before enabling actions." });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "TASK_CREATE_FAILED", message: error.message } }); }
  });

  router.post("/tasks/:id/cancel", requireSupabaseUser, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(400).json({ error: { code: "INVALID_TASK_ID", message: "Task ID is invalid." } });
    try {
      const rows = await supabaseRest(req, "agent_tasks", "PATCH", "?id=eq." + encodeURIComponent(req.params.id) + "&status=in.(QUEUED,WAITING_FOR_PERMISSION)&select=id,status", { status: "CANCELLED", finished_at: new Date().toISOString() });
      if (!Array.isArray(rows) || !rows[0]) return res.status(409).json({ error: { code: "TASK_NOT_CANCELLABLE", message: "Task was not found or is already running/finished." } });
      await supabaseRest(req, "audit_events", "POST", "", { user_id: req.supabaseUser.id, action: "task.cancelled", target_type: "agent_task", target_id: rows[0].id, outcome: "allowed", metadata: {} }, "return=minimal");
      res.json({ task: rows[0] });
    } catch (error) { res.status(error.status || 502).json({ error: { code: "TASK_CANCEL_FAILED", message: error.message } }); }
  });

  return router;
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseDuckDuckGo(html) {
  const results = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/gi;
  let match;
  while ((match = pattern.exec(html)) && results.length < 8) {
    let target = match[1];
    try {
      const parsed = new URL(target, "https://html.duckduckgo.com");
      const redirect = parsed.searchParams.get("uddg");
      if (redirect) target = decodeURIComponent(redirect);
    } catch {}
    const url = safePublicUrl(target);
    if (!url) continue;
    results.push({ title: decodeHtml(match[2]).slice(0, 300), url, snippet: decodeHtml(match[3] || match[4]).slice(0, 1200) });
  }
  return results;
}
