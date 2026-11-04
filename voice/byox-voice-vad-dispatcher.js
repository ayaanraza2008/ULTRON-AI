/**
 * ULTRON AI — BYOX Voice Activity Detector (VAD) & Proactive Dispatcher
 *
 * Derived from Build Your Own X concepts:
 * - Soham Kamani: How to make a responsive telegram bot
 * - Roll your own IRC bot (Event loop, rate-limiting, message queues)
 * - botsfloor: Creating a simple bot with event dispatch
 *
 * Implements pure-CPU Root Mean Square (RMS) Voice Activity Detection (VAD),
 * adaptive noise-floor calibration, and priority-queued proactive speech dispatch.
 */

export class ByoxVoiceVadDispatcher {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 16000;
    this.speechThresholdMultiplier = options.speechThresholdMultiplier || 2.5;
    this.minSpeechDurationMs = options.minSpeechDurationMs || 250;
    this.silenceHangoverMs = options.silenceHangoverMs || 500;

    this.adaptiveNoiseFloor = 100; // Initial baseline RMS
    this.alpha = 0.05; // Smoothing factor for noise tracking

    // Dispatcher queue
    this.dispatchQueue = [];
    this.isSpeaking = false;
    this.quietHours = options.quietHours || { enabled: false, startHour: 23, endHour: 7 };
    this.lastDispatchedAt = 0;
    this.minDispatchGapMs = options.minDispatchGapMs ?? 2000;
  }

  /**
   * Compute RMS energy from 16-bit PCM buffer.
   */
  computeRms(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length < 2) return 0;

    let sumSquares = 0;
    const numSamples = Math.floor(pcmBuffer.length / 2);

    for (let i = 0; i < numSamples; i++) {
      const sample = pcmBuffer.readInt16LE(i * 2);
      sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / numSamples);
  }

  /**
   * Classify audio chunk as SPEECH or SILENCE using adaptive noise floor.
   */
  processAudioChunk(pcmBuffer) {
    const rms = this.computeRms(pcmBuffer);
    const durationMs = Math.round((pcmBuffer.length / 2 / this.sampleRate) * 1000);

    const speechThreshold = this.adaptiveNoiseFloor * this.speechThresholdMultiplier;
    const isSpeech = rms > speechThreshold;

    if (!isSpeech) {
      // Update adaptive noise floor during silence
      this.adaptiveNoiseFloor = (1 - this.alpha) * this.adaptiveNoiseFloor + this.alpha * rms;
    }

    return {
      rms: Math.round(rms),
      noiseFloor: Math.round(this.adaptiveNoiseFloor),
      threshold: Math.round(speechThreshold),
      isSpeech,
      durationMs
    };
  }

  /**
   * Check if current time falls within Quiet Hours.
   */
  isQuietHours(currentDate = new Date()) {
    if (!this.quietHours.enabled) return false;
    const hour = currentDate.getHours();
    const { startHour, endHour } = this.quietHours;

    if (startHour > endHour) {
      // Overnight (e.g., 23:00 to 07:00)
      return hour >= startHour || hour < endHour;
    }
    return hour >= startHour && hour < endHour;
  }

  /**
   * Enqueue a proactive voice message with priority.
   */
  enqueueProactiveMessage(text, priority = 'NORMAL', metadata = {}) {
    if (!text || typeof text !== 'string') {
      throw new Error('Valid text string required for proactive dispatch');
    }

    const priorityWeights = { URGENT: 100, HIGH: 50, NORMAL: 20, LOW: 5 };
    const weight = priorityWeights[priority.toUpperCase()] || 20;

    const item = {
      id: `voice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      text,
      priority: priority.toUpperCase(),
      weight,
      metadata,
      enqueuedAt: Date.now()
    };

    // Insert sorted by priority weight
    const insertIdx = this.dispatchQueue.findIndex(q => q.weight < weight);
    if (insertIdx === -1) {
      this.dispatchQueue.push(item);
    } else {
      this.dispatchQueue.splice(insertIdx, 0, item);
    }

    return item;
  }

  /**
   * Check and poll the next eligible message to dispatch.
   */
  pollNextDispatch(currentDate = new Date()) {
    if (this.dispatchQueue.length === 0 || this.isSpeaking) {
      return null;
    }

    const now = Date.now();
    if (now - this.lastDispatchedAt < this.minDispatchGapMs) {
      return null; // Rate limit spacing
    }

    const inQuietHours = this.isQuietHours(currentDate);

    // Find first message permitted to play
    const candidateIdx = this.dispatchQueue.findIndex(item => {
      if (inQuietHours && item.priority !== 'URGENT') {
        return false; // Suppress non-urgent during quiet hours
      }
      return true;
    });

    if (candidateIdx === -1) {
      return null;
    }

    const item = this.dispatchQueue.splice(candidateIdx, 1)[0];
    this.lastDispatchedAt = now;
    return item;
  }

  /**
   * Clear the proactive dispatch queue (e.g. on emergency stop).
   */
  clearQueue() {
    const droppedCount = this.dispatchQueue.length;
    this.dispatchQueue = [];
    return { droppedCount };
  }
}
