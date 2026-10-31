/**
 * ULTRON AI — JARVIS Always-On Voice Activation & State Machine
 * 
 * Implements low-latency, hands-free dual activation, 12-state lifecycle,
 * natural continuous conversation, speech interruption, and privacy controls.
 */

import { AcousticSnapDetector } from './snap-detector.js';
import { containsWakeWord, normalizeTranscript } from './wake-word.js';

export const VOICE_ACTIVATION_STATES = Object.freeze({
  DISABLED: 'DISABLED',
  INITIALIZING: 'INITIALIZING',
  WAKE_MONITORING: 'WAKE_MONITORING',
  ACTIVATING: 'ACTIVATING',
  LISTENING: 'LISTENING',
  TRANSCRIBING: 'TRANSCRIBING',
  THINKING: 'THINKING',
  EXECUTING: 'EXECUTING',
  SPEAKING: 'SPEAKING',
  RETURNING_TO_READY: 'RETURNING_TO_READY',
  ERROR: 'ERROR',
  SLEEPING: 'SLEEPING',
});

export const WAKE_PHRASES = Object.freeze([
  'ultron',
  'hey ultron',
  'hello ultron',
  'ultron listen',
  'ultron wake up',
  'wake up ultron',
  'ok ultron',
]);

export const VOICE_CONTROL_COMMANDS = Object.freeze({
  WAKE_UP: 'WAKE_UP',
  LISTEN: 'LISTEN',
  STOP_LISTENING: 'STOP_LISTENING',
  SLEEP: 'SLEEP',
  WAKE_WORD_MODE: 'WAKE_WORD_MODE',
  CONTINUOUS_MODE: 'CONTINUOUS_MODE',
  INTERRUPT: 'INTERRUPT',
  CANCEL_TASK: 'CANCEL_TASK',
  MUTE_MIC: 'MUTE_MIC',
  UNMUTE_MIC: 'UNMUTE_MIC',
  DEACTIVATE: 'DEACTIVATE',
});

export class UltronVoiceActivationSystem {
  constructor(options = {}) {
    this.state = VOICE_ACTIVATION_STATES.DISABLED;
    this.snapDetector = new AcousticSnapDetector(options.snapOptions || {});
    this.snapActivationEnabled = options.snapActivationEnabled !== false;
    this.wakeWordActivationEnabled = options.wakeWordActivationEnabled !== false;
    this.continuousConversationEnabled = options.continuousConversationEnabled !== false;
    this.conversationTimeoutMs = options.conversationTimeoutMs || 10000;
    this.wakeWord = (options.wakeWord || 'ultron').toLowerCase();
    this.wakeCooldownMs = options.wakeCooldownMs || 2000;
    this.cloudStreamingActive = false;
    this.isMuted = false;
    this.hasMicPermission = false;
    this.lastWakeAt = 0;
    this.conversationTimer = null;
    this.now = options.now || Date.now;

    // Event hooks
    this.onStateChange = options.onStateChange || (() => {});
    this.onWake = options.onWake || (() => {});
    this.onCommand = options.onCommand || (() => {});
    this.onAudioInterruption = options.onAudioInterruption || (() => {});
    this.onError = options.onError || (() => {});
  }

  getState() {
    return this.state;
  }

  isListening() {
    return this.state === VOICE_ACTIVATION_STATES.LISTENING;
  }

  isWakeMonitoring() {
    return this.state === VOICE_ACTIVATION_STATES.WAKE_MONITORING;
  }

  transitionTo(newState, metadata = {}) {
    if (!Object.values(VOICE_ACTIVATION_STATES).includes(newState)) {
      throw new Error(`Invalid voice activation state: ${newState}`);
    }
    const oldState = this.state;
    if (oldState === newState) return;

    this.state = newState;
    this.onStateChange(oldState, newState, {
      timestamp: this.now(),
      muted: this.isMuted,
      ...metadata,
    });
  }

  /**
   * Start always-ready monitoring (requires explicit mic permission)
   */
  startMonitoring({ hasPermission = true } = {}) {
    if (this.isMuted) {
      return { ok: false, error: 'MICROPHONE_MUTED' };
    }
    this.hasMicPermission = hasPermission;
    if (!hasPermission) {
      this.transitionTo(VOICE_ACTIVATION_STATES.ERROR, { error: 'PERMISSION_DENIED' });
      return { ok: false, error: 'PERMISSION_DENIED' };
    }

    this.transitionTo(VOICE_ACTIVATION_STATES.INITIALIZING);
    this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING);
    return { ok: true, state: this.state };
  }

  stopMonitoring() {
    this.clearConversationTimer();
    this.transitionTo(VOICE_ACTIVATION_STATES.DISABLED);
    return { ok: true, state: this.state };
  }

  setMute(muted = true) {
    this.isMuted = Boolean(muted);
    if (this.isMuted) {
      this.clearConversationTimer();
      if (this.state !== VOICE_ACTIVATION_STATES.DISABLED) {
        this.transitionTo(VOICE_ACTIVATION_STATES.SLEEPING, { reason: 'MUTED' });
      }
    } else {
      if (this.state === VOICE_ACTIVATION_STATES.SLEEPING) {
        this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING, { reason: 'UNMUTED' });
      }
    }
    return { isMuted: this.isMuted, state: this.state };
  }

  /**
   * Process raw audio frame for acoustic finger-snap detection
   */
  processAudioForSnap(timeData, freqData = null) {
    if (this.isMuted || !this.snapActivationEnabled) {
      return { triggered: false };
    }

    // Only detect snap when in WAKE_MONITORING, SLEEPING, or speaking (for interruption)
    if (
      this.state !== VOICE_ACTIVATION_STATES.WAKE_MONITORING &&
      this.state !== VOICE_ACTIVATION_STATES.SLEEPING &&
      this.state !== VOICE_ACTIVATION_STATES.SPEAKING
    ) {
      return { triggered: false };
    }

    const res = this.snapDetector.processAudioFrame(timeData, freqData, this.now());
    if (res.detected) {
      // Handle speech interruption if snap occurred during speaking
      if (this.state === VOICE_ACTIVATION_STATES.SPEAKING) {
        this.onAudioInterruption();
      }

      this.triggerActivation('FINGER_SNAP', { confidence: res.confidence, metrics: res.metrics });
      return { triggered: true, detected: true, confidence: res.confidence };
    }

    return { triggered: false, detected: false, confidence: res.confidence };
  }

  /**
   * Process speech transcript for wake phrase detection
   */
  processTranscriptForWakeWord(rawTranscript) {
    if (this.isMuted || !this.wakeWordActivationEnabled) {
      return { triggered: false };
    }

    const norm = normalizeTranscript(rawTranscript);
    if (!norm) return { triggered: false };

    // Check if in WAKE_MONITORING or SLEEPING or SPEAKING (interruption)
    const canWake = (
      this.state === VOICE_ACTIVATION_STATES.WAKE_MONITORING ||
      this.state === VOICE_ACTIVATION_STATES.SLEEPING ||
      this.state === VOICE_ACTIVATION_STATES.SPEAKING
    );

    if (!canWake) return { triggered: false };

    const containsPhrase = WAKE_PHRASES.some(phrase => norm.includes(phrase)) || containsWakeWord(norm, this.wakeWord);

    if (containsPhrase) {
      const currentTime = this.now();
      if (currentTime - this.lastWakeAt < this.wakeCooldownMs) {
        return { triggered: false, reason: 'cooldown' };
      }
      this.lastWakeAt = currentTime;

      if (this.state === VOICE_ACTIVATION_STATES.SPEAKING) {
        this.onAudioInterruption();
      }

      // Extract spoken query after the wake word if user said "Ultron, what time is it?"
      const strippedQuery = this.stripWakePhrase(rawTranscript);

      this.triggerActivation('VOICE_WAKE_WORD', { transcript: rawTranscript, strippedQuery });
      return { triggered: true, query: strippedQuery, hasEmbeddedCommand: Boolean(strippedQuery && strippedQuery.length > 2) };
    }

    return { triggered: false };
  }

  stripWakePhrase(text) {
    let clean = String(text || '').trim();
    const pattern = new RegExp(`^(?:hey|hello|ok|okay)?\\s*${this.wakeWord}[,\\s]*(?:please|listen|wake up)?\\s*`, 'i');
    clean = clean.replace(pattern, '').trim();
    return clean;
  }

  /**
   * Central activation trigger (snap or voice)
   */
  triggerWake(source, metadata = {}) {
    return this.triggerActivation(source, metadata);
  }

  triggerActivation(source, metadata = {}) {
    if (this.isMuted) return { ok: false, reason: 'MUTED' };
    this.clearConversationTimer();
    this.transitionTo(VOICE_ACTIVATION_STATES.ACTIVATING, { source, ...metadata });
    this.onWake(source, metadata);

    // Transition immediately to LISTENING
    this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { source });

    // If a complete command was already included in the wake sentence (e.g. "Ultron, open my panel")
    if (metadata.strippedQuery && metadata.strippedQuery.length > 2) {
      this.handleSpokenUtterance(metadata.strippedQuery);
    } else {
      // Start continuous conversation silence timeout
      this.resetConversationTimer();
    }
    return { ok: true, state: this.state };
  }

  /**
   * Handle user speech utterance while in LISTENING mode
   */
  handleSpokenUtterance(transcript) {
    const clean = String(transcript || '').trim();
    if (!clean) return;

    const controlCommand = this.parseVoiceControlCommand(clean);
    if (controlCommand === VOICE_CONTROL_COMMANDS.UNMUTE_MIC) {
      this.executeVoiceControlCommand(controlCommand, clean);
      return;
    }

    if (this.isMuted) return;

    if (this.state === VOICE_ACTIVATION_STATES.SPEAKING) {
      this.onAudioInterruption();
    }

    this.clearConversationTimer();
    this.transitionTo(VOICE_ACTIVATION_STATES.TRANSCRIBING, { transcript: clean });

    // 1. Check for immediate Voice Control Commands (e.g. "ULTRON sleep", "stop listening")
    if (controlCommand) {
      this.executeVoiceControlCommand(controlCommand, clean);
      return;
    }

    // 2. Regular AI intent execution
    this.transitionTo(VOICE_ACTIVATION_STATES.THINKING, { query: clean });
    this.onCommand(clean, 'user_speech');
  }

  /**
   * Parse specific voice system commands
   */
  parseVoiceControlCommand(transcript) {
    const text = normalizeTranscript(transcript);
    const target = this.wakeWord;

    if (text === `${target} sleep` || text === 'sleep' || text === `${target} go to sleep`) {
      return VOICE_CONTROL_COMMANDS.SLEEP;
    }
    if (text === `${target} wake up` || text === 'wake up') {
      return VOICE_CONTROL_COMMANDS.WAKE_UP;
    }
    if (text === `${target} stop listening` || text === 'stop listening' || text === `${target} stop`) {
      return VOICE_CONTROL_COMMANDS.STOP_LISTENING;
    }
    if (text === `${target} listen` || text === 'listen') {
      return VOICE_CONTROL_COMMANDS.LISTEN;
    }
    if (text === `${target} mute microphone` || text === 'mute microphone' || text === `${target} mute`) {
      return VOICE_CONTROL_COMMANDS.MUTE_MIC;
    }
    if (text === `${target} unmute microphone` || text === 'unmute microphone' || text === `${target} unmute`) {
      return VOICE_CONTROL_COMMANDS.UNMUTE_MIC;
    }
    if (text === `${target} interrupt` || text === 'interrupt') {
      return VOICE_CONTROL_COMMANDS.INTERRUPT;
    }
    if (text.includes('cancel the current task') || text.includes('cancel task') || text.includes('abort task')) {
      return VOICE_CONTROL_COMMANDS.CANCEL_TASK;
    }
    if (text.includes('wake word mode')) {
      return VOICE_CONTROL_COMMANDS.WAKE_WORD_MODE;
    }
    if (text.includes('continuous conversation mode') || text.includes('continuous mode')) {
      return VOICE_CONTROL_COMMANDS.CONTINUOUS_MODE;
    }
    if (text.includes('deactivate voice activation') || text.includes('turn off voice activation')) {
      return VOICE_CONTROL_COMMANDS.DEACTIVATE;
    }

    return null;
  }

  /**
   * Execute voice system command
   */
  executeVoiceControlCommand(command, rawTranscript) {
    switch (command) {
      case VOICE_CONTROL_COMMANDS.SLEEP:
        this.transitionTo(VOICE_ACTIVATION_STATES.SLEEPING, { reason: 'VOICE_COMMAND' });
        break;
      case VOICE_CONTROL_COMMANDS.WAKE_UP:
      case VOICE_CONTROL_COMMANDS.LISTEN:
        this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { reason: 'VOICE_COMMAND' });
        this.resetConversationTimer();
        break;
      case VOICE_CONTROL_COMMANDS.STOP_LISTENING:
        this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING, { reason: 'VOICE_COMMAND' });
        break;
      case VOICE_CONTROL_COMMANDS.MUTE_MIC:
        this.setMute(true);
        break;
      case VOICE_CONTROL_COMMANDS.UNMUTE_MIC:
        this.setMute(false);
        break;
      case VOICE_CONTROL_COMMANDS.INTERRUPT:
        this.onAudioInterruption();
        this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { reason: 'VOICE_COMMAND' });
        this.resetConversationTimer();
        break;
      case VOICE_CONTROL_COMMANDS.CONTINUOUS_MODE:
        this.continuousConversationEnabled = true;
        this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { mode: 'continuous' });
        this.resetConversationTimer();
        break;
      case VOICE_CONTROL_COMMANDS.WAKE_WORD_MODE:
        this.continuousConversationEnabled = false;
        this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING, { mode: 'wake_word_only' });
        break;
      case VOICE_CONTROL_COMMANDS.DEACTIVATE:
        this.stopMonitoring();
        break;
      case VOICE_CONTROL_COMMANDS.CANCEL_TASK:
        this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { cancelled: true });
        this.onCommand('cancel current task', 'system_control');
        break;
      default:
        break;
    }
  }

  /**
   * Signals that backend AI execution has begun
   */
  notifyExecuting(details = {}) {
    this.transitionTo(VOICE_ACTIVATION_STATES.EXECUTING, details);
  }

  /**
   * Signals that speech audio output has started
   */
  notifySpeakingStarted(details = {}) {
    this.clearConversationTimer();
    this.transitionTo(VOICE_ACTIVATION_STATES.SPEAKING, details);
  }

  /**
   * Signals that speech audio output has completed:
   * Re-arms automatically into LISTENING if continuous mode is enabled,
   * otherwise returns to WAKE_MONITORING.
   */
  notifySpeakingEnded() {
    this.transitionTo(VOICE_ACTIVATION_STATES.RETURNING_TO_READY);

    if (this.continuousConversationEnabled && !this.isMuted) {
      // Smooth re-arm into listening without requiring user to click or say wake word again
      this.transitionTo(VOICE_ACTIVATION_STATES.LISTENING, { reason: 'AUTO_REARM' });
      this.resetConversationTimer();
    } else {
      this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING, { reason: 'AUTO_REARM' });
    }
  }

  resetConversationTimer() {
    this.clearConversationTimer();
    if (this.conversationTimeoutMs > 0) {
      this.conversationTimer = setTimeout(() => {
        if (this.state === VOICE_ACTIVATION_STATES.LISTENING) {
          this.transitionTo(VOICE_ACTIVATION_STATES.WAKE_MONITORING, { reason: 'CONVERSATION_TIMEOUT' });
        }
      }, this.conversationTimeoutMs);
    }
  }

  clearConversationTimer() {
    if (this.conversationTimer) {
      clearTimeout(this.conversationTimer);
      this.conversationTimer = null;
    }
  }

  getDiagnostics() {
    return {
      state: this.state,
      isMuted: this.isMuted,
      hasMicPermission: this.hasMicPermission,
      wakeWord: this.wakeWord,
      snapSensitivity: this.snapDetector.sensitivity,
      snapEnabled: this.snapActivationEnabled,
      continuousConversation: this.continuousConversationEnabled,
      conversationTimeoutMs: this.conversationTimeoutMs,
      hardwareProfile: 'AMD Ryzen 7 5700U 8GB RAM Safe (Local FFT/AudioWorklet)',
    };
  }
}
