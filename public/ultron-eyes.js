/**
 * ULTRON AI — Sensory Visual System Frontend
 * Module: ULTRON EYES CLIENT (public/ultron-eyes.js)
 *
 * Implements browser camera capture via WebRTC / getUserMedia,
 * camera hardware switching, adaptive frame rate sampling,
 * live canvas bounding-box overlays, real-time object/scene perception cards,
 * visual Q&A console, session visual memory purge, and privacy controls.
 */

class UltronEyesClient {
  constructor() {
    this.stream = null;
    this.activeTrack = null;
    this.isStreaming = false;
    this.isPaused = false;
    this.samplingIntervalId = null;
    this.samplingFps = 2;
    this.currentDeviceId = "cam-default-0";
    this.lastObservation = null;

    // DOM Elements
    this.videoEl = null;
    this.canvasEl = null;
    this.overlayCtx = null;
    this.cameraSelect = null;
    this.fpsSelect = null;
    this.startBtn = null;
    this.pauseBtn = null;
    this.resumeBtn = null;
    this.stopBtn = null;
    this.clearMemBtn = null;
    this.statusPill = null;
    this.telemetryPill = null;
    this.objectsContainer = null;
    this.sceneContainer = null;
    this.ocrContainer = null;
    this.activityContainer = null;
    this.queryInput = null;
    this.queryBtn = null;
    this.queryResultContainer = null;
  }

  async init() {
    this._bindDomElements();
    this._attachEventListeners();
    await this.loadSupportedDevices();
    await this.checkCurrentSession();
  }

  _bindDomElements() {
    this.videoEl = document.getElementById("eyesVideoElement");
    this.canvasEl = document.getElementById("eyesOverlayCanvas");
    if (this.canvasEl) {
      this.overlayCtx = this.canvasEl.getContext("2d");
    }
    this.cameraSelect = document.getElementById("eyesCameraSelect");
    this.fpsSelect = document.getElementById("eyesFpsSelect");
    this.startBtn = document.getElementById("eyesStartBtn");
    this.pauseBtn = document.getElementById("eyesPauseBtn");
    this.resumeBtn = document.getElementById("eyesResumeBtn");
    this.stopBtn = document.getElementById("eyesStopBtn");
    this.clearMemBtn = document.getElementById("eyesClearMemBtn");
    this.statusPill = document.getElementById("eyesStatusPill");
    this.telemetryPill = document.getElementById("eyesHeaderTelemetryPill");
    this.objectsContainer = document.getElementById("eyesObjectsList");
    this.sceneContainer = document.getElementById("eyesSceneDescription");
    this.ocrContainer = document.getElementById("eyesOcrText");
    this.activityContainer = document.getElementById("eyesHumanActivity");
    this.queryInput = document.getElementById("eyesQueryInput");
    this.queryBtn = document.getElementById("eyesQueryBtn");
    this.queryResultContainer = document.getElementById("eyesQueryResult");
  }

  _attachEventListeners() {
    this.startBtn?.addEventListener("click", () => this.startLiveVision());
    this.pauseBtn?.addEventListener("click", () => this.pauseLiveVision());
    this.resumeBtn?.addEventListener("click", () => this.resumeLiveVision());
    this.stopBtn?.addEventListener("click", () => this.stopLiveVision());
    this.clearMemBtn?.addEventListener("click", () => this.clearVisualMemory());
    this.queryBtn?.addEventListener("click", () => this.handleVisualQuery());

    this.cameraSelect?.addEventListener("change", (e) => {
      this.switchCamera(e.target.value);
    });

    this.fpsSelect?.addEventListener("change", (e) => {
      this.samplingFps = Math.min(Math.max(parseInt(e.target.value, 10) || 2, 1), 5);
      if (this.isStreaming && !this.isPaused) {
        this._restartSamplingLoop();
      }
    });

    this.queryInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        this.handleVisualQuery();
      }
    });

    // Quick Prompt Pills
    document.querySelectorAll(".eyes-quick-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const query = chip.dataset.query || chip.textContent.trim();
        if (this.queryInput) {
          this.queryInput.value = query;
          this.handleVisualQuery();
        }
      });
    });
  }

  async loadSupportedDevices() {
    try {
      const res = await fetch("/api/jarvis/eyes/devices");
      const data = await res.json();
      if (!data.success) return;

      if (this.cameraSelect) {
        this.cameraSelect.innerHTML = "";
        data.devices.forEach(dev => {
          const opt = document.createElement("option");
          opt.value = dev.id;
          opt.textContent = `${dev.name} [${dev.type}]`;
          if (dev.isDefault) {
            opt.selected = true;
            this.currentDeviceId = dev.id;
          }
          this.cameraSelect.appendChild(opt);
        });
      }

      // Also query browser mediaDevices if available to match hardware IDs
      if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === "function") {
        try {
          const mediaDevs = await navigator.mediaDevices.enumerateDevices();
          const videoDevs = mediaDevs.filter(d => d.kind === "videoinput");
          if (videoDevs.length > 0 && this.cameraSelect) {
            videoDevs.forEach((vd, idx) => {
              const exists = Array.from(this.cameraSelect.options).some(o => o.value === vd.deviceId);
              if (!exists) {
                const opt = document.createElement("option");
                opt.value = vd.deviceId || `cam-local-${idx}`;
                opt.textContent = `Local: ${vd.label || `Camera ${idx + 1}`}`;
                this.cameraSelect.appendChild(opt);
              }
            });
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn("[UltronEyes] Device enumeration failed:", err.message);
    }
  }

  async checkCurrentSession() {
    try {
      const res = await fetch("/api/jarvis/eyes/session/status");
      const data = await res.json();
      if (data.success) {
        this._updateUiState(data.state);
        if (data.lastObservation) {
          this._renderObservation(data.lastObservation);
        }
      }
    } catch (_) {}
  }

  async switchCamera(deviceId) {
    this.currentDeviceId = deviceId;
    try {
      await fetch("/api/jarvis/eyes/devices/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId })
      });
    } catch (_) {}

    if (this.isStreaming) {
      await this.stopLiveVision();
      await this.startLiveVision();
    }
  }

  async startLiveVision() {
    try {
      this._setStatus("REQUESTING_CONSENT", "Requesting Camera Permission...");

      // Browser WebRTC Camera Capture
      let constraints = {
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      if (this.currentDeviceId && !this.currentDeviceId.startsWith("cam-default")) {
        constraints.video.deviceId = { exact: this.currentDeviceId };
      }

      try {
        if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function") {
          this.stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (this.videoEl) {
            this.videoEl.srcObject = this.stream;
            await this.videoEl.play();
          }
          this.activeTrack = this.stream.getVideoTracks()[0];
        }
      } catch (mediaErr) {
        console.warn("[UltronEyes] Physical camera unavailable, continuing with digital vision adapter:", mediaErr.message);
      }

      // Notify backend with explicit user consent
      const res = await fetch("/api/jarvis/eyes/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: this.currentDeviceId,
          fps: this.samplingFps,
          resolution: "720p",
          consent: true
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || "Failed to start camera session on server.");
      }

      this.isStreaming = true;
      this.isPaused = false;
      this._updateUiState("ACTIVE_STREAMING");
      this._restartSamplingLoop();
    } catch (err) {
      this._setStatus("ERROR", `Failed: ${err.message}`);
      alert(`ULTRON EYES Error: ${err.message}`);
    }
  }

  pauseLiveVision() {
    if (!this.isStreaming || this.isPaused) return;
    this.isPaused = true;
    if (this.samplingIntervalId) {
      clearInterval(this.samplingIntervalId);
      this.samplingIntervalId = null;
    }
    fetch("/api/jarvis/eyes/session/pause", { method: "POST" }).catch(() => {});
    this._updateUiState("PAUSED");
  }

  resumeLiveVision() {
    if (!this.isStreaming || !this.isPaused) return;
    this.isPaused = false;
    fetch("/api/jarvis/eyes/session/resume", { method: "POST" }).catch(() => {});
    this._updateUiState("ACTIVE_STREAMING");
    this._restartSamplingLoop();
  }

  async stopLiveVision() {
    this.isStreaming = false;
    this.isPaused = false;

    if (this.samplingIntervalId) {
      clearInterval(this.samplingIntervalId);
      this.samplingIntervalId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      this.activeTrack = null;
    }

    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }

    if (this.overlayCtx && this.canvasEl) {
      this.overlayCtx.clearRect(0, 0, this.canvasEl.width, this.canvasEl.height);
    }

    try {
      await fetch("/api/jarvis/eyes/session/stop", { method: "POST" });
    } catch (_) {}

    this._updateUiState("STOPPED");
  }

  async clearVisualMemory() {
    try {
      const res = await fetch("/api/jarvis/eyes/memory/clear", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        if (this.objectsContainer) this.objectsContainer.innerHTML = '<span class="text-muted">Visual memory cleared.</span>';
        if (this.sceneContainer) this.sceneContainer.textContent = "Memory purged.";
        if (this.ocrContainer) this.ocrContainer.textContent = "None.";
        if (this.queryResultContainer) this.queryResultContainer.innerHTML = "";
      }
    } catch (err) {
      console.error("[UltronEyes] Failed to clear visual memory:", err);
    }
  }

  _restartSamplingLoop() {
    if (this.samplingIntervalId) {
      clearInterval(this.samplingIntervalId);
    }
    const intervalMs = Math.round(1000 / this.samplingFps);
    this.samplingIntervalId = setInterval(() => this._sampleAndSendFrame(), intervalMs);
    // Send immediate first frame
    this._sampleAndSendFrame();
  }

  async _sampleAndSendFrame() {
    if (!this.isStreaming || this.isPaused) return;

    let frameDataUrl = null;

    // Grab frame from video element via canvas
    if (this.videoEl && this.videoEl.videoWidth > 0) {
      const offscreenCanvas = document.createElement("canvas");
      offscreenCanvas.width = this.videoEl.videoWidth;
      offscreenCanvas.height = this.videoEl.videoHeight;
      const ctx = offscreenCanvas.getContext("2d");
      ctx.drawImage(this.videoEl, 0, 0);
      frameDataUrl = offscreenCanvas.toDataURL("image/jpeg", 0.75);

      // Match overlay canvas dimensions to video
      if (this.canvasEl && (this.canvasEl.width !== this.videoEl.videoWidth || this.canvasEl.height !== this.videoEl.videoHeight)) {
        this.canvasEl.width = this.videoEl.videoWidth;
        this.canvasEl.height = this.videoEl.videoHeight;
      }
    } else {
      // Synthetic fallback frame for non-camera or headless environments
      frameDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    }

    try {
      const res = await fetch("/api/jarvis/eyes/frame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frameData: frameDataUrl,
          deviceId: this.currentDeviceId,
          timestamp: new Date().toISOString()
        })
      });

      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.observation) {
        this.lastObservation = data.observation;
        this._renderObservation(data.observation);
        this._drawOverlayBoundingBoxes(data.observation.objects, data.observation.trackedObjects);
      }
    } catch (err) {
      console.warn("[UltronEyes] Frame processing error:", err.message);
    }
  }

  _drawOverlayBoundingBoxes(objects = [], trackedObjects = []) {
    if (!this.overlayCtx || !this.canvasEl) return;
    const ctx = this.overlayCtx;
    const width = this.canvasEl.width || 640;
    const height = this.canvasEl.height || 480;

    ctx.clearRect(0, 0, width, height);

    objects.forEach((obj, idx) => {
      const box = obj.box;
      const x = box.xMin * width;
      const y = box.yMin * height;
      const w = (box.xMax - box.xMin) * width;
      const h = (box.yMax - box.yMin) * height;

      // Iron Man / Ultron HUD Theme Colors
      const isScreen = obj.category === "electronics";
      const strokeColor = isScreen ? "#00f0ff" : "#10b981";

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Corner Brackets for HUD aesthetic
      const cornerLen = 12;
      ctx.fillStyle = strokeColor;
      ctx.fillRect(x, y, cornerLen, 3);
      ctx.fillRect(x, y, 3, cornerLen);
      ctx.fillRect(x + w - cornerLen, y, cornerLen, 3);
      ctx.fillRect(x + w - 3, y, 3, cornerLen);

      // Label Tag
      ctx.fillStyle = "rgba(10, 13, 20, 0.85)";
      const labelText = `${obj.label} ${(obj.confidence * 100).toFixed(0)}%`;
      ctx.font = "bold 11px monospace";
      const textWidth = ctx.measureText(labelText).width;
      ctx.fillRect(x, Math.max(0, y - 18), textWidth + 8, 16);

      ctx.fillStyle = strokeColor;
      ctx.fillText(labelText, x + 4, Math.max(12, y - 6));
    });
  }

  _renderObservation(obs) {
    // 1. Detected Objects
    if (this.objectsContainer) {
      this.objectsContainer.innerHTML = obs.objects.map(o => `
        <div class="eyes-object-chip" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; background: rgba(0, 240, 255, 0.1); border: 1px solid rgba(0, 240, 255, 0.3); font-size: 11px; margin: 2px;">
          <span style="font-weight: bold; color: #00f0ff;">${o.label}</span>
          <span style="color: #94a3b8;">(${(o.confidence * 100).toFixed(0)}%)</span>
          <span style="font-size: 9px; color: #a855f7;">${o.spatialPosition}</span>
        </div>
      `).join("");
    }

    // 2. Scene Description & Changes
    if (this.sceneContainer) {
      let changeAlert = "";
      if (obs.changesDetected) {
        changeAlert = `<div style="margin-top: 6px; font-weight: bold; color: #ff6b00;">⚠️ ${obs.changeSummary}</div>`;
      }
      this.sceneContainer.innerHTML = `<div>${obs.scene}</div>${changeAlert}`;
    }

    // 3. OCR Text
    if (this.ocrContainer) {
      this.ocrContainer.innerHTML = obs.textAndOcr?.hasText
        ? `<div style="font-family: monospace; font-size: 11px; color: #38bdf8;">${obs.textAndOcr.extractedText}</div>
           <div style="font-size: 9px; color: #10b981; margin-top: 2px;">🔒 Credential Sanitization Active</div>`
        : `<span class="text-muted">No text detected in current frame.</span>`;
    }

    // 4. Human Activity
    if (this.activityContainer) {
      this.activityContainer.innerHTML = `
        <div style="font-size: 12px; color: #f1f5f9;">${obs.humanActivity.observableActivity}</div>
        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">Posture: ${obs.humanActivity.visiblePosture}</div>
        <div style="font-size: 9px; color: #64748b; margin-top: 4px;">🛡️ ${obs.humanActivity.privacyAdvisory}</div>
      `;
    }
  }

  async handleVisualQuery() {
    const query = this.queryInput?.value.trim();
    if (!query) return;

    if (this.queryResultContainer) {
      this.queryResultContainer.innerHTML = `<div style="color: #00f0ff;">Analyzing scene and reasoning...</div>`;
    }

    try {
      const res = await fetch("/api/jarvis/eyes/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query })
      });

      const data = await res.json();
      if (!data.success) {
        if (this.queryResultContainer) {
          this.queryResultContainer.innerHTML = `<div style="color: #ef4444;">${data.message || data.error}</div>`;
        }
        return;
      }

      this._renderQueryResult(data);
    } catch (err) {
      if (this.queryResultContainer) {
        this.queryResultContainer.innerHTML = `<div style="color: #ef4444;">Query error: ${err.message}</div>`;
      }
    }
  }

  _renderQueryResult(data) {
    if (!this.queryResultContainer) return;

    const approvalBadge = data.requiresHumanApproval
      ? `<div style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #ef4444; padding: 6px 10px; border-radius: 4px; font-weight: bold; font-size: 11px; margin-top: 8px;">
           🚨 HUMAN APPROVAL REQUIRED: Action requires explicit authorization before execution.
         </div>`
      : "";

    this.queryResultContainer.innerHTML = `
      <div style="background: rgba(17, 22, 34, 0.9); border: 1px solid #1e293b; border-radius: 6px; padding: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong style="color: #00f0ff;">ULTRON Visual Reasoning</strong>
          <span style="font-size: 11px; color: #94a3b8;">Uncertainty: ${(data.uncertaintyScore * 100).toFixed(0)}% | Confidence: ${(data.confidenceScore * 100).toFixed(0)}%</span>
        </div>
        <div style="font-size: 14px; color: #f1f5f9; line-height: 1.5;">${data.answer}</div>
        
        <div style="margin-top: 8px; font-size: 12px; color: #94a3b8;">
          <strong>Direct Observation:</strong>
          <ul style="margin: 4px 0 0 16px; padding: 0;">
            ${data.directlyObserved.slice(0, 3).map(d => `<li>${d}</li>`).join("")}
          </ul>
        </div>

        <div style="margin-top: 8px; font-size: 12px; color: #10b981;">
          <strong>Recommendation:</strong> ${data.recommendedAction}
        </div>

        ${approvalBadge}

        <div style="margin-top: 10px; display: flex; gap: 8px;">
          <button class="btn btn-sm" id="eyesSpeakAnswerBtn">🔊 Speak (Kokoro Voice)</button>
        </div>
      </div>
    `;

    document.getElementById("eyesSpeakAnswerBtn")?.addEventListener("click", () => {
      this._speakAnswer(data.spokenText || data.answer);
    });
  }

  async _speakAnswer(text) {
    try {
      await fetch("/api/jarvis/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: "ultron_onyx" })
      });
    } catch (_) {
      if ("speechSynthesis" in window) {
        const u = new SpeechSynthesisUtterance(text);
        window.speechSynthesis.speak(u);
      }
    }
  }

  _updateUiState(state) {
    if (this.statusPill) {
      this.statusPill.className = "eyes-status-pill";
      if (state === "ACTIVE_STREAMING") {
        this.statusPill.classList.add("active");
        this.statusPill.innerHTML = '<span class="status-dot green pulse"></span> LIVE VISION ACTIVE';
      } else if (state === "PAUSED") {
        this.statusPill.classList.add("paused");
        this.statusPill.innerHTML = '<span class="status-dot amber"></span> VISION PAUSED';
      } else {
        this.statusPill.classList.add("standby");
        this.statusPill.innerHTML = '<span class="status-dot gray"></span> VISION STANDBY';
      }
    }

    if (this.telemetryPill) {
      this.telemetryPill.style.display = state === "ACTIVE_STREAMING" ? "inline-flex" : "none";
    }

    if (this.startBtn) this.startBtn.disabled = state === "ACTIVE_STREAMING";
    if (this.pauseBtn) this.pauseBtn.disabled = state !== "ACTIVE_STREAMING";
    if (this.resumeBtn) this.resumeBtn.disabled = state !== "PAUSED";
    if (this.stopBtn) this.stopBtn.disabled = state === "STOPPED" || state === "DISCONNECTED";
  }

  _setStatus(type, msg) {
    if (this.statusPill) {
      this.statusPill.textContent = msg;
    }
  }
}

// Auto-initialize when DOM is ready
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    window.ultronEyesClient = new UltronEyesClient();
    window.ultronEyesClient.init();
  });
}
