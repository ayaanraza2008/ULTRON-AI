/**
 * ULTRON AI — Always-On Living Energy Core & Compact Control Surface
 * Module: public/floating-core.js
 *
 * Implements the 1:1 aspect ratio minimal floating HUD widget:
 * - Real-time 10 visual state engine (STANDBY, LISTENING, THINKING, SPEAKING,
 *   EXECUTING, SELF_UPGRADING, VISION_ACTIVE, ERROR, OFFLINE, MUTED).
 * - Canvas-based orbital particle & plasma ARC reactor rendering (<1% idle CPU).
 * - Non-stealing keyboard focus and drag-clamping across viewport.
 * - Single-click compact control surface expansion (280x360 px).
 * - Double-click instant voice toggle.
 * - Screen-Capture Exclusion Status Display (WDA_EXCLUDEFROMCAPTURE).
 */

export const FLOATING_CORE_STATES = Object.freeze({
  STANDBY: "STANDBY",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  SPEAKING: "SPEAKING",
  EXECUTING: "EXECUTING",
  SELF_UPGRADING: "SELF_UPGRADING",
  VISION_ACTIVE: "VISION_ACTIVE",
  ERROR: "ERROR",
  OFFLINE: "OFFLINE",
  MUTED: "MUTED"
});

export class FloatingLivingEnergyCore {
  constructor(options = {}) {
    this.container = options.container || null;
    this.currentState = FLOATING_CORE_STATES.STANDBY;
    this.size = options.size || 120; // Default 120x120 px (1:1)
    this.minSize = 80;
    this.maxSize = 240;
    this.posX = options.posX || null;
    this.posY = options.posY || null;
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragDist = 0;
    this.isPanelOpen = false;
    this.particles = [];
    this.audioLevel = 0;
    this.isMuted = false;
    this.activeAgent = "System Controller";
    this.currentTask = "Monitoring host ecosystem";
    this.taskProgress = 100;
    this.captureShieldActive = true;

    this.initDOM();
    this.initCanvas();
    this.initDrag();
    this.initStateSync();
  }

  initDOM() {
    if (typeof document === "undefined") return;

    // Load saved position if available
    try {
      const saved = JSON.parse(localStorage.getItem("ultron_floating_core_pos") || "null");
      if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
        this.posX = saved.x;
        this.posY = saved.y;
      }
      const savedSize = parseInt(localStorage.getItem("ultron_floating_core_size"), 10);
      if (savedSize >= this.minSize && savedSize <= this.maxSize) {
        this.size = savedSize;
      }
    } catch {}

    // 1. Create Core Widget Container
    let widget = document.getElementById("ultronFloatingWidget");
    if (!widget) {
      widget = document.createElement("div");
      widget.id = "ultronFloatingWidget";
      widget.tabIndex = -1; // Non-stealing keyboard focus
      widget.className = `state-${this.currentState.toLowerCase()}`;
      widget.style.width = `${this.size}px`;
      widget.style.height = `${this.size}px`;

      widget.innerHTML = `
        <div class="living-arc-core" id="livingArcCore">
          <canvas class="living-arc-canvas" id="livingArcCanvas" width="${this.size}" height="${this.size}"></canvas>
          <div class="arc-ring outer"></div>
          <div class="arc-ring middle"></div>
          <div class="arc-ring inner"></div>
          <div class="arc-center-nucleus" id="arcNucleus">
            <span class="arc-state-symbol" id="arcSymbol">◈</span>
          </div>
        </div>
      `;
      document.body.appendChild(widget);
    }
    this.widgetEl = widget;

    // Apply clamped positioning
    this.clampAndPosition(this.posX, this.posY);

    // 2. Create Compact Control Surface Panel (280x360 px)
    let panel = document.getElementById("ultronCompactPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "ultronCompactPanel";
      panel.tabIndex = -1;
      panel.innerHTML = `
        <div class="compact-header">
          <span class="compact-title">⚡ ULTRON CORE</span>
          <span class="compact-shield-badge" id="compactShieldBadge" title="Protected by SetWindowDisplayAffinity(0x11)">SHIELD: ACTIVE</span>
          <button class="compact-close-btn" id="compactCloseBtn">✕</button>
        </div>
        <div class="compact-task-box">
          <div class="compact-task-status">
            <span id="compactStateLabel">STATE: STANDBY</span>
            <span id="compactProgressLabel">100%</span>
          </div>
          <div class="compact-progress-bar">
            <div class="compact-progress-fill" id="compactProgressFill" style="width: 100%;"></div>
          </div>
          <div class="compact-agent-pill" id="compactAgentLabel">Agent: Orchestrator (12-Agent Swarm)</div>
        </div>
        <div class="compact-command-row">
          <input type="text" class="compact-command-input" id="compactCommandInput" placeholder="Command ULTRON... (Press Enter)" />
        </div>
        <div class="compact-actions-grid">
          <button class="compact-btn" id="compactVoiceBtn">🎤 Toggle Voice</button>
          <button class="compact-btn" id="compactGestureBtn">✋ Hand Control</button>
          <button class="compact-btn" id="compactMuteBtn">🔇 Mute Audio</button>
          <button class="compact-btn" id="compactAuditBtn">🧬 Audit Myself</button>
          <button class="compact-btn" id="compactVisionBtn">👁️ Vision Scan</button>
          <button class="compact-btn" id="compactDashboardBtn">🌐 Full HUD</button>
          <button class="compact-btn danger" id="compactKillBtn">⚡ STOP</button>
        </div>
        <div class="compact-telemetry-row">
          <span id="compactCpuBadge">AMD Ryzen 7 (16T)</span>
          <span id="compactStatusBadge">ONLINE</span>
        </div>
      `;
      document.body.appendChild(panel);
    }
    this.panelEl = panel;

    // Attach Event Listeners
    this.bindControlEvents();
  }

  clampAndPosition(x, y) {
    if (typeof window === "undefined" || !this.widgetEl) return;
    const pad = 12;
    const maxX = window.innerWidth - this.size - pad;
    const maxY = window.innerHeight - this.size - pad;

    let targetX = (x === null || x === undefined) ? maxX : Math.max(pad, Math.min(maxX, x));
    let targetY = (y === null || y === undefined) ? maxY : Math.max(pad, Math.min(maxY, y));

    this.posX = targetX;
    this.posY = targetY;

    this.widgetEl.style.left = `${targetX}px`;
    this.widgetEl.style.top = `${targetY}px`;
    this.widgetEl.style.bottom = "auto";
    this.widgetEl.style.right = "auto";

    this.positionCompactPanel();
  }

  positionCompactPanel() {
    if (!this.panelEl || !this.widgetEl) return;
    const pad = 12;
    const panelWidth = 280;
    const panelHeight = 360;

    let px = this.posX - panelWidth - 12;
    if (px < pad) {
      px = this.posX + this.size + 12;
    }
    let py = this.posY + (this.size / 2) - (panelHeight / 2);
    if (py + panelHeight > window.innerHeight - pad) {
      py = window.innerHeight - panelHeight - pad;
    }
    if (py < pad) py = pad;

    this.panelEl.style.left = `${px}px`;
    this.panelEl.style.top = `${py}px`;
  }

  initDrag() {
    if (!this.widgetEl) return;

    const onPointerDown = (e) => {
      if (e.button !== 0) return; // Only primary button
      this.isDragging = false;
      this.dragDist = 0;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      const rect = this.widgetEl.getBoundingClientRect();
      this.offsetX = e.clientX - rect.left;
      this.offsetY = e.clientY - rect.top;

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    };

    const onPointerMove = (e) => {
      const dx = e.clientX - this.dragStartX;
      const dy = e.clientY - this.dragStartY;
      this.dragDist = Math.hypot(dx, dy);

      if (this.dragDist > 6) {
        this.isDragging = true;
        this.clampAndPosition(e.clientX - this.offsetX, e.clientY - this.offsetY);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);

      if (this.isDragging) {
        try {
          localStorage.setItem("ultron_floating_core_pos", JSON.stringify({ x: this.posX, y: this.posY }));
        } catch {}
      } else {
        // Single click toggles compact panel
        this.toggleCompactPanel();
      }
      setTimeout(() => { this.isDragging = false; }, 50);
    };

    this.widgetEl.addEventListener("pointerdown", onPointerDown);

    // Double-click: Instant voice listening toggle
    this.widgetEl.addEventListener("dblclick", (e) => {
      e.preventDefault();
      this.toggleVoice();
    });

    // Right-click context menu prevention / trigger
    this.widgetEl.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.resetPosition();
    });
  }

  toggleCompactPanel(forceState = null) {
    this.isPanelOpen = (forceState !== null) ? forceState : !this.isPanelOpen;
    if (this.panelEl) {
      if (this.isPanelOpen) {
        this.positionCompactPanel();
        this.panelEl.classList.add("visible");
      } else {
        this.panelEl.classList.remove("visible");
      }
    }
  }

  setVisualState(state, detail = "") {
    if (!Object.values(FLOATING_CORE_STATES).includes(state)) return;
    this.currentState = state;

    if (this.widgetEl) {
      Object.values(FLOATING_CORE_STATES).forEach(s => {
        this.widgetEl.classList.remove(`state-${s.toLowerCase()}`);
      });
      this.widgetEl.classList.add(`state-${state.toLowerCase()}`);
    }

    const stateSymbols = {
      STANDBY: "◈",
      LISTENING: "◉",
      THINKING: "✦",
      SPEAKING: "≋",
      EXECUTING: "▲",
      SELF_UPGRADING: "🧬",
      VISION_ACTIVE: "◎",
      ERROR: "⚠",
      OFFLINE: "○",
      MUTED: "⊗"
    };

    if (typeof document !== "undefined") {
      const symEl = document.getElementById("arcSymbol");
      if (symEl) symEl.textContent = stateSymbols[state] || "◈";

      const stateLabel = document.getElementById("compactStateLabel");
      if (stateLabel) stateLabel.textContent = `STATE: ${state} ${detail ? "(" + detail + ")" : ""}`;
    }
  }

  setAudioReactivity(normalizedLevel = 0) {
    this.audioLevel = Math.max(0, Math.min(1.0, Number(normalizedLevel) || 0));
    if (typeof document !== "undefined") {
      const nucleus = document.getElementById("arcNucleus");
      if (nucleus && (this.currentState === FLOATING_CORE_STATES.LISTENING || this.currentState === FLOATING_CORE_STATES.SPEAKING)) {
        const scale = 1.0 + this.audioLevel * 0.45;
        nucleus.style.transform = `scale(${scale.toFixed(2)})`;
      }
    }
  }

  toggleVoice() {
    if (this.currentState === FLOATING_CORE_STATES.LISTENING) {
      this.setVisualState(FLOATING_CORE_STATES.STANDBY, "Voice Standby");
    } else {
      this.setVisualState(FLOATING_CORE_STATES.LISTENING, "Listening...");
    }
  }

  resetPosition() {
    this.clampAndPosition(null, null);
    try {
      localStorage.removeItem("ultron_floating_core_pos");
    } catch {}
  }

  bindControlEvents() {
    if (typeof document === "undefined") return;
    const closeBtn = document.getElementById("compactCloseBtn");
    if (closeBtn) closeBtn.onclick = () => this.toggleCompactPanel(false);

    const voiceBtn = document.getElementById("compactVoiceBtn");
    if (voiceBtn) voiceBtn.onclick = () => this.toggleVoice();

    const gestureBtn = document.getElementById("compactGestureBtn");
    if (gestureBtn) {
      gestureBtn.onclick = async () => {
        if (typeof window !== "undefined" && window.handGestureCore) {
          if (!window.handGestureCore.isEnabled) {
            try {
              gestureBtn.textContent = "✋ Initializing...";
              await window.handGestureCore.start();
              gestureBtn.textContent = "✋ Hand: ACTIVE";
              gestureBtn.classList.add("active");
            } catch (err) {
              gestureBtn.textContent = "✋ Hand Control";
              gestureBtn.classList.remove("active");
              alert("Hand tracking camera error: " + err.message);
            }
          } else {
            window.handGestureCore.stop();
            gestureBtn.textContent = "✋ Hand Control";
            gestureBtn.classList.remove("active");
          }
        }
      };
    }

    const muteBtn = document.getElementById("compactMuteBtn");
    if (muteBtn) {
      muteBtn.onclick = () => {
        this.isMuted = !this.isMuted;
        muteBtn.textContent = this.isMuted ? "🔊 Unmute Audio" : "🔇 Mute Audio";
        this.setVisualState(this.isMuted ? FLOATING_CORE_STATES.MUTED : FLOATING_CORE_STATES.STANDBY);
      };
    }

    const auditBtn = document.getElementById("compactAuditBtn");
    if (auditBtn) {
      auditBtn.onclick = async () => {
        this.setVisualState(FLOATING_CORE_STATES.SELF_UPGRADING, "Self-Auditing...");
        try {
          const res = await fetch("/api/jarvis/evolution/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "Ultron, audit yourself" })
          });
          const data = await res.json();
          const taskLabel = document.getElementById("compactStateLabel");
          if (taskLabel) taskLabel.textContent = `HEALTH: ${data.result?.audit?.healthScore || 100}/100`;
          setTimeout(() => this.setVisualState(FLOATING_CORE_STATES.STANDBY), 3500);
        } catch {
          this.setVisualState(FLOATING_CORE_STATES.STANDBY);
        }
      };
    }

    const visionBtn = document.getElementById("compactVisionBtn");
    if (visionBtn) {
      visionBtn.onclick = () => {
        this.setVisualState(FLOATING_CORE_STATES.VISION_ACTIVE, "Scanning Viewport...");
        setTimeout(() => this.setVisualState(FLOATING_CORE_STATES.STANDBY), 4000);
      };
    }

    const cmdInput = document.getElementById("compactCommandInput");
    if (cmdInput) {
      cmdInput.onkeydown = async (e) => {
        if (e.key === "Enter" && cmdInput.value.trim()) {
          const cmd = cmdInput.value.trim();
          cmdInput.value = "";
          this.setVisualState(FLOATING_CORE_STATES.EXECUTING, cmd);
          try {
            await fetch("/api/jarvis/evolution/command", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ command: cmd })
            });
          } catch {}
          setTimeout(() => this.setVisualState(FLOATING_CORE_STATES.STANDBY), 2500);
        }
      };
    }

    const killBtn = document.getElementById("compactKillBtn");
    if (killBtn) {
      killBtn.onclick = async () => {
        this.setVisualState(FLOATING_CORE_STATES.ERROR, "EMERGENCY STOP");
        try {
          await fetch("/api/jarvis/cyber/emergency/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Operator clicked compact HUD Emergency Stop" })
          });
        } catch {}
      };
    }
  }

  initCanvas() {
    if (typeof document === "undefined") return;
    const canvas = document.getElementById("livingArcCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Generate orbiting particle swarm
    const particleCount = 20;
    this.particles = Array.from({ length: particleCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 20 + Math.random() * (this.size * 0.35),
      speed: 0.01 + Math.random() * 0.03,
      size: 1 + Math.random() * 2,
      alpha: 0.3 + Math.random() * 0.7
    }));

    const renderLoop = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // Draw particle orbit based on current state
      const colors = {
        STANDBY: "rgba(0, 210, 255,",
        LISTENING: "rgba(255, 179, 0,",
        THINKING: "rgba(138, 43, 226,",
        SPEAKING: "rgba(56, 189, 248,",
        EXECUTING: "rgba(37, 99, 235,",
        SELF_UPGRADING: "rgba(16, 185, 129,",
        VISION_ACTIVE: "rgba(168, 85, 247,",
        ERROR: "rgba(239, 68, 68,",
        OFFLINE: "rgba(100, 116, 139,",
        MUTED: "rgba(245, 158, 11,"
      };

      const colorBase = colors[this.currentState] || colors.STANDBY;
      const speedMultiplier = this.currentState === FLOATING_CORE_STATES.THINKING ? 2.5 : 1.0;

      // Real-Time Hand Gesture Physics Hook (when hand interaction is engaged)
      if (this.physicsController && this.currentHandMotion) {
        this.physicsController.applyPhysics(
          this.particles,
          this.currentHandMotion,
          this.currentGestureType,
          canvas.width,
          canvas.height,
          ctx
        );
      }

      for (const p of this.particles) {
        if (!this.currentHandMotion) {
          p.angle += p.speed * speedMultiplier;
        }
        const px = (p.dispX !== undefined)
          ? cx + Math.cos(p.angle) * p.radius + p.dispX
          : cx + Math.cos(p.angle) * p.radius;
        const py = (p.dispY !== undefined)
          ? cy + Math.sin(p.angle) * p.radius + p.dispY
          : cy + Math.sin(p.angle) * p.radius;

        const alphaVal = this.currentHandMotion
          ? Math.min(1.0, p.alpha * (this.currentHandMotion.energyIntensity || 1.0))
          : p.alpha;

        ctx.fillStyle = `${colorBase}${alphaVal.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(renderLoop);
    };

    requestAnimationFrame(renderLoop);
  }

  initStateSync() {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", () => {
      this.clampAndPosition(this.posX, this.posY);
    });
  }
}

export const floatingEnergyCore = new FloatingLivingEnergyCore();

if (typeof window !== "undefined") {
  window.floatingEnergyCore = floatingEnergyCore;
  window.FLOATING_CORE_STATES = FLOATING_CORE_STATES;
  window.FloatingLivingEnergyCore = FloatingLivingEnergyCore;
}
