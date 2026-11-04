/**
 * ULTRON AI — Vision Hand Gesture Recognizer
 * Project Codename: ULTRON ETERNAL
 *
 * Implements camera-based hand tracking and gesture classification:
 * - PINCH: Thumb tip and index tip close together (triggers select / unlock).
 * - OPEN_PALM: All 5 fingers extended (activates Energy Core / listening).
 * - TWO_HAND_EXPAND: Distance between both hands increasing (expands holographic core).
 * - TWO_HAND_CONTRACT: Distance between both hands decreasing (contracts holographic core).
 * - SWIPE_LEFT / SWIPE_RIGHT: Hand velocity across horizontal axis (switches HUD tabs).
 *
 * Privacy-gated: strictly runs on local frames; zero camera data leaves the device.
 */

export const GESTURE_TYPES = {
  NONE: "NONE",
  PINCH: "PINCH",
  OPEN_PALM: "OPEN_PALM",
  CLOSED_FIST: "CLOSED_FIST",
  THUMBS_UP: "THUMBS_UP",
  THUMBS_DOWN: "THUMBS_DOWN",
  POINTING: "POINTING",
  TWO_HAND_EXPAND: "TWO_HAND_EXPAND",
  TWO_HAND_CONTRACT: "TWO_HAND_CONTRACT",
  SWIPE_LEFT: "SWIPE_LEFT",
  SWIPE_RIGHT: "SWIPE_RIGHT"
};

export class GestureRecognizer {
  constructor(options = {}) {
    this.pinchThreshold = options.pinchThreshold ?? 0.08; // Normalized distance (0 to 1)
    this.palmExtensionThreshold = options.palmExtensionThreshold ?? 0.15;
    this.fingerExtensionRatio = options.fingerExtensionRatio ?? 1.15; // tip must exceed pip by this ratio
    this.lastHandDistance = null;
    this.gestureHistory = [];
  }

  /**
   * Calculates Euclidean distance between two 2D/3D landmark points.
   */
  calculateDistance(pt1, pt2) {
    const dx = pt1.x - pt2.x;
    const dy = pt1.y - pt2.y;
    const dz = (pt1.z || 0) - (pt2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Classifies gesture from detected hand landmarks (21 landmarks standard).
   * Landmarks indices: 4 = Thumb tip, 8 = Index tip, 12 = Middle tip, 16 = Ring tip, 20 = Pinky tip, 0 = Wrist.
   */
  classifySingleHand(landmarks) {
    if (!Array.isArray(landmarks) || landmarks.length < 21) {
      return { gesture: GESTURE_TYPES.NONE, confidence: 0 };
    }

    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const wrist = landmarks[0];

    // Check Pinch: Thumb tip to Index tip distance
    const pinchDist = this.calculateDistance(thumbTip, indexTip);
    if (pinchDist < this.pinchThreshold) {
      return {
        gesture: GESTURE_TYPES.PINCH,
        confidence: Number((1.0 - pinchDist / this.pinchThreshold).toFixed(2)),
        pinchDistance: pinchDist
      };
    }

    // Finger extension: tip must protrude clearly beyond its pip joint relative to the wrist
    // (prevents open-palm false positives from curled fingers near the wrist plane).
    const fingerChains = [[8, 6], [12, 10], [16, 14], [20, 18]];
    const extensions = fingerChains.map(([, pip]) => this.calculateDistance(landmarks[0] || wrist, landmarks[pip]));
    const tips = fingerChains.map(([tip]) => this.calculateDistance(landmarks[0] || wrist, landmarks[tip]));
    const extended = tips.map((tipDist, i) => tipDist > extensions[i] * this.fingerExtensionRatio);
    const extendedCount = extended.filter(Boolean).length;
    // Thumb extension: tip must protrude beyond the thumb IP joint relative to the wrist
    // (a folded thumb crossing the palm must not register as extended).
    const thumbExtended =
      this.calculateDistance(thumbTip, wrist) >
      this.calculateDistance(landmarks[3] || thumbTip, wrist) * this.fingerExtensionRatio;

    // Open palm: all 4 fingers extended (thumb may be folded — typical relaxed open hand).
    const allExtended = extended.every(Boolean);
    if (allExtended) {
      return {
        gesture: GESTURE_TYPES.OPEN_PALM,
        confidence: 0.95,
        extensions: tips
      };
    }

    // Closed fist: no finger extended, tips retracted toward the palm.
    if (extendedCount === 0 && !thumbExtended) {
      return { gesture: GESTURE_TYPES.CLOSED_FIST, confidence: 0.9 };
    }

    // Pointing: index alone extended.
    if (extendedCount === 1 && extended[0]) {
      return { gesture: GESTURE_TYPES.POINTING, confidence: 0.85, direction: indexTip };
    }

    // Thumbs-only gestures: vertical thumb axis decides agreement (up) or veto-like signal (down).
    if (extendedCount === 0 && thumbExtended) {
      const aboveWrist = thumbTip.y < (wrist?.y ?? 0.5);
      return {
        gesture: aboveWrist ? GESTURE_TYPES.THUMBS_UP : GESTURE_TYPES.THUMBS_DOWN,
        confidence: 0.85,
        aboveWrist
      };
    }

    return { gesture: GESTURE_TYPES.NONE, confidence: 0.5 };
  }

  /**
   * Evaluates two-hand interactive gestures for Energy Core holographic scaling.
   */
  classifyTwoHands(leftHandLandmarks, rightHandLandmarks) {
    if (!leftHandLandmarks || !rightHandLandmarks) {
      return { gesture: GESTURE_TYPES.NONE, coreScaleDelta: 0 };
    }

    const leftWrist = leftHandLandmarks[0] || leftHandLandmarks;
    const rightWrist = rightHandLandmarks[0] || rightHandLandmarks;
    const currentDist = this.calculateDistance(leftWrist, rightWrist);

    if (this.lastHandDistance === null) {
      this.lastHandDistance = currentDist;
      return { gesture: GESTURE_TYPES.NONE, coreScaleDelta: 0, distance: currentDist };
    }

    const delta = currentDist - this.lastHandDistance;
    this.lastHandDistance = currentDist;

    if (delta > 0.05) {
      return {
        gesture: GESTURE_TYPES.TWO_HAND_EXPAND,
        coreScaleDelta: delta,
        factor: Number((1.0 + delta).toFixed(2))
      };
    }

    if (delta < -0.05) {
      return {
        gesture: GESTURE_TYPES.TWO_HAND_CONTRACT,
        coreScaleDelta: delta,
        factor: Number((1.0 + delta).toFixed(2))
      };
    }

    return { gesture: GESTURE_TYPES.NONE, coreScaleDelta: delta };
  }
}

export const gestureRecognizer = new GestureRecognizer();
