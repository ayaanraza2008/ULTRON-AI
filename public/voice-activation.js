/**
 * ULTRON AI — Browser Hands-Free Voice Activation & Web Audio Controller
 * 
 * Manages:
 * - Local microphone stream & AudioContext AnalyserNode
 * - Acoustic finger snap detection with transient frequency analysis
 * - Continuous Web Speech API wake-word listener ("ULTRON", "Hey ULTRON")
 * - Audio-reactive Living Energy Core modulation
 * - Pure Web Audio synthesized cyber activation chime
 * - Continuous conversation loop & automatic re-arming
 * - Persistent mic status indicator & emergency mute control
 */

import { AcousticSnapDetector } from '/voice/snap-detector.js';
import { UltronVoiceActivationSystem, VOICE_ACTIVATION_STATES } from '/voice/voice-activation-system.js';
import { energyCore, CORE_STATES } from './energy-core.js';

export class BrowserVoiceActivationController {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.micStream = null;
    this.micSource = null;
    this.animFrameId = null;
    this.recognition = null;
    this.isMuted = false;
    this.soundsEnabled = true;

    // Preferences
    this.snapEnabled = true;
    this.wakeWordEnabled = true;
    this.continuousEnabled = true;
    this.conversationTimeoutMs = 10000;
    this.snapSensitivity = 'NORMAL';

    this.loadPreferences();

    // Master voice activation engine
    this.system = new UltronVoiceActivationSystem({
      snapActivationEnabled: this.snapEnabled,
      wakeWordActivationEnabled: this.wakeWordEnabled,
      continuousConversationEnabled: this.continuousEnabled,
      conversationTimeoutMs: this.conversationTimeoutMs,
      onStateChange: (from, to, meta) => this.handleStateTransition(from, to, meta),
      onWake: (source, meta) => this.handleWakeTrigger(source, meta),
      onCommand: (command, src) => this.handleCommandDispatch(command, src),
      onAudioInterruption: () => this.handleInterruption(),
      onError: (err) => console.warn('[VoiceActivation] Error:', err),
    });

    this.system.snapDetector.setSensitivity(this.snapSensitivity);
  }

  loadPreferences() {
    try {
      const stored = localStorage.getItem('ultron_voice_prefs');
      if (stored) {
        const p = JSON.parse(stored);
        if (typeof p.snapEnabled === 'boolean') this.snapEnabled = p.snapEnabled;
        if (typeof p.continuousEnabled === 'boolean') this.continuousEnabled = p.continuousEnabled;
        if (p.snapSensitivity) this.snapSensitivity = p.snapSensitivity;
        if (p.conversationTimeoutMs) this.conversationTimeoutMs = p.conversationTimeoutMs;
        if (typeof p.soundsEnabled === 'boolean') this.soundsEnabled = p.soundsEnabled;
      }
    } catch {}
  }

  savePreferences() {
    try {
      const p = {
        snapEnabled: this.snapEnabled,
        continuousEnabled: this.continuousEnabled,
        snapSensitivity: this.snapSensitivity,
        conversationTimeoutMs: this.conversationTimeoutMs,
        soundsEnabled: this.soundsEnabled,
      };
      localStorage.setItem('ultron_voice_prefs', JSON.stringify(p));
    } catch {}
  }

  /**
   * Initializes microphone capture and Web Audio analysis
   */
  async start() {
    if (this.system.getState() !== VOICE_ACTIVATION_STATES.DISABLED && this.micStream) {
      return { ok: true, state: this.system.getState() };
    }

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false, // keep transients raw for snap detection
          autoGainControl: false,
        },
      });

      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
      }

      this.micSource = this.audioCtx.createMediaStreamSource(this.micStream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;
      this.micSource.connect(this.analyser);

      // Start SpeechRecognition for Wake Word
      this.initSpeechRecognition();

      // Start real-time audio sampling loop
      this.startAudioProcessingLoop();

      this.system.startMonitoring({ hasPermission: true });
      this.updateMicHudIndicator(true);

      return { ok: true, state: this.system.getState() };
    } catch (err) {
      console.error('[VoiceActivation] Failed to acquire microphone:', err);
      this.updateMicHudIndicator(false, err.message);
      this.system.transitionTo(VOICE_ACTIVATION_STATES.ERROR, { error: err.message });
      return { ok: false, error: err.message };
    }
  }

  stop() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.recognition) {
      try {
        this.recognition.onend = null;
        this.recognition.stop();
      } catch {}
      this.recognition = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(t => t.stop());
      this.micStream = null;
    }
    if (this.audioCtx) {
      try { this.audioCtx.close(); } catch {}
      this.audioCtx = null;
    }

    this.system.stopMonitoring();
    this.updateMicHudIndicator(false);
    energyCore.setVisualState(CORE_STATES.STANDBY, 'Voice Monitoring Standby');
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach(t => { t.enabled = !this.isMuted; });
    }
    this.system.setMute(this.isMuted);
    this.updateMicHudIndicator(!this.isMuted, this.isMuted ? 'Muted' : 'Active');
    return this.isMuted;
  }

  initSpeechRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('[VoiceActivation] SpeechRecognition not supported in this browser.');
      return;
    }

    this.recognition = new SpeechRec();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = document.getElementById('voiceLanguageSelect')?.value || 'en-IN';

    this.recognition.onresult = (event) => {
      if (this.isMuted) return;
      const last = event.results[event.results.length - 1];
      const transcript = last[0].transcript;

      const currentState = this.system.getState();

      // If in WAKE_MONITORING, check for wake word
      if (currentState === VOICE_ACTIVATION_STATES.WAKE_MONITORING || currentState === VOICE_ACTIVATION_STATES.SLEEPING) {
        this.system.processTranscriptForWakeWord(transcript);
      } else if (currentState === VOICE_ACTIVATION_STATES.LISTENING) {
        if (last.isFinal) {
          this.system.handleSpokenUtterance(transcript);
        }
      }
    };

    this.recognition.onerror = (e) => {
      if (e.error === 'not-allowed') {
        this.stop();
      }
    };

    this.recognition.onend = () => {
      // Auto-restart continuous recognition while system is active
      if (this.system.getState() !== VOICE_ACTIVATION_STATES.DISABLED && !this.isMuted) {
        try { this.recognition.start(); } catch {}
      }
    };

    try { this.recognition.start(); } catch {}
  }

  startAudioProcessingLoop() {
    const timeData = new Float32Array(this.analyser.fftSize);
    const freqData = new Uint8Array(this.analyser.frequencyBinCount);

    const checkFrame = () => {
      if (!this.analyser) return;

      this.analyser.getFloatTimeDomainData(timeData);
      this.analyser.getByteFrequencyData(freqData);

      // Compute normalized RMS amplitude for real-time visual core reactivity
      let sum = 0;
      for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
      const rms = Math.sqrt(sum / timeData.length);
      const normalizedLevel = Math.min(1.0, rms * 4.0);

      const currentState = this.system.getState();

      // Audio reactive core when actively listening or speaking
      if (currentState === VOICE_ACTIVATION_STATES.LISTENING) {
        energyCore.setAudioReactivity(normalizedLevel);
      }

      // Snap Detection
      if (!this.isMuted && this.snapEnabled) {
        this.system.processAudioForSnap(timeData, freqData);
      }

      this.animFrameId = requestAnimationFrame(checkFrame);
    };

    this.animFrameId = requestAnimationFrame(checkFrame);
  }

  handleStateTransition(fromState, toState, meta) {
    const statusText = document.getElementById('voiceActivationStatusText');
    if (statusText) statusText.textContent = `STATE: ${toState}`;

    switch (toState) {
      case VOICE_ACTIVATION_STATES.WAKE_MONITORING:
        energyCore.setVisualState(CORE_STATES.WAKE_MONITORING, 'Listening for ULTRON or Snap');
        energyCore.resetScale();
        break;
      case VOICE_ACTIVATION_STATES.ACTIVATING:
        if (meta.source === 'FINGER_SNAP') {
          energyCore.setVisualState(CORE_STATES.SNAP_DETECTED, 'Finger Snap Recognized');
          energyCore.triggerActivationRipple('#facc15');
        } else {
          energyCore.setVisualState(CORE_STATES.WAKE_DETECTED, 'Wake Word Recognized');
        }
        if (this.soundsEnabled) this.playCyberChime();
        break;
      case VOICE_ACTIVATION_STATES.LISTENING:
        energyCore.setVisualState(CORE_STATES.LISTENING, 'Listening to user...');
        break;
      case VOICE_ACTIVATION_STATES.THINKING:
        energyCore.setVisualState(CORE_STATES.THINKING, 'Processing request...');
        break;
      case VOICE_ACTIVATION_STATES.EXECUTING:
        energyCore.setVisualState(CORE_STATES.EXECUTING, 'Executing command...');
        break;
      case VOICE_ACTIVATION_STATES.SPEAKING:
        energyCore.setVisualState(CORE_STATES.SPEAKING, 'ULTRON Speaking (am_onyx)');
        break;
      case VOICE_ACTIVATION_STATES.SLEEPING:
        energyCore.setVisualState(CORE_STATES.SLEEPING, 'Sleep Mode Active');
        break;
      case VOICE_ACTIVATION_STATES.ERROR:
        energyCore.setVisualState(CORE_STATES.ERROR, meta.error || 'Voice Error');
        break;
      default:
        break;
    }
  }

  handleWakeTrigger(source, meta) {
    const badge = document.getElementById('voiceHudActiveBadge');
    if (badge) {
      badge.textContent = `⚡ WAKE: ${source}`;
      badge.style.display = 'inline-block';
      setTimeout(() => { badge.style.display = 'none'; }, 3000);
    }
  }

  handleCommandDispatch(commandText, source) {
    const input = document.getElementById('userInput');
    if (input) {
      input.value = commandText;
      // Trigger application submission flow
      const sendBtn = document.getElementById('sendBtn') || document.getElementById('userSendBtn');
      if (sendBtn) {
        sendBtn.click();
      } else {
        const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
        input.dispatchEvent(event);
      }
    }
  }

  handleInterruption() {
    console.log('[VoiceActivation] Speech output interrupted by user');
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    const audioElements = document.querySelectorAll('audio');
    audioElements.forEach(a => { try { a.pause(); a.currentTime = 0; } catch {} });
  }

  /**
   * Synthesize a pure futuristic cyber chime using Web Audio oscillator
   */
  playCyberChime() {
    if (!this.audioCtx || this.audioCtx.state !== 'running') return;
    try {
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      const now = this.audioCtx.currentTime;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08); // E6

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  updateMicHudIndicator(active, label = '') {
    const pill = document.getElementById('micStatusPill');
    const dot = document.getElementById('micActiveDot');
    const text = document.getElementById('micStatusLabel');
    if (!pill) return;

    if (active) {
      pill.style.borderColor = '#48bb78';
      if (dot) dot.style.background = '#48bb78';
      if (text) text.textContent = label || 'MIC ACTIVE (ALWAYS-READY)';
    } else {
      pill.style.borderColor = this.isMuted ? '#f56565' : '#4a5568';
      if (dot) dot.style.background = this.isMuted ? '#f56565' : '#718096';
      if (text) text.textContent = label || (this.isMuted ? 'MIC MUTED' : 'MIC STANDBY');
    }
  }
}

export const voiceActivationController = new BrowserVoiceActivationController();

if (typeof window !== "undefined") {
  window.voiceActivationController = voiceActivationController;
  window.BrowserVoiceActivationController = BrowserVoiceActivationController;
}
