/**
 * ULTRON AI — JARVIS Command Center Frontend Application
 *
 * Implements real-time telemetry polling, 12-agent monitoring,
 * browser-native speech recognition & synthesis, sandbox execution,
 * emergency kill switch, and multi-tab HUD navigation.
 */

document.addEventListener("DOMContentLoaded", () => {
  // Navigation
  const navTabs = document.querySelectorAll(".nav-tab");
  const tabPanels = document.querySelectorAll(".tab-panel");

  navTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      navTabs.forEach(t => t.classList.remove("active"));
      tabPanels.forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const targetPanel = document.getElementById(tab.dataset.tab);
      if (targetPanel) targetPanel.classList.add("active");
    });
  });

  // State
  let isHalted = false;
  let isListening = false;
  let recognition = null;

  // UI Elements
  const reactorCore = document.getElementById("reactorCore");
  const coreStatusText = document.getElementById("coreStatusText");
  const killSwitchBtn = document.getElementById("killSwitchBtn");
  const autonomyLevelSelect = document.getElementById("autonomyLevelSelect");
  const ramLabel = document.getElementById("ramLabel");
  const cpuLabel = document.getElementById("cpuLabel");
  const chatViewport = document.getElementById("chatViewport");
  const userInput = document.getElementById("userInput");
  const sendBtn = document.getElementById("sendBtn");
  const agentGrid = document.getElementById("agentGrid");
  const sandboxCodeInput = document.getElementById("sandboxCodeInput");
  const runSandboxBtn = document.getElementById("runSandboxBtn");
  const sandboxOutput = document.getElementById("sandboxOutput");
  const auditLogContainer = document.getElementById("auditLogContainer");
  const dailyBriefingText = document.getElementById("dailyBriefingText");
  const pushToTalkBtn = document.getElementById("pushToTalkBtn");
  const stopAudioBtn = document.getElementById("stopAudioBtn");
  const voiceProfileSelect = document.getElementById("voiceProfileSelect");
  const requestPairingBtn = document.getElementById("requestPairingBtn");
  const pairingBox = document.getElementById("pairingBox");
  const pairingCodeDisplay = document.getElementById("pairingCodeDisplay");
  const pcTerminalOutput = document.getElementById("pcTerminalOutput");

  function setCoreState(state) {
    // "idle" | "listening" | "thinking" | "executing" | "alert"
    coreStatusText.textContent = `CORE: ${state.toUpperCase()}`;
    const glow = reactorCore.querySelector(".core-glow");
    if (!glow) return;

    if (state === "alert") {
      glow.style.background = "#ef4444";
      glow.style.boxShadow = "0 0 20px #ef4444";
    } else if (state === "listening") {
      glow.style.background = "#f59e0b";
      glow.style.boxShadow = "0 0 20px #f59e0b";
    } else if (state === "thinking") {
      glow.style.background = "#a855f7";
      glow.style.boxShadow = "0 0 20px #a855f7";
    } else if (state === "executing") {
      glow.style.background = "#10b981";
      glow.style.boxShadow = "0 0 20px #10b981";
    } else {
      glow.style.background = "#00f0ff";
      glow.style.boxShadow = "0 0 15px #00f0ff";
    }
  }

  // --- Telemetry Polling ---
  async function pollTelemetry() {
    try {
      const res = await fetch("/api/jarvis/telemetry");
      if (!res.ok) return;
      const data = await res.json();
      const t = data.telemetry;

      if (t?.memory) {
        ramLabel.textContent = `${t.memory.usedPercent}% (${Math.round(t.memory.usedBytes / 1024 / 1024)} MB)`;
        if (t.memory.memoryPressureWarning) {
          ramLabel.style.color = "#ef4444";
          ramLabel.title = "High memory pressure on 8GB host!";
        } else {
          ramLabel.style.color = "#00f0ff";
        }
      }

      if (t?.cpuModel) {
        cpuLabel.textContent = `${t.cpuModel} (${t.cpuCores}T)`;
      }

      if (data.emergencyStop) {
        isHalted = true;
        setCoreState("alert");
        killSwitchBtn.textContent = "RESET EMERGENCY STOP";
        killSwitchBtn.classList.remove("btn-danger");
        killSwitchBtn.classList.add("btn-warning");
      }
    } catch {}
  }

  setInterval(pollTelemetry, 4000);
  pollTelemetry();

  // --- 12-Agent Matrix ---
  async function loadAgents() {
    try {
      const res = await fetch("/api/jarvis/agents");
      if (!res.ok) return;
      const data = await res.json();
      agentGrid.innerHTML = "";

      data.agents.forEach(agent => {
        const card = document.createElement("div");
        card.className = "agent-card";
        card.innerHTML = `
          <div class="agent-card-header">
            <span class="agent-card-title">${agent.name}</span>
            <span class="badge">ONLINE</span>
          </div>
          <div class="agent-card-role">${agent.role}</div>
          <div class="agent-card-desc">${agent.description}</div>
        `;
        agentGrid.appendChild(card);
      });
    } catch {}
  }
  loadAgents();

  // --- Daily Briefing ---
  async function loadBriefing() {
    try {
      const res = await fetch("/api/jarvis/productivity/briefing");
      if (!res.ok) return;
      const data = await res.json();
      if (data.briefing?.spokenSummary) {
        dailyBriefingText.textContent = data.briefing.spokenSummary;
      }
    } catch {}
  }
  loadBriefing();

  // --- Audit Trail ---
  async function loadAuditLogs() {
    try {
      const res = await fetch("/api/jarvis/audit");
      if (!res.ok) return;
      const data = await res.json();
      auditLogContainer.innerHTML = "";

      data.logs.forEach(log => {
        const row = document.createElement("div");
        row.className = "audit-entry";
        const time = new Date(log.timestamp).toLocaleTimeString();
        row.innerHTML = `
          <span class="audit-time">[${time}]</span>
          <span class="audit-actor">${log.actor}</span>
          <span class="audit-action">${log.action}</span>
          <span class="audit-desc">${JSON.stringify(log.details)}</span>
        `;
        auditLogContainer.appendChild(row);
      });
    } catch {}
  }
  loadAuditLogs();
  setInterval(loadAuditLogs, 8000);

  // --- Chat & Command Flow ---
  function appendMessage(sender, text, isUser = false) {
    const msg = document.createElement("div");
    msg.className = `message ${isUser ? "user" : "system"}`;
    msg.innerHTML = `<span class="sender">${sender}:</span><span class="text">${text}</span>`;
    chatViewport.appendChild(msg);
    chatViewport.scrollTop = chatViewport.scrollHeight;
  }

  async function handleUserSend() {
    const text = userInput.value.trim();
    if (!text) return;
    userInput.value = "";
    appendMessage("OPERATOR", text, true);
    setCoreState("thinking");

    try {
      // 1. Brain classification
      const classifyRes = await fetch("/api/jarvis/brain/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text })
      });
      const classifyData = await classifyRes.json();

      // 2. Chat dispatch
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, model: classifyData.complexity?.recommendedModel })
      });

      if (!chatRes.ok) {
        throw new Error(`Server returned HTTP ${chatRes.status}`);
      }

      const chatData = await chatRes.json();
      const reply = chatData.reply || chatData.response || "Task evaluated by ULTRON CORE.";
      appendMessage("ULTRON", reply, false);
      setCoreState("idle");

      // Optional voice speak out if speech is enabled
      speakSpokenText(reply);
    } catch (err) {
      appendMessage("ULTRON CORE", `Execution note: ${err.message}`, false);
      setCoreState("idle");
    }
  }

  sendBtn.addEventListener("click", handleUserSend);
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleUserSend();
  });

  // --- Speech Recognition & Synthesis ---
  function speakSpokenText(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();

    // Clean text for speech
    const clean = text.replace(/```[\s\S]*?```/g, "").replace(/[*_#`]/g, "").slice(0, 300);
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = 1.05;
    utter.pitch = 0.9;
    window.speechSynthesis.speak(utter);
  }

  stopAudioBtn.addEventListener("click", () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setCoreState("idle");
  });

  const voiceLanguageSelect = document.getElementById("voiceLanguageSelect");
  if (voiceLanguageSelect) {
    voiceLanguageSelect.addEventListener("change", (e) => {
      const lang = e.target.value;
      if (recognition) {
        recognition.lang = lang === "hi-IN" ? "hi-IN" : "en-IN";
      }
      appendMessage("VOICE AGENT", `Speech dialect set to ${lang.toUpperCase()}.`, false);
    });
  }

  const speakOfflineBtn = document.getElementById("speakOfflineBtn");
  if (speakOfflineBtn) {
    speakOfflineBtn.addEventListener("click", async () => {
      try {
        speakOfflineBtn.disabled = true;
        speakOfflineBtn.textContent = "🔊 Speaking...";
        await fetch("/api/jarvis/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "All systems nominal, sir. ULTRON AI is fully operational." })
        });
      } catch (err) {
        console.error("Offline speech error:", err);
      } finally {
        speakOfflineBtn.disabled = false;
        speakOfflineBtn.textContent = "🔊 Test PC Speaker (Offline SAPI)";
      }
    });
  }

  if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-IN"; // Default Hinglish / Indian English

    recognition.onstart = () => {
      isListening = true;
      setCoreState("listening");
      pushToTalkBtn.textContent = "🎙️ Listening...";
    };

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      userInput.value = transcript;
      handleUserSend();
    };

    recognition.onend = () => {
      isListening = false;
      pushToTalkBtn.textContent = "🎙️ Push To Talk";
      if (!isHalted) setCoreState("idle");
    };

    pushToTalkBtn.addEventListener("click", () => {
      if (isListening) recognition.stop();
      else recognition.start();
    });
  } else {
    pushToTalkBtn.disabled = true;
    pushToTalkBtn.title = "Web Speech API not supported in this browser. Use text input.";
  }

  // --- Coding Sandbox Execution ---
  runSandboxBtn.addEventListener("click", async () => {
    const code = sandboxCodeInput.value.trim();
    if (!code) return;
    sandboxOutput.textContent = "// Executing isolated code...";

    try {
      const res = await fetch("/api/jarvis/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      const r = data.result;
      sandboxOutput.textContent = `Exit Code: ${r.exitCode} (${r.durationMs}ms)\n\nSTDOUT:\n${r.stdout || "(none)"}\n\nSTDERR:\n${r.stderr || "(none)"}`;
    } catch (err) {
      sandboxOutput.textContent = `Sandbox Error: ${err.message}`;
    }
  });

  // --- Emergency Kill Switch ---
  killSwitchBtn.addEventListener("click", async () => {
    if (!isHalted) {
      if (!confirm("ENGAGE EMERGENCY STOP?\nThis will immediately abort all active agent tasks, pause companions, and freeze execution.")) return;
      try {
        const res = await fetch("/api/jarvis/emergency/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "Operator pressed emergency kill switch" })
        });
        const data = await res.json();
        isHalted = true;
        setCoreState("alert");
        killSwitchBtn.textContent = "RESET EMERGENCY STOP";
        killSwitchBtn.classList.remove("btn-danger");
        killSwitchBtn.classList.add("btn-warning");
        appendMessage("EMERGENCY GUARD", "SYSTEM HALTED: All active tasks aborted.", false);
      } catch (err) {
        alert("Failed to engage emergency stop: " + err.message);
      }
    } else {
      try {
        await fetch("/api/jarvis/emergency/reset", { method: "POST" });
        isHalted = false;
        setCoreState("idle");
        killSwitchBtn.textContent = "⚡ EMERGENCY STOP";
        killSwitchBtn.classList.remove("btn-warning");
        killSwitchBtn.classList.add("btn-danger");
        appendMessage("EMERGENCY GUARD", "Emergency stop reset. Core systems active.", false);
      } catch (err) {
        alert("Failed to reset emergency stop: " + err.message);
      }
    }
  });

  // --- Autonomy Level Change ---
  autonomyLevelSelect.addEventListener("change", async (e) => {
    const level = Number(e.target.value);
    try {
      const res = await fetch("/api/jarvis/autonomy/level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level })
      });
      const data = await res.json();
      appendMessage("POLICY GUARD", `Autonomy level updated to Level ${level} (${data.config?.name}): ${data.config?.description}`, false);
    } catch {}
  });

  // --- Device Pairing ---
  requestPairingBtn.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/jarvis/devices/pair/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Mobile Companion", platform: "android" })
      });
      const data = await res.json();
      pairingCodeDisplay.textContent = data.code;
      pairingBox.style.display = "block";
    } catch {}
  });

  // --- PC Quick Commands ---
  document.getElementById("runGitStatusBtn")?.addEventListener("click", async () => {
    pcTerminalOutput.textContent = "Running git status...";
    try {
      const res = await fetch("/api/jarvis/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "import { execSync } from 'child_process'; console.log(execSync('git status --short').toString());" })
      });
      const data = await res.json();
      pcTerminalOutput.textContent = data.result.stdout || "(clean working tree)";
    } catch (err) {
      pcTerminalOutput.textContent = err.message;
    }
  });

  document.getElementById("runNodeVerBtn")?.addEventListener("click", async () => {
    pcTerminalOutput.textContent = "Node: " + navigator.userAgent;
  });

  // --- Native Windows Automation Controls ---
  document.getElementById("lockPcBtn")?.addEventListener("click", async () => {
    if (!confirm("Lock Windows workstation session?")) return;
    try {
      await fetch("/api/jarvis/pc/lock", { method: "POST" });
      appendMessage("SYSTEM AGENT", "Workstation session locked successfully.", false);
    } catch (err) {
      alert("Lock failed: " + err.message);
    }
  });

  document.getElementById("captureScreenBtn")?.addEventListener("click", async () => {
    pcTerminalOutput.textContent = "Capturing primary display...";
    try {
      const res = await fetch("/api/jarvis/pc/screenshot", { method: "POST" });
      const data = await res.json();
      pcTerminalOutput.textContent = `Screenshot captured: ${data.filename || "success"} (${data.sizeBytes || "done"} bytes)`;
      appendMessage("VISION AGENT", `Primary screen frame captured and analyzed. Active context updated.`, false);
    } catch (err) {
      pcTerminalOutput.textContent = "Screen capture failed: " + err.message;
    }
  });

  document.getElementById("volDownBtn")?.addEventListener("click", async () => {
    await fetch("/api/jarvis/pc/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "volume_down" })
    });
  });

  document.getElementById("volUpBtn")?.addEventListener("click", async () => {
    await fetch("/api/jarvis/pc/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "volume_up" })
    });
  });

  document.getElementById("volMuteBtn")?.addEventListener("click", async () => {
    await fetch("/api/jarvis/pc/volume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mute" })
    });
  });

  // Poll Battery Status
  async function pollBattery() {
    try {
      const res = await fetch("/api/jarvis/pc/battery");
      const data = await res.json();
      const label = document.getElementById("batteryPercentLabel");
      if (label && data) {
        label.textContent = `${data.percent}% (${data.isCharging ? "Charging" : "Discharging"})`;
      }
    } catch {}
  }
  pollBattery();
  setInterval(pollBattery, 60000);
});
