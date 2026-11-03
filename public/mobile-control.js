/**
 * ULTRON AI — Mobile Control Center Frontend Subsystem
 * Module: public/mobile-control.js
 *
 * Provides real-time device cards, live screen snapshot mirroring, interactive
 * coordinate picker, action dispatch palette, autonomous task submission,
 * and Level 3/4 confirmation modal with a 60-second countdown timer.
 */

export class MobileControlCenter {
  constructor(options = {}) {
    this.apiBase = options.apiBase || "/api/mobile";
    this.container = null;
    this.activeDevice = null;
    this.devices = [];
    this.selectedCoords = null;
    this.pendingConfirmation = null;
    this.countdownTimer = null;
  }

  init() {
    this.container = document.getElementById("mobile-panel");
    if (!this.container) return;

    this.bindEvents();
    this.refreshDevices();
  }

  bindEvents() {
    const refreshBtn = document.getElementById("mobile-refresh-btn");
    if (refreshBtn) refreshBtn.addEventListener("click", () => this.refreshDevices());

    const snapBtn = document.getElementById("mobile-capture-btn");
    if (snapBtn) snapBtn.addEventListener("click", () => this.captureScreen());

    const closeBtn = document.getElementById("mobile-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.hide());

    // Coordinate picker on screen image
    const screenImg = document.getElementById("mobile-screen-img");
    if (screenImg) {
      screenImg.addEventListener("click", (e) => this.handleScreenClick(e, screenImg));
    }

    // Quick Action buttons
    document.querySelectorAll("[data-mobile-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.mobileAction;
        this.dispatchQuickAction(action);
      });
    });

    // App launcher
    const launchBtn = document.getElementById("mobile-launch-app-btn");
    if (launchBtn) {
      launchBtn.addEventListener("click", () => this.handleAppLaunch());
    }

    // Text type
    const typeBtn = document.getElementById("mobile-type-btn");
    if (typeBtn) {
      typeBtn.addEventListener("click", () => this.handleTypeText());
    }

    // Gesture Tap
    const tapBtn = document.getElementById("mobile-tap-coords-btn");
    if (tapBtn) {
      tapBtn.addEventListener("click", () => this.handleTapCoordinates());
    }

    // Gesture Swipes
    document.querySelectorAll("[data-mobile-swipe]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.mobileSwipe;
        this.handleSwipe(dir);
      });
    });

    // Autonomous Task Submit
    const autoForm = document.getElementById("mobile-auto-form");
    if (autoForm) {
      autoForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleAutonomousTask();
      });
    }

    // Modal buttons
    const authBtn = document.getElementById("mobile-modal-authorize");
    if (authBtn) authBtn.addEventListener("click", () => this.confirmPendingAction());

    const denyBtn = document.getElementById("mobile-modal-deny");
    if (denyBtn) denyBtn.addEventListener("click", () => this.denyPendingAction());
  }

  show() {
    if (this.container) {
      this.container.hidden = false;
      this.refreshDevices();
    }
  }

  hide() {
    if (this.container) {
      this.container.hidden = true;
    }
  }

  async refreshDevices() {
    const listEl = document.getElementById("mobile-device-list");
    const statusBadge = document.getElementById("mobile-status-badge");
    if (statusBadge) statusBadge.textContent = "SCANNING...";

    try {
      const res = await fetch(`${this.apiBase}/devices?refresh=1`, { credentials: "same-origin" });
      const data = await res.json();

      if (!data.success) throw new Error(data.error?.message || "Failed to list devices");

      this.devices = data.devices || [];
      const count = data.count || 0;

      if (statusBadge) {
        statusBadge.textContent = count > 0 ? `${count} DEVICE${count === 1 ? "" : "S"} ONLINE` : "NO DEVICE CONNECTED";
        statusBadge.style.color = count > 0 ? "#4ade80" : "#f87171";
      }

      if (listEl) {
        listEl.replaceChildren();
        if (count === 0) {
          const emptyDiv = document.createElement("div");
          emptyDiv.className = "mobile-empty-state";
          const iconSpan = document.createElement("span");
          iconSpan.textContent = "📱";
          const b = document.createElement("b");
          b.textContent = "No Android Devices Detected";
          const p = document.createElement("p");
          p.textContent = "Connect your phone via USB with USB Debugging enabled, or pair via ADB wireless.";
          emptyDiv.appendChild(iconSpan);
          emptyDiv.appendChild(b);
          emptyDiv.appendChild(p);
          listEl.appendChild(emptyDiv);
          this.activeDevice = null;
        } else {
          this.devices.forEach((dev, idx) => {
            const card = document.createElement("div");
            card.className = `mobile-device-card ${idx === 0 ? "active" : ""}`;

            const header = document.createElement("div");
            header.className = "dev-header";
            const strong = document.createElement("strong");
            strong.textContent = dev.model || "Android Device";
            const badge = document.createElement("span");
            badge.className = `dev-badge ${dev.state === "online" ? "badge-online" : "badge-warn"}`;
            badge.textContent = String(dev.state || "offline").toUpperCase();
            header.appendChild(strong);
            header.appendChild(badge);

            const meta = document.createElement("div");
            meta.className = "dev-meta";
            const sId = document.createElement("span");
            sId.textContent = `ID: ${dev.id}`;
            const sType = document.createElement("span");
            sType.textContent = `Type: ${dev.connectionType || "USB"}`;
            const sProd = document.createElement("span");
            sProd.textContent = `Product: ${dev.product || "Unknown"}`;
            meta.appendChild(sId);
            meta.appendChild(sType);
            meta.appendChild(sProd);

            card.appendChild(header);
            card.appendChild(meta);

            card.addEventListener("click", () => {
              document.querySelectorAll(".mobile-device-card").forEach(c => c.classList.remove("active"));
              card.classList.add("active");
              this.activeDevice = dev.id;
            });
            listEl.appendChild(card);
          });
          this.activeDevice = this.devices[0].id;
        }
      }
    } catch (err) {
      if (statusBadge) {
        statusBadge.textContent = "STANDBY";
        statusBadge.style.color = "#94a3b8";
      }
      if (listEl) {
        listEl.replaceChildren();
        const errDiv = document.createElement("div");
        errDiv.className = "mobile-empty-state";
        const p = document.createElement("p");
        p.textContent = String(err.message || "Standby");
        errDiv.appendChild(p);
        listEl.appendChild(errDiv);
      }
    }
  }

  async captureScreen() {
    const previewWrapper = document.getElementById("mobile-preview-wrapper");
    const previewImg = document.getElementById("mobile-screen-img");
    const captureBtn = document.getElementById("mobile-capture-btn");

    if (captureBtn) captureBtn.disabled = true;

    try {
      const res = await fetch(`${this.apiBase}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ deviceId: this.activeDevice, format: "base64" })
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.message || "Screen capture failed. Ensure device is online.");
        return;
      }

      if (previewImg && data.data) {
        previewImg.src = `data:image/png;base64,${data.data}`;
        previewImg.hidden = false;
        const placeholder = document.getElementById("mobile-preview-placeholder");
        if (placeholder) placeholder.hidden = true;
      }
    } catch (err) {
      alert("Error capturing screen: " + err.message);
    } finally {
      if (captureBtn) captureBtn.disabled = false;
    }
  }

  handleScreenClick(event, img) {
    const rect = img.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Scale to natural image resolution
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;

    const actualX = Math.round(clickX * scaleX);
    const actualY = Math.round(clickY * scaleY);

    this.selectedCoords = { x: actualX, y: actualY };

    const coordsDisplay = document.getElementById("mobile-coords-display");
    if (coordsDisplay) {
      coordsDisplay.textContent = `Selected: X:${actualX}, Y:${actualY}`;
    }

    const inputX = document.getElementById("mobile-input-x");
    const inputY = document.getElementById("mobile-input-y");
    if (inputX && inputY) {
      inputX.value = actualX;
      inputY.value = actualY;
    }
  }

  async dispatchQuickAction(action) {
    return this.sendAction(action, {});
  }

  async handleAppLaunch() {
    const select = document.getElementById("mobile-app-select");
    const customInput = document.getElementById("mobile-custom-app");

    let pkg = select?.value;
    if (pkg === "custom" && customInput) {
      pkg = customInput.value.trim();
    }

    if (!pkg) {
      alert("Please select or enter an app package name.");
      return;
    }

    await this.sendAction("launch_app", { package: pkg });
  }

  async handleTypeText() {
    const textInput = document.getElementById("mobile-type-input");
    const text = textInput ? textInput.value : "";
    if (!text) return;

    await this.sendAction("type_text", { text });
    if (textInput) textInput.value = "";
  }

  async handleTapCoordinates() {
    const inputX = document.getElementById("mobile-input-x");
    const inputY = document.getElementById("mobile-input-y");
    const x = parseInt(inputX?.value, 10);
    const y = parseInt(inputY?.value, 10);

    if (isNaN(x) || isNaN(y)) {
      alert("Please enter valid X and Y coordinates.");
      return;
    }

    await this.sendAction("tap", { x, y });
  }

  async handleSwipe(direction) {
    const width = 1080;
    const height = 2400;
    let x1, y1, x2, y2;

    switch (direction) {
      case "up":
        x1 = Math.round(width / 2); y1 = Math.round(height * 0.75);
        x2 = Math.round(width / 2); y2 = Math.round(height * 0.25);
        break;
      case "down":
        x1 = Math.round(width / 2); y1 = Math.round(height * 0.25);
        x2 = Math.round(width / 2); y2 = Math.round(height * 0.75);
        break;
      case "left":
        x1 = Math.round(width * 0.8); y1 = Math.round(height / 2);
        x2 = Math.round(width * 0.2); y2 = Math.round(height / 2);
        break;
      case "right":
        x1 = Math.round(width * 0.2); y1 = Math.round(height / 2);
        x2 = Math.round(width * 0.8); y2 = Math.round(height / 2);
        break;
      default:
        return;
    }

    await this.sendAction("swipe", { x1, y1, x2, y2, durationMs: 300 });
  }

  async sendAction(action, params = {}, confirmationToken = null) {
    try {
      const res = await fetch(`${this.apiBase}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          deviceId: this.activeDevice,
          action,
          params,
          confirmationToken
        })
      });

      const data = await res.json();

      if (res.status === 403 && data.error?.code === "CONFIRMATION_REQUIRED") {
        // Pop confirmation modal
        this.showConfirmationModal(action, params, data.error.confirmationToken, data.error.message);
        return;
      }

      if (!res.ok) {
        alert(data.error?.message || "Action dispatch failed");
        return;
      }

      this.logActivity(`Executed: ${action}`);
    } catch (err) {
      alert("Error dispatching action: " + err.message);
    }
  }

  showConfirmationModal(action, params, token, message) {
    this.pendingConfirmation = { action, params, token };
    const modal = document.getElementById("mobile-confirm-modal");
    const desc = document.getElementById("mobile-modal-desc");
    const timerEl = document.getElementById("mobile-modal-timer");

    if (!modal) return;

    if (desc) desc.textContent = message || `Level 3/4 sensitive action '${action}' requires authorization.`;
    modal.hidden = false;

    let secondsLeft = 60;
    if (timerEl) timerEl.textContent = `${secondsLeft}s`;

    clearInterval(this.countdownTimer);
    this.countdownTimer = setInterval(() => {
      secondsLeft -= 1;
      if (timerEl) timerEl.textContent = `${secondsLeft}s`;
      if (secondsLeft <= 0) {
        clearInterval(this.countdownTimer);
        this.denyPendingAction();
      }
    }, 1000);
  }

  async confirmPendingAction() {
    if (!this.pendingConfirmation) return;
    const { action, params, token } = this.pendingConfirmation;

    clearInterval(this.countdownTimer);
    const modal = document.getElementById("mobile-confirm-modal");
    if (modal) modal.hidden = true;

    // Re-dispatch with single-use confirmation token
    await this.sendAction(action, params, token);
    this.pendingConfirmation = null;
  }

  denyPendingAction() {
    clearInterval(this.countdownTimer);
    this.pendingConfirmation = null;
    const modal = document.getElementById("mobile-confirm-modal");
    if (modal) modal.hidden = true;
    this.logActivity("Action authorization denied by operator.");
  }

  async handleAutonomousTask() {
    const input = document.getElementById("mobile-auto-input");
    const logViewer = document.getElementById("mobile-workflow-log");
    const goal = input ? input.value.trim() : "";

    if (!goal) return;

    if (logViewer) {
      logViewer.replaceChildren();
      const planItem = document.createElement("div");
      planItem.className = "log-item";
      const b = document.createElement("b");
      b.textContent = "[PLANNING] ";
      planItem.appendChild(b);
      planItem.appendChild(document.createTextNode(`Formulating DAG for: "${goal}"...`));
      logViewer.appendChild(planItem);
    }

    try {
      const res = await fetch(`${this.apiBase}/workflow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ goal, deviceId: this.activeDevice })
      });

      const data = await res.json();

      if (logViewer) {
        if (!data.success) {
          const failDiv = document.createElement("div");
          failDiv.className = "log-item error";
          const b = document.createElement("b");
          b.textContent = "[FAILED] ";
          failDiv.appendChild(b);
          failDiv.appendChild(document.createTextNode(data.message || data.error || "Execution halted"));
          logViewer.appendChild(failDiv);
        } else {
          const succDiv = document.createElement("div");
          succDiv.className = "log-item success";
          const b = document.createElement("b");
          b.textContent = "[SUCCESS] ";
          succDiv.appendChild(b);
          succDiv.appendChild(document.createTextNode(data.summary || "Task completed"));
          logViewer.appendChild(succDiv);

          if (data.workflow?.completedSteps) {
            data.workflow.completedSteps.forEach(s => {
              const stepDiv = document.createElement("div");
              stepDiv.className = "log-item";
              stepDiv.textContent = `✔ Step ${s.stepId}: ${s.action} (verified)`;
              logViewer.appendChild(stepDiv);
            });
          }
        }
      }
    } catch (err) {
      if (logViewer) {
        const netDiv = document.createElement("div");
        netDiv.className = "log-item error";
        const b = document.createElement("b");
        b.textContent = "[NETWORK_ERROR] ";
        netDiv.appendChild(b);
        netDiv.appendChild(document.createTextNode(err.message));
        logViewer.appendChild(netDiv);
      }
    }
  }

  logActivity(msg) {
    const logViewer = document.getElementById("mobile-workflow-log");
    if (logViewer) {
      const div = document.createElement("div");
      div.className = "log-item";
      div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      logViewer.prepend(div);
    }
  }
}

export const mobileControlCenter = new MobileControlCenter();
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    mobileControlCenter.init();
  });
}
