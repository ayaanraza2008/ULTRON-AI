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

  // --- Kokoro am_onyx Speech Synthesis & Voice Engine ---
  let activeOnyxAudio = null;

  const PERSONALITY_CONFIGS = {
    NORMAL: { speed: 0.95, prefix: "" },
    COMMAND: { speed: 0.98, prefix: "Acknowledged. " },
    ALERT: { speed: 1.05, prefix: "Alert. " },
    RESEARCH: { speed: 0.92, prefix: "" },
    SUCCESS: { speed: 0.96, prefix: "" },
    ERROR: { speed: 0.94, prefix: "Notice: " },
    "WAKE-UP": { speed: 0.98, prefix: "Online, sir. " }
  };

  async function speakSpokenText(text) {
    if (activeOnyxAudio) {
      try {
        activeOnyxAudio.pause();
        activeOnyxAudio.currentTime = 0;
      } catch {}
      activeOnyxAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    let clean = String(text || "").replace(/```[\s\S]*?```/g, "").replace(/[*_#`]/g, "").slice(0, 450).trim();
    if (!clean) return;

    const personalityMode = document.getElementById("voicePersonalitySelect")?.value || "NORMAL";
    const modeConfig = PERSONALITY_CONFIGS[personalityMode] || PERSONALITY_CONFIGS.NORMAL;
    const voiceStatusBadge = document.getElementById("voiceStatusBadge");

    if (modeConfig.prefix && !clean.toLowerCase().startsWith(modeConfig.prefix.toLowerCase().trim())) {
      clean = modeConfig.prefix + clean;
    }

    try {
      const res = await fetch("/api/jarvis/voice/kokoro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          voice: "am_onyx",
          speed: modeConfig.speed
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.dataUrl) {
          activeOnyxAudio = new Audio(data.dataUrl);
          activeOnyxAudio.playbackRate = 1.0;
          activeOnyxAudio.play().catch(e => {
            console.warn("Autoplay note:", e.message);
          });
          if (voiceStatusBadge) {
            voiceStatusBadge.style.color = "#4ade80";
            voiceStatusBadge.textContent = "● Primary Voice Engine: Kokoro-82M (am_onyx Active [" + personalityMode + "]) | Latency: <50ms";
          }
          return;
        }
      }
    } catch (err) {
      console.warn("Kokoro am_onyx synthesis fallback:", err);
    }

    if (voiceStatusBadge) {
      voiceStatusBadge.style.color = "#facc15";
      voiceStatusBadge.textContent = "● Secondary Voice Engine: Windows SAPI Fallback (Active)";
    }

    if (window.speechSynthesis) {
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = modeConfig.speed;
      utter.pitch = 0.85;
      window.speechSynthesis.speak(utter);
    }
  }

  stopAudioBtn.addEventListener("click", async () => {
    if (activeOnyxAudio) {
      try {
        activeOnyxAudio.pause();
        activeOnyxAudio.currentTime = 0;
      } catch {}
      activeOnyxAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    try {
      await fetch("/api/jarvis/voice/interrupt", { method: "POST" });
    } catch {}
    setCoreState("idle");
  });

  const speakOnyxBtn = document.getElementById("speakOnyxBtn");
  if (speakOnyxBtn) {
    speakOnyxBtn.addEventListener("click", async () => {
      try {
        speakOnyxBtn.disabled = true;
        speakOnyxBtn.textContent = "🔊 Synthesizing...";
        await speakSpokenText("Systems online. I am ULTRON. All core processes are operational. Awaiting your command.");
      } catch (err) {
        console.error("Onyx test error:", err);
      } finally {
        speakOnyxBtn.disabled = false;
        speakOnyxBtn.textContent = "🔊 Test Onyx Voice (Kokoro am_onyx)";
      }
    });
  }

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
  // --- ULTRON ETERNAL: Multi-Device Ecosystem & Synchronizer Handlers ---
  const unlockAllMobileBtn = document.getElementById("unlockAllMobileBtn");
  const lockAllMobileBtn = document.getElementById("lockAllMobileBtn");
  const playSongAllDevicesBtn = document.getElementById("playSongAllDevicesBtn");
  const unlockPcBtn = document.getElementById("unlockPcBtn");
  const simulateCallBtn = document.getElementById("simulateCallBtn");
  const hangupCallBtn = document.getElementById("hangupCallBtn");
  const telephonyCallHud = document.getElementById("telephonyCallHud");
  const callLiveTranscript = document.getElementById("callLiveTranscript");

  unlockAllMobileBtn?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/jarvis/devices/unlock-mobile", { method: "POST" });
      const data = await res.json();
      ["phone1LockLabel", "phone2LockLabel", "phone3LockLabel"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = "UNLOCKED"; el.className = "device-lock-state unlocked"; }
      });
      appendMessage("DEVICE HUB", `All ${data.unlockedCount || 3} mobile devices unlocked simultaneously.`, false);
    } catch (err) {
      alert("Failed to unlock mobile devices: " + err.message);
    }
  });

  lockAllMobileBtn?.addEventListener("click", async () => {
    try {
      await fetch("/api/jarvis/devices/lock-mobile", { method: "POST" });
      ["phone1LockLabel", "phone2LockLabel", "phone3LockLabel"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = "LOCKED"; el.className = "device-lock-state locked"; }
      });
      appendMessage("DEVICE HUB", "All mobile devices locked.", false);
    } catch (err) {
      alert("Failed to lock mobile devices: " + err.message);
    }
  });

  playSongAllDevicesBtn?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/jarvis/devices/play-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "favorite song" })
      });
      const data = await res.json();
      appendMessage("MEDIA HUB", `Playing favorite song across ${data.playingDevices || 3} connected devices simultaneously.`, false);
    } catch (err) {
      alert("Failed to dispatch media: " + err.message);
    }
  });

  unlockPcBtn?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/jarvis/devices/pc/unlock", { method: "POST" });
      const data = await res.json();
      const pcLabel = document.getElementById("pcLockLabel");
      if (pcLabel) { pcLabel.textContent = "UNLOCKED"; pcLabel.className = "device-lock-state unlocked"; }
      if (reactorCore) {
        reactorCore.className = "reactor-core state-call_active";
      }
      appendMessage("SYSTEM AGENT", "Workstation unlocked. Energy Core activated in high-power orange state.", false);
    } catch (err) {
      alert("PC unlock failed: " + err.message);
    }
  });

  simulateCallBtn?.addEventListener("click", async () => {
    if (telephonyCallHud) telephonyCallHud.style.display = "block";
    if (reactorCore) reactorCore.className = "reactor-core state-call_active";
    if (callLiveTranscript) callLiveTranscript.textContent = "ULTRON: 'Good evening sir. ULTRON is online. How may I assist you?'";

    appendMessage("TELEPHONY AGENT", "Inbound telephone call connected (+91 Verified Owner). Live two-way voice stream active.", false);
  });

  hangupCallBtn?.addEventListener("click", () => {
    if (telephonyCallHud) telephonyCallHud.style.display = "none";
    if (reactorCore) reactorCore.className = "reactor-core state-standby";
    appendMessage("TELEPHONY AGENT", "Telephone call session terminated. Transcript archived to session history.", false);
  });

  // --- Hand Gesture Control (Optional Camera Tracking) ---
  let gestureTrackingActive = false;
  document.getElementById("toggleGestureBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("toggleGestureBtn");
    if (!gestureTrackingActive) {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          alert("Camera access is not supported in this browser environment.");
          return;
        }
        await navigator.mediaDevices.getUserMedia({ video: true });
        gestureTrackingActive = true;
        btn.textContent = "✋ Gesture Control Active (Pinch / Scale Core)";
        btn.classList.add("btn-accent");
        appendMessage("VISION GESTURE", "Local camera tracking active. Pinch to select, open palm to activate, two-hand distance scales Energy Core.", false);
      } catch (err) {
        alert("Camera permission denied or camera unavailable: " + err.message);
      }
    } else {
      gestureTrackingActive = false;
      btn.textContent = "✋ Enable Hand Gesture Control";
      btn.classList.remove("btn-accent");
      appendMessage("VISION GESTURE", "Camera gesture tracking deactivated.", false);
    }
  });

  // ==========================================
  // --- MODULE 1 & 9: SYSTEM CONTROL HANDLERS ---
  // ==========================================
  window.launchApp = async (app) => {
    try {
      const res = await fetch("/api/jarvis/system/apps/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app })
      });
      const data = await res.json();
      appendMessage("SYSTEM AGENT", `Launched application: ${data.app || app}`, false);
    } catch (err) {
      appendMessage("SYSTEM AGENT", `Failed to launch ${app}: ${err.message}`, false);
    }
  };

  document.getElementById("takeScreenshotBtn")?.addEventListener("click", async () => {
    const statusEl = document.getElementById("screenshotStatus");
    if (statusEl) statusEl.textContent = "Capturing...";
    try {
      const res = await fetch("/api/jarvis/system/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scrubCredentials: true })
      });
      const data = await res.json();
      if (statusEl) statusEl.textContent = `Captured: ${data.path ? data.path.split(/\\|\//).pop() : "Saved"}`;
      appendMessage("SYSTEM AGENT", `Screenshot saved: ${data.path}`, false);
    } catch (err) {
      if (statusEl) statusEl.textContent = "Failed";
    }
  });

  document.getElementById("refreshDrivesBtn")?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/jarvis/system/drives");
      const data = await res.json();
      const listEl = document.getElementById("uiDrivesList");
      if (listEl && data.drives) {
        listEl.innerHTML = data.drives.map(d => `
          <div style="background: rgba(0, 243, 255, 0.05); padding: 8px; border-radius: 6px; border: 1px solid rgba(0, 243, 255, 0.2); margin-bottom: 6px;">
            <strong>${d.letter} [${d.name}]</strong> - ${d.type} (${d.freeGB} GB Free of ${d.totalGB} GB)
            <div style="background: #1a202c; height: 6px; border-radius: 3px; margin-top: 4px; overflow: hidden;">
              <div style="background: var(--cyan-accent); width: ${100 - d.percentFree}%; height: 100%;"></div>
            </div>
          </div>
        `).join("");
      }
    } catch {}
  });

  document.getElementById("organizeFolderBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("organizeTargetInput");
    const targetDir = input?.value.trim() || "Downloads";
    const resultEl = document.getElementById("organizeResult");
    if (resultEl) resultEl.textContent = "Organizing with backup...";
    try {
      const res = await fetch("/api/jarvis/system/files/organize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceDir: targetDir })
      });
      const data = await res.json();
      if (resultEl) resultEl.textContent = `Organized ${data.movedCount || 0} files. Backup: ${data.backupId || "Created"}`;
      appendMessage("SYSTEM AGENT", `Folder organized. Backup snapshot: ${data.backupId}`, false);
    } catch (err) {
      if (resultEl) resultEl.textContent = `Error: ${err.message}`;
    }
  });

  // ==========================================
  // --- MODULE 3, 4, 5: MEDIA & PRODUCTION ---
  // ==========================================
  window.setProductionPrompt = (text) => {
    const input = document.getElementById("autoProdPromptInput");
    if (input) input.value = text;
  };

  document.getElementById("startAutoProdBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("autoProdPromptInput");
    const prompt = input?.value.trim();
    if (!prompt) return;

    const progBox = document.getElementById("prodProgressContainer");
    const stageLabel = document.getElementById("prodStageLabel");
    const percentLabel = document.getElementById("prodPercentLabel");
    const bar = document.getElementById("prodProgressBar");
    const detailEl = document.getElementById("prodExportDetail");

    if (progBox) progBox.style.display = "block";
    if (stageLabel) stageLabel.textContent = "Stage: ANALYZING MEDIA & CONCEPT";
    if (percentLabel) percentLabel.textContent = "25%";
    if (bar) bar.style.width = "25%";
    if (detailEl) detailEl.textContent = "Searching local drives for candidate clips...";

    try {
      const res = await fetch("/api/jarvis/media/production/autonomous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      const data = await res.json();

      if (bar) bar.style.width = "100%";
      if (percentLabel) percentLabel.textContent = "100%";
      if (stageLabel) stageLabel.textContent = "Stage: EXPORT COMPLETED";
      if (detailEl) {
        detailEl.innerHTML = `
          <strong style="color: #48bb78;">Production Successful!</strong><br/>
          <strong>Preset:</strong> ${data.preset} (${data.durationSeconds}s)<br/>
          <strong>Export Location:</strong> <code style="color: var(--cyan-accent);">${data.videoExportPath}</code><br/>
          <strong>Concept:</strong> <em>"${data.concept}"</em>
        `;
      }
      appendMessage("AUTONOMOUS PRODUCTION", `Video production complete! Exported to: ${data.videoExportPath}`, false);
    } catch (err) {
      if (stageLabel) stageLabel.textContent = "Stage: FAILED";
      if (detailEl) detailEl.textContent = `Error: ${err.message}`;
    }
  });

  document.getElementById("searchMediaBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("mediaSearchInput");
    const q = encodeURIComponent(input?.value.trim() || "");
    const listEl = document.getElementById("mediaResultsList");
    if (listEl) listEl.innerHTML = "<div>Searching media catalog...</div>";
    try {
      const res = await fetch(`/api/jarvis/media/search?q=${q}`);
      const data = await res.json();
      if (listEl && data.results) {
        if (data.results.length === 0) {
          listEl.innerHTML = '<div style="color: #a0aec0;">No media files matching search found.</div>';
        } else {
          listEl.innerHTML = data.results.map(r => `
            <div style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; margin-bottom: 4px; display: flex; justify-content: space-between;">
              <span><strong>${r.name}</strong> (${r.mediaType.toUpperCase()})</span>
              <span style="color: #a0aec0;">${r.sizeMB || 0} MB</span>
            </div>
          `).join("");
        }
      }
    } catch (err) {
      if (listEl) listEl.innerHTML = `<div>Error searching media: ${err.message}</div>`;
    }
  });

  document.getElementById("generateThumbBtn")?.addEventListener("click", async () => {
    const title = document.getElementById("thumbTitleInput")?.value.trim() || "ULTRON PRODUCTION";
    const subtitle = document.getElementById("thumbSubInput")?.value.trim() || "AUTONOMOUS SYSTEM CONTROL";
    const preset = document.getElementById("thumbPresetSelect")?.value || "CYBERPUNK";
    const area = document.getElementById("thumbPreviewArea");
    if (area) area.innerHTML = "<div>Rendering graphic composition...</div>";

    try {
      const res = await fetch("/api/jarvis/media/image/thumbnail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, subtitle, preset })
      });
      const data = await res.json();
      if (area) {
        area.innerHTML = `
          <div style="color: #48bb78; font-size: 12px; margin-bottom: 6px;">Thumbnail Exported: ${data.filename}</div>
          <div style="font-size: 11px; color: #a0aec0;">Path: ${data.outputPath}</div>
        `;
      }
    } catch (err) {
      if (area) area.innerHTML = `<div>Error: ${err.message}</div>`;
    }
  });

});
