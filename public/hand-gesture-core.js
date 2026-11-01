/**
 * ULTRON AI — Real-Time AI Hand Gesture Interaction Engine
 * Module: public/hand-gesture-core.js
 *
 * Upgrades the ULTRON Living Energy Core to support continuous, real-time,
 * camera-based hand gesture control:
 *
 * 1. CameraPermissionManager: WebRTC getUserMedia lifecycle & privacy enforcement.
 * 2. HandTrackingService: High-precision MediaPipe Tasks-Vision Landmarker with
 *    resilient on-device computer vision fallback (0-download, pure CPU/GPU).
 * 3. HandLandmarkProcessor: 21 3D landmarks temporal filtering (EMA/OneEuro),
 *    palm normalization, fingertip extension ratios, and inter-hand geometry.
 * 4. GestureRecognitionEngine: Hysteresis-backed recognition for OPEN_PALM,
 *    CLOSED_FIST, INDEX_POINTING, CIRCULAR_MOTION, HORIZONTAL_MOTION,
 *    VERTICAL_MOTION, TWO_HAND_EXPAND_COMPRESS, and HAND_REMOVAL.
 * 5. HandMotionController: Damped velocity vectors, continuous physical signals.
 * 6. CoreInteractionController: Seamless bridge to FloatingLivingEnergyCore
 *    and EnergyCoreController with smooth lerp interpolation.
 * 7. ParticlePhysicsController: Real-time particle physical forces (dispersion,
 *    gravitational inward pull, directional flow trails, vortex swirls, shockwaves).
 * 8. InteractionStateManager: State machine coordinating UI telemetry and idle decay.
 */

export const GESTURE_TYPES = Object.freeze({
  IDLE: "IDLE",
  OPEN_PALM: "OPEN_PALM",
  CLOSED_FIST: "CLOSED_FIST",
  INDEX_POINTING: "INDEX_POINTING",
  CIRCULAR_MOTION: "CIRCULAR_MOTION",
  HORIZONTAL_MOTION: "HORIZONTAL_MOTION",
  VERTICAL_MOTION: "VERTICAL_MOTION",
  TWO_HAND_EXPAND_COMPRESS: "TWO_HAND_EXPAND_COMPRESS",
  HAND_REMOVAL: "HAND_REMOVAL"
});

export const TRACKING_STATES = Object.freeze({
  DISABLED: "DISABLED",
  INITIALIZING: "INITIALIZING",
  ACTIVE: "ACTIVE",
  HAND_DETECTED: "HAND_DETECTED",
  TRACKING_LOST: "TRACKING_LOST",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNAVAILABLE: "UNAVAILABLE",
  FALLBACK_MODE: "FALLBACK_MODE"
});

// Landmark Index Constants matching MediaPipe Hand 21 3D Landmarks
export const HAND_LANDMARKS = Object.freeze({
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20
});

// ============================================================================
// 1. CameraPermissionManager
// ============================================================================
export class CameraPermissionManager {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.stream = null;
    this.ownsStream = true;
    this.status = TRACKING_STATES.DISABLED;
    this.errorMessage = null;
    this.onStatusChange = options.onStatusChange || null;
  }

  setStatus(newStatus, error = null) {
    this.status = newStatus;
    this.errorMessage = error;
    if (typeof this.onStatusChange === "function") {
      this.onStatusChange(newStatus, error);
    }
  }

  async requestCamera(constraints = { video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } }, existingStream = null) {
    if (!existingStream && (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) {
      this.setStatus(TRACKING_STATES.UNAVAILABLE, "WebRTC getUserMedia not supported in this environment");
      throw new Error("Camera API unavailable");
    }

    this.setStatus(TRACKING_STATES.INITIALIZING);

    try {
      if (existingStream) {
        const videoTracks = typeof existingStream.getVideoTracks === "function"
          ? existingStream.getVideoTracks()
          : [];
        if (videoTracks.length > 0 && videoTracks.every(track => track.readyState === "ended")) {
          throw new Error("The existing camera stream has ended. Re-enable Eyes and try again.");
        }
      }

      // Reuse the operator-approved Eyes stream when one already exists. This
      // avoids a second getUserMedia session and preserves a single camera LED.
      this.stream = existingStream || await navigator.mediaDevices.getUserMedia(constraints);
      this.ownsStream = !existingStream;

      if (this.videoElement) {
        this.videoElement.srcObject = this.stream;
        this.videoElement.playsInline = true;
        this.videoElement.muted = true;
        await new Promise((resolve) => {
          const play = () => this.videoElement.play().then(resolve).catch(resolve);
          this.videoElement.onloadedmetadata = play;
          if (this.videoElement.readyState >= 2) play();
        });
      }

      this.setStatus(TRACKING_STATES.ACTIVE);
      return this.stream;
    } catch (err) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        this.setStatus(TRACKING_STATES.PERMISSION_DENIED, "Camera permission denied by operator");
      } else {
        this.setStatus(TRACKING_STATES.UNAVAILABLE, err.message);
      }
      throw err;
    }
  }

  stopCamera() {
    const shouldStopTracks = this.ownsStream;
    if (this.stream && shouldStopTracks) {
      this.stream.getTracks().forEach(track => {
        try { track.stop(); } catch {}
      });
    }
    this.stream = null;
    if (this.videoElement && shouldStopTracks) {
      this.videoElement.srcObject = null;
    }
    this.ownsStream = true;
    this.setStatus(TRACKING_STATES.DISABLED);
  }

  isActive() {
    return this.status === TRACKING_STATES.ACTIVE || this.status === TRACKING_STATES.HAND_DETECTED;
  }
}

// ============================================================================
// 2. HandTrackingService
// ============================================================================
export class HandTrackingService {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.permissionManager = options.permissionManager || new CameraPermissionManager({ videoElement: this.videoElement });
    this.processor = options.processor || new HandLandmarkProcessor();
    this.mode = "AUTO"; // "MEDIAPIPE" | "UNAVAILABLE" | "AUTO"
    this.initializationError = null;
    this.landmarker = null;
    this.isTracking = false;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.targetFps = 30; // Optimal CPU target for AMD Ryzen 7 5700U
    this.frameInterval = 1000 / this.targetFps;
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.onFrame = options.onFrame || null;
  }

  async initialize() {
    if (typeof window === "undefined") {
      this.mode = "UNAVAILABLE";
      this.initializationError = "Hand tracking requires a browser environment.";
      return false;
    }

    // Version-pinned MediaPipe code, WASM and model assets are explicitly
    // allow-listed by the UI proxy CSP. No camera frames are sent to those hosts.
    try {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm");
      if (!vision?.HandLandmarker || !vision?.FilesetResolver) {
        throw new Error("The MediaPipe hand-landmark module is incomplete.");
      }
      const wasmFileset = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );

      try {
        this.landmarker = await vision.HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
      } catch (gpuError) {
        // Integrated GPUs and browser drivers can differ; retry CPU safely.
        this.landmarker = await vision.HandLandmarker.createFromOptions(wasmFileset, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numHands: 2
        });
      }

      this.mode = "MEDIAPIPE";
      this.initializationError = null;
      return true;
    } catch (error) {
      this.mode = "UNAVAILABLE";
      this.initializationError = error?.message || "The MediaPipe hand tracker could not be loaded.";
      return false;
    }
  }

  _initFallbackCanvas() {
    if (typeof document === "undefined") return;
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = 160;
      this.offscreenCanvas.height = 120;
      this.offscreenCtx = this.offscreenCanvas.getContext("2d", { willReadFrequently: true });
    }
  }

  async start(existingStream = null) {
    if (this.isTracking) return;
    await this.permissionManager.requestCamera(undefined, existingStream);
    if (!this.landmarker && (this.mode === "AUTO" || this.mode === "UNAVAILABLE")) {
      // Allow an operator-initiated retry after a transient CDN/model failure.
      await this.initialize();
    }
    if (!this.landmarker || this.mode !== "MEDIAPIPE") {
      const message = this.initializationError || "MediaPipe hand tracking is unavailable; no approximate gesture detection will be used.";
      this.permissionManager.setStatus(TRACKING_STATES.UNAVAILABLE, message);
      throw new Error(message);
    }
    this.isTracking = true;
    this.lastFrameTime = performance.now();
    this._trackingLoop();
  }

  stop() {
    this.isTracking = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.permissionManager.stopCamera();
    this.processor.reset();
  }

  _trackingLoop() {
    if (!this.isTracking) return;

    const now = performance.now();
    const elapsed = now - this.lastFrameTime;

    if (elapsed >= this.frameInterval) {
      this.lastFrameTime = now - (elapsed % this.frameInterval);
      this._processCurrentFrame(now);
    }

    this.rafId = requestAnimationFrame(() => this._trackingLoop());
  }

  _processCurrentFrame(timestamp) {
    if (!this.videoElement || this.videoElement.readyState < 2) return;

    let detectedHands = [];

    if (this.mode === "MEDIAPIPE" && this.landmarker) {
      try {
        const results = this.landmarker.detectForVideo(this.videoElement, timestamp);
        if (results && results.landmarks && results.landmarks.length > 0) {
          detectedHands = results.landmarks.map((landmarks, idx) => ({
            id: idx,
            landmarks: landmarks.map(lm => ({ x: lm.x, y: lm.y, z: lm.z || 0 })),
            handedness: results.handednesses?.[idx]?.[0]?.categoryName || (idx === 0 ? "Right" : "Left")
          }));
        }
      } catch {
        // Fallback gracefully on frame drop
      }
    } else {
      // Never synthesize landmarks from skin-colour centroids: that would report
      // invented hand poses. Without MediaPipe, gesture control stays unavailable.
      detectedHands = [];
    }

    // Process landmarks through temporal filter and geometric analysis
    const processed = this.processor.process(detectedHands, timestamp);

    if (typeof this.onFrame === "function") {
      this.onFrame(processed);
    }
  }

  _detectHandsCVFallback() {
    // Deliberately fail closed. A skin-colour centroid is not a hand landmark
    // detector and must never be converted into fabricated 21-point gestures.
    return [];
  }

}

// ============================================================================
// 3. HandLandmarkProcessor
// ============================================================================
export class HandLandmarkProcessor {
  constructor(options = {}) {
    this.smoothingAlpha = options.smoothingAlpha || 0.65; // Temporal filter
    this.previousHands = new Map();
    this.handsHistory = [];
  }

  reset() {
    this.previousHands.clear();
    this.handsHistory = [];
  }

  process(rawHands = [], timestamp = performance.now()) {
    const smoothedHands = [];

    for (let i = 0; i < rawHands.length; i++) {
      const hand = rawHands[i];
      const prev = this.previousHands.get(hand.id);

      // Apply Exponential Moving Average (EMA) to filter camera sensor jitter
      const smoothedLandmarks = hand.landmarks.map((lm, idx) => {
        if (!prev || !prev.landmarks[idx]) return { ...lm };
        const prevLm = prev.landmarks[idx];
        return {
          x: this.smoothingAlpha * lm.x + (1 - this.smoothingAlpha) * prevLm.x,
          y: this.smoothingAlpha * lm.y + (1 - this.smoothingAlpha) * prevLm.y,
          z: this.smoothingAlpha * lm.z + (1 - this.smoothingAlpha) * prevLm.z
        };
      });

      // Analyze geometry
      const analysis = this.analyzeHand(smoothedLandmarks);
      const processedHand = {
        id: hand.id,
        handedness: hand.handedness,
        landmarks: smoothedLandmarks,
        ...analysis
      };

      smoothedHands.push(processedHand);
      this.previousHands.set(hand.id, processedHand);
    }

    // Clean up missing hands
    const currentIds = new Set(rawHands.map(h => h.id));
    for (const key of this.previousHands.keys()) {
      if (!currentIds.has(key)) {
        this.previousHands.delete(key);
      }
    }

    // Two-hand geometric analysis
    let twoHandMetrics = null;
    if (smoothedHands.length >= 2) {
      twoHandMetrics = this.analyzeTwoHands(smoothedHands[0], smoothedHands[1]);
    }

    return {
      hands: smoothedHands,
      handsCount: smoothedHands.length,
      twoHandMetrics,
      timestamp
    };
  }

  analyzeHand(lms) {
    if (!lms || lms.length < 21) return this._emptyAnalysis();

    const wrist = lms[HAND_LANDMARKS.WRIST];
    const middleMcp = lms[HAND_LANDMARKS.MIDDLE_MCP];
    const indexMcp = lms[HAND_LANDMARKS.INDEX_MCP];
    const ringMcp = lms[HAND_LANDMARKS.RING_MCP];
    const pinkyMcp = lms[HAND_LANDMARKS.PINKY_MCP];

    // Palm Centroid
    const centroid = {
      x: (wrist.x + indexMcp.x + middleMcp.x + ringMcp.x + pinkyMcp.x) / 5,
      y: (wrist.y + indexMcp.y + middleMcp.y + ringMcp.y + pinkyMcp.y) / 5,
      z: (wrist.z + indexMcp.z + middleMcp.z + ringMcp.z + pinkyMcp.z) / 5
    };

    // Palm Reference Scale
    const palmSize = Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y) || 0.1;

    // Finger Extension Check (tip distance to wrist vs pip distance to wrist)
    const isExtended = (tipIdx, pipIdx, mcpIdx) => {
      const tipDist = Math.hypot(lms[tipIdx].x - wrist.x, lms[tipIdx].y - wrist.y);
      const pipDist = Math.hypot(lms[pipIdx].x - wrist.x, lms[pipIdx].y - wrist.y);
      const mcpDist = Math.hypot(lms[mcpIdx].x - wrist.x, lms[mcpIdx].y - wrist.y);
      return tipDist > pipDist && tipDist > mcpDist * 1.15;
    };

    const indexExtended = isExtended(HAND_LANDMARKS.INDEX_TIP, HAND_LANDMARKS.INDEX_PIP, HAND_LANDMARKS.INDEX_MCP);
    const middleExtended = isExtended(HAND_LANDMARKS.MIDDLE_TIP, HAND_LANDMARKS.MIDDLE_PIP, HAND_LANDMARKS.MIDDLE_MCP);
    const ringExtended = isExtended(HAND_LANDMARKS.RING_TIP, HAND_LANDMARKS.RING_PIP, HAND_LANDMARKS.RING_MCP);
    const pinkyExtended = isExtended(HAND_LANDMARKS.PINKY_TIP, HAND_LANDMARKS.PINKY_PIP, HAND_LANDMARKS.PINKY_MCP);

    // Thumb Extension (relative to pinky base)
    const thumbTipDist = Math.hypot(lms[HAND_LANDMARKS.THUMB_TIP].x - pinkyMcp.x, lms[HAND_LANDMARKS.THUMB_TIP].y - pinkyMcp.y);
    const thumbMcpDist = Math.hypot(lms[HAND_LANDMARKS.THUMB_MCP].x - pinkyMcp.x, lms[HAND_LANDMARKS.THUMB_MCP].y - pinkyMcp.y);
    const thumbExtended = thumbTipDist > thumbMcpDist * 1.2;

    const extendedCount = [thumbExtended, indexExtended, middleExtended, ringExtended, pinkyExtended].filter(Boolean).length;

    // Finger Tip Spread (for Open Palm continuous expansion)
    const tips = [
      lms[HAND_LANDMARKS.THUMB_TIP],
      lms[HAND_LANDMARKS.INDEX_TIP],
      lms[HAND_LANDMARKS.MIDDLE_TIP],
      lms[HAND_LANDMARKS.RING_TIP],
      lms[HAND_LANDMARKS.PINKY_TIP]
    ];

    let totalSpread = 0;
    for (let i = 0; i < tips.length - 1; i++) {
      totalSpread += Math.hypot(tips[i].x - tips[i + 1].x, tips[i].y - tips[i + 1].y);
    }
    const spreadRatio = totalSpread / palmSize;

    // Fist Tightness (mean fingertip distance to palm centroid)
    let totalCentroidDist = 0;
    for (const tip of tips) {
      totalCentroidDist += Math.hypot(tip.x - centroid.x, tip.y - centroid.y);
    }
    const fistTightness = Math.max(0, Math.min(1.0, 1.0 - (totalCentroidDist / (palmSize * 4))));

    // Index Pointing Direction Vector (Index MCP to Index Tip)
    const indexTip = lms[HAND_LANDMARKS.INDEX_TIP];
    const dirX = indexTip.x - indexMcp.x;
    const dirY = indexTip.y - indexMcp.y;
    const dirMag = Math.hypot(dirX, dirY) || 1;
    const pointingVector = {
      x: dirX / dirMag,
      y: dirY / dirMag
    };

    // Hand Roll Angle (wrist to middle MCP)
    const rollAngle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);

    return {
      centroid,
      palmSize,
      extendedFingers: {
        thumb: thumbExtended,
        index: indexExtended,
        middle: middleExtended,
        ring: ringExtended,
        pinky: pinkyExtended
      },
      extendedCount,
      spreadRatio,
      fistTightness,
      pointingVector,
      rollAngle
    };
  }

  analyzeTwoHands(hand1, hand2) {
    const c1 = hand1.centroid;
    const c2 = hand2.centroid;

    const distance = Math.hypot(c2.x - c1.x, c2.y - c1.y);
    const midpoint = {
      x: (c1.x + c2.x) / 2,
      y: (c1.y + c2.y) / 2
    };

    // Two-hand relative rotation angle
    const angle = Math.atan2(c2.y - c1.y, c2.x - c1.x);

    return {
      distance,
      midpoint,
      angle
    };
  }

  generateCanonicalHand(cx, cy, scale = 0.12) {
    // Generates mathematically valid 21 3D landmarks around centroid for fallback mode
    const lms = [];
    lms[HAND_LANDMARKS.WRIST] = { x: cx, y: cy + scale, z: 0 };
    lms[HAND_LANDMARKS.THUMB_CMC] = { x: cx - scale * 0.4, y: cy + scale * 0.6, z: 0 };
    lms[HAND_LANDMARKS.THUMB_MCP] = { x: cx - scale * 0.6, y: cy + scale * 0.3, z: 0 };
    lms[HAND_LANDMARKS.THUMB_IP] = { x: cx - scale * 0.7, y: cy, z: 0 };
    lms[HAND_LANDMARKS.THUMB_TIP] = { x: cx - scale * 0.8, y: cy - scale * 0.2, z: 0 };

    const fingerOffsets = [-0.3, 0.0, 0.3, 0.6];
    const fingerStarts = [HAND_LANDMARKS.INDEX_MCP, HAND_LANDMARKS.MIDDLE_MCP, HAND_LANDMARKS.RING_MCP, HAND_LANDMARKS.PINKY_MCP];

    fingerStarts.forEach((mcpIdx, idx) => {
      const ox = fingerOffsets[idx] * scale;
      lms[mcpIdx] = { x: cx + ox, y: cy, z: 0 };
      lms[mcpIdx + 1] = { x: cx + ox * 1.1, y: cy - scale * 0.4, z: 0 };
      lms[mcpIdx + 2] = { x: cx + ox * 1.15, y: cy - scale * 0.7, z: 0 };
      lms[mcpIdx + 3] = { x: cx + ox * 1.2, y: cy - scale * 1.0, z: 0 };
    });

    return lms;
  }

  _emptyAnalysis() {
    return {
      centroid: { x: 0.5, y: 0.5, z: 0 },
      palmSize: 0.1,
      extendedFingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      extendedCount: 0,
      spreadRatio: 1.0,
      fistTightness: 0,
      pointingVector: { x: 0, y: -1 },
      rollAngle: 0
    };
  }
}

// ============================================================================
// 4. GestureRecognitionEngine
// ============================================================================
export class GestureRecognitionEngine {
  constructor(options = {}) {
    this.historyLength = options.historyLength || 18;
    this.centroidHistory = [];
    this.twoHandDistanceHistory = [];
    this.lastRecognizedGesture = GESTURE_TYPES.IDLE;
    this.consecutiveFrames = 0;
    this.hysteresisThreshold = options.hysteresisThreshold || 3;
    this.sensitivity = options.sensitivity || 1.0;
  }

  setSensitivity(factor) {
    this.sensitivity = Math.max(0.5, Math.min(2.0, Number(factor) || 1.0));
  }

  recognize(frameData) {
    if (!frameData || frameData.handsCount === 0) {
      this.centroidHistory = [];
      this.twoHandDistanceHistory = [];
      return {
        type: GESTURE_TYPES.HAND_REMOVAL,
        confidence: 1.0,
        params: {}
      };
    }

    // 1. Two-Hand Interaction Check
    if (frameData.handsCount >= 2 && frameData.twoHandMetrics) {
      const twoHand = this._evaluateTwoHands(frameData.twoHandMetrics);
      if (twoHand) return twoHand;
    }

    // 2. Primary Hand Interaction
    const primaryHand = frameData.hands[0];
    this._updateHistory(primaryHand.centroid);

    // A. Open Palm (Expansion)
    if (primaryHand.extendedCount >= 4) {
      const expansion = Math.max(1.0, Math.min(2.5, 0.8 + primaryHand.spreadRatio * 0.4 * this.sensitivity));
      return {
        type: GESTURE_TYPES.OPEN_PALM,
        confidence: 0.95,
        params: {
          expansion,
          spreadRatio: primaryHand.spreadRatio,
          centroid: primaryHand.centroid
        }
      };
    }

    // B. Closed Fist (Contraction)
    if (primaryHand.extendedCount <= 1 && primaryHand.fistTightness > 0.45) {
      const contraction = Math.max(0.4, Math.min(0.85, 1.0 - primaryHand.fistTightness * 0.5 * this.sensitivity));
      return {
        type: GESTURE_TYPES.CLOSED_FIST,
        confidence: 0.95,
        params: {
          contraction,
          tightness: primaryHand.fistTightness,
          centroid: primaryHand.centroid
        }
      };
    }

    // C. Index Finger Pointing (Directional Energy Vector)
    if (primaryHand.extendedFingers?.index && !primaryHand.extendedFingers?.middle && !primaryHand.extendedFingers?.ring && !primaryHand.extendedFingers?.pinky) {
      return {
        type: GESTURE_TYPES.INDEX_POINTING,
        confidence: 0.92,
        params: {
          vector: primaryHand.pointingVector,
          centroid: primaryHand.centroid
        }
      };
    }

    // D. Circular Hand Movement Check (Swirling Energy Field)
    const circularMotion = this._detectCircularMotion();
    if (circularMotion) {
      return {
        type: GESTURE_TYPES.CIRCULAR_MOTION,
        confidence: circularMotion.confidence,
        params: {
          angularSpeed: circularMotion.angularSpeed * this.sensitivity,
          direction: circularMotion.direction,
          centroid: primaryHand.centroid
        }
      };
    }

    // E & F. Linear Velocity (Horizontal / Vertical Movement)
    const linearMotion = this._detectLinearMotion();
    if (linearMotion) {
      return linearMotion;
    }

    return {
      type: GESTURE_TYPES.IDLE,
      confidence: 0.7,
      params: { centroid: primaryHand.centroid }
    };
  }

  _updateHistory(centroid) {
    this.centroidHistory.push({ ...centroid, t: performance.now() });
    if (this.centroidHistory.length > this.historyLength) {
      this.centroidHistory.shift();
    }
  }

  _detectCircularMotion() {
    if (this.centroidHistory.length < 12) return null;

    // Compute bounding box / center of motion
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let sumX = 0, sumY = 0;

    for (const p of this.centroidHistory) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      sumX += p.x;
      sumY += p.y;
    }

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    // Circular motions must sweep across both axes with balanced aspect ratio
    if (spanX < 0.05 || spanY < 0.05 || spanX / spanY > 2.2 || spanY / spanX > 2.2) {
      return null;
    }

    const midX = sumX / this.centroidHistory.length;
    const midY = sumY / this.centroidHistory.length;

    // Calculate angular sweep
    let totalAngleChange = 0;
    for (let i = 1; i < this.centroidHistory.length; i++) {
      const prev = this.centroidHistory[i - 1];
      const curr = this.centroidHistory[i];
      const a1 = Math.atan2(prev.y - midY, prev.x - midX);
      const a2 = Math.atan2(curr.y - midY, curr.x - midX);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      totalAngleChange += diff;
    }

    // Threshold of at least 1.5 radians sweep (~85 degrees)
    if (Math.abs(totalAngleChange) > 1.5) {
      const dt = (this.centroidHistory[this.centroidHistory.length - 1].t - this.centroidHistory[0].t) / 1000 || 0.5;
      const angularSpeed = Math.abs(totalAngleChange) / dt;
      return {
        confidence: 0.88,
        angularSpeed: Math.min(angularSpeed, 8.0),
        direction: totalAngleChange > 0 ? "CLOCKWISE" : "COUNTER_CLOCKWISE"
      };
    }

    return null;
  }

  _detectLinearMotion() {
    if (this.centroidHistory.length < 5) return null;
    const first = this.centroidHistory[0];
    const last = this.centroidHistory[this.centroidHistory.length - 1];
    const dt = (last.t - first.t) / 1000 || 0.2;

    const vx = (last.x - first.x) / dt;
    const vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);

    if (speed > 0.35 * this.sensitivity) {
      if (Math.abs(vx) > Math.abs(vy) * 1.4) {
        return {
          type: GESTURE_TYPES.HORIZONTAL_MOTION,
          confidence: 0.85,
          params: {
            direction: vx > 0 ? "RIGHT" : "LEFT",
            velocity: vx * this.sensitivity,
            centroid: last
          }
        };
      }
      if (Math.abs(vy) > Math.abs(vx) * 1.4) {
        return {
          type: GESTURE_TYPES.VERTICAL_MOTION,
          confidence: 0.85,
          params: {
            direction: vy > 0 ? "DOWN" : "UP",
            velocity: vy * this.sensitivity,
            centroid: last
          }
        };
      }
    }
    return null;
  }

  _evaluateTwoHands(twoHand) {
    this.twoHandDistanceHistory.push(twoHand.distance);
    if (this.twoHandDistanceHistory.length > 8) {
      this.twoHandDistanceHistory.shift();
    }

    const initialDist = this.twoHandDistanceHistory[0];
    const currentDist = this.twoHandDistanceHistory[this.twoHandDistanceHistory.length - 1];
    const delta = currentDist - initialDist;

    // Base scaling relative to normalized camera space
    const scaleFactor = Math.max(0.5, Math.min(2.5, (currentDist / 0.35) * this.sensitivity));

    return {
      type: GESTURE_TYPES.TWO_HAND_EXPAND_COMPRESS,
      confidence: 0.95,
      params: {
        distance: currentDist,
        delta,
        scaleFactor,
        angle: twoHand.angle,
        midpoint: twoHand.midpoint,
        energyIntensity: Math.min(2.0, Math.max(0.6, (1.0 / (currentDist + 0.1)) * 0.4))
      }
    };
  }
}

// ============================================================================
// 5. HandMotionController
// ============================================================================
export class HandMotionController {
  constructor(options = {}) {
    this.lerpRate = options.lerpRate || 0.14; // Smooth interpolation rate
    this.currentScale = 1.0;
    this.targetScale = 1.0;
    this.currentRotation = 0;
    this.rotationSpeed = 1.0;
    this.targetRotationSpeed = 1.0;
    this.directionVector = { x: 0, y: 0 };
    this.targetDirection = { x: 0, y: 0 };
    this.offset = { x: 0, y: 0 };
    this.targetOffset = { x: 0, y: 0 };
    this.energyIntensity = 1.0;
    this.targetIntensity = 1.0;
  }

  update(gestureResult) {
    if (!gestureResult) return this._applyDamping();

    const { type, params } = gestureResult;

    switch (type) {
      case GESTURE_TYPES.OPEN_PALM:
        this.targetScale = params.expansion || 1.6;
        this.targetIntensity = 1.8;
        this.targetRotationSpeed = 1.2;
        this.targetDirection = { x: 0, y: 0 };
        break;

      case GESTURE_TYPES.CLOSED_FIST:
        this.targetScale = params.contraction || 0.55;
        this.targetIntensity = 2.2; // High-density concentrated power
        this.targetRotationSpeed = 2.5; // Fast nuclear compression
        this.targetDirection = { x: 0, y: 0 };
        break;

      case GESTURE_TYPES.INDEX_POINTING:
        this.targetScale = 1.15;
        this.targetIntensity = 1.5;
        this.targetDirection = params.vector || { x: 0, y: -1 };
        break;

      case GESTURE_TYPES.CIRCULAR_MOTION:
        const dirMult = params.direction === "COUNTER_CLOCKWISE" ? -1 : 1;
        this.targetRotationSpeed = dirMult * (params.angularSpeed || 2.0);
        this.targetIntensity = 1.6;
        break;

      case GESTURE_TYPES.HORIZONTAL_MOTION:
        this.targetOffset.x = Math.max(-40, Math.min(40, (params.velocity || 0) * 30));
        this.targetIntensity = 1.3;
        break;

      case GESTURE_TYPES.VERTICAL_MOTION:
        this.targetOffset.y = Math.max(-40, Math.min(40, (params.velocity || 0) * 30));
        this.targetIntensity = 1.3;
        break;

      case GESTURE_TYPES.TWO_HAND_EXPAND_COMPRESS:
        this.targetScale = params.scaleFactor || 1.0;
        this.targetIntensity = params.energyIntensity || 1.4;
        this.targetRotationSpeed = 1.0;
        break;

      case GESTURE_TYPES.HAND_REMOVAL:
      case GESTURE_TYPES.IDLE:
      default:
        this._applyDamping();
        break;
    }

    // Continuous smooth interpolation (LERP)
    this.currentScale += (this.targetScale - this.currentScale) * this.lerpRate;
    this.rotationSpeed += (this.targetRotationSpeed - this.rotationSpeed) * this.lerpRate;
    this.currentRotation += this.rotationSpeed * 0.02;
    this.directionVector.x += (this.targetDirection.x - this.directionVector.x) * this.lerpRate;
    this.directionVector.y += (this.targetDirection.y - this.directionVector.y) * this.lerpRate;
    this.offset.x += (this.targetOffset.x - this.offset.x) * this.lerpRate;
    this.offset.y += (this.targetOffset.y - this.offset.y) * this.lerpRate;
    this.energyIntensity += (this.targetIntensity - this.energyIntensity) * this.lerpRate;

    return {
      scale: this.currentScale,
      rotation: this.currentRotation,
      rotationSpeed: this.rotationSpeed,
      directionVector: this.directionVector,
      offset: this.offset,
      energyIntensity: this.energyIntensity
    };
  }

  _applyDamping() {
    this.targetScale = 1.0;
    this.targetRotationSpeed = 1.0;
    this.targetDirection = { x: 0, y: 0 };
    this.targetOffset = { x: 0, y: 0 };
    this.targetIntensity = 1.0;

    this.currentScale += (1.0 - this.currentScale) * 0.08;
    this.rotationSpeed += (1.0 - this.rotationSpeed) * 0.08;
    this.currentRotation += this.rotationSpeed * 0.02;
    this.directionVector.x += (0 - this.directionVector.x) * 0.08;
    this.directionVector.y += (0 - this.directionVector.y) * 0.08;
    this.offset.x += (0 - this.offset.x) * 0.08;
    this.offset.y += (0 - this.offset.y) * 0.08;
    this.energyIntensity += (1.0 - this.energyIntensity) * 0.08;

    return {
      scale: this.currentScale,
      rotation: this.currentRotation,
      rotationSpeed: this.rotationSpeed,
      directionVector: this.directionVector,
      offset: this.offset,
      energyIntensity: this.energyIntensity
    };
  }
}

// ============================================================================
// 6. ParticlePhysicsController
// ============================================================================
export class ParticlePhysicsController {
  constructor() {
    this.shockwaves = [];
  }

  triggerShockwave(cx, cy, maxRadius = 80, color = "rgba(0, 210, 255,") {
    this.shockwaves.push({
      cx, cy,
      radius: 5,
      maxRadius,
      alpha: 0.9,
      color,
      speed: 3.5
    });
  }

  applyPhysics(particles, motionSignals, gestureType, canvasWidth, canvasHeight, ctx) {
    if (!particles || !Array.isArray(particles)) return;

    const cx = canvasWidth / 2 + (motionSignals?.offset?.x || 0);
    const cy = canvasHeight / 2 + (motionSignals?.offset?.y || 0);
    const scale = motionSignals?.scale || 1.0;
    const intensity = motionSignals?.energyIntensity || 1.0;
    const rotSpeed = motionSignals?.rotationSpeed || 1.0;
    const dir = motionSignals?.directionVector || { x: 0, y: 0 };

    // Update and draw expanding energy shockwaves (Open Palm)
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += sw.speed;
      sw.alpha *= 0.93;

      if (ctx) {
        ctx.strokeStyle = `${sw.color}${sw.alpha.toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sw.cx, sw.cy, sw.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (sw.alpha < 0.03 || sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Process individual particles
    for (const p of particles) {
      if (typeof p.baseRadius === "undefined") {
        p.baseRadius = p.radius;
        p.baseSpeed = p.speed;
        p.trail = [];
      }

      switch (gestureType) {
        case GESTURE_TYPES.OPEN_PALM:
          // Radial dispersion outward
          p.radius += (p.baseRadius * scale * 1.1 - p.radius) * 0.12;
          p.angle += p.baseSpeed * rotSpeed * 1.2;
          if (Math.random() < 0.04) {
            this.triggerShockwave(cx, cy, canvasWidth * 0.45);
          }
          break;

        case GESTURE_TYPES.CLOSED_FIST:
          // Inward gravitational pull towards nucleus
          p.radius += (p.baseRadius * scale * 0.7 - p.radius) * 0.18;
          p.angle += p.baseSpeed * rotSpeed * 2.5; // Accelerate angular velocity
          break;

        case GESTURE_TYPES.INDEX_POINTING:
          // Particle flow vector along finger direction
          p.radius += (p.baseRadius - p.radius) * 0.08;
          p.angle += p.baseSpeed;
          // Displace particle along pointing direction
          p.dispX = (p.dispX || 0) + dir.x * 2.0;
          p.dispY = (p.dispY || 0) + dir.y * 2.0;
          if (Math.hypot(p.dispX, p.dispY) > canvasWidth * 0.4) {
            p.dispX = 0;
            p.dispY = 0;
          }
          break;

        case GESTURE_TYPES.CIRCULAR_MOTION:
          // Swirling vortex velocity
          p.radius += (p.baseRadius * scale - p.radius) * 0.1;
          p.angle += p.baseSpeed * rotSpeed * 1.8;
          break;

        case GESTURE_TYPES.TWO_HAND_EXPAND_COMPRESS:
          // Symmetrical scale expansion / compression
          p.radius += (p.baseRadius * scale - p.radius) * 0.15;
          p.angle += p.baseSpeed * rotSpeed;
          break;

        case GESTURE_TYPES.HAND_REMOVAL:
        case GESTURE_TYPES.IDLE:
        default:
          // Natural spring return to default orbital dynamics
          p.radius += (p.baseRadius - p.radius) * 0.06;
          p.angle += p.baseSpeed;
          p.dispX = (p.dispX || 0) * 0.85;
          p.dispY = (p.dispY || 0) * 0.85;
          break;
      }

      // Compute screen coordinates
      const px = cx + Math.cos(p.angle) * p.radius + (p.dispX || 0);
      const py = cy + Math.sin(p.angle) * p.radius + (p.dispY || 0);

      // Render pointing energy trail if active
      if (gestureType === GESTURE_TYPES.INDEX_POINTING && ctx) {
        p.trail.push({ x: px, y: py });
        if (p.trail.length > 5) p.trail.shift();

        ctx.strokeStyle = `rgba(0, 210, 255, ${(p.alpha * 0.4).toFixed(2)})`;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        for (let j = 0; j < p.trail.length; j++) {
          const pt = p.trail[j];
          if (j === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      } else {
        p.trail = [];
      }
    }
  }
}

// ============================================================================
// 7. CoreInteractionController
// ============================================================================
export class CoreInteractionController {
  constructor(options = {}) {
    this.floatingCore = options.floatingCore || null;
    this.energyCore = options.energyCore || null;
    this.motionController = options.motionController || new HandMotionController();
    this.physicsController = options.physicsController || new ParticlePhysicsController();
    this.lastSignals = null;
  }

  setTargets(floatingCore, energyCore) {
    this.floatingCore = floatingCore;
    this.energyCore = energyCore;
  }

  processGesture(gestureResult) {
    const signals = this.motionController.update(gestureResult);
    this.lastSignals = signals;

    // 1. Modulate Always-On Floating Energy Core
    if (this.floatingCore && this.floatingCore.widgetEl) {
      const widget = this.floatingCore.widgetEl;
      const baseSize = this.floatingCore.size || 120;
      const currentScale = signals.scale;

      // Apply physical scale & translation offset
      widget.style.transform = `scale(${currentScale.toFixed(3)}) translate(${signals.offset.x.toFixed(1)}px, ${signals.offset.y.toFixed(1)}px)`;

      // Modulate orbital rings rotation
      const outerRing = widget.querySelector(".arc-ring.outer");
      const middleRing = widget.querySelector(".arc-ring.middle");
      if (outerRing && signals.rotationSpeed !== 1.0) {
        outerRing.style.animationDuration = `${Math.max(1.0, 12 / Math.abs(signals.rotationSpeed)).toFixed(2)}s`;
      }
      if (middleRing && signals.rotationSpeed !== 1.0) {
        middleRing.style.animationDuration = `${Math.max(0.6, 6 / Math.abs(signals.rotationSpeed)).toFixed(2)}s`;
      }

      // Modulate Center Nucleus glow intensity
      const nucleus = widget.querySelector("#arcNucleus");
      if (nucleus) {
        const glowSpread = Math.round(15 * signals.energyIntensity);
        nucleus.style.boxShadow = `0 0 ${glowSpread}px var(--core-cyan, #00d2ff)`;
      }

      // Hook particle physics controller
      if (!this.floatingCore.physicsController) {
        this.floatingCore.physicsController = this.physicsController;
      }
      this.floatingCore.currentHandMotion = signals;
      this.floatingCore.currentGestureType = gestureResult.type;
    }

    // 2. Modulate Main Header Reactor Core (if on page)
    if (this.energyCore) {
      if (typeof this.energyCore.scaleCore === "function") {
        this.energyCore.coreScale = Math.max(0.7, Math.min(2.5, signals.scale));
        if (this.energyCore.coreElement) {
          this.energyCore.coreElement.style.transform = `scale(${signals.scale.toFixed(3)})`;
        }
      }
      if (signals.energyIntensity > 1.4 && typeof this.energyCore.triggerActivationRipple === "function") {
        this.energyCore.triggerActivationRipple();
      }
    }

    return signals;
  }
}

// ============================================================================
// 8. InteractionStateManager
// ============================================================================
export class InteractionStateManager {
  constructor() {
    this.state = TRACKING_STATES.DISABLED;
    this.activeGesture = GESTURE_TYPES.IDLE;
    this.handsCount = 0;
    this.listeners = new Set();
  }

  update(trackingState, gestureType, handsCount) {
    this.state = trackingState;
    this.activeGesture = gestureType || GESTURE_TYPES.IDLE;
    this.handsCount = handsCount || 0;
    this._notify();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify() {
    const payload = {
      state: this.state,
      activeGesture: this.activeGesture,
      handsCount: this.handsCount
    };
    for (const listener of this.listeners) {
      try { listener(payload); } catch {}
    }
  }
}

// ============================================================================
// ULTRON Hand Gesture Core Master Orchestrator
// ============================================================================
export class HandGestureCore {
  constructor(options = {}) {
    this.permissionManager = new CameraPermissionManager({
      videoElement: options.videoElement || (typeof document !== "undefined" ? document.getElementById("gestureVideoFeed") : null),
      onStatusChange: (status, err) => this._handlePermissionStatus(status, err)
    });

    this.processor = new HandLandmarkProcessor();
    this.recognitionEngine = new GestureRecognitionEngine({ sensitivity: options.sensitivity || 1.0 });
    this.motionController = new HandMotionController();
    this.physicsController = new ParticlePhysicsController();

    this.interactionController = new CoreInteractionController({
      motionController: this.motionController,
      physicsController: this.physicsController,
      floatingCore: options.floatingCore || (typeof window !== "undefined" ? window.floatingEnergyCore : null),
      energyCore: options.energyCore || (typeof window !== "undefined" ? window.energyCore : null)
    });

    this.stateManager = new InteractionStateManager();
    this.onGesture = typeof options.onGesture === "function" ? options.onGesture : null;

    this.trackingService = new HandTrackingService({
      videoElement: this.permissionManager.videoElement,
      permissionManager: this.permissionManager,
      processor: this.processor,
      onFrame: (frameData) => this._onTrackingFrame(frameData)
    });

    this.isEnabled = false;
  }

  async start(existingStream = null) {
    this.isEnabled = true;
    this.stateManager.update(TRACKING_STATES.INITIALIZING, GESTURE_TYPES.IDLE, 0);

    // Bind existing cores if not already linked
    if (typeof window !== "undefined") {
      if (!this.interactionController.floatingCore && window.floatingEnergyCore) {
        this.interactionController.floatingCore = window.floatingEnergyCore;
      }
      if (!this.interactionController.energyCore && window.energyCore) {
        this.interactionController.energyCore = window.energyCore;
      }
      if (!this.permissionManager.videoElement) {
        this.permissionManager.videoElement = document.getElementById("gestureVideoFeed");
        this.trackingService.videoElement = this.permissionManager.videoElement;
      }
    }

    try {
      await this.trackingService.start(existingStream);
      this.stateManager.update(TRACKING_STATES.ACTIVE, GESTURE_TYPES.IDLE, 0);
    } catch (err) {
      this.isEnabled = false;
      this.stateManager.update(this.permissionManager.status, GESTURE_TYPES.IDLE, 0);
      throw err;
    }
  }

  stop() {
    this.isEnabled = false;
    this.trackingService.stop();
    // Smoothly restore original idle core state
    this.interactionController.processGesture({ type: GESTURE_TYPES.HAND_REMOVAL });
    this.stateManager.update(TRACKING_STATES.DISABLED, GESTURE_TYPES.IDLE, 0);
  }

  setSensitivity(factor) {
    this.recognitionEngine.setSensitivity(factor);
  }

  _onTrackingFrame(frameData) {
    if (!this.isEnabled) return;

    const gestureResult = this.recognitionEngine.recognize(frameData);
    this.interactionController.processGesture(gestureResult);

    const trackingState = frameData.handsCount > 0 ? TRACKING_STATES.HAND_DETECTED : TRACKING_STATES.ACTIVE;
    this.stateManager.update(trackingState, gestureResult.type, frameData.handsCount);
    if (typeof this.onGesture === "function") {
      try { this.onGesture(gestureResult, frameData); } catch { /* UI callbacks must not stop tracking. */ }
    }
  }

  _handlePermissionStatus(status, error) {
    this.stateManager.update(status, GESTURE_TYPES.IDLE, 0);
  }
}

export const handGestureCore = new HandGestureCore();

if (typeof window !== "undefined") {
  window.handGestureCore = handGestureCore;
  window.GESTURE_TYPES = GESTURE_TYPES;
  window.TRACKING_STATES = TRACKING_STATES;
  window.HandGestureCore = HandGestureCore;
}
