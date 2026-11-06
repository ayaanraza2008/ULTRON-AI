import { createParticleEngine } from "./particle-swarm-engine.js";

const $ = selector => document.querySelector(selector);
const app = $("#app");
const canvas = $("#energy-core");
const engine = createParticleEngine(canvas);

function preferredInteractionMode() {
  try {
    return window.localStorage.getItem("ultron-interaction-mode") === "text" ? "text" : "voice";
  } catch {
    return "voice";
  }
}

const state = {
  mode: preferredInteractionMode(),
  status: "standby",
  authenticated: false,
  session: null,
  authMode: "supabase",
  persona: "ultron",
  model: "",
  preferences: { voice_input_locale: "en-IN", voice_enabled: true, memory_enabled: true },
  preferenceAvailable: false,
  models: [],
  history: [],
  conversations: [],
  memoryItems: [],
  documents: [],
  conversationId: null,
  persistenceAvailable: false,
  attachments: [],
  recognition: null,
  muted: false,
  speaking: false,
  busy: false,
  requestController: null,
  health: null,
  pollId: 0
};

const messageList = $("#message-list");
const transcript = $("#transcript");
const composer = $("#composer");
const messageInput = $("#message-input");
const connection = $("#connection-indicator");
const connectionLabel = $("#connection-label");
const authScreen = $("#auth-screen");
const authForm = $("#auth-form");
const authMessage = $("#auth-message");
const toastRegion = $("#toast-region");
const drawerScrim = $("#drawer-scrim");
const settingsDrawer = $("#settings-drawer");
const activityDrawer = $("#activity-drawer");
const coreTrigger = $("#core-trigger");
const coreInteraction = $("#core-wrap");

function apiErrorMessage(error, fallback = "The request could not be completed.") {
  const message = error?.payload?.error?.message || error?.payload?.message || error?.message;
  return typeof message === "string" && message.length < 300 ? message : fallback;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers,
    body: options.body === undefined || typeof options.body === "string" ? options.body : JSON.stringify(options.body)
  });
  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    try { payload = await response.json(); } catch { payload = null; }
  } else if (!response.ok) {
    try { payload = { error: { message: (await response.text()).slice(0, 240) } }; } catch {}
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Request failed with HTTP " + response.status + ".");
    error.status = response.status;
    error.code = payload?.error?.code || null;
    error.payload = payload;
    throw error;
  }
  return payload ?? {};
}

function toast(message, tone = "normal") {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  if (tone === "error") item.dataset.tone = "bad";
  toastRegion.append(item);
  window.setTimeout(() => item.remove(), 4200);
}

function setStatus(status, mainText, subText) {
  const allowed = new Set(["standby", "listening", "thinking", "speaking", "executing", "error"]);
  state.status = allowed.has(status) ? status : "standby";
  app.dataset.state = state.status;
  $("#state-label").textContent = state.status.toUpperCase();
  if (mainText !== undefined) $("#assistant-line-main").textContent = mainText;
  if (subText !== undefined) $("#assistant-line-sub").textContent = subText;
  engine.setState(state.status);
  const interactionLabel = state.busy ? "Stop current request" : state.status === "listening" ? "Stop voice input" : state.speaking ? "Stop voice output" : "Start voice input";
  coreTrigger.setAttribute("aria-label", interactionLabel);
  coreInteraction.setAttribute("aria-label", interactionLabel);
}

function setConnection(online, label) {
  connection.dataset.state = online ? "online" : "offline";
  connectionLabel.textContent = label || (online ? "CONNECTED" : "OFFLINE");
}

function setMode(mode) {
  state.mode = mode === "text" ? "text" : "voice";
  try { window.localStorage.setItem("ultron-interaction-mode", state.mode); } catch {}
  if (state.mode === "text") {
    if (state.recognition) state.recognition.stop();
    stopSpeech();
  }
  app.dataset.mode = state.mode;
  $("#voice-mode").classList.toggle("is-active", state.mode === "voice");
  $("#text-mode").classList.toggle("is-active", state.mode === "text");
  $("#voice-mode").setAttribute("aria-pressed", String(state.mode === "voice"));
  $("#text-mode").setAttribute("aria-pressed", String(state.mode === "text"));
  composer.hidden = state.mode !== "text";
  if (state.mode === "text") {
    window.setTimeout(() => messageInput.focus(), 90);
    $("#assistant-line-sub").textContent = state.busy ? "ULTRON is processing" : "Type a message to begin";
  } else {
    $("#assistant-line-sub").textContent = "Tap the core to speak";
  }
}

function addMessage(role, content, meta = "") {
  const item = document.createElement("li");
  item.className = "message message--" + (role === "user" ? "user" : "assistant");
  if (meta === "error") item.classList.add("message--error");
  const label = document.createElement("span");
  label.className = "message__role";
  label.textContent = role === "user" ? "YOU" : state.persona.toUpperCase();
  const body = document.createElement("span");
  body.className = "message__body";
  body.textContent = String(content ?? "");
  item.append(label, body);
  messageList.append(item);
  transcript.scrollTop = transcript.scrollHeight;
}

function renderHistory() {
  messageList.replaceChildren();
  for (const item of state.history.slice(-40)) {
    addMessage(item.role, item.content);
  }
}

function showAuth(message = "") {
  state.authenticated = false;
  authScreen.hidden = false;
  app.setAttribute("aria-hidden", "true");
  app.inert = true;
  authMessage.textContent = message;
  setStatus("standby", "Authentication required", "Sign in to connect to your private system");
}

function hideAuth() {
  authScreen.hidden = true;
  app.removeAttribute("aria-hidden");
  app.inert = false;
}

function setAuthMode(mode) {
  state.authMode = mode === "legacy" ? "legacy" : "supabase";
  const legacy = state.authMode === "legacy";
  $("#email-field").hidden = legacy;
  $("#google-signin").hidden = legacy;
  $("#recovery-button").hidden = legacy;
  $("#legacy-access-toggle").textContent = legacy ? "Use email and password" : "Use owner access code";
  $("#auth-title").textContent = legacy ? "Owner access" : "Sign in";
  $("#auth-copy").textContent = legacy
    ? "Enter the private owner access code configured for this ULTRON instance."
    : "Authenticate with your ULTRON owner account.";
  $("#password-label").textContent = legacy ? "Owner access code" : "Password";
  $("#auth-password").autocomplete = legacy ? "current-password" : "current-password";
  $("#auth-password").value = "";
  authMessage.textContent = "";
}

async function bootstrap() {
  try {
    const session = await api("/api/session");
    if (!session.authenticated) {
      setAuthMode("supabase");
      showAuth(session.configured === false
        ? "Owner authentication is not configured on the server."
        : "Sign in with your owner account to continue.");
      setConnection(true, "API READY");
      return;
    }
    state.session = session;
    state.authenticated = true;
    state.persona = "ultron";
    hideAuth();
    $("#account-label").textContent = session.email || (session.authType === "access_gate" ? "Owner access session" : "Owner session");
    setConnection(true, "CONNECTED");
    setStatus("standby", "ULTRON is online.", "Personal intelligence system ready");
    await loadWorkspace();
  } catch (error) {
    setConnection(false, "API UNAVAILABLE");
    setAuthMode("supabase");
    showAuth(apiErrorMessage(error, "ULTRON could not verify the current session."));
  }
}

async function signIn(event) {
  event.preventDefault();
  const password = $("#auth-password").value;
  const email = $("#auth-email").value.trim();
  const button = $("#auth-submit");
  button.disabled = true;
  button.textContent = "AUTHENTICATING...";
  authMessage.textContent = "";
  try {
    if (state.authMode === "legacy") {
      await api("/api/session", { method: "POST", body: { password } });
    } else {
      await api("/api/auth/signin", { method: "POST", body: { email, password } });
    }
    await bootstrap();
  } catch (error) {
    authMessage.textContent = apiErrorMessage(error, "Sign-in was not accepted.");
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span aria-hidden="true">↗</span>';
  }
}

async function requestRecovery() {
  const email = $("#auth-email").value.trim();
  if (!email) {
    authMessage.textContent = "Enter your account email first.";
    $("#auth-email").focus();
    return;
  }
  const button = $("#recovery-button");
  button.disabled = true;
  try {
    const result = await api("/api/auth/recovery", { method: "POST", body: { email } });
    authMessage.textContent = result.message || "If an account exists, recovery instructions will be sent.";
  } catch (error) {
    authMessage.textContent = apiErrorMessage(error, "Recovery could not be started.");
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  try {
    await api("/api/auth/signout", { method: "POST", body: {} });
    await api("/api/logout", { method: "POST", body: {} });
  } catch {
    try { await api("/api/logout", { method: "POST", body: {} }); } catch {}
  }
  state.history = [];
  state.conversations = [];
  state.memoryItems = [];
  state.documents = [];
  state.conversationId = null;
  state.session = null;
  state.models = [];
  renderConversationList();
  renderMemoryItems();
  renderDocuments();
  messageList.replaceChildren();
  closeDrawers();
  showAuth("You have signed out.");
  setConnection(true, "API READY");
}

function renderConversationList() {
  const list = $("#conversation-list");
  list.replaceChildren();
  if (state.session?.authType !== "supabase") {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "Persistent conversation history requires the owner Supabase session."; 
    list.append(note);
    return;
  }
  if (!state.conversations.length) {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "No saved conversations yet.";
    list.append(note);
    return;
  }
  for (const conversation of state.conversations.slice(0, 12)) {
    const entry = document.createElement("div");
    entry.className = "conversation-entry";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = conversation.title || "Untitled conversation";
    open.addEventListener("click", () => void switchConversation(conversation.id));
    const meta = document.createElement("span");
    const date = new Date(conversation.updated_at || conversation.created_at || "");
    meta.textContent = (conversation.id === state.conversationId ? "CURRENT · " : "") + (Number.isNaN(date.valueOf()) ? "Saved thread" : date.toLocaleString());
    entry.append(open, meta);
    list.append(entry);
  }
}

async function switchConversation(conversationId) {
  if (state.busy || typeof conversationId !== "string") return;
  try {
    const result = await api("/api/conversations/" + encodeURIComponent(conversationId) + "/messages");
    state.conversationId = conversationId;
    state.persistenceAvailable = true;
    state.history = (Array.isArray(result.messages) ? result.messages : [])
      .filter(item => ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .slice(-40)
      .map(item => ({ role: item.role, content: item.content }));
    renderHistory();
    renderConversationList();
    closeDrawers();
    setStatus("standby", "Conversation restored.", "Loaded from your saved history");
  } catch (error) {
    toast(apiErrorMessage(error, "The selected conversation could not be loaded."), "error");
  }
}

async function loadConversation() {
  if (state.session?.authType !== "supabase") {
    state.persistenceAvailable = false;
    state.conversations = [];
    renderConversationList();
    return;
  }
  try {
    const result = await api("/api/conversations");
    state.persistenceAvailable = true;
    state.conversations = Array.isArray(result.conversations) ? result.conversations : [];
    renderConversationList();
    const recent = state.conversations[0];
    if (!recent?.id) {
      state.conversationId = null;
      state.history = [];
      renderHistory();
      return;
    }
    state.conversationId = recent.id;
    const history = await api("/api/conversations/" + encodeURIComponent(recent.id) + "/messages");
    state.history = (Array.isArray(history.messages) ? history.messages : [])
      .filter(item => ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .slice(-40)
      .map(item => ({ role: item.role, content: item.content }));
    renderHistory();
    renderConversationList();
  } catch (error) {
    state.persistenceAvailable = false;
    state.conversations = [];
    renderConversationList();
    if (error.status === 401 || error.status === 403) toast("Conversation history is not available for this session.");
    else toast("Conversation history could not be loaded.");
  }
}

async function ensureConversation(firstMessage) {
  if (!state.persistenceAvailable || state.conversationId) return state.conversationId;
  try {
    const result = await api("/api/conversations", {
      method: "POST",
      body: { title: String(firstMessage).slice(0, 70) || "New conversation" }
    });
    state.conversationId = result.conversation?.id || null;
    if (result.conversation?.id) {
      state.conversations = [result.conversation, ...state.conversations.filter(item => item.id !== result.conversation.id)].slice(0, 20);
      renderConversationList();
    }
    return state.conversationId;
  } catch {
    state.persistenceAvailable = false;
    toast("Chat is available, but conversation storage is not available for this session.");
    return null;
  }
}

async function persistMessage(role, content) {
  if (!state.conversationId || !state.persistenceAvailable) return;
  try {
    await api("/api/conversations/" + encodeURIComponent(state.conversationId) + "/messages", {
      method: "POST",
      body: { role, content }
    });
  } catch {
    state.persistenceAvailable = false;
    toast("The latest message could not be saved to conversation history.", "error");
  }
}

function setBusy(busy) {
  state.busy = busy;
  $("#send-button").disabled = busy;
  messageInput.disabled = busy;
  coreTrigger.disabled = false;
  const interactionLabel = busy ? "Stop current request" : state.status === "listening" ? "Stop voice input" : state.speaking ? "Stop voice output" : "Start voice input";
  coreTrigger.setAttribute("aria-label", interactionLabel);
  coreInteraction.setAttribute("aria-label", interactionLabel);
  $("#send-button").setAttribute("aria-busy", String(busy));
}

async function sendMessage(rawText, attachments = []) {
  const text = String(rawText || "").trim();
  if ((!text && attachments.length === 0) || state.busy) return;
  // Spoken output belongs to the mode in which this message was submitted.
  // Switching modes while a provider is responding must not make a text reply audible.
  const responseMode = state.mode;
  state.requestController = new AbortController();
  setBusy(true);
  setStatus("thinking", "Processing your request.", "Connecting to the ULTRON intelligence runtime");
  const userText = text || "Please analyze the attached image.";
  const userMessage = { role: "user", content: userText };
  state.history.push(userMessage);
  renderHistory();
  await ensureConversation(userText);
  await persistMessage("user", userText);

  try {
    const result = await api("/api/chat", {
      method: "POST",
      signal: state.requestController.signal,
      body: {
        messages: state.history.slice(-40).map(item => ({ role: item.role, content: item.content })),
        stream: false,
        model: state.model || undefined,
        persona: state.persona,
        attachments: attachments.slice(0, 2)
      }
    });
    const answer = typeof result.content === "string" ? result.content.trim() : "";
    if (!answer) throw new Error("ULTRON returned an empty response.");
    state.history.push({ role: "assistant", content: answer });
    addMessage("assistant", answer);
    await persistMessage("assistant", answer);
    const source = [result.provider, result.model || state.model].filter(Boolean).join(" · ");
    setStatus("standby", "Response received.", source || "ULTRON ready");
    if (responseMode === "voice" && state.preferences.voice_enabled && !state.muted) speak(answer);
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("standby", "Request stopped.", "You can send another message");
    } else {
      const message = apiErrorMessage(error, "ULTRON could not complete the request.");
      state.history.push({ role: "assistant", content: message });
      addMessage("assistant", message, "error");
      setStatus("error", "Request could not be completed.", error.code || "Check connection and try again");
      toast(message, "error");
    }
  } finally {
    state.requestController = null;
    setBusy(false);
    $("#image-input").value = "";
    state.attachments = [];
    renderAttachments();
  }
}

function speak(text) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    toast("Spoken output is not supported by this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
  utterance.rate = 0.96;
  utterance.pitch = state.persona === "naya" ? 1.0 : 0.88;
  utterance.volume = 0.92;
  const voices = window.speechSynthesis.getVoices();
  const locale = state.preferences.voice_input_locale === "hi-IN" ? "hi-IN" : "en-IN";
  const matching = voices.find(voice => voice.lang.toLowerCase() === locale.toLowerCase())
    || voices.find(voice => voice.lang.toLowerCase().startsWith(locale.slice(0, 2).toLowerCase()));
  if (matching) utterance.voice = matching;
  utterance.onstart = () => {
    state.speaking = true;
    setStatus("speaking", "ULTRON is speaking.", "Tap the core to stop playback");
  };
  utterance.onend = () => {
    state.speaking = false;
    setStatus("standby", "Response complete.", "Ready when you are");
  };
  utterance.onerror = () => {
    state.speaking = false;
    setStatus("standby", "Response ready.", "Browser speech playback ended");
  };
  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
}

function createRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;
  const recognition = new Recognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = state.preferences.voice_input_locale === "hi-IN" ? "hi-IN" : "en-IN";
  let finalText = "";
  recognition.onstart = () => setStatus("listening", "Listening.", "Speak clearly, then pause");
  recognition.onresult = event => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalText += result[0].transcript + " ";
      else interim += result[0].transcript;
    }
    if (interim) $("#assistant-line-main").textContent = interim.slice(0, 120);
  };
  recognition.onerror = event => {
    state.recognition = null;
    setStatus("error", "Voice input stopped.", event.error === "not-allowed" ? "Microphone permission was denied" : "Try again or switch to text mode");
  };
  recognition.onend = () => {
    state.recognition = null;
    const captured = finalText.trim();
    if (captured) {
      void sendMessage(captured, state.attachments);
    } else if (state.status === "listening") {
      setStatus("standby", "No speech detected.", "Tap the core to try again");
    }
  };
  return recognition;
}

function toggleVoiceInput() {
  if (state.busy) {
    state.requestController?.abort();
    setStatus("thinking", "Stopping request.", "Cancelling the in-flight chat request");
    return;
  }
  if (state.recognition) {
    state.recognition.stop();
    return;
  }
  if (state.speaking) {
    stopSpeech();
    setStatus("standby", "Playback stopped.", "Ready when you are");
    return;
  }
  const recognition = createRecognition();
  if (!recognition) {
    toast("Speech recognition is unavailable in this browser. Switch to Text mode.");
    setMode("text");
    return;
  }
  stopSpeech();
  state.recognition = recognition;
  try {
    recognition.start();
  } catch {
    state.recognition = null;
    toast("The microphone could not be started. Check browser permissions.");
    setStatus("error", "Microphone unavailable.", "Allow microphone access in your browser");
  }
}

function renderAttachments() {
  const list = $("#attachment-list");
  list.replaceChildren();
  for (const [index, item] of state.attachments.entries()) {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    const label = document.createElement("span");
    label.textContent = item.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove " + item.name);
    remove.addEventListener("click", () => {
      state.attachments.splice(index, 1);
      renderAttachments();
    });
    chip.append(label, remove);
    list.append(chip);
  }
}

async function addAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (state.attachments.length + files.length > 2) {
    toast("Attach no more than two images per message.");
    return;
  }
  for (const file of files) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type) || file.size > 4 * 1024 * 1024) {
      toast("Only JPEG, PNG, WebP or GIF images up to 4 MB are supported.", "error");
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Image could not be read."));
      reader.readAsDataURL(file);
    }).catch(() => "");
    if (dataUrl) state.attachments.push({ name: file.name.slice(0, 70), dataUrl });
  }
  renderAttachments();
}

function openDrawer(drawer) {
  const other = drawer === settingsDrawer ? activityDrawer : settingsDrawer;
  other.classList.remove("is-open");
  other.setAttribute("aria-hidden", "true");
  other.inert = true;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
  drawer.inert = false;
  drawerScrim.hidden = false;
  const focusable = drawer.querySelector("button, select, input");
  focusable?.focus();
}

function closeDrawers() {
  for (const drawer of [settingsDrawer, activityDrawer]) {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    drawer.inert = true;
  }
  drawerScrim.hidden = true;
}

function setSwitch(button, value) {
  button.setAttribute("aria-checked", String(Boolean(value)));
}

function setStatusValue(name, value, tone = "") {
  const element = document.querySelector('[data-status="' + name + '"]');
  if (!element) return;
  element.textContent = String(value);
  if (tone) element.dataset.tone = tone;
  else delete element.dataset.tone;
}

function readinessWorkerState(readiness) {
  if (!readiness || typeof readiness !== "object") return "Unknown";
  const worker = readiness.worker || readiness.workers || readiness.taskWorker;
  if (typeof worker === "string") return worker;
  if (worker && typeof worker === "object") return worker.state || worker.status || "Configured";
  return "Unavailable";
}

async function refreshSystemStatus() {
  const healthResult = await api("/api/health").catch(() => null);
  state.health = healthResult;
  if (healthResult?.status === "ok") setConnection(true, "CONNECTED");
  else setConnection(false, "API OFFLINE");
  setStatusValue("api", healthResult?.status === "ok" ? "Online" : "Unavailable", healthResult?.status === "ok" ? "good" : "bad");
  setStatusValue("provider", healthResult?.providerConfigured === true ? "Configured" : healthResult?.providerConfigured === false ? "Not configured" : "Unknown", healthResult?.providerConfigured === true ? "good" : healthResult?.providerConfigured === false ? "bad" : "");
  setStatusValue("database", healthResult?.supabaseConfigured === true ? "Configured" : healthResult?.supabaseConfigured === false ? "Not configured" : "Unknown", healthResult?.supabaseConfigured === true ? "good" : healthResult?.supabaseConfigured === false ? "bad" : "");

  const [readiness, autonomy] = await Promise.all([
    api("/api/runtime/readiness").catch(() => null),
    api("/api/jarvis/autonomy/state").catch(() => null)
  ]);
  setStatusValue("worker", readinessWorkerState(readiness), readinessWorkerState(readiness).toLowerCase().includes("ready") ? "good" : "");
  setStatusValue("autonomy", Number.isFinite(autonomy?.autonomyLevel) ? "Level " + autonomy.autonomyLevel : "Unavailable",
    Number.isFinite(autonomy?.autonomyLevel) ? "good" : "");
  if (!readiness && !autonomy) $("#runtime-note").textContent = "Some owner-only system endpoints are unavailable for this session. Unavailable values are not estimated.";
  else $("#runtime-note").textContent = "Live API data only. Cloud runtime status does not represent your local PC.";
}

async function loadModels() {
  const select = $("#model-select");
  try {
    const result = await api("/api/models");
    state.models = Array.isArray(result.models) ? result.models : [];
    select.replaceChildren();
    for (const model of state.models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.append(option);
    }
    state.model = result.defaultModel && state.models.includes(result.defaultModel) ? result.defaultModel : state.models[0] || "";
    select.value = state.model;
    select.disabled = state.models.length === 0;
  } catch {
    select.replaceChildren();
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Model discovery unavailable";
    select.append(option);
    select.disabled = true;
  }
}

async function loadPreferences() {
  if (state.session?.authType !== "supabase") {
    $("#memory-toggle").disabled = true;
    $("#speech-toggle").disabled = true;
    $("#locale-select").disabled = true;
    return;
  }
  try {
    const result = await api("/api/preferences");
    const preferences = result.preferences || {};
    state.preferences = {
      voice_input_locale: preferences.voice_input_locale || "en-IN",
      voice_enabled: preferences.voice_enabled !== false,
      memory_enabled: preferences.memory_enabled !== false
    };
    state.preferenceAvailable = true;
    $("#locale-select").value = state.preferences.voice_input_locale;
    setSwitch($("#memory-toggle"), state.preferences.memory_enabled);
    setSwitch($("#speech-toggle"), state.preferences.voice_enabled);
  } catch {
    state.preferenceAvailable = false;
    $("#memory-toggle").disabled = true;
    $("#speech-toggle").disabled = true;
    $("#locale-select").disabled = true;
    $("#runtime-note").textContent = "Account preferences could not be loaded. Settings are not shown as saved.";
  }
}


function renderMemoryItems() {
  const list = $("#memory-items");
  list.replaceChildren();
  if (state.session?.authType !== "supabase") {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "Saved memory management requires the owner Supabase session.";
    list.append(note);
    return;
  }
  if (!state.memoryItems.length) {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "No saved memory items.";
    list.append(note);
    return;
  }
  for (const memory of state.memoryItems.slice(0, 12)) {
    const entry = document.createElement("div");
    entry.className = "memory-entry";
    const head = document.createElement("div");
    head.className = "memory-entry__head";
    const title = document.createElement("span");
    title.textContent = memory.title || "Untitled memory";
    const status = document.createElement("span");
    status.textContent = memory.is_active ? "ACTIVE" : "PAUSED";
    head.append(title, status);
    const meta = document.createElement("div");
    meta.className = "memory-entry__meta";
    meta.textContent = [memory.kind, memory.source].filter(Boolean).join(" · ");
    const body = document.createElement("div");
    body.className = "memory-entry__body";
    const content = String(memory.content || "");
    body.textContent = content.length > 420 ? content.slice(0, 420) + "…" : content;
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = memory.is_active ? "Pause" : "Activate";
    toggle.addEventListener("click", () => void updateMemory(memory.id, { is_active: !memory.is_active }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => void deleteMemory(memory.id));
    actions.append(toggle, remove);
    entry.append(head, meta, body, actions);
    list.append(entry);
  }
}

async function loadMemory() {
  if (state.session?.authType !== "supabase") {
    state.memoryItems = [];
    renderMemoryItems();
    $("#memory-feedback").textContent = "Use the owner Supabase session to manage saved memories.";
    return;
  }
  try {
    const result = await api("/api/memory");
    state.memoryItems = Array.isArray(result.items) ? result.items : [];
    renderMemoryItems();
    $("#memory-feedback").textContent = "Only active, unexpired memories are eligible for chat context when memory is enabled.";
  } catch (error) {
    state.memoryItems = [];
    renderMemoryItems();
    $("#memory-feedback").textContent = apiErrorMessage(error, "Saved memory is unavailable for this account.");
  }
}

async function saveMemory(event) {
  event.preventDefault();
  const kind = $("#memory-kind").value;
  const title = $("#memory-title").value.trim();
  const content = $("#memory-content").value.trim();
  if (!title || !content) {
    $("#memory-feedback").textContent = "Enter both a title and memory content.";
    return;
  }
  const button = $("#memory-save");
  button.disabled = true;
  $("#memory-feedback").textContent = "Saving the memory item...";
  try {
    await api("/api/memory", { method: "POST", body: { kind, title, content } });
    $("#memory-title").value = "";
    $("#memory-content").value = "";
    await loadMemory();
    toast("User-approved memory saved.");
  } catch (error) {
    $("#memory-feedback").textContent = apiErrorMessage(error, "Memory could not be saved.");
  } finally {
    button.disabled = state.session?.authType !== "supabase";
  }
}

async function updateMemory(memoryId, patch) {
  try {
    await api("/api/memory/" + encodeURIComponent(memoryId), { method: "PATCH", body: patch });
    await loadMemory();
  } catch (error) {
    toast(apiErrorMessage(error, "Memory could not be updated."), "error");
  }
}

async function deleteMemory(memoryId) {
  try {
    await api("/api/memory/" + encodeURIComponent(memoryId), { method: "DELETE" });
    await loadMemory();
    toast("Memory item deleted.");
  } catch (error) {
    toast(apiErrorMessage(error, "Memory could not be deleted."), "error");
  }
}


function renderDocuments() {
  const list = $("#document-list");
  list.replaceChildren();
  if (state.session?.authType !== "supabase") {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "Private document storage requires the owner Supabase session.";
    list.append(note);
    return;
  }
  if (!state.documents.length) {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "No private documents are stored for this account.";
    list.append(note);
    return;
  }
  for (const file of state.documents.slice(0, 12)) {
    const entry = document.createElement("div");
    entry.className = "document-entry";
    const head = document.createElement("div");
    head.className = "document-entry__head";
    const name = document.createElement("span");
    name.textContent = file.filename || "Untitled file";
    const size = document.createElement("span");
    size.textContent = Number.isFinite(Number(file.size_bytes)) ? (Number(file.size_bytes) / 1048576).toFixed(2) + " MB" : "";
    head.append(name, size);
    const meta = document.createElement("span");
    meta.className = "document-entry__meta";
    meta.textContent = [file.mime_type, file.created_at ? new Date(file.created_at).toLocaleDateString() : ""].filter(Boolean).join(" · ");
    const actions = document.createElement("div");
    actions.className = "inline-actions";
    const download = document.createElement("button");
    download.type = "button";
    download.textContent = "Download";
    download.addEventListener("click", () => void downloadDocument(file));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => void deleteDocument(file.id));
    actions.append(download, remove);
    entry.append(head, meta, actions);
    list.append(entry);
  }
}

async function loadDocuments() {
  if (state.session?.authType !== "supabase") {
    state.documents = [];
    renderDocuments();
    $("#document-feedback").textContent = "Private document storage requires the owner Supabase session.";
    return;
  }
  try {
    const result = await api("/api/documents");
    state.documents = Array.isArray(result.documents) ? result.documents : [];
    renderDocuments();
    $("#document-feedback").textContent = "Private account storage only. The current API stores and retrieves files; automatic document processing is not exposed by this route.";
  } catch (error) {
    state.documents = [];
    renderDocuments();
    $("#document-feedback").textContent = apiErrorMessage(error, "Private document storage is unavailable.");
  }
}

async function uploadDocument(fileList) {
  const file = Array.from(fileList || [])[0];
  if (!file) return;
  const extension = file.name.toLowerCase().split(".").pop();
  const allowed = new Set(["txt", "md", "markdown", "csv", "json", "html", "htm", "pdf", "docx"]);
  if (!allowed.has(extension) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
    $("#document-feedback").textContent = "Choose a supported document between 1 byte and 5 MB.";
    $("#document-input").value = "";
    return;
  }
  const button = $("#document-upload");
  button.disabled = true;
  $("#document-feedback").textContent = "Reading and securely uploading " + file.name + "...";
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("The selected document could not be read."));
      reader.readAsDataURL(file);
    });
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("The selected document could not be encoded.");
    await api("/api/documents/upload", {
      method: "POST",
      body: { filename: file.name, fileBase64: dataUrl.slice(separator + 1) }
    });
    await loadDocuments();
    toast("Private document uploaded.");
  } catch (error) {
    $("#document-feedback").textContent = apiErrorMessage(error, "The document could not be uploaded.");
    toast(apiErrorMessage(error, "The document could not be uploaded."), "error");
  } finally {
    button.disabled = state.session?.authType !== "supabase";
    $("#document-input").value = "";
  }
}

async function downloadDocument(file) {
  try {
    const response = await fetch("/api/documents/" + encodeURIComponent(file.id) + "/download", { credentials: "same-origin" });
    if (!response.ok) {
      let payload = null;
      try { payload = await response.json(); } catch {}
      throw new Error(payload?.error?.message || "The file could not be downloaded.");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = file.filename || "ultron-document";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    toast(apiErrorMessage(error, "The document could not be downloaded."), "error");
  }
}

async function deleteDocument(documentId) {
  try {
    await api("/api/documents/" + encodeURIComponent(documentId), { method: "DELETE" });
    await loadDocuments();
    toast("Private document deleted.");
  } catch (error) {
    toast(apiErrorMessage(error, "The document could not be deleted."), "error");
  }
}

async function queueEmployeeTask(event) {
  event.preventDefault();
  const goal = $("#task-goal").value.trim();
  if (goal.length < 2 || goal.length > 2000) {
    $("#task-feedback").textContent = "Enter a task goal between 2 and 2,000 characters.";
    return;
  }
  if (state.session?.authType !== "supabase") {
    $("#task-feedback").textContent = "Task queue requires the owner Supabase session.";
    return;
  }
  const button = $("#task-submit");
  button.disabled = true;
  $("#task-feedback").textContent = "Submitting the task to the durable queue...";
  try {
    const result = await api("/api/jarvis/agents/task", {
      method: "POST",
      body: { goal, role: $("#task-role").value, mode: $("#task-mode").value }
    });
    const task = result.task || {};
    $("#task-feedback").textContent = (task.status || "QUEUED") + " · " +
      (result.execution?.notice || "The task is queued, not completed.");
    $("#task-goal").value = "";
    await loadActivity();
    toast("Task accepted by ULTRON's durable queue.");
  } catch (error) {
    $("#task-feedback").textContent = apiErrorMessage(error, "The task could not be queued.");
    toast(apiErrorMessage(error, "The task could not be queued."), "error");
  } finally {
    button.disabled = state.session?.authType !== "supabase";
  }
}

async function savePreferences() {
  if (!state.preferenceAvailable) {
    toast("Account preferences are unavailable for this session.", "error");
    return;
  }
  try {
    const result = await api("/api/preferences", {
      method: "PUT",
      body: {
        voice_input_locale: state.preferences.voice_input_locale,
        voice_enabled: state.preferences.voice_enabled,
        memory_enabled: state.preferences.memory_enabled
      }
    });
    const saved = result.preferences || {};
    state.preferences.voice_input_locale = saved.voice_input_locale || state.preferences.voice_input_locale;
    state.preferences.voice_enabled = saved.voice_enabled !== false;
    state.preferences.memory_enabled = saved.memory_enabled !== false;
    toast("Preferences saved.");
  } catch (error) {
    toast(apiErrorMessage(error, "Preferences could not be saved."), "error");
    await loadPreferences();
  }
}

function renderActivity(tasks, tools) {
  const taskList = $("#task-list");
  taskList.replaceChildren();
  if (!Array.isArray(tasks) || tasks.length === 0) {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "No task records were returned by the task API.";
    taskList.append(note);
  } else {
    for (const task of tasks.slice(0, 8)) {
      const item = document.createElement("div");
      item.className = "activity-item";
      const top = document.createElement("div");
      top.className = "activity-item__top";
      const title = document.createElement("span");
      title.textContent = task.title || task.id || "Untitled task";
      const status = document.createElement("span");
      status.className = "activity-item__state";
      status.textContent = task.status || "Unknown";
      top.append(title, status);
      const meta = document.createElement("span");
      meta.className = "activity-item__meta";
      meta.textContent = task.updated_at ? "Updated " + new Date(task.updated_at).toLocaleString() : "Task record";
      item.append(top, meta);
      taskList.append(item);
    }
  }

  const capabilityList = $("#capability-list");
  capabilityList.replaceChildren();
  if (!Array.isArray(tools) || tools.length === 0) {
    const note = document.createElement("p");
    note.className = "drawer-note";
    note.textContent = "Tool registry is unavailable for this session.";
    capabilityList.append(note);
  } else {
    for (const tool of tools.slice(0, 12)) {
      const item = document.createElement("div");
      item.className = "activity-item";
      const top = document.createElement("div");
      top.className = "activity-item__top";
      const name = document.createElement("span");
      name.textContent = tool.name || tool.id || "Registered tool";
      const level = document.createElement("span");
      level.className = "activity-item__state";
      level.textContent = "P" + String(tool.permissionLevel ?? "?");
      top.append(name, level);
      const meta = document.createElement("span");
      meta.className = "activity-item__meta";
      meta.textContent = [tool.category, tool.requiresConfirmation ? "Confirmation required" : "Registry entry"].filter(Boolean).join(" · ");
      item.append(top, meta);
      capabilityList.append(item);
    }
  }
  $("#activity-updated").textContent = new Date().toLocaleTimeString();
}

async function loadActivity() {
  const [tasks, registry] = await Promise.all([
    api("/api/jarvis/agents/tasks").catch(() => null),
    api("/api/jarvis/tools").catch(() => null)
  ]);
  renderActivity(tasks?.tasks, registry?.tools);
}

async function loadWorkspace() {
  const ownerSession = state.session?.authType === "supabase";
  $("#task-submit").disabled = !ownerSession;
  $("#memory-save").disabled = !ownerSession;
  $("#document-upload").disabled = !ownerSession;
  await Promise.all([loadConversation(), loadPreferences(), loadMemory(), loadDocuments(), loadModels(), refreshSystemStatus()]);
  void loadActivity();
  if (!state.pollId) state.pollId = window.setInterval(() => {
    if (!document.hidden && state.authenticated) void refreshSystemStatus();
  }, 30000);
}

async function startNewConversation() {
  if (state.busy) return;
  state.conversationId = null;
  state.history = [];
  messageList.replaceChildren();
  closeDrawers();
  setStatus("standby", "New conversation ready.", "Your next message starts a fresh thread");
  if (state.session?.authType === "supabase") {
    try {
      const result = await api("/api/conversations", { method: "POST", body: { title: "New conversation" } });
      state.conversationId = result.conversation?.id || null;
      state.persistenceAvailable = Boolean(state.conversationId);
      if (result.conversation?.id) {
        state.conversations = [result.conversation, ...state.conversations.filter(item => item.id !== result.conversation.id)].slice(0, 20);
        renderConversationList();
      }
    } catch {
      state.persistenceAvailable = false;
      toast("A new thread will remain in this session only.");
    }
  }
}

$("#voice-mode").addEventListener("click", () => setMode("voice"));
$("#text-mode").addEventListener("click", () => setMode("text"));
coreTrigger.addEventListener("click", toggleVoiceInput);
coreInteraction.addEventListener("click", toggleVoiceInput);
coreInteraction.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleVoiceInput();
  }
});
$("#mute-toggle").addEventListener("click", () => {
  state.muted = !state.muted;
  $("#mute-toggle").classList.toggle("is-muted", state.muted);
  $("#mute-toggle").setAttribute("aria-pressed", String(state.muted));
  $("#mute-toggle").setAttribute("aria-label", state.muted ? "Unmute voice output" : "Mute voice output");
  $("#mute-toggle").title = state.muted ? "Unmute voice output" : "Mute voice output";
  if (state.muted) stopSpeech();
});
$("#attach-open").addEventListener("click", () => $("#image-input").click());
$("#image-input").addEventListener("change", event => void addAttachments(event.target.files));
composer.addEventListener("submit", event => {
  event.preventDefault();
  const text = messageInput.value;
  const files = state.attachments.map(item => ({ dataUrl: item.dataUrl }));
  messageInput.value = "";
  void sendMessage(text, files);
});
messageInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composer.requestSubmit();
  }
});
$("#settings-open").addEventListener("click", () => openDrawer(settingsDrawer));
$("#settings-close").addEventListener("click", closeDrawers);
$("#activity-open").addEventListener("click", () => {
  openDrawer(activityDrawer);
  void loadActivity();
});
$("#activity-close").addEventListener("click", closeDrawers);
drawerScrim.addEventListener("click", closeDrawers);
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeDrawers();
    if (state.recognition) state.recognition.stop();
  }
});
$("#signout-button").addEventListener("click", () => void signOut());
$("#auth-form").addEventListener("submit", signIn);
$("#legacy-access-toggle").addEventListener("click", () => setAuthMode(state.authMode === "legacy" ? "supabase" : "legacy"));
$("#recovery-button").addEventListener("click", requestRecovery);
$("#google-signin").addEventListener("click", () => { window.location.assign("/api/auth/google"); });
$("#persona-select").addEventListener("change", event => {
  state.persona = event.target.value === "naya" ? "naya" : "ultron";
  setStatus("standby", state.persona === "naya" ? "NAYA selected." : "ULTRON selected.", "Personality applies to new messages in this session");
});
$("#model-select").addEventListener("change", event => { state.model = event.target.value; });
$("#locale-select").addEventListener("change", event => {
  state.preferences.voice_input_locale = event.target.value;
  if (state.recognition) state.recognition.stop();
  void savePreferences();
});
$("#memory-toggle").addEventListener("click", () => {
  state.preferences.memory_enabled = !state.preferences.memory_enabled;
  setSwitch($("#memory-toggle"), state.preferences.memory_enabled);
  void savePreferences();
});
$("#speech-toggle").addEventListener("click", () => {
  state.preferences.voice_enabled = !state.preferences.voice_enabled;
  setSwitch($("#speech-toggle"), state.preferences.voice_enabled);
  if (!state.preferences.voice_enabled) stopSpeech();
  void savePreferences();
});
$("#new-conversation").addEventListener("click", () => void startNewConversation());
$("#memory-form").addEventListener("submit", event => void saveMemory(event));
$("#task-form").addEventListener("submit", event => void queueEmployeeTask(event));
$("#document-upload").addEventListener("click", () => $("#document-input").click());
$("#document-input").addEventListener("change", event => void uploadDocument(event.target.files));

setMode(state.mode);
setStatus("standby", "ULTRON is initializing.", "Establishing secure connection");
void bootstrap();
