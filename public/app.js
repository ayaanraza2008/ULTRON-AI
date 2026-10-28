(() => {
  "use strict";
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const VIEWS = {
    home: ["COMMAND CENTER", "Command center"],
    chat: ["AI TERMINAL", "AI terminal"],
    tasks: ["AUTONOMOUS TASKS", "Autonomous tasks"],
    research: ["RESEARCH LAB", "Research lab"],
    coding: ["CODING AGENT", "Coding agent"],
    vision: ["VISION / CAMERA", "Vision & camera"],
    voice: ["VOICE STUDIO", "Voice studio"],
    files: ["DOCUMENT VAULT", "Document vault"],
    memory: ["MEMORY VAULT", "Memory vault"],
    automation: ["AUTOMATION", "Automation"],
    integrations: ["INTEGRATIONS", "Integrations"],
    security: ["SECURITY & APPROVALS", "Security & approvals"],
    system: ["SYSTEM HEALTH", "System health"],
    settings: ["SETTINGS", "Settings"]
  };
  const state = {
    view: "home",
    health: null,
    session: { authenticated: false, configured: false, authType: null, email: null },
    caps: null,
    readiness: null,
    worker: null,
    models: [{ id: "openrouter/free", label: "Automatic free router" }],
    model: "openrouter/free",
    persona: "ultron",
    coreState: "idle",
    coreDetail: "READY FOR INPUT",
    authMode: "signin",
    messages: [],
    attachments: [],
    conversations: [],
    conversationId: null,
    busy: false,
    controller: null,
    tasks: [],
    tasksError: "",
    selectedTask: null,
    taskProgress: null,
    memories: [],
    memoryError: "",
    research: null,
    researchError: "",
    coding: null,
    codingError: "",
    document: null,
    documentError: "",
    documentFile: null,
    documentSaved: false,
    savedDocuments: [],
    savedDocumentsError: "",
    integrations: [],
    integrationError: "",
    schedules: [],
    scheduleError: "",
    roles: [],
    routines: [],
    employeeStatus: null,
    preferences: { voice_enabled: true, voice_input_locale: "en-IN", memory_enabled: true },
    voiceActive: false,
    recognition: null,
    cameraStream: null,
    cameraPending: false,
    cameraRequestId: 0,
    cameraError: "",
    cameraNotice: "Camera is off. No frames are being captured.",
    cameraContinuousConsent: false,
    cameraContinuous: false,
    cameraIntervalSeconds: 15,
    cameraTimer: null,
    cameraRunId: 0,
    cameraContinuousStartedAt: 0,
    cameraSummaries: [],
    lastAnswer: "",
    sidebarCollapsed: false
  };

  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
  const signedIn = () => state.session.authenticated === true && state.session.authType === "supabase";
  const hasSession = () => state.session.authenticated === true;
  const displayDate = value => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "—";
  };
  const safeUrl = value => {
    try {
      const url = new URL(String(value || ""));
      return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  };
  function plainText(value) { return esc(value).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>"); }
  function chip(value) {
    const text = String(value || "UNKNOWN").toUpperCase().replace(/_/g, " ");
    const good = ["OK", "CONNECTED", "COMPLETED", "SUCCESS", "ENABLED", "LIVE", "PASSED", "AUTHENTICATED"].includes(text);
    const bad = ["ERROR", "FAILED", "BLOCKED", "DISABLED", "OFFLINE", "UNAVAILABLE"].includes(text);
    const warn = ["UNKNOWN", "PENDING", "QUEUED", "NOT CONFIGURED", "WAITING FOR PERMISSION", "CONFIGURED UNVERIFIED"].includes(text);
    return '<span class="state-chip ' + (good ? "good" : bad ? "bad" : warn ? "warn" : "purple") + '">' + esc(text) + "</span>";
  }
  function toast(message, kind) {
    const root = $("#toast-stack");
    if (!root) return;
    const item = document.createElement("div");
    item.className = "toast" + (kind ? " " + kind : "");
    item.textContent = String(message || "Done");
    root.appendChild(item);
    window.setTimeout(() => item.remove(), 4200);
  }
  async function readPayload(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { message: text.slice(0, 500) }; }
  }
  async function api(url, options) {
    const opts = Object.assign({ method: "GET", credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } }, options || {});
    opts.headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    if (opts.body !== undefined && typeof opts.body !== "string" && !(opts.body instanceof FormData) && !(opts.body instanceof Blob)) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const response = await fetch(url, opts);
    const data = await readPayload(response);
    if (!response.ok) {
      const error = new Error(data && data.error && data.error.message || data.message || ("Request failed (" + response.status + ")"));
      error.status = response.status;
      error.code = data && data.error && data.error.code;
      throw error;
    }
    return data;
  }
  async function maybe(url) {
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      return { ok: response.ok, status: response.status, data: await readPayload(response) };
    } catch (error) { return { ok: false, status: 0, data: {}, error }; }
  }
  function setCore(mode, detail) {
    state.coreState = mode || "idle";
    state.coreDetail = detail || "READY FOR INPUT";
    document.body.dataset.coreState = state.coreState;
    const footer = $("#footer-state");
    if (footer) footer.textContent = state.coreDetail;
    const label = $("#core-state-label");
    if (label) label.textContent = state.coreState === "thinking" || state.coreState === "responding" ? "PROCESSING" :
      state.coreState === "offline" ? "CORE UNVERIFIED" : state.coreState === "error" ? "ATTENTION REQUIRED" : "SYSTEM STANDBY";
    const sideTitle = $("#side-status-title");
    const sideDetail = $("#side-status-detail");
    const sideBox = $(".side-status");
    if (sideTitle) sideTitle.textContent = state.health && state.health.status === "ok" ? "CORE REACHABLE" : "CORE UNVERIFIED";
    if (sideDetail) sideDetail.textContent = detail || "Checking API health";
    if (sideBox) sideBox.dataset.state = state.health && state.health.status === "ok" ? "ok" : "unknown";
  }
  function updateChrome() {
    const status = $("#api-status");
    const statusText = $("#api-status-text");
    const modelText = $("#model-status-text");
    const accountName = $("#account-name");
    const accountDetail = $("#account-detail");
    const healthOk = state.health && state.health.status === "ok";
    if (status) status.dataset.state = healthOk ? "ok" : state.health ? "error" : "checking";
    if (statusText) statusText.textContent = healthOk ? "API ONLINE" : state.health ? "API UNVERIFIED" : "CONNECTING";
    if (modelText) {
      const ready = state.readiness && Array.isArray(state.readiness.components)
        ? state.readiness.components.find(item => item && item.id === "cloud_model") : null;
      modelText.textContent = ready && ready.state === "configured_unverified" ? "MODEL CONFIGURED" : "MODEL ROUTING";
    }
    if (accountName) accountName.textContent = signedIn() ? (state.session.email || "Signed-in operator") : hasSession() ? "Session active" : "Guest operator";
    if (accountDetail) accountDetail.textContent = signedIn() ? "Private data synchronized" : hasSession() ? "API session active" : "Sign in to sync your data";
    if ($("#footer-model")) $("#footer-model").textContent = healthOk ? "API REACHABLE · INFERENCE NOT YET PROVEN" : "SECURE API · STATUS UNVERIFIED";
    setCore(state.coreState, state.coreDetail);
  }
  async function refreshStatus(quiet) {
    const results = await Promise.all([maybe("/api/health"), maybe("/api/session"), maybe("/api/capabilities")]);
    state.health = results[0].ok ? results[0].data : { status: "unavailable" };
    state.session = results[1].ok
      ? { authenticated: results[1].data.authenticated === true, configured: results[1].data.configured !== false, authType: results[1].data.authType || null, email: results[1].data.email || null }
      : { authenticated: false, configured: results[1].status !== 503 && results[1].status !== 404, authType: null, email: null };
    state.caps = results[2].ok ? results[2].data : null;
    if (signedIn()) {
      const ready = await maybe("/api/runtime/readiness");
      state.readiness = ready.ok ? ready.data : null;
      const worker = await maybe("/api/worker/status");
      state.worker = worker.ok ? worker.data : null;
    } else {
      state.readiness = null;
      state.worker = null;
    }
    updateChrome();
    if (!results[0].ok || !state.health || state.health.status !== "ok") setCore("offline", "API HEALTH UNVERIFIED");
    else if (state.coreState === "offline") setCore("idle", "CORE REACHABLE · PROVIDER UNVERIFIED");
    if (!quiet) toast(results[0].ok ? "API status refreshed. A healthy endpoint does not prove live AI inference." : "Could not verify the ULTRON API endpoint.", results[0].ok ? "success" : "error");
    if (state.view === "home" || state.view === "system" || state.view === "security") renderCurrent();
  }
  function openAuth(mode) {
    state.authMode = mode || "signin";
    updateAuthMode();
    const modal = $("#auth-modal");
    if (modal) modal.hidden = false;
    if ($("#auth-email")) $("#auth-email").focus();
  }
  function closeAuth() { const modal = $("#auth-modal"); if (modal) modal.hidden = true; }
  function updateAuthMode() {
    const mode = state.authMode;
    $$(".auth-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.authMode === mode));
    const title = $("#auth-title");
    const passWrap = $("#auth-password-wrap");
    const pass = $("#auth-password");
    const submit = $("#auth-submit");
    if (title) title.textContent = mode === "signup" ? "Create your operator account." : mode === "recovery" ? "Recover your access." : "Welcome back, operator.";
    if (passWrap) passWrap.hidden = mode === "recovery";
    if (pass) pass.required = mode !== "recovery";
    if (submit) submit.innerHTML = (mode === "signup" ? "Create account" : mode === "recovery" ? "Send recovery email" : "Sign in securely") + " <span>↗</span>";
    if ($("#auth-error")) { $("#auth-error").hidden = true; $("#auth-error").textContent = ""; }
  }
  function gate(title, desc) {
    return '<div class="auth-required-panel"><span class="required-icon">◇</span><div><strong>' + esc(title || "Sign in to unlock private data") + '</strong><p>' + esc(desc || "Private tasks, memory, schedules and conversations require your Supabase account.") + '</p><button class="button button-primary button-small" data-action="open-auth">Sign in securely ↗</button></div></div>';
  }
  function pageHead(kicker, title, desc, actions) {
    return '<div class="page-head"><div><div class="eyebrow">' + esc(kicker) + '</div><h1>' + esc(title) + '</h1><p>' + esc(desc) + '</p></div><div class="page-actions">' + (actions || "") + '</div></div>';
  }
  function emptyState(symbol, title, description) {
    return '<div class="empty-state"><span class="empty-symbol">' + esc(symbol) + '</span><h3>' + esc(title) + '</h3><p>' + esc(description) + '</p></div>';
  }
  function apiValue() { return state.health && state.health.status === "ok" ? "ONLINE" : "UNVERIFIED"; }
  function modelState() {
    const item = state.readiness && Array.isArray(state.readiness.components) ? state.readiness.components.find(v => v && v.id === "cloud_model") : null;
    return item ? item.state : "not_verified";
  }

  function renderHome() {
    const signedLabel = signedIn() ? "ACCOUNT SYNCED" : hasSession() ? "SESSION ACTIVE" : "PRIVATE DATA LOCKED";
    const modelLabel = modelState() === "configured_unverified" ? "CONFIGURED · UNVERIFIED" : "LIVE INFERENCE UNVERIFIED";
    return '<div class="home-hero panel">' +
      '<div class="hero-copy"><div class="hero-kicker">PERSONAL INTELLIGENCE / SYSTEM 01</div>' +
      '<h1>Think beyond.<span>Command everything.</span></h1>' +
      '<p>Your personal AI command layer for reasoning, research, coding and guarded task workflows. Connected status is shown honestly; actions report their real results.</p>' +
      '<div class="hero-actions"><button class="button button-primary" data-view="chat">Open AI terminal <span>↗</span></button><button class="button" data-view="tasks">Task control <span>⌁</span></button><button class="button button-quiet" data-action="refresh-status">Refresh status ↻</button></div>' +
      '<div class="hero-footnote"><span>●</span> LIVE STATUS ONLY <span>·</span> NO SIMULATED COMPLETIONS</div></div>' +
      '<div class="core-stage"><div class="energy-core" aria-label="Decorative animated ULTRON energy core"><div class="core-ring ring-one"></div><div class="core-ring ring-two"></div><div class="core-ring ring-three"></div><div class="core-grid"></div><div class="core-core"></div><div class="core-state"><i></i><span id="core-state-label">SYSTEM STANDBY</span></div><div class="core-label"><strong>ULTRON / CORE</strong>ADAPTIVE ENERGY FIELD</div></div></div>' +
      '</div>' +
      '<div class="home-grid"><div class="home-main-stack">' +
      '<section class="panel prompt-panel"><div class="prompt-head"><strong>Start a conversation</strong><small>MODEL · ' + esc(state.model) + '</small></div>' +
      '<form class="prompt-box" data-form="home-chat"><textarea name="prompt" id="home-prompt" maxlength="12000" rows="2" placeholder="Ask ULTRON to reason, plan, research or help you build…" required></textarea><button class="button button-primary" type="submit" aria-label="Send prompt">↗</button></form>' +
      '<div class="prompt-controls"><div class="prompt-hints"><button class="hint-chip" data-prompt="Help me plan my day with clear priorities.">Plan my day</button><button class="hint-chip" data-prompt="Research this topic and cite useful sources: ">Research a topic</button><button class="hint-chip" data-prompt="Review this code and suggest a safe, tested improvement: ">Review code</button></div><span class="prompt-note">AI output depends on configured provider access.</span></div></section>' +
      '<div class="metric-grid">' +
      '<article class="metric-card"><div class="metric-top"><span class="metric-icon">⌬</span>' + chip(apiValue()) + '</div><div class="metric-value">' + esc(apiValue()) + '</div><div class="metric-label">Backend API</div><div class="metric-foot"><i></i> Health endpoint check</div></article>' +
      '<article class="metric-card"><div class="metric-top"><span class="metric-icon">◈</span>' + chip(signedLabel) + '</div><div class="metric-value">' + (signedIn() ? "SYNCED" : hasSession() ? "ACTIVE" : "LOCKED") + '</div><div class="metric-label">Account identity</div><div class="metric-foot"><i></i> ' + esc(signedLabel.toLowerCase()) + '</div></article>' +
      '<article class="metric-card"><div class="metric-top"><span class="metric-icon">✦</span>' + chip(modelState()) + '</div><div class="metric-value">' + (modelState() === "configured_unverified" ? "READY?" : "PENDING") + '</div><div class="metric-label">AI provider</div><div class="metric-foot"><i></i> ' + esc(modelLabel) + '</div></article>' +
      '</div>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Workspace launcher</strong><small>Jump directly into a capability</small></div><span class="panel-icon">⌘</span></div><div class="quick-grid">' +
      '<button class="quick-card" data-view="research"><span>⌕</span><span><strong>Research lab</strong><small>Search and synthesize</small></span></button>' +
      '<button class="quick-card" data-view="coding"><span>‹›</span><span><strong>Coding agent</strong><small>Plan, review and explain</small></span></button>' +
      '<button class="quick-card" data-view="files"><span>▤</span><span><strong>Document vault</strong><small>Extract and save privately</small></span></button>' +
      '<button class="quick-card" data-view="memory"><span>◈</span><span><strong>Memory vault</strong><small>Review your saved context</small></span></button>' +
      '</div></section></div>' +
      '<div class="home-side-stack"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>System snapshot</strong><small>Read-only status summary</small></div><span class="panel-icon">⌬</span></div>' +
      '<div class="activity-list">' +
      '<div class="activity-item"><span class="activity-icon">◉</span><div class="activity-copy"><strong>API health</strong><p>' + esc(state.health && state.health.status === "ok" ? "Health route returned an OK status." : "Health status could not be confirmed.") + '</p></div>' + chip(apiValue()) + '</div>' +
      '<div class="activity-item"><span class="activity-icon">✦</span><div class="activity-copy"><strong>Model inference</strong><p>Provider configuration does not prove that a live model call will succeed.</p></div>' + chip(modelState()) + '</div>' +
      '<div class="activity-item"><span class="activity-icon">⛨</span><div class="activity-copy"><strong>Protected actions</strong><p>Private records require sign-in. Higher-risk actions retain approval gates.</p></div>' + chip(signedIn() ? "AUTHENTICATED" : "LOCKED") + '</div>' +
      '<div class="activity-item"><span class="activity-icon">↻</span><div class="activity-copy"><strong>Last refreshed</strong><p>' + esc(displayDate(new Date().toISOString())) + '</p></div></div>' +
      '</div><div class="section-gap"><button class="button button-quiet full-width" data-view="system">Open system diagnostics ↗</button></div></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Operator access</strong><small>Authentication and private storage</small></div><span class="panel-icon">⛨</span></div>' +
      (signedIn()
        ? '<p class="muted" class="account-summary">Signed in as <strong>' + esc(state.session.email || "operator") + '</strong>. Private account APIs are available subject to service readiness.</p><button class="button button-quiet full-width" data-action="signout">Sign out securely</button>'
        : '<p class="muted">Sign in to use private memory, saved conversations, task records, schedules and private document storage.</p><button class="button button-primary full-width" data-action="open-auth">Open identity gate ↗</button>') +
      '<p class="microcopy">No task, integration or provider success is inferred from the UI itself.</p></section></div></div>';
  }
  function renderChatMessages() {
    if (!state.messages.length) return emptyState("◉", "Your terminal is ready", "Ask a question or give ULTRON a bounded task. Responses require a live provider configuration.");
    return state.messages.map((message, index) => {
      const role = message.role === "user" ? "user" : "assistant";
      const name = role === "user" ? "YOU" : "ULTRON";
      const content = message.content ? plainText(message.content) : message.streaming ? '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>' : "";
      const imageNames = Array.isArray(message.attachments) && message.attachments.length
        ? '<div class="microcopy">Attached images: ' + message.attachments.map(item => esc(item.name)).join(", ") + '</div>' : "";
      return '<article class="chat-message ' + role + '"><span class="message-avatar">' + (role === "user" ? "U" : "✦") + '</span><div class="message-body"><div class="message-top"><strong>' + name + '</strong><span>' + (message.time ? esc(message.time) : "NOW") + '</span>' + (message.model ? '<span>· ' + esc(message.model) + '</span>' : "") + '</div><div class="message-content">' + content + imageNames + '</div></div></article>';
    }).join("");
  }
  function renderChat() {
    return pageHead("LIVE REASONING LAYER", "AI terminal", "A streaming chat interface wired to ULTRON's model router. Provider and model availability must be verified by an actual response.", '<button class="button button-quiet" data-action="new-chat">＋ New conversation</button>') +
      '<div class="chat-layout"><aside class="panel chat-history"><div class="panel-head"><div class="panel-title"><strong>History</strong><small>' + (signedIn() ? "Private conversations" : "Sign in to sync") + '</small></div><span class="panel-icon">◷</span></div>' +
      (signedIn() ? '<button class="button button-small full-width" data-action="new-chat">＋ New terminal</button><div class="history-list">' +
        (state.conversations.length ? state.conversations.map(item => '<button class="history-item ' + (item.id === state.conversationId ? "active" : "") + '" data-action="select-conversation" data-id="' + esc(item.id) + '">◉ ' + esc(item.title || "Untitled conversation") + '</button>').join("") : '<div class="microcopy">No saved conversations yet.</div>') +
        '</div>' : gate("Sign in to load history", "Chat can still run with an active API session; private conversation storage requires Supabase sign-in.")) +
      '<div class="sidebar-spacer"></div><div class="microcopy">Model choice: automatic free router. The server keeps provider keys private.</div></aside>' +
      '<section class="panel chat-window"><div class="chat-window-head"><div><strong>ULTRON / INTERACTIVE SESSION</strong><small id="chat-live-status">' + (state.busy ? "Response streaming…" : "Awaiting operator input") + '</small></div><div class="chat-toolbar"><select id="persona-select" class="select-compact" aria-label="Assistant personality"><option value="ultron"' + (state.persona === "ultron" ? " selected" : "") + '>ULTRON</option><option value="naya"' + (state.persona === "naya" ? " selected" : "") + '>NAYA</option></select><select id="model-select" class="select-compact" aria-label="Model selection">' +
      state.models.map(model => '<option value="' + esc(model.id) + '"' + (model.id === state.model ? " selected" : "") + '>' + esc(model.label) + '</option>').join("") + '</select></div></div>' +
      '<div class="chat-messages" id="chat-messages" aria-live="polite">' + renderChatMessages() + '</div>' +
      '<div class="chat-composer"><form class="form-stack" data-form="chat"><textarea id="chat-input" name="prompt" maxlength="12000" rows="3" placeholder="Message ULTRON… (Enter to send · Shift+Enter for a new line)" required></textarea><div id="chat-attachments">' + renderAttachments() + '</div>' +
      '<div class="chat-composer-bottom"><div class="chat-toolbar"><button class="button button-small button-quiet" type="button" data-action="attach-images">＋ Image</button><button class="button button-small button-quiet" type="button" data-action="speak-last">◖ Read last answer</button><span class="chat-hint">Keep private data out of prompts unless necessary.</span></div><button class="button button-primary" type="submit"' + (state.busy ? " disabled" : "") + '>Send ↗</button></div></form></div></section></div>';
  }
  function renderAttachments() {
    return state.attachments.length ? '<div class="file-chip"><span>' + state.attachments.map(file => esc(file.name)).join(", ") + '</span><button class="text-button" type="button" data-action="clear-images">Remove</button></div>' : "";
  }
  function renderTasks() {
    const content = signedIn()
      ? '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Create a task record</strong><small>Only allowlisted bounded workflows are handled by the worker</small></div><span class="panel-icon">⌁</span></div>' +
        '<form class="form-stack" data-form="task-create"><div class="form-row"><div><label for="task-title">Task title</label><input id="task-title" name="title" maxlength="240" required placeholder="Summarize a topic"></div><div><label for="task-type">Workflow</label><select id="task-type" name="taskType"><option value="research">Research</option><option value="manual">Manual record</option><option value="autonomous">Autonomous report draft</option></select></div></div><label for="task-description">Description / goal</label><textarea id="task-description" name="description" maxlength="12000" required placeholder="Describe the outcome you need."></textarea><div class="form-row"><div><label for="task-query">Research query (if applicable)</label><input id="task-query" name="query" maxlength="400" placeholder="Optional research query"></div><div><label for="task-risk">Requested risk level</label><select id="task-risk" name="risk"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div></div><p class="field-help">The server independently infers risk; a low label cannot downgrade a higher-risk request. Saving a task record is not proof it ran.</p><div class="form-actions"><button class="button button-primary" type="submit">Create task record ↗</button><button class="button" type="button" data-action="refresh-tasks">Refresh tasks ↻</button></div></form></section>' +
        '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Task ledger</strong><small>Per-account tasks from the backend</small></div><span class="panel-icon">◷</span></div>' +
        (state.tasksError ? '<div class="error-panel">' + esc(state.tasksError) + '</div>' : "") +
        (state.tasks.length ? '<div class="list-stack">' + state.tasks.map(task => '<article class="list-row"><span class="list-row-icon">⌁</span><div class="list-row-main"><strong>' + esc(task.title || "Untitled task") + '</strong><p>' + esc(task.input && typeof task.input === "object" ? task.input.description || task.input.goal || JSON.stringify(task.input) : task.input || "No description provided.") + '</p><div class="list-row-meta">' + chip(task.status) + '<span class="microcopy">Updated ' + esc(displayDate(task.updated_at || task.created_at)) + '</span></div>' + (task.result ? '<div class="task-result">' + plainText(typeof task.result === "string" ? task.result : JSON.stringify(task.result, null, 2)) + '</div>' : "") + (task.error_code ? '<p class="microcopy">Error code: ' + esc(task.error_code) + '</p>' : "") + '</div><div class="list-row-actions">' + (["QUEUED", "WAITING_FOR_PERMISSION"].includes(String(task.status || "").toUpperCase()) ? '<button class="button button-small" data-action="approve-task" data-id="' + esc(task.id) + '">Approve</button><button class="button button-small button-danger" data-action="cancel-task" data-id="' + esc(task.id) + '">Cancel</button>' : '<button class="button button-small" data-action="task-progress" data-id="' + esc(task.id) + '">Timeline</button>') + '</div></article>').join("") + '</div>' : emptyState("⌁", "No task records", "Create a bounded task record to see it here.")) +
        (state.taskProgress ? '<div class="notice-panel"><strong>Selected task timeline</strong><p>State: ' + esc(state.taskProgress.progress && state.taskProgress.progress.state || "unknown") + ' · Checkpoints: ' + esc(state.taskProgress.progress && state.taskProgress.progress.checkpointCount || 0) + '</p>' + (Array.isArray(state.taskProgress.checkpoints) ? state.taskProgress.checkpoints.map(item => '<p>· ' + esc(item.action) + ' — ' + esc(item.outcome) + ' — ' + esc(displayDate(item.timestamp)) + '</p>').join("") : "") + '</div>' : "") +
        '</section>'
      : gate("Private task ledger locked", "Sign in with your Supabase account to create, review, approve or cancel task records.");
    return pageHead("TASK CONTROL / GUARDED EXECUTION", "Autonomous tasks", "Review queued work transparently. ULTRON does not run arbitrary code or treat approval as permission for unrelated external actions.", '<button class="button button-quiet" data-action="refresh-tasks">↻ Refresh</button>') + content;
  }
  function renderResearch() {
    let resultHtml = "";
    if (state.research) {
      const results = Array.isArray(state.research.results) ? state.research.results : Array.isArray(state.research.items) ? state.research.items : [];
      const summary = state.research.summary || state.research.answer || state.research.content || "";
      resultHtml = (summary ? '<div class="notice-panel">' + plainText(summary) + '</div>' : "");
      if (results.length) resultHtml += '<div class="result-grid">' + results.map(item => {
        const url = safeUrl(item.url || item.link || "");
        return '<article class="result-card"><h3>' + esc(item.title || item.name || "Research result") + '</h3><p>' + plainText(item.snippet || item.description || item.content || "") + '</p>' + (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">Open source ↗</a>' : "") + '</article>';
      }).join("") + '</div>';
      if (!summary && !results.length) resultHtml = '<pre class="code-output">' + plainText(JSON.stringify(state.research, null, 2)) + '</pre>';
    } else if (!state.researchError) resultHtml = emptyState("⌕", "Research starts with a question", "Submit a query. Results depend on configured search access and may require source verification.");
    return pageHead("INTELLIGENCE GATHERING", "Research lab", "Query the connected research adapter and inspect returned sources. No results are invented for display.", "") +
      '<section class="panel panel-pad"><form class="form-stack" data-form="research"><label for="research-query">Research objective</label><textarea id="research-query" name="query" maxlength="3000" required placeholder="What should ULTRON investigate?"></textarea><div class="form-actions"><button class="button button-primary" type="submit"' + (!hasSession() ? " disabled" : "") + '>Run research ↗</button><span class="field-help">Uses /api/research; availability depends on service/provider status.</span></div></form>' + (state.researchError ? '<div class="error-panel">' + esc(state.researchError) + '</div>' : "") + '</section>' +
      '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Research output</strong><small>Latest response from the API</small></div>' + (state.research ? chip("RESPONSE RECEIVED") : chip("AWAITING QUERY")) + '</div>' + resultHtml + '</section>';
  }
  function renderCoding() {
    const output = state.coding ? (state.coding.content || state.coding.answer || state.coding.result || JSON.stringify(state.coding, null, 2)) : "";
    return pageHead("BOUNDED ENGINEERING SUPPORT", "Coding agent", "Generate plans, explanations and reviews. This interface does not execute generated code or represent a hardened sandbox.", "") +
      '<div class="two-col"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Define the coding task</strong><small>Be precise about expected output</small></div><span class="panel-icon">‹›</span></div>' +
      '<form class="form-stack" data-form="coding"><label for="coding-task">Task</label><textarea id="coding-task" name="task" maxlength="5000" required placeholder="Describe the problem, desired behavior and constraints."></textarea><div class="form-row"><div><label for="coding-mode">Mode</label><select id="coding-mode" name="mode"><option value="plan">Plan</option><option value="review">Review</option><option value="explain">Explain</option><option value="implement">Implementation guidance</option></select></div><div><label for="coding-language">Language</label><input id="coding-language" name="language" maxlength="60" value="JavaScript"></div></div><label for="coding-code">Code / error (optional)</label><textarea id="coding-code" name="code" maxlength="16000" placeholder="Paste relevant code or error output"></textarea><div class="form-actions"><button class="button button-primary" type="submit"' + (!hasSession() ? " disabled" : "") + '>Request coding help ↗</button></div></form></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Agent response</strong><small>Generated output is untrusted until reviewed and tested</small></div>' + chip(state.coding ? "RESPONSE RECEIVED" : "AWAITING TASK") + '</div>' + (state.codingError ? '<div class="error-panel">' + esc(state.codingError) + '</div>' : "") + (state.coding ? '<pre class="code-output">' + plainText(output) + '</pre>' : emptyState("‹›", "Ready for a task", "A provider error will be shown explicitly instead of a fake response.")) + '</section></div>';
  }
  function renderVoice() {
    const supported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    return pageHead("VOICE INTERFACE", "Voice studio", "Use browser-native speech input and playback when your browser supports them. Cloud speech adapters require their own configuration.", "") +
      '<div class="two-col"><section class="panel panel-pad"><div class="core-stage"><div class="energy-core"><div class="core-ring ring-one"></div><div class="core-ring ring-two"></div><div class="core-ring ring-three"></div><div class="core-core"></div><div class="core-label"><strong>' + (state.voiceActive ? "LISTENING" : "VOICE READY") + '</strong>LOCAL BROWSER SPEECH</div></div></div><div class="panel-head"><div class="panel-title"><strong>Talk to ULTRON</strong><small>' + (supported ? "Speech recognition available" : "Speech recognition unavailable in this browser") + '</small></div>' + chip(state.voiceActive ? "LISTENING" : supported ? "READY" : "UNAVAILABLE") + '</div>' +
      '<div class="form-stack"><label for="voice-text">Recognized or typed request</label><textarea id="voice-text" maxlength="12000" placeholder="Your transcribed words will appear here.">' + esc(state.voiceText) + '</textarea><div class="form-actions"><button class="button button-primary" data-action="voice-toggle" type="button"' + (!supported && !state.voiceActive ? " disabled" : "") + '>' + (state.voiceActive ? "Stop listening" : "Start listening") + '</button><button class="button" data-action="send-voice-text" type="button">Send to AI terminal ↗</button><button class="button button-quiet" data-action="speak-last" type="button">Read last answer ◖</button></div>' +
      '<p class="field-help">Microphone permission is requested by your browser only after you press Start listening. Speech can be processed locally by the browser; it is not a verified always-on wake-word system.</p></div></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Voice readiness</strong><small>Capability constraints</small></div><span class="panel-icon">◖</span></div>' +
      '<div class="preference-row"><div><strong>Browser speech recognition</strong><small>' + (supported ? "Browser provides the recognition API." : "Try a browser that supports SpeechRecognition.") + '</small></div>' + chip(supported ? "AVAILABLE" : "UNAVAILABLE") + '</div>' +
      '<div class="preference-row"><div><strong>Browser text-to-speech</strong><small>' + (window.speechSynthesis ? "Speech playback is available on this device." : "Speech playback is not available.") + '</small></div>' + chip(window.speechSynthesis ? "AVAILABLE" : "UNAVAILABLE") + '</div>' +
      '<div class="preference-row"><div><strong>Premium speech providers</strong><small>Requires server-side provider credentials and live tests.</small></div>' + chip("UNVERIFIED") + '</div>' +
      '<div class="notice-panel">This page does not keep the microphone open in the background. No audio is recorded until you start a browser-supported speech session.</div></section></div>';
  }
  function renderVision() {
    const supported = Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const cameraOn = Boolean(state.cameraStream);
    const cameraPending = state.cameraPending === true;
    const summaries = state.cameraSummaries.length
      ? '<div class="camera-summary-list">' + state.cameraSummaries.map(item =>
          '<article class="camera-summary"><div class="list-row-meta"><span>' + esc(displayDate(item.at)) + '</span>' + chip("SUMMARY") + '</div><p>' + plainText(item.text) + '</p></article>'
        ).join("") + '</div>'
      : emptyState("◉", "No scene summaries yet", "Analyze one frame or explicitly start continuous summaries to request descriptions from your configured AI model.");
    return pageHead("CONSENT-CONTROLLED PERCEPTION", "Vision & camera", "Preview your camera locally, then choose whether to send a single low-resolution still frame to ULTRON. Camera startup never sends frames automatically.", "") +
      '<div class="two-col vision-layout"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Live camera preview</strong><small>No recording or automatic upload on start</small></div>' + chip(state.cameraContinuous ? "ANALYZING" : cameraOn ? "CAMERA ACTIVE" : "CAMERA OFF") + '</div>' +
      '<div class="camera-preview-frame' + (cameraOn ? ' is-active' : '') + '"><video id="vision-preview" autoplay muted playsinline aria-label="Live camera preview"></video><div class="camera-preview-placeholder"><span class="empty-symbol">◉</span><strong>Camera offline</strong><span>Start the camera when you are ready.</span></div></div>' +
      (state.cameraError ? '<div class="error-panel">' + esc(state.cameraError) + '</div>' : '') +
      '<div class="camera-controls"><button class="button button-primary" data-action="camera-start" type="button"' + (!supported || cameraOn || cameraPending ? " disabled" : "") + '>' + (cameraPending ? "Waiting for permission…" : "Start camera") + '</button><button class="button button-danger" data-action="camera-stop" type="button"' + (!cameraOn && !cameraPending ? " disabled" : "") + '>Stop camera</button><button class="button" data-action="camera-analyze" type="button"' + (!cameraOn || state.busy ? " disabled" : "") + '>Analyze one frame</button></div>' +
      '<p class="field-help">' + (supported ? 'Browser camera access is available. Your browser will ask permission after you press Start camera.' : 'Camera access requires a supported browser API and a secure context (HTTPS or trusted localhost).') + '</p>' +
      '<div class="notice-panel">' + esc(state.cameraNotice) + '</div>' +
      '<p class="microcopy">A frame is resized to at most 640 × 360 and encoded as JPEG before a request. One-shot analysis sends the still image to the configured model; image bytes are not stored as camera recordings. The returned text may be saved in your chat history when signed in.</p>' +
      '</section><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Continuous scene summaries</strong><small>Opt-in, bounded sampling</small></div>' + chip(state.cameraContinuous ? "RUNNING" : state.cameraContinuousConsent ? "CONSENT GIVEN" : "OFF") + '</div>' +
      '<label class="camera-consent"><input id="camera-continuous-consent" type="checkbox"' + (state.cameraContinuousConsent ? " checked" : "") + (cameraOn ? "" : " disabled") + '><span><strong>Allow continuous still-frame analysis</strong><small>Explicitly allow a camera still to be sent at the selected interval. This does not record video.</small></span></label>' +
      '<label for="camera-interval">Sampling interval</label><select id="camera-interval"' + (state.cameraContinuous ? " disabled" : "") + '><option value="15"' + (state.cameraIntervalSeconds === 15 ? " selected" : "") + '>Every 15 seconds</option><option value="30"' + (state.cameraIntervalSeconds === 30 ? " selected" : "") + '>Every 30 seconds</option><option value="60"' + (state.cameraIntervalSeconds === 60 ? " selected" : "") + '>Every 60 seconds</option></select>' +
      '<div class="form-actions"><button class="button button-primary" data-action="camera-continuous-start" type="button"' + (!cameraOn || !state.cameraContinuousConsent || state.cameraContinuous || !hasSession() ? " disabled" : "") + '>Start continuous summaries</button><button class="button button-danger" data-action="camera-continuous-stop" type="button"' + (!state.cameraContinuous ? " disabled" : "") + '>Stop summaries</button></div>' +
      '<p class="field-help">Continuous mode requires sign-in and a compatible vision model. It sends no more than one frame at a time, skips samples while another chat request is active, and stops automatically after 30 minutes. Navigating away, hiding this tab, unchecking consent, or stopping the camera halts future sampling.</p>' +
      '<div class="panel-head camera-summary-heading"><div class="panel-title"><strong>Recent visual observations</strong><small>Newest first · up to 8 summaries</small></div></div>' + summaries + '</section></div>';
  }

  function renderFiles() {
    let extracted = "";
    if (state.document) {
      const text = state.document.extractedText || state.document.text || state.document.content || "";
      extracted = '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Extraction result</strong><small>' + esc(state.document.filename || (state.documentFile && state.documentFile.name) || "Selected file") + ' · ' + esc(state.document.characters || String(text).length) + ' characters</small></div>' + chip("EXTRACTED") + '</div><pre class="code-output">' + plainText(text) + '</pre><div class="form-actions"><button class="button button-primary" data-action="save-document-memory">Save text to Memory Vault</button><button class="button" data-action="save-document-private"' + (!signedIn() || !state.documentFile || state.documentFile.size > 5 * 1024 * 1024 ? " disabled" : "") + '>Save original privately</button></div><p class="field-help">Extraction is transient until you explicitly save. Original private storage requires sign-in and a working Supabase storage migration.</p></section>';
    }
    return pageHead("PRIVATE FILE WORKSPACE", "Document vault", "Extract text locally submitted to the backend, then choose whether to save the text or upload the original file to your private account.", "") +
      '<div class="two-col"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Import a document</strong><small>TXT, Markdown, CSV, JSON, HTML, PDF, DOCX</small></div><span class="panel-icon">▤</span></div>' +
      '<div class="upload-area"><span class="empty-symbol">＋</span><strong>' + (state.documentFile ? esc(state.documentFile.name) : "Drop in a document") + '</strong><p>Choose a file to extract useful text. Supported files are bounded by the API size limits.</p><button class="button" data-action="choose-document" type="button">Choose file</button></div>' +
      '<div class="form-actions"><button class="button button-primary" data-action="extract-document" type="button"' + (!state.documentFile ? " disabled" : "") + '>Extract text ↗</button><button class="button button-quiet" data-action="clear-document" type="button">Clear</button></div>' +
      (state.documentError ? '<div class="error-panel">' + esc(state.documentError) + '</div>' : "") +
      '<p class="microcopy">Documents are treated as untrusted content. Instructions inside uploaded documents are not system instructions.</p></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Your private originals</strong><small>Account-scoped storage</small></div><button class="button button-small" data-action="refresh-documents">↻ Refresh</button></div>' +
      (signedIn() ? (state.savedDocumentsError ? '<div class="error-panel">' + esc(state.savedDocumentsError) + '</div>' : state.savedDocuments.length ? '<div class="list-stack">' + state.savedDocuments.map(item => '<article class="list-row"><span class="list-row-icon">▤</span><div class="list-row-main"><strong>' + esc(item.filename || "Private document") + '</strong><p>' + esc(item.mime_type || "Unknown type") + ' · ' + esc(item.size_bytes || "—") + ' bytes · ' + esc(displayDate(item.created_at)) + '</p><div class="list-row-meta"><a class="text-button" href="/api/documents/' + encodeURIComponent(item.id) + '/download">Download file ↗</a></div></div><button class="button button-small button-danger" data-action="delete-document" data-id="' + esc(item.id) + '">Delete</button></article>').join("") + '</div>' : emptyState("▤", "No saved originals", "Uploaded private files appear here after a successful API response.")) : gate("Private file storage locked", "Sign in to list, download, or delete the originals attached to your account.")) +
      '</section></div>' + extracted;
  }
  function renderMemory() {
    return pageHead("PERSONAL CONTEXT / OWNER CONTROLLED", "Memory vault", "Memory is account-scoped and user-controlled. You can create entries, deactivate them or delete them; saved content is not treated as trusted instructions.", '<button class="button button-quiet" data-action="refresh-memory">↻ Refresh</button>') +
      (signedIn() ? '<div class="two-col"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Save a memory</strong><small>Only save what you intend ULTRON to retain</small></div><span class="panel-icon">◈</span></div><form class="form-stack" data-form="memory"><label for="memory-kind">Memory type</label><select id="memory-kind" name="kind"><option value="preference">Preference</option><option value="project_fact">Project fact</option><option value="profile_note">Profile note</option></select><label for="memory-title">Title</label><input id="memory-title" name="title" maxlength="240" required placeholder="How I like my work organized"><label for="memory-content">Content</label><textarea id="memory-content" name="content" maxlength="20000" required placeholder="Write the context to remember…"></textarea><div class="form-actions"><button class="button button-primary" type="submit">Save to memory ↗</button></div></form></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Your saved context</strong><small>' + state.memories.length + ' entries loaded</small></div>' + chip("PRIVATE") + '</div>' + (state.memoryError ? '<div class="error-panel">' + esc(state.memoryError) + '</div>' : state.memories.length ? '<div class="list-stack">' + state.memories.map(item => '<article class="list-row"><span class="list-row-icon">◈</span><div class="list-row-main"><strong>' + esc(item.title) + '</strong><p>' + plainText(item.content) + '</p><div class="list-row-meta">' + chip(item.kind) + chip(item.is_active ? "ACTIVE" : "INACTIVE") + '<span class="microcopy">' + esc(displayDate(item.updated_at || item.created_at)) + '</span></div></div><div class="list-row-actions"><button class="button button-small" data-action="toggle-memory" data-id="' + esc(item.id) + '" data-active="' + String(item.is_active === true) + '">' + (item.is_active ? "Deactivate" : "Activate") + '</button><button class="button button-small button-danger" data-action="delete-memory" data-id="' + esc(item.id) + '">Delete</button></div></article>').join("") + '</div>' : emptyState("◈", "No memories saved", "Create a preference, project fact or profile note to begin.")) + '</section></div>' : gate("Memory vault locked", "Sign in to read or edit your private memory. The interface never fabricates saved entries."));
  }
  function renderIntegrations() {
    return pageHead("ADAPTER REGISTRY", "Integrations", "This registry distinguishes configured adapters from verified live connectivity. Missing credentials or companion services appear as unavailable, not working.", '<button class="button button-quiet" data-action="refresh-integrations">↻ Refresh</button>') +
      (state.integrationError ? '<div class="error-panel">' + esc(state.integrationError) + '</div>' : "") +
      (state.integrations.length ? '<div class="three-col">' + state.integrations.map(item => '<article class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>' + esc(item.name || item.id || "Integration") + '</strong><small>' + esc(item.mode || "API adapter") + '</small></div>' + chip(item.state || (item.configured ? "CONFIGURED UNVERIFIED" : "BLOCKED")) + '</div><p class="muted" class="integration-desc">' + esc(item.capability || item.description || "Capability readiness data") + '</p><p class="microcopy">' + esc(item.note || "Live connectivity not verified.") + '</p></article>').join("") + '</div>' : emptyState("⟡", "No readiness data loaded", "Sign in to request integration readiness from the backend."));
  }
  function renderAutomation() {
    if (!signedIn()) return pageHead("GUARDED ROUTINES", "Automation", "Schedules create plans and drafts. They do not send messages, publish content, spend money, execute shell commands or control devices automatically.", "") + gate("Private schedules locked", "Sign in with your Supabase account to create and manage schedules.");
    const roles = state.roles.length ? state.roles : [{ id: "chief-of-staff", name: "Chief of Staff" }];
    const selectedRole = $("#schedule-role") ? $("#schedule-role").value : roles[0].id;
    const routines = state.routines.filter(item => !Array.isArray(item.roles) || item.roles.includes(selectedRole));
    const form = '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Create a schedule</strong><small>Run cadences between 1 hour and 7 days</small></div><span class="panel-icon">◷</span></div><form class="form-stack" data-form="schedule"><div class="form-row"><div><label for="schedule-role">AI Employee role</label><select id="schedule-role" name="role">' + roles.map(role => '<option value="' + esc(role.id) + '"' + (role.id === selectedRole ? " selected" : "") + '>' + esc(role.name || role.title || role.id) + '</option>').join("") + '</select></div><div><label for="schedule-routine">Routine</label><select id="schedule-routine" name="routineId">' + (routines.length ? routines.map(item => '<option value="' + esc(item.id) + '">' + esc(item.name || item.title || item.id) + '</option>').join("") : '<option value="">Load available routines</option>') + '</select></div></div><label for="schedule-goal">Goal</label><textarea id="schedule-goal" name="goal" maxlength="2000" required placeholder="Describe the plan or report this routine should prepare."></textarea><label for="schedule-context">Optional context</label><textarea id="schedule-context" name="context" maxlength="4000" placeholder="Relevant non-secret context"></textarea><div><label for="schedule-interval">Repeat interval</label><select id="schedule-interval" name="intervalMinutes"><option value="60">Every hour</option><option value="360">Every 6 hours</option><option value="1440" selected>Daily</option><option value="10080">Weekly</option></select></div><div class="form-actions"><button class="button button-primary" type="submit">Save schedule ↗</button></div></form><p class="field-help">Scheduling runs only when the backend scheduler and worker credentials are enabled. UI save success does not prove a future execution.</p></section>';
    const scheduleList = '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Your schedules</strong><small>Per-account recurring routines</small></div><button class="button button-small" data-action="refresh-automation">↻ Refresh</button></div>' +
      (state.scheduleError ? '<div class="error-panel">' + esc(state.scheduleError) + '</div>' : state.schedules.length ? '<div class="list-stack">' + state.schedules.map(item => '<article class="list-row"><span class="list-row-icon">◷</span><div class="list-row-main"><strong>' + esc(item.goal || item.routine_id || "Scheduled routine") + '</strong><p>Role: ' + esc(item.role_id) + ' · Routine: ' + esc(item.routine_id) + '</p><div class="list-row-meta">' + chip(item.enabled ? "ENABLED" : "DISABLED") + '<span class="microcopy">Next run: ' + esc(displayDate(item.next_run_at)) + '</span></div></div><div class="list-row-actions"><button class="button button-small" data-action="toggle-schedule" data-id="' + esc(item.id) + '" data-enabled="' + String(item.enabled === true) + '">' + (item.enabled ? "Pause" : "Enable") + '</button><button class="button button-small" data-action="run-schedule" data-id="' + esc(item.id) + '">Run report</button><button class="button button-small button-danger" data-action="delete-schedule" data-id="' + esc(item.id) + '">Delete</button></div></article>').join("") + '</div>' : emptyState("◷", "No schedules yet", "Save an approved schedule to see it here.")) +
      '<div class="notice-panel">' + esc(state.employeeStatus && state.employeeStatus.notice || "Schedule execution status will be shown only after reading the backend.") + '</div></section>';
    return pageHead("ROUTINES / PLANNING ONLY", "Automation", "Schedule bounded drafts and reports. External side effects and device control are not enabled through these routines.", "") + form + scheduleList;
  }
  function renderSecurity() {
    const healthOk = state.health && state.health.status === "ok";
    return pageHead("TRUST BOUNDARIES", "Security & approvals", "A clear view of the guards around identity, data and actions. Status reflects API evidence and never implies a full security audit.", '<button class="button button-quiet" data-action="refresh-status">↻ Refresh checks</button>') +
      '<div class="three-col"><article class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>API exposure</strong><small>Reachability only</small></div><span class="panel-icon">⌬</span></div><div class="metric-value">' + esc(healthOk ? "ONLINE" : "UNVERIFIED") + '</div><p class="microcopy">A successful health check does not validate auth, providers, RLS or task completion.</p>' + chip(healthOk ? "OK" : "UNVERIFIED") + '</article>' +
      '<article class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Account scope</strong><small>Private APIs</small></div><span class="panel-icon">◈</span></div><div class="metric-value">' + (signedIn() ? "SIGNED IN" : "LOCKED") + '</div><p class="microcopy">Private memory, conversations, documents, tasks and schedules use authenticated endpoints.</p>' + chip(signedIn() ? "AUTHENTICATED" : "SIGN IN REQUIRED") + '</article>' +
      '<article class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Action approvals</strong><small>Guarded execution</small></div><span class="panel-icon">⛨</span></div><div class="metric-value">GUARDED</div><p class="microcopy">Higher-risk work can require approval. No arbitrary code execution is exposed by this interface.</p>' + chip("POLICY GATED") + '</article></div>' +
      '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Operational notes</strong><small>Explicit limitations</small></div><span class="panel-icon">i</span></div><div class="list-stack">' +
      '<article class="list-row"><span class="list-row-icon">1</span><div class="list-row-main"><strong>Authentication</strong><p>Private endpoints require an authenticated Supabase user. Keep passwords and provider keys in server-side settings only.</p></div></article>' +
      '<article class="list-row"><span class="list-row-icon">2</span><div class="list-row-main"><strong>Inference</strong><p>Model routing configuration is not evidence of live successful inference. A failed provider call should remain visible.</p></div></article>' +
      '<article class="list-row"><span class="list-row-icon">3</span><div class="list-row-main"><strong>External tools</strong><p>Integration cards are capability/readiness data. Do not treat configured endpoints as verified or enable unattended consequential actions.</p></div></article>' +
      '<article class="list-row"><span class="list-row-icon">4</span><div class="list-row-main"><strong>Local device access</strong><p>A hosted API cannot directly control a PC microphone or local desktop without a paired, authenticated companion.</p></div></article></div></section>';
  }
  function renderSystem() {
    const health = state.health || {};
    const components = state.readiness && Array.isArray(state.readiness.components) ? state.readiness.components : [];
    return pageHead("OBSERVABILITY / DIAGNOSTICS", "System health", "Inspect returned service and capability readiness data. No secret values are displayed and no upstream work is performed by this page itself.", '<button class="button button-primary" data-action="refresh-status">Refresh diagnostics ↻</button>') +
      '<div class="three-col"><article class="panel panel-pad"><div class="panel-title"><strong>API health</strong><small>/api/health</small></div><div class="metric-value">' + esc(health.status || "UNVERIFIED") + '</div><div class="section-gap">' + chip(health.status || "UNVERIFIED") + '</div></article>' +
      '<article class="panel panel-pad"><div class="panel-title"><strong>Authentication</strong><small>/api/session</small></div><div class="metric-value">' + (signedIn() ? "SUPABASE" : hasSession() ? "SESSION" : "GUEST") + '</div><p class="microcopy">' + esc(state.session.email || "No signed-in account returned") + '</p></article>' +
      '<article class="panel panel-pad"><div class="panel-title"><strong>Worker status</strong><small>Account-gated status route</small></div><div class="metric-value">' + esc(state.worker && state.worker.state || "NOT LOADED") + '</div><p class="microcopy">Queued-task execution needs live verification with a working worker and provider.</p></article></div>' +
      '<section class="panel panel-pad section-gap"><div class="panel-head"><div class="panel-title"><strong>Capability readiness</strong><small>Configured does not equal live-verified</small></div>' + chip(components.length ? "RESPONSE RECEIVED" : "NOT LOADED") + '</div>' +
      (components.length ? '<div class="list-stack">' + components.map(item => '<article class="list-row"><span class="list-row-icon">⌬</span><div class="list-row-main"><strong>' + esc(item.label || item.name || item.id || "Capability") + '</strong><p>' + esc(item.note || item.detail || item.description || "No status detail provided.") + '</p></div>' + chip(item.state || "UNKNOWN") + '</article>').join("") + '</div>' : signedIn() ? emptyState("⌬", "No readiness components returned", "The readiness route may be unavailable or return a different schema.") : gate("Sign in for detailed readiness", "Detailed runtime readiness is available to authenticated Supabase accounts.")) +
      '<pre class="code-output section-gap">' + plainText(JSON.stringify({ health: health, worker: state.worker, session: { authenticated: state.session.authenticated, authType: state.session.authType }, capabilities: state.caps }, null, 2)) + '</pre>';
  }
  function renderSettings() {
    return pageHead("OPERATOR PREFERENCES", "Settings", "Save account preferences to the backend. Provider credentials are intentionally not editable or exposed in the browser.", "") +
      (signedIn() ? '<div class="two-col"><section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Behavior</strong><small>Stored per Supabase account</small></div><span class="panel-icon">⚙</span></div>' +
      '<form class="form-stack" data-form="settings"><label for="pref-locale">Voice input locale</label><select id="pref-locale" name="voice_input_locale">' +
      ['en-IN','hi-IN','en-US','en-GB'].map(locale => '<option value="' + locale + '"' + (state.preferences.voice_input_locale === locale ? " selected" : "") + '>' + locale + '</option>').join("") +
      '</select><div class="preference-row"><div><strong>Voice enabled</strong><small>Store your preference for voice features.</small></div><label class="switch"><input type="checkbox" name="voice_enabled"' + (state.preferences.voice_enabled !== false ? " checked" : "") + '><span></span></label></div>' +
      '<div class="preference-row"><div><strong>Personal memory retrieval</strong><small>Allow eligible saved memories to inform chat when relevant.</small></div><label class="switch"><input type="checkbox" name="memory_enabled"' + (state.preferences.memory_enabled !== false ? " checked" : "") + '><span></span></label></div>' +
      '<div class="form-actions"><button class="button button-primary" type="submit">Save preferences ↗</button></div></form></section>' +
      '<section class="panel panel-pad"><div class="panel-head"><div class="panel-title"><strong>Session & local interface</strong><small>Current browser session</small></div><span class="panel-icon">⛨</span></div>' +
      '<div class="preference-row"><div><strong>Account</strong><small>' + esc(state.session.email || "Authenticated session") + '</small></div>' + chip("SIGNED IN") + '</div>' +
      '<div class="preference-row"><div><strong>Chat personality</strong><small>Choose ULTRON or NAYA in the AI terminal.</small></div><button class="button button-small" data-view="chat">Open terminal</button></div>' +
      '<div class="preference-row"><div><strong>Sidebar layout</strong><small>Collapse navigation to maximize workspace.</small></div><button class="button button-small" data-action="toggle-sidebar">Toggle sidebar</button></div>' +
      '<div class="preference-row"><div><strong>Sign out</strong><small>Clear the server session and cookies.</small></div><button class="button button-small button-danger" data-action="signout">Sign out</button></div></section></div>' :
      '<div class="panel panel-pad">' + gate("Preferences require sign-in", "Sign in to load and save account-scoped preferences.") + '<div class="form-actions"><button class="button button-primary" data-action="open-auth">Sign in / create account ↗</button></div></div>');
  }

  const RENDERERS = {
    home: renderHome, chat: renderChat, tasks: renderTasks, research: renderResearch, coding: renderCoding,
    vision: renderVision, voice: renderVoice, files: renderFiles, memory: renderMemory, automation: renderAutomation,
    integrations: renderIntegrations, security: renderSecurity, system: renderSystem, settings: renderSettings
  };
  function renderCurrent() {
    const root = $("#view-root");
    if (!root) return;
    root.innerHTML = (RENDERERS[state.view] || renderHome)();
    if (state.view === "vision" && state.cameraStream) {
      const preview = $("#vision-preview");
      if (preview) {
        preview.srcObject = state.cameraStream;
        preview.play().catch(() => {});
      }
    }
    const meta = VIEWS[state.view] || VIEWS.home;
    if ($("#breadcrumb-current")) $("#breadcrumb-current").textContent = meta[0];
    $$("[data-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.view === state.view);
      button.classList.toggle("is-active", button.dataset.view === state.view);
    });
    if (state.view === "chat") {
      const messages = $("#chat-messages");
      if (messages) messages.scrollTop = messages.scrollHeight;
    }
  }
  async function navigate(view) {
    if (!RENDERERS[view]) view = "home";
    if (state.view === "vision" && view !== "vision") stopCamera();
    state.view = view;
    closeMobileNav();
    renderCurrent();
    try { await loadViewData(view); } catch (error) { toast(error.message || "Workspace data could not load.", "error"); }
    if (state.view === view) renderCurrent();
  }
  async function loadViewData(view) {
    if (view === "home" || view === "system" || view === "security") {
      if (!state.health) await refreshStatus(true);
      if (signedIn() && !state.readiness) {
        const data = await maybe("/api/runtime/readiness");
        state.readiness = data.ok ? data.data : null;
      }
    }
    if (view === "chat") {
      if (hasSession()) {
        try {
          const data = await api("/api/models");
          const source = Array.isArray(data.models) ? data.models : Array.isArray(data.data) ? data.data : [];
          state.models = source.map(item => typeof item === "string" ? { id: item, label: item } : { id: item.id || item.model || item.name, label: item.name || item.id || item.model || "Model" }).filter(item => item.id);
          if (!state.models.some(item => item.id === "openrouter/free")) state.models.unshift({ id: "openrouter/free", label: "Automatic free router" });
          if (!state.models.some(item => item.id === state.model)) state.model = data.defaultModel || "openrouter/free";
        } catch { state.models = [{ id: "openrouter/free", label: "Automatic free router" }]; }
      }
      if (signedIn()) await loadConversations();
    }
    if (view === "tasks") await loadTasks();
    if (view === "memory") await loadMemories();
    if (view === "files") { await loadSavedDocuments(); }
    if (view === "integrations") await loadIntegrations();
    if (view === "automation") await loadSchedules();
    if (view === "settings" && signedIn()) await loadPreferences();
  }
  async function loadConversations() {
    if (!signedIn()) { state.conversations = []; return; }
    try {
      const data = await api("/api/conversations");
      state.conversations = Array.isArray(data.conversations) ? data.conversations : [];
    } catch (error) { toast("Conversation history could not load: " + error.message, "error"); }
  }
  async function loadConversation(id) {
    if (!signedIn()) return;
    try {
      const data = await api("/api/conversations/" + encodeURIComponent(id) + "/messages");
      state.conversationId = id;
      state.messages = (Array.isArray(data.messages) ? data.messages : []).map(message => ({ role: message.role, content: message.content, time: displayDate(message.created_at), model: message.model || "" }));
      renderCurrent();
    } catch (error) { toast("Could not load conversation: " + error.message, "error"); }
  }
  async function ensureConversation(title) {
    if (!signedIn()) return null;
    if (state.conversationId) return state.conversationId;
    const data = await api("/api/conversations", { method: "POST", body: { title: String(title || "New conversation").slice(0, 160) } });
    if (!data.conversation || !data.conversation.id) throw new Error("The API did not return a conversation ID.");
    state.conversationId = data.conversation.id;
    await loadConversations();
    return state.conversationId;
  }
  async function saveMessage(id, role, content) {
    if (!signedIn() || !id || !content) return;
    await api("/api/conversations/" + encodeURIComponent(id) + "/messages", { method: "POST", body: { role: role, content: String(content).slice(0, 100000) } });
  }
  async function sendChat(rawPrompt, options = {}) {
    const prompt = String(rawPrompt || "").trim();
    const preserveAttachments = options.preserveAttachments === true;
    const attachments = Array.isArray(options.attachments) ? options.attachments.slice(0, 2) : state.attachments.slice(0, 2);
    if (!prompt && !attachments.length) return null;
    if (!hasSession()) { toast("Sign in to send a chat request.", "error"); openAuth("signin"); return null; }
    if (state.busy) return null;
    if (!preserveAttachments) state.attachments = [];
    let completedAnswer = null;
    state.messages.push({ role: "user", content: prompt, time: "NOW", attachments: attachments.map(file => ({ name: file.name })) });
    const assistant = { role: "assistant", content: "", streaming: true, time: "LIVE STREAM", model: state.model };
    state.messages.push(assistant);
    state.busy = true;
    setCore("thinking", "MODEL REQUEST IN PROGRESS");
    renderCurrent();
    try {
      if (signedIn()) {
        try {
          const id = await ensureConversation(prompt.slice(0, 160) || "Image analysis");
          await saveMessage(id, "user", prompt || "Please analyze the attached image.");
        } catch (error) { toast("Chat is running but conversation persistence is unavailable: " + error.message, "error"); }
      }
      const messages = state.messages.filter(item => (item.role === "user" || item.role === "assistant") && item !== assistant).slice(-35).map(item => ({ role: item.role, content: item.content || "" }));
      const controller = new AbortController();
      state.controller = controller;
      const response = await fetch("/api/chat", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream, application/json" },
        body: JSON.stringify({ messages: messages, stream: true, model: state.model || "openrouter/free", persona: state.persona, attachments: attachments.map(file => ({ dataUrl: file.dataUrl })) }),
        signal: controller.signal
      });
      if (!response.ok) {
        const data = await readPayload(response);
        throw new Error(data && data.error && data.error.message || "Chat request failed (" + response.status + ").");
      }
      if (!response.body || !response.body.getReader) throw new Error("This browser could not read the response stream.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let complete = false;
      async function processBlock(block) {
        let eventName = "message";
        const dataLines = [];
        block.split(/\r?\n/).forEach(line => {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        });
        if (!dataLines.length) return;
        const raw = dataLines.join("\n");
        if (eventName === "done" || raw === "[DONE]") { complete = true; return; }
        if (eventName === "provider_error") {
          let data = {};
          try { data = JSON.parse(raw); } catch {}
          throw new Error(data.error && data.error.message || "The provider interrupted the response.");
        }
        let data;
        try { data = JSON.parse(raw); } catch { return; }
        if (typeof data.delta === "string") {
          answer += data.delta;
          assistant.content = answer;
          assistant.streaming = true;
          assistant.model = response.headers.get("X-ULTRON-Model") || state.model;
          state.lastAnswer = answer;
          setCore("responding", "RESPONSE STREAMING");
          const target = $("#chat-messages");
          if (target) { target.innerHTML = renderChatMessages(); target.scrollTop = target.scrollHeight; }
          const live = $("#chat-live-status");
          if (live) live.textContent = "Response streaming…";
        }
      }
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";
        for (const block of blocks) await processBlock(block);
      }
      buffer += decoder.decode();
      if (buffer.trim()) await processBlock(buffer);
      assistant.streaming = false;
      if (!answer) throw new Error("The provider finished without returning a text response.");
      state.lastAnswer = answer;
      completedAnswer = answer;
      setCore("success", "MODEL RESPONSE RECEIVED");
      if (signedIn() && state.conversationId) {
        try { await saveMessage(state.conversationId, "assistant", answer); }
        catch { toast("Response received, but it could not be saved to conversation history.", "error"); }
      }
    } catch (error) {
      assistant.streaming = false;
      assistant.content = (error && error.name === "AbortError") ? "Response cancelled by operator." : "Request failed: " + String(error.message || error);
      setCore("error", "MODEL REQUEST FAILED");
    } finally {
      state.busy = false;
      state.controller = null;
      if (!preserveAttachments) state.attachments = [];
      renderCurrent();
      if ($("#chat-live-status")) $("#chat-live-status").textContent = "Awaiting operator input";
      if (state.coreState === "error") toast(assistant.content, "error");
    }
    return completedAnswer;
  }
  async function loadTasks() {
    if (!signedIn()) { state.tasks = []; state.tasksError = "Sign in with Supabase to read private task records."; return; }
    try { const data = await api("/api/tasks"); state.tasks = Array.isArray(data.tasks) ? data.tasks : []; state.tasksError = ""; }
    catch (error) { state.tasks = []; state.tasksError = error.message; }
  }
  async function createTask(form) {
    if (!signedIn()) { openAuth("signin"); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { title: String(values.title || "").trim(), description: String(values.description || "").trim(), query: String(values.query || "").trim(), taskType: values.taskType || "research", risk: values.risk || "low" };
    if (body.taskType === "autonomous") { body.role = "chief-of-staff"; body.goal = body.description; body.mode = "report"; }
    if (!body.title || !body.description) { toast("Enter a title and description.", "error"); return; }
    try {
      const data = await api("/api/tasks", { method: "POST", body: body });
      toast(data.notice || "Task record saved.", "success");
      await loadTasks();
      renderCurrent();
    } catch (error) { toast(error.message || "Task could not be created.", "error"); }
  }
  async function taskAction(action, id) {
    if (!signedIn()) { openAuth("signin"); return; }
    const task = state.tasks.find(item => item.id === id);
    if (!task) { toast("Task not found. Refresh the ledger first.", "error"); return; }
    try {
      if (action === "approve-task") {
        if (!window.confirm("Approve this saved task? Approval only queues supported bounded workflows.\n\n" + String(task.title || id).slice(0, 160))) return;
        const data = await api("/api/tasks/" + encodeURIComponent(id) + "/approve", { method: "POST", body: { confirm: true } });
        toast(data.notice || "Approval recorded by the backend.", "success");
      } else if (action === "cancel-task") {
        if (!window.confirm("Cancel this queued task?")) return;
        await api("/api/tasks/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: {} });
        toast("Cancellation requested.", "success");
      } else if (action === "task-progress") {
        state.taskProgress = await api("/api/tasks/" + encodeURIComponent(id) + "/progress");
      }
      await loadTasks();
      renderCurrent();
    } catch (error) { toast(error.message || "Task action failed.", "error"); }
  }
  async function loadMemories() {
    if (!signedIn()) { state.memories = []; state.memoryError = "Sign in to access private memory."; return; }
    try { const data = await api("/api/memory"); state.memories = Array.isArray(data.items) ? data.items : []; state.memoryError = ""; }
    catch (error) { state.memories = []; state.memoryError = error.message; }
  }
  async function memoryAction(action, id, button) {
    if (!signedIn()) { openAuth("signin"); return; }
    const item = state.memories.find(entry => entry.id === id);
    if (!item) return;
    try {
      if (action === "delete-memory") {
        if (!window.confirm("Delete this memory permanently?\n\n" + String(item.title || "").slice(0, 180))) return;
        await api("/api/memory/" + encodeURIComponent(id), { method: "DELETE" });
      } else {
        await api("/api/memory/" + encodeURIComponent(id), { method: "PATCH", body: { is_active: button && button.dataset.active !== "true" } });
      }
      await loadMemories();
      renderCurrent();
      toast(action === "delete-memory" ? "Memory deleted." : "Memory state updated.", "success");
    } catch (error) { toast(error.message || "Memory action failed.", "error"); }
  }
  async function loadSavedDocuments() {
    if (!signedIn()) { state.savedDocuments = []; state.savedDocumentsError = "Sign in with Supabase to access private files."; return; }
    try { const data = await api("/api/documents"); state.savedDocuments = Array.isArray(data.documents) ? data.documents : []; state.savedDocumentsError = ""; }
    catch (error) { state.savedDocuments = []; state.savedDocumentsError = error.message + " — private document storage may need its migration applied."; }
  }
  async function loadIntegrations() {
    if (!hasSession()) { state.integrations = []; state.integrationError = "Sign in to request integration readiness."; return; }
    try { const data = await api("/api/integrations"); state.integrations = Array.isArray(data.integrations) ? data.integrations : []; state.integrationError = ""; }
    catch (error) { state.integrations = []; state.integrationError = error.message; }
  }
  async function loadSchedules() {
    if (!signedIn()) { state.schedules = []; state.scheduleError = "Sign in to read private schedules."; return; }
    try {
      const results = await Promise.all([api("/api/employees/schedules"), api("/api/employees/status"), api("/api/employees/roles")]);
      state.schedules = Array.isArray(results[0].schedules) ? results[0].schedules : [];
      state.employeeStatus = results[1];
      state.roles = Array.isArray(results[2].roles) ? results[2].roles : [];
      state.routines = Array.isArray(results[2].routineTemplates) ? results[2].routineTemplates : [];
      state.scheduleError = "";
    } catch (error) { state.schedules = []; state.scheduleError = error.message; }
  }
  async function loadPreferences() {
    if (!signedIn()) return;
    try { const data = await api("/api/preferences"); if (data.preferences) state.preferences = Object.assign(state.preferences, data.preferences); }
    catch (error) { toast("Preferences not loaded: " + error.message, "error"); }
  }
  async function savePreferences(form) {
    if (!signedIn()) { openAuth("signin"); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const body = {
      voice_input_locale: values.voice_input_locale || state.preferences.voice_input_locale || "en-IN",
      voice_enabled: values.voice_enabled === "on",
      memory_enabled: values.memory_enabled === "on"
    };
    try {
      const data = await api("/api/preferences", { method: "PUT", body: body });
      state.preferences = Object.assign(state.preferences, data.preferences || body);
      toast("Preferences saved to your account.", "success");
      renderCurrent();
    } catch (error) { toast("Preference update failed: " + error.message, "error"); }
  }
  async function submitResearch(form) {
    if (!hasSession()) { openAuth("signin"); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const query = String(values.query || "").trim();
    if (query.length < 2) return;
    state.research = null; state.researchError = "";
    renderCurrent(); setCore("thinking", "RESEARCH REQUEST IN PROGRESS");
    try {
      state.research = await api("/api/research", { method: "POST", body: { query: query } });
      setCore("success", "RESEARCH RESPONSE RECEIVED");
    } catch (error) { state.researchError = error.message; setCore("error", "RESEARCH REQUEST FAILED"); }
    renderCurrent();
  }
  async function submitCoding(form) {
    if (!hasSession()) { openAuth("signin"); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { task: String(values.task || "").trim(), mode: values.mode || "plan", language: String(values.language || "unspecified"), code: String(values.code || "") };
    if (!body.task) return;
    state.coding = null; state.codingError = ""; renderCurrent(); setCore("thinking", "CODING REQUEST IN PROGRESS");
    try { state.coding = await api("/api/coding/assist", { method: "POST", body: body }); setCore("success", "CODING RESPONSE RECEIVED"); }
    catch (error) { state.codingError = error.message; setCore("error", "CODING REQUEST FAILED"); }
    renderCurrent();
  }
  async function submitSchedule(form) {
    if (!signedIn()) { openAuth("signin"); return; }
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { role: values.role, routineId: values.routineId, goal: String(values.goal || "").trim(), context: String(values.context || "").trim(), intervalMinutes: Number(values.intervalMinutes) };
    if (!body.routineId) { toast("Choose a routine before saving.", "error"); return; }
    try {
      const data = await api("/api/employees/schedules", { method: "POST", body: body });
      toast(data.notice || "Schedule saved. Actual execution still depends on worker readiness.", "success");
      await loadSchedules(); renderCurrent();
    } catch (error) { toast(error.message || "Schedule could not be saved.", "error"); }
  }
  async function scheduleAction(action, id, button) {
    if (!signedIn()) { openAuth("signin"); return; }
    try {
      if (action === "toggle-schedule") await api("/api/employees/schedules/" + encodeURIComponent(id), { method: "PATCH", body: { enabled: button.dataset.enabled !== "true" } });
      else if (action === "delete-schedule") {
        if (!window.confirm("Delete this schedule? Existing task records remain.")) return;
        await api("/api/employees/schedules/" + encodeURIComponent(id), { method: "DELETE" });
      } else {
        if (!window.confirm("Queue a bounded draft/report now? This does not perform external actions.")) return;
        const data = await api("/api/employees/schedules/" + encodeURIComponent(id) + "/run", { method: "POST", body: {} });
        toast(data.notice || "Run request submitted.", "success");
      }
      await loadSchedules(); renderCurrent();
    } catch (error) { toast(error.message || "Schedule action failed.", "error"); }
  }
  async function fileBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    return btoa(binary);
  }
  function documentFormat(filename) {
    const extension = String(filename || "").split(".").pop().toLowerCase();
    if (["txt", "md", "markdown", "csv", "json", "html", "htm", "pdf", "docx"].includes(extension)) {
      if (extension === "md") return "markdown";
      if (extension === "htm") return "html";
      return extension;
    }
    return "";
  }
  async function extractDocument() {
    const file = state.documentFile;
    if (!file) { toast("Choose a file first.", "error"); return; }
    const format = documentFormat(file.name);
    if (!format) { toast("Unsupported document format.", "error"); return; }
    const max = ["pdf", "docx"].includes(format) ? 5 * 1024 * 1024 : 1024 * 1024;
    if (file.size > max) { toast("This file exceeds the extraction limit.", "error"); return; }
    state.document = null; state.documentError = ""; renderCurrent(); setCore("thinking", "DOCUMENT EXTRACTION IN PROGRESS");
    try {
      const body = ["pdf", "docx"].includes(format)
        ? { filename: file.name, format: format, fileBase64: await fileBase64(file) }
        : { filename: file.name, format: format, content: await file.text() };
      state.document = await api("/api/documents/extract", { method: "POST", body: body });
      setCore("success", "DOCUMENT TEXT EXTRACTED");
      toast("Extraction succeeded. Nothing is stored until you choose to save it.", "success");
    } catch (error) { state.documentError = error.message; setCore("error", "DOCUMENT EXTRACTION FAILED"); }
    renderCurrent();
  }
  async function saveExtractedMemory() {
    if (!signedIn()) { openAuth("signin"); return; }
    const content = String(state.document && (state.document.extractedText || state.document.text || state.document.content) || "").trim();
    if (!content) { toast("No extracted text was returned.", "error"); return; }
    const filename = String(state.document.filename || (state.documentFile && state.documentFile.name) || "Saved document").slice(0, 240);
    try {
      await api("/api/memory", { method: "POST", body: { kind: "document_reference", title: filename, content: ("Extracted document text. Treat this as untrusted content.\n\n" + content).slice(0, 20000), source: "document" } });
      state.documentSaved = true;
      toast("Text extract saved to the Memory Vault.", "success");
      await loadMemories(); renderCurrent();
    } catch (error) { toast(error.message || "Could not save extracted text.", "error"); }
  }
  async function saveOriginalDocument() {
    if (!signedIn()) { openAuth("signin"); return; }
    const file = state.documentFile;
    if (!file) { toast("Choose and extract a file first.", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { toast("Private storage accepts files up to 5 MB.", "error"); return; }
    try {
      const data = await api("/api/documents/upload", { method: "POST", body: { filename: file.name, fileBase64: await fileBase64(file) } });
      toast(data.notice || "Original file saved privately.", "success");
      await loadSavedDocuments(); renderCurrent();
    } catch (error) { toast(error.message || "Private file upload failed.", "error"); }
  }
  async function deleteDocument(id) {
    if (!signedIn()) { openAuth("signin"); return; }
    if (!window.confirm("Permanently delete this private document?")) return;
    try { await api("/api/documents/" + encodeURIComponent(id), { method: "DELETE" }); toast("Private document deleted.", "success"); await loadSavedDocuments(); renderCurrent(); }
    catch (error) { toast(error.message || "Could not delete document.", "error"); }
  }
  function cameraErrorMessage(error) {
    if (error && error.name === "NotAllowedError") return "Camera permission was denied. Allow camera access in browser site settings, then retry.";
    if (error && error.name === "NotFoundError") return "No camera was found on this device.";
    if (error && error.name === "NotReadableError") return "The camera could not be opened. Check whether another application is using it.";
    return "The camera could not start. Check browser support, site permissions, and device availability.";
  }
  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      state.cameraError = "Camera access requires a supported browser and HTTPS or trusted localhost.";
      renderCurrent();
      return;
    }
    if (state.cameraStream || state.cameraPending) return;
    const requestId = ++state.cameraRequestId;
    state.cameraPending = true;
    state.cameraError = "";
    state.cameraNotice = "Requesting camera permission. No frames are sent while the preview is idle.";
    renderCurrent();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 640, max: 640 },
          height: { ideal: 360, max: 360 }
        }
      });
      if (requestId !== state.cameraRequestId) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      state.cameraPending = false;
      state.cameraStream = stream;
      state.cameraError = "";
      state.cameraNotice = "Camera preview is active. No frames are sent unless you choose one-shot analysis or start continuous summaries.";
      stream.getVideoTracks().forEach(track => track.addEventListener("ended", () => {
        if (state.cameraStream === stream) {
          stopCamera();
          if (state.view === "vision") renderCurrent();
        }
      }, { once: true }));
      renderCurrent();
      const preview = $("#vision-preview");
      if (preview) {
        preview.srcObject = stream;
        preview.play().catch(() => {
          if (state.cameraStream === stream) {
            state.cameraNotice = "Camera is connected, but preview playback was blocked by the browser. Check site permissions and retry.";
            if (state.view === "vision") renderCurrent();
          }
        });
      }
    } catch (error) {
      if (requestId !== state.cameraRequestId) return;
      const message = cameraErrorMessage(error);
      stopCamera();
      state.cameraError = message;
      state.cameraNotice = "Camera is off. No frames are being captured.";
      renderCurrent();
      toast(message, "error");
    }
  }
  function stopContinuousCameraAnalysis(updateNotice = true) {
    state.cameraContinuous = false;
    state.cameraRunId += 1;
    if (state.cameraTimer !== null) window.clearTimeout(state.cameraTimer);
    state.cameraTimer = null;
    state.cameraContinuousStartedAt = 0;
    if (updateNotice) state.cameraNotice = "Continuous scene summaries are stopped. No more frames will be sampled.";
  }
  function stopCamera() {
    state.cameraRequestId += 1;
    state.cameraPending = false;
    stopContinuousCameraAnalysis(false);
    state.cameraContinuousConsent = false;
    const stream = state.cameraStream;
    state.cameraStream = null;
    if (stream) stream.getTracks().forEach(track => {
      try { track.stop(); } catch {}
    });
    const preview = $("#vision-preview");
    if (preview) {
      try { preview.pause(); } catch {}
      preview.srcObject = null;
    }
    state.cameraNotice = "Camera is off. No frames are being captured.";
  }
  function captureCameraFrame() {
    const preview = $("#vision-preview");
    if (!state.cameraStream || !preview || preview.readyState < 2 || !preview.videoWidth || !preview.videoHeight) {
      throw new Error("The camera preview is not ready yet. Wait for the image to appear, then retry.");
    }
    const sourceWidth = preview.videoWidth;
    const sourceHeight = preview.videoHeight;
    const scale = Math.min(1, 640 / sourceWidth, 360 / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The browser could not prepare a camera still frame.");
    context.drawImage(preview, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.55);
    if (!dataUrl.startsWith("data:image/jpeg;base64,") || dataUrl.length > 750_000) {
      throw new Error("This camera frame exceeds the safe upload size limit. Retry or adjust the camera scene.");
    }
    return { name: "camera-frame.jpg", dataUrl };
  }
  async function analyzeCameraFrame() {
    if (!state.cameraStream) throw new Error("Start the camera before requesting a frame analysis.");
    if (state.busy) { toast("ULTRON is already processing a request. Wait for it to finish before analyzing a frame.", "error"); return; }
    const frame = captureCameraFrame();
    state.cameraNotice = "Sending one still frame to the configured AI model. The camera itself is not recorded.";
    renderCurrent();
    const answer = await sendChat(
      "Analyze this camera still. Describe visible objects, the scene, and any readable text. Separate observations from uncertainty and do not identify people.",
      { attachments: [frame], preserveAttachments: true }
    );
    if (answer) {
      state.cameraSummaries.unshift({ at: new Date().toISOString(), text: answer });
      state.cameraSummaries = state.cameraSummaries.slice(0, 8);
      state.cameraNotice = "One frame was analyzed. The image is not stored as a recording; response text may be saved to signed-in conversation history.";
    } else {
      state.cameraNotice = "The frame was not successfully analyzed. Review the response/error in the AI terminal and check vision-provider readiness.";
    }
    if (state.view === "vision") renderCurrent();
  }
  function scheduleContinuousCameraSummary(runId) {
    if (!state.cameraContinuous || !state.cameraStream || runId !== state.cameraRunId) return;
    state.cameraTimer = window.setTimeout(async () => {
      state.cameraTimer = null;
      if (!state.cameraContinuous || !state.cameraStream || runId !== state.cameraRunId) return;
      if (Date.now() - state.cameraContinuousStartedAt >= 30 * 60 * 1000) {
        stopContinuousCameraAnalysis(false);
        state.cameraNotice = "Continuous summaries stopped at the 30-minute session limit.";
        if (state.view === "vision") renderCurrent();
        return;
      }
      if (!state.busy) {
        try {
          const frame = captureCameraFrame();
          state.cameraNotice = "Sending one low-resolution still frame to the configured AI model.";
          const answer = await sendChat(
            "Describe the current camera still in 1–3 concise sentences. Mention only visible evidence and clearly state uncertainty.",
            { attachments: [frame], preserveAttachments: true }
          );
          const samplingStillActive = state.cameraContinuous && Boolean(state.cameraStream) && runId === state.cameraRunId;
          if (answer) {
            state.cameraSummaries.unshift({ at: new Date().toISOString(), text: answer });
            state.cameraSummaries = state.cameraSummaries.slice(0, 8);
            state.cameraNotice = samplingStillActive
              ? "Latest frame analyzed. Continuous sampling remains active until you stop it or the 30-minute limit is reached."
              : "The in-flight frame finished after sampling stopped. No further frames will be sent.";
          } else {
            state.cameraNotice = samplingStillActive
              ? "The latest frame did not produce a verified description. Check chat errors and vision-provider readiness."
              : "Sampling has stopped. No further frames will be sent; the in-flight request produced no description.";
          }
        } catch (error) {
          const samplingStillActive = state.cameraContinuous && Boolean(state.cameraStream) && runId === state.cameraRunId;
          state.cameraNotice = samplingStillActive
            ? (error.message || "The latest frame could not be analyzed.")
            : "Sampling has stopped. No further frames will be sent; the in-flight request failed.";
        }
      } else {
        state.cameraNotice = "Sample skipped because another chat request is active.";
      }
      if (state.view === "vision") renderCurrent();
      if (state.cameraContinuous && state.cameraStream && runId === state.cameraRunId) scheduleContinuousCameraSummary(runId);
    }, Math.max(15, Math.min(60, Number(state.cameraIntervalSeconds) || 15)) * 1000);
  }
  function startContinuousCameraAnalysis() {
    if (!state.cameraStream) { toast("Start the camera before enabling continuous summaries.", "error"); return; }
    if (!state.cameraContinuousConsent) { toast("Enable the explicit continuous-frame consent checkbox first.", "error"); return; }
    if (!hasSession()) { state.cameraNotice = "Sign in before sending continuous camera frames to the AI model."; openAuth("signin"); renderCurrent(); return; }
    if (state.cameraContinuous) return;
    state.cameraContinuous = true;
    state.cameraContinuousStartedAt = Date.now();
    const runId = ++state.cameraRunId;
    state.cameraNotice = "Continuous summaries are active. One still frame will be sampled per interval; maximum session length is 30 minutes.";
    scheduleContinuousCameraSummary(runId);
    renderCurrent();
  }

  function startVoice() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { toast("Speech recognition is not supported by this browser.", "error"); return; }
    if (state.recognition) { try { state.recognition.stop(); } catch {} }
    const recognition = new Recognition();
    recognition.lang = state.preferences.voice_input_locale || "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = event => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) text += event.results[i][0].transcript;
      state.voiceText = text;
      if ($("#voice-text")) $("#voice-text").value = text;
    };
    recognition.onerror = event => { state.voiceActive = false; toast("Speech recognition issue: " + (event.error || "unknown error"), "error"); renderCurrent(); };
    recognition.onend = () => { state.voiceActive = false; state.recognition = null; renderCurrent(); };
    try { state.recognition = recognition; state.voiceActive = true; recognition.start(); renderCurrent(); }
    catch (error) { state.voiceActive = false; toast("Could not start microphone: " + error.message, "error"); renderCurrent(); }
  }
  function stopVoice() {
    if (state.recognition) { try { state.recognition.stop(); } catch {} }
    state.voiceActive = false; state.recognition = null; renderCurrent();
  }
  function speakLast() {
    if (!window.speechSynthesis) { toast("Text-to-speech is not available in this browser.", "error"); return; }
    const text = String(state.lastAnswer || state.messages.slice().reverse().find(item => item.role === "assistant" && item.content)?.content || "");
    if (!text) { toast("There is no assistant answer to read yet.", "info"); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
    utterance.lang = state.preferences.voice_input_locale || "en-IN";
    window.speechSynthesis.speak(utterance);
  }
  async function authenticate(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email || "").trim();
    const password = String(values.password || "");
    const errorBox = $("#auth-error");
    if (errorBox) { errorBox.hidden = true; errorBox.textContent = ""; }
    const submit = $("#auth-submit");
    if (submit) { submit.disabled = true; submit.textContent = "Please wait…"; }
    try {
      if (state.authMode === "signin") {
        await api("/api/auth/signin", { method: "POST", body: { email: email, password: password } });
        toast("Signed in successfully.", "success");
      } else if (state.authMode === "signup") {
        const result = await api("/api/auth/signup", { method: "POST", body: { email: email, password: password } });
        if (result.confirmationRequired) { toast(result.message || "Check your email to confirm your account.", "info"); state.authMode = "signin"; updateAuthMode(); return; }
        toast("Account created.", "success");
      } else {
        const result = await api("/api/auth/recovery", { method: "POST", body: { email: email } });
        toast(result.message || "If the account exists, recovery instructions were sent.", "success");
        closeAuth(); return;
      }
      await refreshStatus(true);
      closeAuth();
      await navigate(state.view);
    } catch (error) {
      if (errorBox) { errorBox.textContent = error.message || "Authentication failed."; errorBox.hidden = false; }
    } finally {
      if (submit) { submit.disabled = false; updateAuthMode(); }
    }
  }
  async function signOut() {
    try {
      await api("/api/auth/signout", { method: "POST", body: {} });
      await api("/api/logout", { method: "POST", body: {} }).catch(() => ({}));
      state.session = { authenticated: false, configured: state.session.configured, authType: null, email: null };
      state.messages = []; state.conversationId = null; state.conversations = [];
      state.tasks = []; state.memories = []; state.schedules = [];
      await refreshStatus(true);
      toast("Signed out.", "success");
      await navigate("home");
    } catch (error) { toast("Sign out issue: " + error.message, "error"); }
  }
  function closeMobileNav() {
    const sidebar = $("#sidebar"); const scrim = $("#mobile-scrim");
    if (sidebar) sidebar.classList.remove("mobile-open");
    if (scrim) scrim.classList.remove("show");
  }
  function toggleMobileNav() {
    const sidebar = $("#sidebar"); const scrim = $("#mobile-scrim");
    if (!sidebar || !scrim) return;
    const open = !sidebar.classList.contains("mobile-open");
    sidebar.classList.toggle("mobile-open", open);
    scrim.classList.toggle("show", open);
  }
  function toggleSidebar() {
    if (window.matchMedia("(max-width: 1020px)").matches) { toggleMobileNav(); return; }
    state.sidebarCollapsed = !state.sidebarCollapsed;
    $("#sidebar").classList.toggle("collapsed", state.sidebarCollapsed);
  }
  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, dataUrl: String(reader.result || "") });
      reader.onerror = () => reject(new Error("Could not read image file."));
      reader.readAsDataURL(file);
    });
  }

  document.addEventListener("click", async event => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) { event.preventDefault(); await navigate(viewButton.dataset.view); return; }
    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton) {
      const input = $("#home-prompt");
      if (input) { input.value = promptButton.dataset.prompt || ""; input.focus(); }
      else { await navigate("home"); if ($("#home-prompt")) { $("#home-prompt").value = promptButton.dataset.prompt || ""; $("#home-prompt").focus(); } }
      return;
    }
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) { const modal = $("#" + closeButton.dataset.closeModal); if (modal) modal.hidden = true; return; }
    const authTab = event.target.closest("[data-auth-mode]");
    if (authTab) { state.authMode = authTab.dataset.authMode; updateAuthMode(); return; }
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    try {
      if (action === "open-auth" || action === "account") openAuth("signin");
      else if (action === "refresh-status") await refreshStatus(false);
      else if (action === "new-chat") { if (state.controller) state.controller.abort(); state.messages = []; state.conversationId = null; state.busy = false; state.attachments = []; if (state.view !== "chat") await navigate("chat"); else renderCurrent(); }
      else if (action === "select-conversation") await loadConversation(button.dataset.id);
      else if (action === "attach-images") $("#image-input").click();
      else if (action === "clear-images") { state.attachments = []; renderCurrent(); }
      else if (action === "refresh-tasks") { await loadTasks(); renderCurrent(); }
      else if (action === "approve-task" || action === "cancel-task" || action === "task-progress") await taskAction(action, button.dataset.id);
      else if (action === "refresh-memory") { await loadMemories(); renderCurrent(); }
      else if (action === "delete-memory" || action === "toggle-memory") await memoryAction(action, button.dataset.id, button);
      else if (action === "choose-document") $("#document-input").click();
      else if (action === "extract-document") await extractDocument();
      else if (action === "clear-document") { state.document = null; state.documentError = ""; state.documentFile = null; renderCurrent(); }
      else if (action === "save-document-memory") await saveExtractedMemory();
      else if (action === "save-document-private") await saveOriginalDocument();
      else if (action === "refresh-documents") { await loadSavedDocuments(); renderCurrent(); }
      else if (action === "delete-document") await deleteDocument(button.dataset.id);
      else if (action === "refresh-integrations") { await loadIntegrations(); renderCurrent(); }
      else if (action === "refresh-automation") { await loadSchedules(); renderCurrent(); }
      else if (action === "toggle-schedule" || action === "run-schedule" || action === "delete-schedule") await scheduleAction(action, button.dataset.id, button);
      else if (action === "camera-start") await startCamera();
      else if (action === "camera-stop") { stopCamera(); renderCurrent(); }
      else if (action === "camera-analyze") await analyzeCameraFrame();
      else if (action === "camera-continuous-start") startContinuousCameraAnalysis();
      else if (action === "camera-continuous-stop") { stopContinuousCameraAnalysis(); renderCurrent(); }
      else if (action === "voice-toggle") state.voiceActive ? stopVoice() : startVoice();
      else if (action === "send-voice-text") { const text = $("#voice-text") ? $("#voice-text").value : state.voiceText; state.voiceText = text || ""; await navigate("chat"); await sendChat(state.voiceText); }
      else if (action === "speak-last") speakLast();
      else if (action === "signout") await signOut();
      else if (action === "toggle-sidebar") toggleSidebar();
    } catch (error) { toast(error.message || "Action failed.", "error"); }
  });

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!form.matches("form[data-form]")) return;
    event.preventDefault();
    const type = form.dataset.form;
    try {
      if (type === "home-chat") {
        const input = $("#home-prompt");
        const text = input ? input.value : "";
        if (input) input.value = "";
        await navigate("chat");
        await sendChat(text);
      } else if (type === "chat") {
        const input = $("#chat-input");
        const text = input ? input.value : "";
        if (input) input.value = "";
        await sendChat(text);
      } else if (type === "task-create") await createTask(form);
      else if (type === "research") await submitResearch(form);
      else if (type === "coding") await submitCoding(form);
      else if (type === "memory") {
        if (!signedIn()) { openAuth("signin"); return; }
        const values = Object.fromEntries(new FormData(form).entries());
        await api("/api/memory", { method: "POST", body: { kind: values.kind, title: String(values.title || "").trim(), content: String(values.content || "").trim() } });
        toast("Memory saved to your account.", "success"); form.reset(); await loadMemories(); renderCurrent();
      } else if (type === "schedule") await submitSchedule(form);
      else if (type === "settings") await savePreferences(form);
      else if (type === "auth") await authenticate(form);
    } catch (error) { toast(error.message || "Request failed.", "error"); }
  });
  $("#auth-form").addEventListener("submit", event => { event.preventDefault(); authenticate(event.currentTarget); });
  $("#account-trigger").addEventListener("click", () => signedIn() ? navigate("settings") : openAuth("signin"));
  $("#profile-trigger").addEventListener("click", () => signedIn() ? navigate("settings") : openAuth("signin"));
  $("#google-signin").addEventListener("click", () => { window.location.assign("/api/auth/google"); });
  $("#mobile-menu").addEventListener("click", toggleMobileNav);
  $("#mobile-scrim").addEventListener("click", closeMobileNav);
  $("#sidebar-collapse").addEventListener("click", toggleSidebar);
  $("#refresh-status").addEventListener("click", () => refreshStatus(false));
  $("#image-input").addEventListener("change", async event => {
    const files = Array.from(event.target.files || []).slice(0, 2 - state.attachments.length);
    try {
      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) { toast(file.name + " is over the 4 MB image limit.", "error"); continue; }
        if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type)) { toast("Unsupported image format: " + file.name, "error"); continue; }
        state.attachments.push(await readImage(file));
      }
      renderCurrent();
    } catch (error) { toast(error.message, "error"); }
    event.target.value = "";
  });
  $("#document-input").addEventListener("change", event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    state.documentFile = file; state.document = null; state.documentError = "";
    renderCurrent();
    event.target.value = "";
  });
  document.addEventListener("change", event => {
    if (event.target.id === "model-select") { state.model = event.target.value || "openrouter/free"; }
    if (event.target.id === "persona-select") state.persona = event.target.value === "naya" ? "naya" : "ultron";
    if (event.target.id === "camera-continuous-consent") {
      state.cameraContinuousConsent = event.target.checked === true;
      if (!state.cameraContinuousConsent && state.cameraContinuous) stopContinuousCameraAnalysis();
      renderCurrent();
    }
    if (event.target.id === "camera-interval") {
      const value = Number(event.target.value);
      state.cameraIntervalSeconds = [15, 30, 60].includes(value) ? value : 15;
    }
    if (event.target.id === "schedule-role") {
      const select = $("#schedule-routine");
      if (select) {
        const routines = state.routines.filter(item => !Array.isArray(item.roles) || item.roles.includes(event.target.value));
        select.innerHTML = routines.map(item => '<option value="' + esc(item.id) + '">' + esc(item.name || item.title || item.id) + '</option>').join("");
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.cameraStream) {
      stopCamera();
      if (state.view === "vision") renderCurrent();
    }
  });
  window.addEventListener("pagehide", stopCamera, { once: true });

  document.addEventListener("keydown", event => {
    if (event.target && event.target.matches("#chat-input") && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault(); const form = event.target.closest("form"); if (form) form.requestSubmit();
    }
    if (event.key === "Escape") closeMobileNav();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault(); openAuth("signin");
    }
  });

  function initParticleField() {
    const canvas = $("#particle-field");
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    let width = 0, height = 0, particles = [], frame = 0, visible = true;
    const reduceDensity = () => window.matchMedia("(max-width: 760px)").matches;
    function resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth; height = window.innerHeight;
      canvas.width = Math.floor(width * ratio); canvas.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = reduceDensity() ? 85 : Math.min(260, Math.floor(width * height / 5500));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * width, y: Math.random() * height, vx: (Math.random() - .5) * .18,
        vy: (Math.random() - .5) * .18, radius: Math.random() * 1.5 + .25, hue: Math.random() > .76 ? 285 : Math.random() > .47 ? 345 : 195,
        alpha: Math.random() * .32 + .1
      }));
    }
    function draw() {
      if (!visible) { frame = requestAnimationFrame(draw); return; }
      context.clearRect(0, 0, width, height);
      const reduce = reduceDensity();
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -5) p.x = width + 5; if (p.x > width + 5) p.x = -5;
        if (p.y < -5) p.y = height + 5; if (p.y > height + 5) p.y = -5;
        context.beginPath(); context.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        context.fillStyle = "hsla(" + p.hue + ",85%,75%," + p.alpha + ")"; context.fill();
      });
      if (!reduce) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const a = particles[i], b = particles[j], dx = a.x - b.x, dy = a.y - b.y, distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < 75) {
              context.strokeStyle = "rgba(156,122,210," + ((1 - distance / 75) * .075) + ")";
              context.lineWidth = .5; context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
            }
          }
        }
      }
      frame = requestAnimationFrame(draw);
    }
    document.addEventListener("visibilitychange", () => { visible = !document.hidden; });
    window.addEventListener("resize", resize, { passive: true });
    resize(); draw();
    window.addEventListener("pagehide", () => cancelAnimationFrame(frame), { once: true });
  }

  async function boot() {
    initParticleField();
    await refreshStatus(true);
    renderCurrent();
    if (state.view === "home" && !state.health) setCore("offline", "API HEALTH UNVERIFIED");
  }
  boot().catch(error => { setCore("error", "INITIALIZATION FAILED"); toast(error.message || "Frontend initialization failed.", "error"); });
})();