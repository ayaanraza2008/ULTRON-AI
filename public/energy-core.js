/**
 * ULTRON AI — Cyber-HUD Energy Core & Multi-Device Visual Controller
 * Project Codename: ULTRON ETERNAL
 *
 * Drives real-time visual reactions of the holographic ARC Reactor:
 * - 10 Visual Core States:
 *   STANDBY (Cyan/Blue) | CALL_CONNECTING (Blue Pulse) | CALL_ACTIVE (Orange Energy) |
 *   LISTENING (Bright Cyan) | THINKING (Accelerating Particles) | EXECUTING (Orange Rings) |
 *   SPEAKING (Audio-Reactive) | TASK_COMPLETED (Energy Burst) | ERROR (Red) | OFFLINE (Dimmed)
 * - Telephony Call HUD: Displays caller, active call duration, and live audio transcription.
 * - Multi-Device Fleet HUD: Displays real-time status of Windows PC + 3 Android phones.
 * - Optional Hand Gesture Controller: Pinch to select/unlock, two-hand holographic core scaling.
 */

export const CORE_STATES = {
  STANDBY: "STANDBY",
  CALL_CONNECTING: "CALL_CONNECTING",
  CALL_ACTIVE: "CALL_ACTIVE",
  WAKE_MONITORING: "WAKE_MONITORING",
  SNAP_DETECTED: "SNAP_DETECTED",
  WAKE_DETECTED: "WAKE_DETECTED",
  LISTENING: "LISTENING",
  THINKING: "THINKING",
  EXECUTING: "EXECUTING",
  SPEAKING: "SPEAKING",
  TASK_COMPLETED: "TASK_COMPLETED",
  ERROR: "ERROR",
  SLEEPING: "SLEEPING",
  OFFLINE: "OFFLINE"
};

export class EnergyCoreController {
  constructor() {
    this.currentState = CORE_STATES.STANDBY;
    this.coreElement = typeof document !== "undefined" ? document.getElementById("reactorCore") : null;
    this.statusTextElement = typeof document !== "undefined" ? document.getElementById("coreStatusText") : null;
    this.statusPill = typeof document !== "undefined" ? document.getElementById("coreStatusPill") : null;
    this.coreScale = 1.0;
    this.cameraStream = null;
    this.gestureActive = false;
  }

  setVisualState(state, detailText = "") {
    if (!Object.values(CORE_STATES).includes(state)) return;
    this.currentState = state;

    if (this.coreElement) {
      // Remove previous state classes
      Object.values(CORE_STATES).forEach(s => {
        this.coreElement.classList.remove("state-" + s.toLowerCase());
      });
      this.coreElement.classList.add("state-" + state.toLowerCase());
    }

    if (this.statusTextElement) {
      this.statusTextElement.textContent = `CORE: ${state} ${detailText ? "— " + detailText : ""}`;
    }

    if (this.statusPill) {
      this.statusPill.setAttribute("data-state", state);
    }
  }

  scaleCore(factor) {
    this.coreScale = Math.max(0.7, Math.min(2.5, this.coreScale * factor));
    if (this.coreElement) {
      this.coreElement.style.transform = `scale(${this.coreScale})`;
    }
  }

  resetScale() {
    this.coreScale = 1.0;
    if (this.coreElement) {
      this.coreElement.style.transform = "scale(1.0)";
    }
  }

  setAudioReactivity(normalizedLevel = 0) {
    if (!this.coreElement) return;
    const clamped = Math.max(0, Math.min(1.0, Number(normalizedLevel) || 0));
    const dynamicScale = this.coreScale * (1.0 + clamped * 0.35);
    const glowSpread = 20 + Math.round(clamped * 40);
    this.coreElement.style.transform = `scale(${dynamicScale.toFixed(3)})`;
    const glowEl = this.coreElement.querySelector(".core-glow");
    if (glowEl) {
      glowEl.style.boxShadow = `0 0 ${glowSpread}px var(--core-current-glow, #a855f7)`;
    }
  }

  triggerActivationRipple(color = "#eab308") {
    if (!this.coreElement) return;
    this.coreElement.classList.add("core-ripple-active");
    setTimeout(() => {
      this.coreElement?.classList.remove("core-ripple-active");
    }, 600);
  }

  /**
   * Initializes Server-Sent Events (SSE) listener from backend.
   */
  connectEventStream(url = "/api/jarvis/hud/events") {
    try {
      const eventSource = new EventSource(url);
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "CORE_STATE_CHANGE") {
            this.setVisualState(data.state, data.detail);
          }
          if (data.type === "TELEPHONY_CALL") {
            this.handleCallEvent(data);
          }
          if (data.type === "DEVICE_STATE_CHANGE") {
            this.updateDeviceStatus(data.device);
          }
        } catch {}
      };
      eventSource.onerror = () => {
        // Fallback to local polling if SSE is disconnected
      };
    } catch {}
  }

  handleCallEvent(callData) {
    const callHud = document.getElementById("telephonyCallHud");
    if (!callHud) return;

    if (callData.state === "RINGING") {
      this.setVisualState(CORE_STATES.CALL_CONNECTING, "INCOMING CALL: " + callData.from);
      callHud.style.display = "block";
    } else if (callData.state === "CONNECTED") {
      this.setVisualState(CORE_STATES.CALL_ACTIVE, "CALL CONNECTED");
      callHud.style.display = "block";
    } else if (callData.state === "COMPLETED") {
      this.setVisualState(CORE_STATES.STANDBY, "CALL ENDED");
      setTimeout(() => { callHud.style.display = "none"; }, 4000);
    }
  }

  updateDeviceStatus(device) {
    const elem = document.getElementById(`device-card-${device.id}`);
    if (elem) {
      const statusSpan = elem.querySelector(".device-lock-state");
      if (statusSpan) {
        statusSpan.textContent = device.screenLocked ? "LOCKED" : "UNLOCKED";
        statusSpan.className = `device-lock-state ${device.screenLocked ? "locked" : "unlocked"}`;
      }
    }
  }
}

export const energyCore = new EnergyCoreController();

if (typeof window !== "undefined") {
  window.energyCore = energyCore;
  window.CORE_STATES = CORE_STATES;
  window.EnergyCoreController = EnergyCoreController;
}
