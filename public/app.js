const $ = (id) => document.getElementById(id);
const state = { messages: [], busy: false, voiceActive: false, recognition: null, speaking: false, voiceRestartTimer: null, toastTimer: null };
const features = {
  memory: ["Memory & knowledge", "Long-term memory will be enabled after a dedicated database and user-isolation policy are configured. No memory is being silently saved."],
  research: ["Research", "Web research and citations are not connected yet. ULTRON will not pretend to search the web or invent sources."],
  media: ["Vision & media", "Image, document, avatar, and video tools require separately verified services. No generation jobs run from this screen yet."],
  tasks: ["Agents & tasks", "Task orchestration and desktop automation are not connected yet. No local computer actions are being simulated."],
  integrations: ["Integrations", "NaraRouter is the configured AI gateway. Voice, research, storage, and media integrations will appear here only after they are implemented and verified."],
  settings: ["Settings", "Voice uses browser speech capabilities when available. Persistent history, account management, and memory controls will be added with the authenticated database layer."]
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
async function init() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
    if (response.status === 503) { showScreen("setup-screen"); return; }
    const session = await response.json();
    if (session.authenticated) {
      showScreen("app-shell");
      await refreshHealth();
    } else showScreen("login-screen");
  } catch {
    showScreen("setup-screen");
    $("setup-screen").querySelector("h1").textContent = "Core unreachable.";
    $("setup-screen").querySelector(".muted").textContent = "Could not connect to the server. Check your connection and refresh.";
  }
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("login-error").textContent = "";
  const button = event.submitter;
  if (button) button.disabled = true;
  try {
    await api("/api/session", { method: "POST", body: JSON.stringify({ password: $("access-password").value }) });
    $("access-password").value = "";
    showScreen("app-shell");
    await refreshHealth();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally { if (button) button.disabled = false; }
});
$("logout-button").addEventListener("click", async () => {
  stopVoice();
  try { await api("/api/logout", { method: "POST", body: "{}" }); } catch {}
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
  $("sidebar").classList.remove("open");
}
document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
$("return-chat").addEventListener("click", () => switchPanel("chat"));
$("open-sidebar").addEventListener("click", () => $("sidebar").classList.add("open"));
$("close-sidebar").addEventListener("click", () => $("sidebar").classList.remove("open"));
$("new-chat").addEventListener("click", () => {
  stopVoice();
  state.messages = [];
  $("messages").replaceChildren();
  $("messages").classList.add("hidden");
  $("welcome-view").classList.remove("hidden");
  $("message-input").focus();
  switchPanel("chat");
});
$("clear-chat").addEventListener("click", () => {
  if (!state.messages.length) return;
  state.messages = [];
  $("messages").replaceChildren();
  $("messages").classList.add("hidden");
  $("welcome-view").classList.remove("hidden");
  toast("Current conversation cleared.");
});
document.querySelectorAll(".suggestion-card").forEach(button => button.addEventListener("click", () => {
  $("message-input").value = button.dataset.prompt || "";
  resizeTextarea();
  $("message-input").focus();
}));
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
async function sendMessage(text) {
  const clean = text.trim();
  if (!clean || state.busy) return;
  if (clean.length > 12000) { toast("Message is too long. Please shorten it."); return; }
  state.messages.push({ role: "user", content: clean });
  addMessage("user", clean);
  input.value = "";
  resizeTextarea();
  setBusy(true);
  const assistant = addMessage("assistant", "", true);
  let responseText = "";
  try {
    const response = await api("/api/chat", { method: "POST", body: JSON.stringify({ messages: state.messages, stream: true }) });
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
    addCopyButton(assistant.wrapper, responseText);
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
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalTranscript = "";
    $("voice-status").textContent = "Listening · Hindi, English or Hinglish";
    recognition.onresult = event => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0] ? event.results[i][0].transcript : "";
        if (event.results[i].isFinal) finalTranscript += transcript;
        else interim += transcript;
      }
      const heard = (finalTranscript + " " + interim).trim();
      $("voice-status").textContent = heard ? "Heard: " + heard.slice(0, 100) : "Listening · Hindi, English or Hinglish";
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
  utterance.lang = /[\u0900-\u097F]/.test(text) ? "hi-IN" : "en-IN";
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
init();
