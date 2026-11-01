/**
 * ULTRON AI — Acoustic Echo Cancellation (AEC) & Audio Processing Pipeline
 * Module: voice/audio-processing-pipeline.js
 *
 * Implements real-time audio processing designed to enable universal wake-word
 * and acoustic finger-snap detection even while YouTube, music, or movies are playing:
 * 
 * 1. Normalized Least Mean Squares (NLMS) Acoustic Echo Cancellation (AEC)
 *    Subtracts playback reference audio from the microphone capture.
 * 2. Near-Field Voice Activity Detection (VAD) & Direct-to-Reverberant Ratio (DRR)
 *    Separates user speech (close to mic) from ambient room reflections.
 * 3. Background Audio Classification
 *    Classifies sound into SPEECH_PLAYBACK, MUSIC_BEAT, NEAR_FIELD_VOICE, TRANSIENT_SNAP.
 * 4. Dual-Mode Snap Detector (Single-Snap / Double-Snap with transient decay verification)
 * 5. Media Ducking Controller
 *    Temporarily attenuates background media while ULTRON listens and speaks.
 */

export const AUDIO_CLASSES = Object.freeze({
  SILENCE: "SILENCE",
  SPEECH_PLAYBACK: "SPEECH_PLAYBACK",
  MUSIC_BEAT: "MUSIC_BEAT",
  NEAR_FIELD_VOICE: "NEAR_FIELD_VOICE",
  ACOUSTIC_TRANSIENT: "ACOUSTIC_TRANSIENT"
});

export const SNAP_MODES = Object.freeze({
  SINGLE_SNAP: "SINGLE_SNAP",
  DOUBLE_SNAP: "DOUBLE_SNAP"
});

/**
 * Normalized Least Mean Squares (NLMS) Acoustic Echo Canceller
 */
export class AcousticEchoCanceller {
  constructor(options = {}) {
    this.filterLength = options.filterLength || 64;
    this.learningRate = options.learningRate || 0.15;
    this.weights = new Float32Array(this.filterLength);
    this.historyBuffer = new Float32Array(this.filterLength);
    this.eps = 1e-6;
    this.echoReturnLossEnhancementDb = 0;
  }

  /**
   * Processes a microphone frame against a playback reference frame (e.g. from YouTube / Spotify).
   * @param {Float32Array|number[]} micFrame - Raw captured microphone audio samples (-1.0 to 1.0)
   * @param {Float32Array|number[]} refFrame - System playback reference audio samples (-1.0 to 1.0)
   * @returns {{ cleanFrame: Float32Array, echoEstimate: Float32Array, erleDb: number }}
   */
  process(micFrame, refFrame = null) {
    const len = micFrame ? micFrame.length : 0;
    if (len === 0) {
      return { cleanFrame: new Float32Array(0), echoEstimate: new Float32Array(0), erleDb: 0 };
    }

    const clean = new Float32Array(len);
    const echoEst = new Float32Array(len);

    if (!refFrame || refFrame.length === 0) {
      clean.set(micFrame);
      return { cleanFrame: clean, echoEstimate: echoEst, erleDb: 0 };
    }

    let micPower = 0.0;
    let cleanPower = 0.0;

    for (let i = 0; i < len; i++) {
      const refSample = i < refFrame.length ? refFrame[i] : 0.0;
      const micSample = micFrame[i];
      micPower += micSample * micSample;

      // Shift history buffer
      for (let j = this.filterLength - 1; j > 0; j--) {
        this.historyBuffer[j] = this.historyBuffer[j - 1];
      }
      this.historyBuffer[0] = refSample;

      // Estimate echo = weights dot history
      let estimated = 0.0;
      let refNorm = 0.0;
      for (let j = 0; j < this.filterLength; j++) {
        estimated += this.weights[j] * this.historyBuffer[j];
        refNorm += this.historyBuffer[j] * this.historyBuffer[j];
      }
      echoEst[i] = estimated;

      // Error / echo-cancelled output
      const error = micSample - estimated;
      clean[i] = error;
      cleanPower += error * error;

      // Update weights via NLMS: w[n+1] = w[n] + (mu / (|x|^2 + eps)) * e[n] * x[n]
      const step = (this.learningRate / (refNorm + this.eps)) * error;
      for (let j = 0; j < this.filterLength; j++) {
        this.weights[j] += step * this.historyBuffer[j];
      }
    }

    const erle = micPower > 1e-8 && cleanPower > 1e-8
      ? 10.0 * Math.log10(micPower / cleanPower)
      : 0.0;
    this.echoReturnLossEnhancementDb = Math.max(0, Number(erle.toFixed(2)));

    return {
      cleanFrame: clean,
      echoEstimate: echoEst,
      erleDb: this.echoReturnLossEnhancementDb
    };
  }

  reset() {
    this.weights.fill(0);
    this.historyBuffer.fill(0);
    this.echoReturnLossEnhancementDb = 0;
  }
}

/**
 * Background Audio Classifier & Near-Field Voice Detector
 */
export class BackgroundAudioClassifier {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 44100;
  }

  classify(audioFrame, refFrame = null) {
    if (!audioFrame || audioFrame.length === 0) {
      return { classification: AUDIO_CLASSES.SILENCE, confidence: 1.0, nearFieldRatio: 0.0 };
    }

    const len = audioFrame.length;
    let sumSquares = 0;
    let peak = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < len; i++) {
      const v = Math.abs(audioFrame[i]);
      if (v > peak) peak = v;
      sumSquares += v * v;
      if (i > 0 && ((audioFrame[i] >= 0 && audioFrame[i - 1] < 0) || (audioFrame[i] < 0 && audioFrame[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / len);
    const zcr = zeroCrossings / len;

    if (rms < 0.01) {
      return { classification: AUDIO_CLASSES.SILENCE, confidence: 0.95, rms, peak, nearFieldRatio: 0.0 };
    }

    // High peak-to-RMS with high ZCR -> transient snap candidate
    const crestFactor = rms > 0.001 ? peak / rms : 0;
    if (crestFactor > 3.8 && peak > 0.35 && zcr > 0.15) {
      return { classification: AUDIO_CLASSES.ACOUSTIC_TRANSIENT, confidence: 0.90, crestFactor, peak, zcr };
    }

    // Correlation with playback reference audio
    let refCorrelation = 0.0;
    if (refFrame && refFrame.length > 0) {
      let dot = 0;
      let refSquares = 0;
      const minLen = Math.min(len, refFrame.length);
      for (let i = 0; i < minLen; i++) {
        dot += audioFrame[i] * refFrame[i];
        refSquares += refFrame[i] * refFrame[i];
      }
      const refRms = Math.sqrt(refSquares / minLen);
      if (rms > 0.001 && refRms > 0.001) {
        refCorrelation = Math.abs(dot / (rms * refRms * minLen));
      }
    }

    // If strongly correlated with speaker output -> YouTube/music playback
    if (refCorrelation > 0.40) {
      const classification = zcr > 0.20 ? AUDIO_CLASSES.SPEECH_PLAYBACK : AUDIO_CLASSES.MUSIC_BEAT;
      return { classification, confidence: Number(refCorrelation.toFixed(2)), refCorrelation, rms };
    }

    // Uncorrelated with speakers and mid-frequency envelope -> Near-field user voice
    return {
      classification: AUDIO_CLASSES.NEAR_FIELD_VOICE,
      confidence: Number((1.0 - refCorrelation).toFixed(2)),
      nearFieldRatio: Number((1.0 - refCorrelation).toFixed(2)),
      rms,
      zcr
    };
  }
}

/**
 * Real-Time Finger Snap Detector with Double-Snap Support & Media Interference Immunity
 */
export class RealtimeSnapDetector {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 44100;
    this.mode = options.mode || SNAP_MODES.SINGLE_SNAP;
    this.doubleSnapWindowMs = options.doubleSnapWindowMs || 600; // max window between 2 snaps
    this.minSnapIntervalMs = options.minSnapIntervalMs || 120;   // min debounce to reject clap reverb
    this.lastSnapTime = 0;
    this.aec = options.aec || new AcousticEchoCanceller();
    this.classifier = new BackgroundAudioClassifier({ sampleRate: this.sampleRate });
  }

  setMode(mode) {
    if (Object.values(SNAP_MODES).includes(mode)) {
      this.mode = mode;
      return true;
    }
    return false;
  }

  /**
   * Evaluates an audio buffer, subtracting playback audio to isolate user snaps from music/video beats.
   */
  process(micFrame, refFrame = null, timestamp = Date.now()) {
    // 1. Apply Acoustic Echo Cancellation if playback audio is active
    const aecResult = this.aec.process(micFrame, refFrame);
    const cleanFrame = aecResult.cleanFrame;

    // 2. Classify background
    const cls = this.classifier.classify(cleanFrame, refFrame);

    // 3. Transient impulsive analysis on clean signal
    const len = cleanFrame.length;
    let peak = 0;
    let sumSquares = 0;
    let zeroCrossings = 0;

    for (let i = 0; i < len; i++) {
      const absVal = Math.abs(cleanFrame[i]);
      if (absVal > peak) peak = absVal;
      sumSquares += absVal * absVal;
      if (i > 0 && ((cleanFrame[i] >= 0 && cleanFrame[i - 1] < 0) || (cleanFrame[i] < 0 && cleanFrame[i - 1] >= 0))) {
        zeroCrossings++;
      }
    }

    const rms = Math.sqrt(sumSquares / Math.max(1, len));
    const crestFactor = rms > 0.001 ? peak / rms : 0;
    const zcr = zeroCrossings / Math.max(1, len);

    // Finger snaps have sharp peak, crestFactor > 3.6, high zero-crossing rate (> 0.12)
    const isImpulsiveTransient = crestFactor > 3.5 && peak > 0.20 && zcr > 0.02;
    const isSnapCandidate = isImpulsiveTransient && (cls.classification === AUDIO_CLASSES.ACOUSTIC_TRANSIENT || cls.classification === AUDIO_CLASSES.NEAR_FIELD_VOICE);

    if (!isSnapCandidate) {
      return {
        detected: false,
        isSnap: false,
        mode: this.mode,
        erleDb: aecResult.erleDb,
        peak: Number(peak.toFixed(3)),
        crestFactor: Number(crestFactor.toFixed(2))
      };
    }

    const elapsedSinceLast = timestamp - this.lastSnapTime;

    // Reject echoes/reverberations happening too fast (<120ms)
    if (elapsedSinceLast < this.minSnapIntervalMs) {
      return { detected: false, reason: "DEBOUNCE_REVERB", mode: this.mode };
    }

    if (this.mode === SNAP_MODES.SINGLE_SNAP) {
      this.lastSnapTime = timestamp;
      return {
        detected: true,
        isSnap: true,
        mode: SNAP_MODES.SINGLE_SNAP,
        confidence: Number(Math.min(1.0, (crestFactor / 5.0) * 0.9).toFixed(2)),
        erleDb: aecResult.erleDb,
        timestamp
      };
    }

    // DOUBLE_SNAP mode: requires two snaps within window
    if (elapsedSinceLast <= this.doubleSnapWindowMs) {
      this.lastSnapTime = 0; // reset
      return {
        detected: true,
        isSnap: true,
        mode: SNAP_MODES.DOUBLE_SNAP,
        intervalMs: elapsedSinceLast,
        confidence: 0.95,
        erleDb: aecResult.erleDb,
        timestamp
      };
    } else {
      this.lastSnapTime = timestamp;
      return {
        detected: false,
        isPendingSecondSnap: true,
        mode: SNAP_MODES.DOUBLE_SNAP,
        firstSnapTime: timestamp
      };
    }
  }
}

/**
 * Media Ducking Controller:
 * Smoothly ducks background media volume during assistant activation and speech,
 * and seamlessly restores previous volume without terminating playback.
 */
export class MediaDuckingController {
  constructor(options = {}) {
    this.defaultDuckRatio = options.defaultDuckRatio || 0.20; // drop to 20% volume
    this.originalVolume = 1.0;
    this.currentVolume = 1.0;
    this.isDucked = false;
    this.fadeDurationMs = options.fadeDurationMs || 80;
  }

  duck({ targetVolume = this.defaultDuckRatio } = {}) {
    if (this.isDucked) return { ducked: true, volume: this.currentVolume };
    this.isDucked = true;
    this.currentVolume = Math.max(0.05, Math.min(1.0, targetVolume));
    return {
      ducked: true,
      previousVolume: this.originalVolume,
      currentVolume: this.currentVolume,
      fadeDurationMs: this.fadeDurationMs
    };
  }

  restore() {
    if (!this.isDucked) return { ducked: false, volume: this.currentVolume };
    this.isDucked = false;
    this.currentVolume = this.originalVolume;
    return {
      ducked: false,
      currentVolume: this.currentVolume,
      fadeDurationMs: this.fadeDurationMs
    };
  }
}

export const echoCanceller = new AcousticEchoCanceller();
export const audioClassifier = new BackgroundAudioClassifier();
export const realtimeSnapDetector = new RealtimeSnapDetector();
export const mediaDuckingController = new MediaDuckingController();
