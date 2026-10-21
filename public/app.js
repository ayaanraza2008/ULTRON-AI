const $ = (id) => document.getElementById(id);
const state = { messages: [], busy: false, voiceActive: false, recognition: null, speaking: false, voiceRestartTimer: null, toastTimer: null, authType: null, conversationId: null, persistenceBusy: false, attachments: [] };
const features = {
  memory: ["Memory & knowledge", "Manage only the facts and preferences you explicitly choose to save. You can deactivate or delete each memory at any time."],
  research: ["Research", "Web research and citations are not connected yet. ULTRON will not pretend to search the web or invent sources."],
  media: ["Vision & media", "Image, document, avatar, and video tools require separately verified services. No generation jobs run from this screen yet."],
  tasks: ["Agents & tasks", "Task orchestration and desktop automation are not connected yet. No local computer actions are being simulated."],
  integrations: ["Integrations", "OpenRouter provides the AI models gateway. ULTRON has a dedicated Supabase project for account authentication and private chat history. Research and media integrations still need separate implementation and verification."],
  settings: ["Settings", "Account sign-in and private conversation history use Supabase. Voice uses browser speech capabilities when available; password recovery and user-controlled memory settings remain to be implemented."]
};
function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => node.classList.add("hidden"), 3600);
}
async function api(url, options = {}) {
  const headers = Object.assign({}, options.body ? { "Content-Type": "application/json" } : {}, options.headers || {});
  const response = await fetch(url, Object.assign({ credentials: "same-origin" }, options, { headers }));
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch {}
    const error = new Error(payload && payload.error && payload.error.message ? payload.error.message : "Request failed (" + response.status + ")");
    error.status = response.status;
    error.code = payload && payload.error && payload.error.code;
    throw error;
  }
  return response;
}
function showScreen(screen) {
  ["login-screen", "setup-screen", "app-shell"].forEach(id => $(id).classList.toggle("hidden", id !== screen));
}
async function enterApplication(session) {
  state.authType = session.authType || null;
  showScreen("app-shell");
  $("conversation-history").classList.toggle("hidden", state.authType !== "supabase");
  document.querySelector(".history-label").classList.toggle("hidden", state.authType !== "supabase");
  await refreshHealth();
  if (state.authType === "supabase") {
    await loadLatestConversation();
    await loadPreferences();
  }
}
async function init() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (response.status === 503) { showScreen("setup-screen"); return; }
    const session = await response.json();
    if (session.authenticated) await enterApplication(session);
    else showScreen("login-screen");
  } catch {
    showScreen("setup-screen");
    $("setup-screen").querySelector("h1").textContent = "Core unreachable.";
    $("setup-screen").querySelector(".muted").textContent = "Could not connect to the server. Check your connection and refresh.";
  }
}
async function submitAccountAuth(path) {
  $("login-error").textContent = "";
  const button = $("login-form").querySelector('button[type="submit"]');
  const signup = $("signup-button");
  button.disabled = true;
  signup.disabled = true;
  try {
    const response = await api(path, { method: "POST", body: JSON.stringify({
      email: $("account-email").value.trim(),
      password: $("account-password").value
    }) });
    const result = await response.json();
    if (result.confirmationRequired) {
      $("login-error").textContent = result.message || "Check your email to confirm your account, then sign in.";
      return;
    }
    $("account-password").value = "";
    await enterApplication({ authenticated: true, authType: "supabase", email: result.email });
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    button.disabled = false;
    signup.disabled = false;
  }
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  await submitAccountAuth("/api/auth/signin");
});
$("signup-button").addEventListener("click", async () => {
  await submitAccountAuth("/api/auth/signup");
});
$("logout-button").addEventListener("click", async () => {
  stopVoice();
  try { await api("/api/auth/signout", { method: "POST", body: "{}" }); } catch {}
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
  state.authType = null;
  state.conversationId = null;
  state.messages = [];
  showScreen("login-screen");
});
async function refreshHealth() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    const configured = Boolean(data.providerConfigured);
    $("status-light").className = "status-light " + (configured ? "" : "warn");
    $("status-title").textContent = configured ? "Core configured" : "AI provider setup needed";
    $("status-subtitle").textContent = configured ? "Provider settings detected" : "Add key and model in server secrets";
    $("top-status").textContent = configured ? "CORE READY" : "CORE LIMITED";
  } catch {
    $("status-light").className = "status-light down";
    $("status-title").textContent = "Core unreachable";
    $("status-subtitle").textContent = "Unable to read health status";
    $("top-status").textContent = "OFFLINE";
  }
}
$("refresh-health").addEventListener("click", refreshHealth);
function renderConversationHistory(conversations) {
  const container = $("conversation-history");
  container.replaceChildren();
  const items = Array.isArray(conversations) ? conversations : [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "Your saved chats will appear here.";
    container.append(empty);
    return;
  }
  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item" + (item.id === state.conversationId ? " active" : "");
    button.dataset.conversationId = item.id;
    button.textContent = item.title || "New conversation";
    button.title = item.title || "New conversation";
    button.setAttribute("aria-current", item.id === state.conversationId ? "page" : "false");
    button.addEventListener("click", () => openConversation(item.id));
    container.append(button);
  });
}
async function refreshConversationHistory() {
  if (state.authType !== "supabase") return;
  try {
    const response = await api("/api/conversations");
    const data = await response.json();
    renderConversationHistory(data.conversations);
  } catch (error) {
    toast("Could not refresh saved chats: " + error.message);
  }
}
async function openConversation(id, announce = true) {
  try {
    const response = await api("/api/conversations/" + encodeURIComponent(id) + "/messages");
    const data = await response.json();
    state.conversationId = id;
    state.messages = (data.messages || []).filter(item => ["user", "assistant"].includes(item.role)).map(item => ({ role: item.role, content: item.content }));
    $("messages").replaceChildren();
    if (state.messages.length) {
      $("welcome-view").classList.add("hidden");
      $("messages").classList.remove("hidden");
      state.messages.forEach(item => addMessage(item.role, item.content));
    } else {
      $("messages").classList.add("hidden");
      $("welcome-view").classList.remove("hidden");
    }
    switchPanel("chat");
    renderConversationHistory(Array.from($("conversation-history").querySelectorAll(".history-item")).map(button => ({ id: button.dataset.conversationId, title: button.textContent })).filter(item => item.id));
    if (announce) toast("Conversation opened.");
  } catch (error) {
    toast("Could not open saved conversation: " + error.message);
  }
}
async function loadLatestConversation() {
  try {
    const response = await api("/api/conversations");
    const data = await response.json();
    renderConversationHistory(data.conversations);
    const latest = data.conversations && data.conversations[0];
    if (latest) await openConversation(latest.id, false);
  } catch (error) {
    toast("Saved history could not be loaded: " + error.message);
  }
}
async function ensureConversation(firstMessage) {
  if (state.authType !== "supabase") return null;
  if (state.conversationId) return state.conversationId;
  if (state.persistenceBusy) return null;
  state.persistenceBusy = true;
  try {
    const response = await api("/api/conversations", { method: "POST", body: JSON.stringify({ title: firstMessage.slice(0, 70) || "New conversation" }) });
    const data = await response.json();
    state.conversationId = data.conversation.id;
    await refreshConversationHistory();
    return state.conversationId;
  } catch (error) {
    toast("Chat is available, but saving history failed: " + error.message);
    return null;
  } finally { state.persistenceBusy = false; }
}
async function persistMessage(role, content) {
  if (state.authType !== "supabase") return;
  if (role === "assistant" && !state.conversationId) return;
  const id = await ensureConversation(role === "user" ? content : "New conversation");
  if (!id) return;
  try {
    await api("/api/conversations/" + encodeURIComponent(id) + "/messages", { method: "POST", body: JSON.stringify({ role, content }) });
    if (role === "assistant") await refreshConversationHistory();
  } catch (error) {
    toast("This message could not be saved: " + error.message);
  }
}
function switchPanel(name) {
  const isChat = name === "chat";
  $("chat-panel").classList.toggle("hidden", !isChat);
  $("chat-panel").classList.toggle("active-panel", isChat);
  $("placeholder-panel").classList.toggle("hidden", isChat);
  if (!isChat) {
    $("placeholder-title").textContent = (features[name] || ["Module unavailable"])[0];
    $("placeholder-description").textContent = (features[name] || ["", "This module is not configured."])[1];
    $("page-title").textContent = (features[name] || ["Module"])[0];
  } else $("page-title").textContent = "Command center";
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.panel === name));
  $("clear-chat").classList.toggle("hidden", !isChat);
  $("model-tools").classList.toggle("hidden", name !== "integrations");
  $("memory-tools").classList.toggle("hidden", name !== "memory" || state.authType !== "supabase");
  if (name === "memory") {
    if (state.authType !== "supabase") $("placeholder-description").textContent = "Sign in with your ULTRON account to manage private memories.";
    else loadMemoryItems();
  }
  $("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
$("return-chat").addEventListener("click", () => switchPanel("chat"));
$("open-sidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
$("close-sidebar").addEventListener("click", () => $("sidebar").classList.remove("open"));
$("new-chat").addEventListener("click", () => {
  stopVoice();
  state.messages = [];
  state.conversationId = null;
  $("messages").replaceChildren();
  $("messages").classList.add("hidden");
  $("welcome-view").classList.remove("hidden");
  refreshConversationHistory();
  $("message-input").focus();
  switchPanel("chat");
});
$("clear-chat").addEventListener("click", () => {
  if (!state.messages.length) return;
  state.messages = [];
  state.conversationId = null;
  $("messages").replaceChildren();
  $("messages").classList.add("hidden");
  $("welcome-view").classList.remove("hidden");
  refreshConversationHistory();
  toast("Current conversation cleared. The saved conversation remains in history.");
});
document.querySelectorAll(".suggestion-card").forEach(button => button.addEventListener("click", () => {
  $("message-input").value = button.dataset.prompt || "";
  resizeTextarea();
  $("message-input").focus();
}));
const imageInput = $("image-input");
function renderImagePreviews() {
  const container = $("image-previews");
  container.replaceChildren();
  container.classList.toggle("hidden", state.attachments.length === 0);
  state.attachments.forEach(item => {
    const card = document.createElement("div");
    card.className = "image-preview";
    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.alt = item.name;
    const label = document.createElement("span");
    label.textContent = item.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove " + item.name);
    remove.addEventListener("click", () => {
      state.attachments = state.attachments.filter(current => current.id !== item.id);
      renderImagePreviews();
    });
    card.append(img, label, remove);
    container.append(card);
  });
}
$("attach-image").addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", async () => {
  const files = Array.from(imageInput.files || []);
  imageInput.value = "";
  if (state.attachments.length + files.length > 2) {
    toast("Attach up to two images per message.");
    return;
  }
  for (const file of files) {
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      toast("Choose a JPEG, PNG, WebP, or GIF image.");
      continue;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast(file.name + " is larger than 4 MB.");
      continue;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read image file."));
        reader.readAsDataURL(file);
      });
      state.attachments.push({ id: crypto.randomUUID(), name: file.name, dataUrl });
    } catch (error) { toast(error.message); }
  }
  renderImagePreviews();
});
// Capture submit before any other handler so the browser never navigates away and clears the chat.
document.addEventListener("submit", event => {
  if (event.target && event.target.id === "chat-form") event.preventDefault();
}, true);
$("chat-form").addEventListener("submit", event => {
  event.preventDefault();
  const submittedText = input.value;
  const submittedAttachments = state.attachments.slice();
  if (!submittedText.trim() && !submittedAttachments.length) return;
  if (state.busy) return;
  void sendMessage(submittedText, submittedAttachments).catch(error => {
    console.error("[ULTRON] Chat submit failed unexpectedly:", error);
    toast("Chat failed before a response: " + (error && error.message ? error.message : "Unexpected frontend error"));
  });
});
const input = $("message-input");
function resizeTextarea() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 180) + "px";
}
input.addEventListener("input", resizeTextarea);
input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $("chat-form").requestSubmit();
  }
});
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function safeMarkdown(value) {
  const tick = String.fromCharCode(96);
  let text = escapeHtml(value);
  const blocks = [];
  const fencePattern = new RegExp(tick + tick + tick + "([a-zA-Z0-9_-]*)\n([\s\S]*?)" + tick + tick + tick, "g");
  text = text.replace(fencePattern, (_match, lang, code) => {
    const token = "ULTRONCODETOKEN" + blocks.length + "END";
    blocks.push("<pre><code>" + code.replace(/\n$/, "") + "</code></pre>");
    return token;
  });
  const inlinePattern = new RegExp(tick + "([^" + tick + "\n]+)" + tick, "g");
  text = text.replace(inlinePattern, "<code>$1</code>");
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    const decoded = url.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(decoded)) return label;
    return '<a href="' + decoded + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
  });
  text = text.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");
  text = text.replace(/^(?:- |\* )(.*)$/gm, "<li>$1</li>");
  text = text.replace(/(<li>.*<\/li>\n?)+/gs, match => "<ul>" + match + "</ul>");
  text = text.split(/\n{2,}/).map(part => {
    if (/^<(pre|ul|blockquote)/.test(part) || /^ULTRONCODETOKEN\d+END$/.test(part)) return part;
    return part.replace(/\n/g, "<br>");
  }).join("\n");
  return text.replace(/ULTRONCODETOKEN(\d+)END/g, (_match, index) => blocks[Number(index)] || "");
}
function addMessage(role, text, typing = false) {
  $("welcome-view").classList.add("hidden");
  $("messages").classList.remove("hidden");
  const wrapper = document.createElement("article");
  wrapper.className = "message " + role;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "YOU" : "U";
  const content = document.createElement("div");
  content.className = "message-content";
  const label = document.createElement("div");
  label.className = "message-role";
  label.textContent = role === "user" ? "OPERATOR" : "ULTRON";
  const body = document.createElement("div");
  body.className = "message-body";
  if (typing) body.innerHTML = '<div class="typing-dots" aria-label="Thinking"><span></span><span></span><span></span></div>';
  else body.innerHTML = safeMarkdown(text);
  content.append(label, body);
  wrapper.append(avatar, content);
  $("messages").append(wrapper);
  $("messages").scrollTop = $("messages").scrollHeight;
  return { wrapper, body };
}
function setBusy(busy) {
  state.busy = busy;
  $("send-button").disabled = busy;
  $("send-button").querySelector("span:first-child").textContent = busy ? "Thinking" : "Send";
}
async function sendMessage(text, attachments = []) {
  const clean = text.trim();
  if ((!clean && !attachments.length) || state.busy) return;
  if (clean.length > 12000) { toast("Message is too long. Please shorten it."); return; }
  state.messages.push({ role: "user", content: clean || "Please analyze the attached image." });
  addMessage("user", (clean || "Please analyze the attached image.") + (attachments.length ? "\n\n[Image attached for this request]" : ""));
  input.value = "";
  resizeTextarea();
  setBusy(true);
  const assistant = addMessage("assistant", "", true);
  let responseText = "";
  try {
    // Persistence is best-effort and must never prevent the actual model request.
    await persistMessage("user", (clean || "Please analyze the attached image.") + (attachments.length ? "\n[Image attached; image data is not saved in chat history]" : ""));
    console.info("[ULTRON] Sending chat request", { messageCount: state.messages.length, hasAttachments: attachments.length > 0 });
    const response = await api("/api/chat", { method: "POST", body: JSON.stringify({ messages: state.messages, attachments: attachments.map(item => ({ name: item.name, dataUrl: item.dataUrl })), stream: true }) });
    if (attachments.length) toast("Image detected. ULTRON is selecting a vision model automatically.");
    else if (response.headers.get("X-ULTRON-Fallback") === "true") toast("Primary model limit reached. ULTRON switched to a backup model.");
    if (!response.body) throw new Error("Streaming is not supported by this connection.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      buffer += decoder.decode(item.value, { stream: true });
      const events = buffer.split(/\n\n/);
      buffer = events.pop() || "";
      for (const eventText of events) {
        let eventType = "message";
        const dataLines = [];
        for (const line of eventText.split(/\r?\n/)) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        let payload;
        try { payload = JSON.parse(dataLines.join("\n")); } catch { continue; }
        if (eventType === "provider_error") throw new Error(payload && payload.error ? payload.error.message : "The provider interrupted the response.");
        if (payload.delta) {
          responseText += payload.delta;
          assistant.body.innerHTML = safeMarkdown(responseText);
          $("messages").scrollTop = $("messages").scrollHeight;
        }
      }
    }
    if (!responseText) responseText = "The provider returned an empty response. Please try again.";
    assistant.body.innerHTML = safeMarkdown(responseText);
    state.messages.push({ role: "assistant", content: responseText });
    await persistMessage("assistant", responseText);
    addCopyButton(assistant.wrapper, responseText);
    if (attachments.length) {
      state.attachments = state.attachments.filter(item => !attachments.some(sent => sent.id === item.id));
      renderImagePreviews();
    }
    if (state.voiceActive) speakAndResume(responseText);
  } catch (error) {
    assistant.body.textContent = error.message;
    assistant.body.style.color = "var(--danger)";
    if (error.status === 401) {
      stopVoice();
      showScreen("login-screen");
    }
  } finally {
    setBusy(false);
    input.focus();
    $("messages").scrollTop = $("messages").scrollHeight;
  }
}
function addCopyButton(wrapper, text) {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  const copy = document.createElement("button");
  copy.className = "message-action";
  copy.textContent = "Copy response";
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); toast("Response copied."); }
    catch { toast("Clipboard access is unavailable in this browser."); }
  });
  actions.append(copy);
  wrapper.querySelector(".message-content").append(actions);
}
async function loadMemoryItems() {
  const list = $("memory-list");
  if (state.authType !== "supabase") {
    list.textContent = "Sign in with your ULTRON account to manage private memories.";
    return;
  }
  list.textContent = "Loading your saved memories…";
  try {
    const response = await api("/api/memory");
    const data = await response.json();
    list.replaceChildren();
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "No saved memories yet. Add one above when you want ULTRON to remember it.";
      list.append(empty);
      return;
    }
    items.forEach(item => {
      const card = document.createElement("article");
      card.className = "memory-card" + (item.is_active ? "" : " inactive");
      const meta = document.createElement("div");
      meta.className = "memory-meta";
      meta.textContent = item.kind.replace(/_/g, " ") + (item.is_active ? " · active" : " · inactive");
      const title = document.createElement("h3");
      title.textContent = item.title;
      const body = document.createElement("p");
      body.textContent = item.content;
      const actions = document.createElement("div");
      actions.className = "memory-actions";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = item.is_active ? "Deactivate" : "Reactivate";
      toggle.addEventListener("click", async () => {
        toggle.disabled = true;
        try {
          await api("/api/memory/" + encodeURIComponent(item.id), { method: "PATCH", body: JSON.stringify({ is_active: !item.is_active }) });
          await loadMemoryItems();
          toast(item.is_active ? "Memory deactivated." : "Memory reactivated.");
        } catch (error) { toast("Memory update failed: " + error.message); toggle.disabled = false; }
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.addEventListener("click", async () => {
        if (!window.confirm("Permanently delete this saved memory?")) return;
        remove.disabled = true;
        try {
          await api("/api/memory/" + encodeURIComponent(item.id), { method: "DELETE" });
          await loadMemoryItems();
          toast("Memory deleted.");
        } catch (error) { toast("Memory deletion failed: " + error.message); remove.disabled = false; }
      });
      actions.append(toggle, remove);
      card.append(meta, title, body, actions);
      list.append(card);
    });
  } catch (error) {
    list.textContent = "Could not load saved memories: " + error.message;
  }
}
$("memory-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("memory-form").querySelector('button[type="submit"]');
  const errorNode = $("memory-error");
  errorNode.textContent = "";
  button.disabled = true;
  try {
    await api("/api/memory", {
      method: "POST",
      body: JSON.stringify({
        kind: $("memory-kind").value,
        title: $("memory-title").value,
        content: $("memory-content").value
      })
    });
    $("memory-form").reset();
    await loadMemoryItems();
    toast("Memory saved to your private ULTRON account.");
  } catch (error) {
    errorNode.textContent = error.message;
  } finally { button.disabled = false; }
});
async function loadPreferences() {
  try {
    const response = await api("/api/preferences");
    const data = await response.json();
    const locale = data.preferences && data.preferences.voice_input_locale;
    if (["en-IN", "hi-IN", "hinglish"].includes(locale)) $("voice-language").value = locale;
  } catch (error) {
    toast("Voice preferences could not be loaded: " + error.message);
  }
}
async function saveVoicePreferences() {
  if (state.authType !== "supabase") return;
  const locale = $("voice-language").value;
  try {
    await api("/api/preferences", {
      method: "PUT",
      body: JSON.stringify({ voice_input_locale: locale })
    });
    toast("Voice language preference saved.");
  } catch (error) {
    toast("Voice preference could not be saved: " + error.message);
  }
}
function voiceSupported() { return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition); }
function startVoice() {
  if (!voiceSupported()) { toast("Speech recognition is not supported in this browser. Try a current version of Chrome or Edge."); return; }
  if (!window.isSecureContext && location.hostname !== "localhost") { toast("Microphone access requires HTTPS."); return; }
  state.voiceActive = true;
  $("voice-banner").classList.remove("hidden");
  $("voice-toggle").innerHTML = "<span>■</span><span>Voice active</span>";
  $("voice-toggle").setAttribute("aria-pressed", "true");
  beginListening();
}
function beginListening() {
  if (!state.voiceActive || state.busy || state.speaking) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  try {
    const recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = $("voice-language").value === "hi-IN" ? "hi-IN" : "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalTranscript = "";
    $("voice-status").textContent = "Listening · " + $("voice-language").options[$("voice-language").selectedIndex].text;
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0] ? event.results[i][0].transcript : "";
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      const heard = (finalTranscript + " " + interim).trim();
      $("voice-status").textContent = heard ? "Heard: " + heard.slice(0, 100) : "Listening · " + $("voice-language").options[$("voice-language").selectedIndex].text;
    };
    recognition.onerror = event => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast("Microphone permission was denied. Enable it in browser settings.");
        stopVoice();
      } else if (event.error !== "no-speech" && event.error !== "aborted") {
        $("voice-status").textContent = "Voice error: " + event.error;
      }
    };
    recognition.onend = () => {
      if (state.recognition === recognition) state.recognition = null;
      if (!state.voiceActive) return;
      const transcript = finalTranscript.trim();
      if (transcript) sendMessage(transcript);
      else if (!state.busy && !state.speaking) {
        clearTimeout(state.voiceRestartTimer);
        state.voiceRestartTimer = setTimeout(beginListening, 350);
      }
    };
    recognition.start();
  } catch (error) {
    toast("Could not start microphone: " + error.message);
    stopVoice();
  }
}
function speakAndResume(text) {
  if (!state.voiceActive || !("speechSynthesis" in window)) {
    if (state.voiceActive) setTimeout(beginListening, 250);
    return;
  }
  state.speaking = true;
  $("voice-status").textContent = "Speaking · stop voice mode to interrupt";
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 8000));
  utterance.lang = $("voice-language").value === "hi-IN" ? "hi-IN" : "en-IN";
  utterance.rate = 1;
  utterance.onend = utterance.onerror = () => {
    state.speaking = false;
    if (state.voiceActive) setTimeout(beginListening, 250);
  };
  window.speechSynthesis.speak(utterance);
}
function stopVoice() {
  state.voiceActive = false;
  state.speaking = false;
  clearTimeout(state.voiceRestartTimer);
  if (state.recognition) {
    const current = state.recognition;
    state.recognition = null;
    try { current.onend = null; current.stop(); } catch {}
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  $("voice-banner").classList.add("hidden");
  $("voice-toggle").innerHTML = "<span>◖</span><span>Voice mode</span>";
  $("voice-toggle").setAttribute("aria-pressed", "false");
}
$("voice-toggle").addEventListener("click", () => state.voiceActive ? stopVoice() : startVoice());
$("stop-voice").addEventListener("click", stopVoice);
document.addEventListener("keydown", event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); $("new-chat").click(); }
  if (event.key === "Escape") $("sidebar").classList.remove("open");
});
window.addEventListener("beforeunload", stopVoice);
window.addEventListener("error", event => {
  console.error("[ULTRON] Unhandled frontend error:", event.error || event.message);
});
window.addEventListener("unhandledrejection", event => {
  console.error("[ULTRON] Unhandled async error:", event.reason);
});
init();

$("voice-language").addEventListener("change", () => {
  saveVoicePreferences();
  if (!state.voiceActive) return;
  if (state.recognition) {
    const current = state.recognition;
    state.recognition = null;
    try { current.onend = null; current.stop(); } catch {}
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  state.speaking = false;
  setTimeout(beginListening, 200);
});

$("load-models").addEventListener("click", async () => {
  const button = $("load-models");
  const list = $("model-list");
  button.disabled = true;
  button.textContent = "Loading available models…";
  list.replaceChildren();
  try {
    const response = await api("/api/models");
    const data = await response.json();
    data.models.forEach(modelId => {
      const row = document.createElement("div");
      row.className = "model-row";
      const name = document.createElement("code");
      name.textContent = modelId;
      const copy = document.createElement("button");
      copy.className = "message-action";
      copy.textContent = "Copy ID";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(modelId); toast("Model ID copied. Select it as OPENROUTER_DEFAULT_MODEL in Render."); }
        catch { toast("Select and copy the model ID manually."); }
      });
      row.append(name, copy);
      list.append(row);
    });
    if (data.defaultModel) {
      const current = document.createElement("p");
      current.className = "model-note";
      current.textContent = "Configured default model: " + data.defaultModel;
      list.prepend(current);
    }
    if (!data.models.length) list.textContent = "No models were returned for this key.";
  } catch (error) {
    list.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Refresh available models";
  }
});
