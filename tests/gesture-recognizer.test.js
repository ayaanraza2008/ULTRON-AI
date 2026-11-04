import test from "node:test";
import assert from "node:assert/strict";
import {
  gestureRecognizer,
  GestureRecognizer,
  GESTURE_TYPES
} from "../vision/gesture-recognizer.js";

test("GestureRecognizer: Classifies pinch gesture when thumb and index tips are close", () => {
  const recognizer = new GestureRecognizer({ pinchThreshold: 0.08 });
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  // Set thumb tip (4) and index tip (8) close together
  landmarks[4] = { x: 0.50, y: 0.50, z: 0 };
  landmarks[8] = { x: 0.52, y: 0.51, z: 0 }; // distance ~ 0.022 < 0.08

  const result = recognizer.classifySingleHand(landmarks);
  assert.equal(result.gesture, GESTURE_TYPES.PINCH);
  assert.ok(result.confidence > 0.7);
});

test("GestureRecognizer: Classifies open palm when all fingertips are extended", () => {
  const recognizer = new GestureRecognizer({ palmExtensionThreshold: 0.15 });
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));

  // Wrist at center (0.5, 0.5)
  landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
  // Fingertips extended outwards (> 0.15 distance)
  landmarks[4] = { x: 0.7, y: 0.5, z: 0 }; // Thumb
  landmarks[8] = { x: 0.5, y: 0.2, z: 0 }; // Index (dist 0.3)
  landmarks[12] = { x: 0.5, y: 0.15, z: 0 }; // Middle (dist 0.35)
  landmarks[16] = { x: 0.5, y: 0.18, z: 0 }; // Ring (dist 0.32)
  landmarks[20] = { x: 0.5, y: 0.25, z: 0 }; // Pinky (dist 0.25)

  const result = recognizer.classifySingleHand(landmarks);
  assert.equal(result.gesture, GESTURE_TYPES.OPEN_PALM);
  assert.ok(result.confidence >= 0.9);
});

test("GestureRecognizer: Evaluates two-hand interactive gestures for Energy Core scaling", () => {
  const recognizer = new GestureRecognizer();

  const leftHand = [{ x: 0.4, y: 0.5, z: 0 }];
  const rightHand = [{ x: 0.6, y: 0.5, z: 0 }]; // initial distance 0.2

  // First sample sets baseline
  recognizer.classifyTwoHands(leftHand, rightHand);

  // Second sample: hands moved further apart (expansion)
  const leftExpanded = [{ x: 0.3, y: 0.5, z: 0 }];
  const rightExpanded = [{ x: 0.7, y: 0.5, z: 0 }]; // distance 0.4 (+0.2)

  const expandResult = recognizer.classifyTwoHands(leftExpanded, rightExpanded);
  assert.equal(expandResult.gesture, GESTURE_TYPES.TWO_HAND_EXPAND);
  assert.ok(expandResult.coreScaleDelta > 0.05);

  // Third sample: hands moved closer together (contraction)
  const leftContracted = [{ x: 0.45, y: 0.5, z: 0 }];
  const rightContracted = [{ x: 0.55, y: 0.5, z: 0 }]; // distance 0.1 (-0.3)

  const contractResult = recognizer.classifyTwoHands(leftContracted, rightContracted);
  assert.equal(contractResult.gesture, GESTURE_TYPES.TWO_HAND_CONTRACT);
  assert.ok(contractResult.coreScaleDelta < -0.05);
});

test("GestureRecognizer: extended gesture taxonomy (fist, thumbs, pointing)", () => {
  const recognizer = new GestureRecognizer();
  const palmBase = () => {
    const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    landmarks[0] = { x: 0.5, y: 0.5, z: 0 };
    // Folded default: each pip sits 0.05 from the wrist, tips no further.
    landmarks[6] = { x: 0.5, y: 0.45, z: 0 };
    landmarks[8] = { x: 0.5, y: 0.45, z: 0 };
    landmarks[10] = { x: 0.5, y: 0.47, z: 0 };
    landmarks[12] = { x: 0.5, y: 0.47, z: 0 };
    landmarks[14] = { x: 0.5, y: 0.48, z: 0 };
    landmarks[16] = { x: 0.5, y: 0.48, z: 0 };
    landmarks[18] = { x: 0.5, y: 0.49, z: 0 };
    landmarks[20] = { x: 0.5, y: 0.49, z: 0 };
    return landmarks;
  };

  // Closed fist: everything retracted; thumb folded across its own axis so
  // its tip cannot be farther from the wrist than its IP joint.
  const fist = palmBase();
  fist[3] = { x: 0.44, y: 0.51, z: 0 };
  fist[4] = { x: 0.44, y: 0.52, z: 0 };
  const fistResult = recognizer.classifySingleHand(fist);
  assert.equal(fistResult.gesture, GESTURE_TYPES.CLOSED_FIST);
  assert.ok(fistResult.confidence >= 0.85);

  // Thumbs up: fingers folded, thumb extended well above the wrist.
  const thumbsUp = palmBase();
  thumbsUp[2] = { x: 0.5, y: 0.45, z: 0 };
  thumbsUp[3] = { x: 0.5, y: 0.40, z: 0 };
  thumbsUp[4] = { x: 0.5, y: 0.25, z: 0 };
  const up = recognizer.classifySingleHand(thumbsUp);
  assert.equal(up.gesture, GESTURE_TYPES.THUMBS_UP);
  assert.equal(up.aboveWrist, true);

  // Thumbs down: thumb extended below the wrist.
  const thumbsDown = palmBase();
  thumbsDown[2] = { x: 0.5, y: 0.55, z: 0 };
  thumbsDown[3] = { x: 0.5, y: 0.60, z: 0 };
  thumbsDown[4] = { x: 0.5, y: 0.75, z: 0 };
  const down = recognizer.classifySingleHand(thumbsDown);
  assert.equal(down.gesture, GESTURE_TYPES.THUMBS_DOWN);
  assert.equal(down.aboveWrist, false);

  // Pointing: index alone extended toward the top of the frame.
  const pointing = fist.map(p => ({ ...p }));
  pointing[6] = { x: 0.5, y: 0.45, z: 0 };
  pointing[8] = { x: 0.5, y: 0.20, z: 0 };
  const point = recognizer.classifySingleHand(pointing);
  assert.equal(point.gesture, GESTURE_TYPES.POINTING);
  assert.ok(point.confidence >= 0.8);

  // Examined taxonomy stays UI-scoped: none of these classes map to destructive actions.
  const harmful = ["DELETE", "EXECUTE_COMMAND", "SEND_PAYMENT"];
  for (const cls of harmful) {
    assert.equal(Object.values(GESTURE_TYPES).includes(cls), false);
  }
});
