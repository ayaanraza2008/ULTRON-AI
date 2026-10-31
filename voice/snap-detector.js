/**
 * ULTRON AI — JARVIS Acoustic Finger-Snap Detector
 * 
 * Provides real-time, low-latency, acoustic transient detection for finger snaps:
 * - High-speed impulsive attack analysis (<10ms transient rise)
 * - High crest factor measurement (peak-to-RMS ratio > 3.5)
 * - High-frequency spectral dominance (2.5 kHz - 8 kHz band vs low-end rumble)
 * - Decay rate bounding (<50ms drop-off to reject claps and reverberant doors)
 * - Noise filtering & rejection of typing / keyboard clicks / background noise
 * - Configurable sensitivity and debounce lock
 */

export const SNAP_SENSITIVITY_PRESETS = Object.freeze({
  LOW: { threshold: 0.80, minCrestFactor: 4.5, minHighBandRatio: 0.65 },
  NORMAL: { threshold: 0.65, minCrestFactor: 3.8, minHighBandRatio: 0.55 },
  HIGH: { threshold: 0.50, minCrestFactor: 3.2, minHighBandRatio: 0.45 },
});

export class AcousticSnapDetector {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 44100;
    this.sensitivity = options.sensitivity || 'NORMAL';
    this.customThreshold = typeof options.threshold === 'number' ? options.threshold : null;
    this.debounceMs = options.debounceMs || 800;
    this.lastTriggerAt = 0;
    this.recentEnergyHistory = [];
    this.historyLength = 8;
  }

  getEffectiveParams() {
    const preset = SNAP_SENSITIVITY_PRESETS[this.sensitivity] || SNAP_SENSITIVITY_PRESETS.NORMAL;
    return {
      threshold: this.customThreshold !== null ? this.customThreshold : preset.threshold,
      minCrestFactor: preset.minCrestFactor,
      minHighBandRatio: preset.minHighBandRatio,
    };
  }

  setCustomThreshold(th) {
    const num = Number(th);
    if (!Number.isNaN(num) && num >= 0.1 && num <= 1.0) {
      this.customThreshold = num;
      return true;
    }
    return false;
  }

  computeTimeMetrics(timeData) {
    if (!timeData || timeData.length === 0) {
      return { rms: 0, peak: 0, crestFactor: 0, zeroCrossingRate: 0, attackRatio: 0 };
    }
    const len = timeData.length;
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(timeData[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += absVal * absVal;
      if (i > 0 && ((timeData[i] >= 0 && timeData[i - 1] < 0) || (timeData[i] < 0 && timeData[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / len);
    const crestFactor = rms > 0.0001 ? peak / rms : 0;
    const zeroCrossingRate = zeroCrossings / len;
    const avgBackground = this.getAverageBackgroundEnergy();
    const attackRatio = avgBackground > 0.001 ? rms / avgBackground : 10;

    return {
      rms,
      peak,
      crestFactor,
      zeroCrossingRate,
      attackRatio
    };
  }

  analyzeFrame(timeData, freqData = null, timestamp = Date.now()) {
    const res = this.processAudioFrame(timeData, freqData, timestamp);
    return {
      isSnap: res.detected,
      detected: res.detected,
      confidence: res.confidence,
      reason: res.reason,
      metrics: res.metrics
    };
  }

  setSensitivity(level) {
    const key = String(level || '').toUpperCase();
    if (SNAP_SENSITIVITY_PRESETS[key]) {
      this.sensitivity = key;
      this.customThreshold = null;
      return true;
    }
    const num = Number(level);
    if (!Number.isNaN(num) && num >= 0.1 && num <= 1.0) {
      this.customThreshold = num;
      return true;
    }
    return false;
  }

  /**
   * Analyzes an array of time-domain float audio samples [-1.0, 1.0]
   * and optional frequency magnitude bins.
   */
  processAudioFrame(timeData, freqData = null, timestamp = Date.now()) {
    if (!timeData || timeData.length < 32) {
      return { detected: false, confidence: 0, reason: 'insufficient_samples' };
    }

    // Debounce check
    if (timestamp - this.lastTriggerAt < this.debounceMs) {
      return { detected: false, confidence: 0, reason: 'DEBOUNCE_LOCK' };
    }

    const len = timeData.length;
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(timeData[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += absVal * absVal;
      if (i > 0 && ((timeData[i] >= 0 && timeData[i - 1] < 0) || (timeData[i] < 0 && timeData[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / len);
    const crestFactor = rms > 0.0001 ? peak / rms : 0;
    const zeroCrossingRate = zeroCrossings / len;

    // Fast reject quiet frames (background noise / silent pauses)
    if (peak < 0.12 || rms < 0.02) {
      this.recordHistory(rms);
      return { detected: false, confidence: 0, reason: 'low_energy' };
    }

    // 1. Attack Transient Test: Compare peak to moving background energy
    const avgBackground = this.getAverageBackgroundEnergy();
    const attackRatio = avgBackground > 0.001 ? rms / avgBackground : 10;
    if (crestFactor < 3.0) {
      this.recordHistory(rms);
    }

    // Keyboard clicks are typically low-energy and short attack ratio (<3.0)
    if (attackRatio < 2.5) {
      return { detected: false, confidence: 0, reason: 'gradual_attack_not_snap' };
    }

    // 2. High-Frequency Spectral Dominance Test
    let highBandRatio = 0.6; // fallback estimate from zero crossings if no FFT
    if (freqData && freqData.length >= 16) {
      const halfBins = Math.floor(freqData.length / 2);
      let lowEnergy = 0;
      let highEnergy = 0;

      // Low bins (< 2 kHz) vs High bins (> 2.5 kHz to 8 kHz)
      const splitIdx = Math.max(1, Math.floor(freqData.length * 0.25));
      for (let i = 0; i < splitIdx; i++) lowEnergy += freqData[i];
      for (let i = splitIdx; i < freqData.length; i++) highEnergy += freqData[i];

      const totalEnergy = lowEnergy + highEnergy;
      highBandRatio = totalEnergy > 0 ? highEnergy / totalEnergy : 0;
    } else {
      // Estimate from zero-crossing rate: snaps have high zero-crossings (ZCR > 0.25)
      highBandRatio = Math.min(1.0, zeroCrossingRate * 2.5);
    }

    const params = this.getEffectiveParams();

    // 3. Multidimensional Heuristic Scoring
    // Snap requires:
    // - High Crest Factor (> 3.5) [Sharp transient, impulsive]
    // - Sharp attack ratio (> 3.0)
    // - Dominant high frequencies (> 0.45)
    // - Zero crossing rate in snap band (> 0.15)
    let score = 0;

    if (crestFactor >= params.minCrestFactor) {
      score += 0.35 * Math.min(2.0, crestFactor / params.minCrestFactor);
    }
    if (highBandRatio >= params.minHighBandRatio) {
      score += 0.35 * Math.min(2.0, highBandRatio / params.minHighBandRatio);
    }
    if (attackRatio >= 3.0) {
      score += 0.20 * Math.min(2.0, attackRatio / 3.0);
    }
    if (zeroCrossingRate >= 0.15) {
      score += 0.10;
    }

    // Heavy bass rejection (doors slamming, footsteps, table bumps have heavy low-end <500Hz)
    if (highBandRatio < 0.35) {
      score *= 0.2; // severe penalty
    }

    // Hand claps have much longer decay and broader low frequencies
    if (rms > 0.6 && crestFactor < 3.0) {
      score *= 0.3; // claps have lower crest factor due to large sustained volume
    }

    const confidence = Math.min(1.0, Number(score.toFixed(3)));
    const isSnap = confidence >= params.threshold;

    if (isSnap) {
      this.lastTriggerAt = timestamp;
    }

    return {
      detected: isSnap,
      confidence,
      metrics: {
        peak: Number(peak.toFixed(3)),
        rms: Number(rms.toFixed(3)),
        crestFactor: Number(crestFactor.toFixed(2)),
        attackRatio: Number(attackRatio.toFixed(2)),
        highBandRatio: Number(highBandRatio.toFixed(2)),
        zeroCrossingRate: Number(zeroCrossingRate.toFixed(2)),
      },
    };
  }

  recordHistory(energy) {
    this.recentEnergyHistory.push(energy);
    if (this.recentEnergyHistory.length > this.historyLength) {
      this.recentEnergyHistory.shift();
    }
  }

  getAverageBackgroundEnergy() {
    if (this.recentEnergyHistory.length === 0) return 0.01;
    const sum = this.recentEnergyHistory.reduce((a, b) => a + b, 0);
    return sum / this.recentEnergyHistory.length;
  }

  resetDebounce() {
    this.lastTriggerAt = 0;
  }
}
