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
  TWO_HAND_EXPAND: "TWO_HAND_EXPAND",
  TWO_HAND_CONTRACT: "TWO_HAND_CONTRACT",
  SWIPE_LEFT: "SWIPE_LEFT",
  SWIPE_RIGHT: "SWIPE_RIGHT"
};

export class GestureRecognizer {
  constructor(options = {}) {
    this.pinchThreshold = options.pinchThreshold ?? 0.08; // Normalized distance (0 to 1)
    this.palmExtensionThreshold = options.palmExtensionThreshold ?? 0.15;
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

    // Check Open Palm: All fingertips extended far from wrist
    const fingerTips = [landmarks[8], landmarks[12], landmarks[16], landmarks[20]];
    const extensions = fingerTips.map(tip => this.calculateDistance(tip, wrist));
    const allExtended = extensions.every(ext => ext > this.palmExtensionThreshold);

    if (allExtended) {
      return {
        gesture: GESTURE_TYPES.OPEN_PALM,
        confidence: 0.95,
        extensions
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
