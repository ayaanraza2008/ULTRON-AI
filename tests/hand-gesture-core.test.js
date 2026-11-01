import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  GESTURE_TYPES,
  TRACKING_STATES,
  HAND_LANDMARKS,
  CameraPermissionManager,
  HandTrackingService,
  HandLandmarkProcessor,
  GestureRecognitionEngine,
  HandMotionController,
  ParticlePhysicsController,
  CoreInteractionController,
  InteractionStateManager,
  HandGestureCore
} from "../public/hand-gesture-core.js";

describe("ULTRON AI — Real-Time Hand Gesture Control for Living Energy Core", () => {
  // --------------------------------------------------------------------------
  // 1. CameraPermissionManager
  // --------------------------------------------------------------------------
  describe("CameraPermissionManager", () => {
    test("Initializes in DISABLED state and handles graceful fallback", () => {
      const manager = new CameraPermissionManager();
      assert.equal(manager.status, TRACKING_STATES.DISABLED);
      assert.equal(manager.isActive(), false);
    });

    test("Emits state changes via onStatusChange callback", () => {
      const states = [];
      const manager = new CameraPermissionManager({
        onStatusChange: (status) => states.push(status)
      });

      manager.setStatus(TRACKING_STATES.INITIALIZING);
      manager.setStatus(TRACKING_STATES.ACTIVE);
      manager.setStatus(TRACKING_STATES.DISABLED);

      assert.deepEqual(states, [
        TRACKING_STATES.INITIALIZING,
        TRACKING_STATES.ACTIVE,
        TRACKING_STATES.DISABLED
      ]);
    });

    test("Stops camera tracks cleanly", () => {
      let stopped = false;
      const mockTrack = { stop: () => { stopped = true; } };
      const manager = new CameraPermissionManager();
      manager.stream = { getTracks: () => [mockTrack] };

      manager.stopCamera();
      assert.equal(stopped, true);
      assert.equal(manager.stream, null);
      assert.equal(manager.status, TRACKING_STATES.DISABLED);
    });
  });

  // --------------------------------------------------------------------------
  // 2. HandLandmarkProcessor
  // --------------------------------------------------------------------------
  describe("HandLandmarkProcessor (21 3D Landmarks & Geometry)", () => {
    const processor = new HandLandmarkProcessor({ smoothingAlpha: 0.6 });

    test("Generates mathematically valid canonical 21-landmark hand", () => {
      const canonical = processor.generateCanonicalHand(0.5, 0.5, 0.1);
      assert.equal(canonical.length, 21);
      assert.equal(canonical[HAND_LANDMARKS.WRIST].x, 0.5);
      assert.equal(canonical[HAND_LANDMARKS.WRIST].y, 0.6);
    });

    test("Temporal filter (EMA) removes high-frequency jitter", () => {
      processor.reset();
      const rawHand1 = {
        id: 0,
        handedness: "Right",
        landmarks: processor.generateCanonicalHand(0.5, 0.5, 0.1)
      };
      // Frame 1
      const res1 = processor.process([rawHand1]);
      const wristX1 = res1.hands[0].landmarks[HAND_LANDMARKS.WRIST].x;
      assert.equal(wristX1, 0.5);

      // Frame 2 with simulated jitter (+0.1)
      const rawHand2 = {
        id: 0,
        handedness: "Right",
        landmarks: processor.generateCanonicalHand(0.6, 0.5, 0.1)
      };
      const res2 = processor.process([rawHand2]);
      const wristX2 = res2.hands[0].landmarks[HAND_LANDMARKS.WRIST].x;

      // Smoothed value: 0.6 * 0.6 + 0.4 * 0.5 = 0.56
      assert.ok(Math.abs(wristX2 - 0.56) < 0.001);
    });

    test("Calculates palm centroid, size, and pointing vector correctly", () => {
      const lms = processor.generateCanonicalHand(0.4, 0.4, 0.15);
      const analysis = processor.analyzeHand(lms);

      assert.ok(analysis.centroid.x > 0.35 && analysis.centroid.x < 0.45);
      assert.ok(analysis.centroid.y > 0.35 && analysis.centroid.y < 0.55);
      assert.ok(analysis.palmSize > 0.05);
      assert.ok(typeof analysis.pointingVector.x === "number");
      assert.ok(typeof analysis.pointingVector.y === "number");
    });

    test("Calculates two-hand distance, midpoint, and relative angle", () => {
      const hand1 = { centroid: { x: 0.3, y: 0.5, z: 0 } };
      const hand2 = { centroid: { x: 0.7, y: 0.5, z: 0 } };

      const twoHand = processor.analyzeTwoHands(hand1, hand2);
      assert.ok(Math.abs(twoHand.distance - 0.4) < 0.001);
      assert.equal(twoHand.midpoint.x, 0.5);
      assert.equal(twoHand.midpoint.y, 0.5);
      assert.equal(twoHand.angle, 0); // Horizontal line
    });
  });

  // --------------------------------------------------------------------------
  // 3. GestureRecognitionEngine
  // --------------------------------------------------------------------------
  describe("GestureRecognitionEngine (8 Gesture Types)", () => {
    const engine = new GestureRecognitionEngine();

    test("Recognizes OPEN_PALM gesture and computes expansion factor", () => {
      const frameData = {
        handsCount: 1,
        hands: [{
          extendedCount: 5,
          spreadRatio: 3.5,
          fistTightness: 0.1,
          centroid: { x: 0.5, y: 0.5 },
          extendedFingers: { thumb: true, index: true, middle: true, ring: true, pinky: true }
        }]
      };

      const result = engine.recognize(frameData);
      assert.equal(result.type, GESTURE_TYPES.OPEN_PALM);
      assert.ok(result.params.expansion > 1.2);
    });

    test("Recognizes CLOSED_FIST gesture and computes contraction factor", () => {
      const frameData = {
        handsCount: 1,
        hands: [{
          extendedCount: 0,
          spreadRatio: 0.5,
          fistTightness: 0.85,
          centroid: { x: 0.5, y: 0.5 },
          extendedFingers: { thumb: false, index: false, middle: false, ring: false, pinky: false }
        }]
      };

      const result = engine.recognize(frameData);
      assert.equal(result.type, GESTURE_TYPES.CLOSED_FIST);
      assert.ok(result.params.contraction < 0.8);
    });

    test("Recognizes INDEX_POINTING gesture and computes directional energy vector", () => {
      const frameData = {
        handsCount: 1,
        hands: [{
          extendedCount: 1,
          fistTightness: 0.2,
          centroid: { x: 0.5, y: 0.5 },
          pointingVector: { x: 0.707, y: -0.707 },
          extendedFingers: { thumb: false, index: true, middle: false, ring: false, pinky: false }
        }]
      };

      const result = engine.recognize(frameData);
      assert.equal(result.type, GESTURE_TYPES.INDEX_POINTING);
      assert.equal(result.params.vector.x, 0.707);
      assert.equal(result.params.vector.y, -0.707);
    });

    test("Recognizes CIRCULAR_MOTION swirling energy field", () => {
      const eng = new GestureRecognitionEngine();
      // Simulate circular path
      const steps = 16;
      let lastResult = null;
      for (let i = 0; i < steps; i++) {
        const theta = (i / steps) * Math.PI * 2;
        const cx = 0.5 + Math.cos(theta) * 0.15;
        const cy = 0.5 + Math.sin(theta) * 0.15;
        lastResult = eng.recognize({
          handsCount: 1,
          hands: [{
            extendedCount: 2,
            fistTightness: 0.2,
            centroid: { x: cx, y: cy },
            extendedFingers: { thumb: false, index: true, middle: true, ring: false, pinky: false }
          }]
        });
      }

      assert.equal(lastResult.type, GESTURE_TYPES.CIRCULAR_MOTION);
      assert.ok(lastResult.params.angularSpeed > 0);
    });

    test("Recognizes TWO_HAND_EXPAND_COMPRESS interaction", () => {
      const eng = new GestureRecognitionEngine();
      // Distance increasing (hands moving apart)
      [0.2, 0.25, 0.32, 0.42, 0.55].forEach(dist => {
        eng.recognize({
          handsCount: 2,
          twoHandMetrics: { distance: dist, midpoint: { x: 0.5, y: 0.5 }, angle: 0 },
          hands: [{ centroid: { x: 0.5 - dist / 2, y: 0.5 } }, { centroid: { x: 0.5 + dist / 2, y: 0.5 } }]
        });
      });

      const res = eng.recognize({
        handsCount: 2,
        twoHandMetrics: { distance: 0.65, midpoint: { x: 0.5, y: 0.5 }, angle: 0 },
        hands: [{ centroid: { x: 0.175, y: 0.5 } }, { centroid: { x: 0.825, y: 0.5 } }]
      });

      assert.equal(res.type, GESTURE_TYPES.TWO_HAND_EXPAND_COMPRESS);
      assert.ok(res.params.scaleFactor > 1.2);
    });

    test("Recognizes HAND_REMOVAL when zero hands detected", () => {
      const result = engine.recognize({ handsCount: 0 });
      assert.equal(result.type, GESTURE_TYPES.HAND_REMOVAL);
    });
  });

  // --------------------------------------------------------------------------
  // 4. HandMotionController & Damping
  // --------------------------------------------------------------------------
  describe("HandMotionController", () => {
    test("Smoothly interpolates target scale, rotation, and offsets via LERP", () => {
      const controller = new HandMotionController({ lerpRate: 0.2 });

      // Signal Open Palm
      const s1 = controller.update({
        type: GESTURE_TYPES.OPEN_PALM,
        params: { expansion: 2.0 }
      });

      // Target is 2.0, first step from 1.0: 1.0 + (2.0 - 1.0) * 0.2 = 1.2
      assert.ok(Math.abs(s1.scale - 1.2) < 0.05);

      // Signal Hand Removal: applies exponential damping back to 1.0
      controller.update({ type: GESTURE_TYPES.HAND_REMOVAL });
      const s2 = controller.update({ type: GESTURE_TYPES.HAND_REMOVAL });
      assert.ok(s2.scale < s1.scale); // Decaying back to 1.0
    });
  });

  // --------------------------------------------------------------------------
  // 5. ParticlePhysicsController
  // --------------------------------------------------------------------------
  describe("ParticlePhysicsController (Continuous Physical Particle Dynamics)", () => {
    test("Applies radial dispersion during OPEN_PALM", () => {
      const physics = new ParticlePhysicsController();
      const particles = [
        { radius: 30, baseRadius: 30, angle: 0, speed: 0.02, size: 2, alpha: 0.8 }
      ];

      physics.applyPhysics(particles, { scale: 1.8, energyIntensity: 1.5, rotationSpeed: 1.0 }, GESTURE_TYPES.OPEN_PALM, 120, 120, null);

      assert.ok(particles[0].radius > 30, "Particles must expand outward radially during Open Palm");
    });

    test("Applies gravitational inward pull during CLOSED_FIST", () => {
      const physics = new ParticlePhysicsController();
      const particles = [
        { radius: 40, baseRadius: 40, angle: 0, speed: 0.02, size: 2, alpha: 0.8 }
      ];

      physics.applyPhysics(particles, { scale: 0.5, energyIntensity: 2.0, rotationSpeed: 2.0 }, GESTURE_TYPES.CLOSED_FIST, 120, 120, null);

      assert.ok(particles[0].radius < 40, "Particles must pull inward towards nucleus during Closed Fist");
    });

    test("Applies directional displacement along pointing vector during INDEX_POINTING", () => {
      const physics = new ParticlePhysicsController();
      const particles = [
        { radius: 30, baseRadius: 30, angle: 0, speed: 0.02, size: 2, alpha: 0.8, dispX: 0, dispY: 0 }
      ];

      physics.applyPhysics(
        particles,
        { scale: 1.0, directionVector: { x: 1.0, y: 0.0 }, energyIntensity: 1.0 },
        GESTURE_TYPES.INDEX_POINTING,
        120, 120, null
      );

      assert.ok(particles[0].dispX > 0, "Particles must stream along pointing direction vector");
    });

    test("Spring returns particles to base radius on HAND_REMOVAL", () => {
      const physics = new ParticlePhysicsController();
      const particles = [
        { radius: 55, baseRadius: 30, angle: 0, speed: 0.02, size: 2, alpha: 0.8, dispX: 10, dispY: 5 }
      ];

      physics.applyPhysics(particles, { scale: 1.0, energyIntensity: 1.0 }, GESTURE_TYPES.HAND_REMOVAL, 120, 120, null);

      assert.ok(particles[0].radius < 55, "Particles must spring-return back toward base radius");
      assert.ok(particles[0].dispX < 10, "Displacement must decay toward 0");
    });
  });

  // --------------------------------------------------------------------------
  // 6. InteractionStateManager & Master Facade
  // --------------------------------------------------------------------------
  describe("InteractionStateManager & HandGestureCore Facade", () => {
    test("State manager notifies subscribers upon state changes", () => {
      const stateManager = new InteractionStateManager();
      let lastPayload = null;
      stateManager.subscribe((payload) => {
        lastPayload = payload;
      });

      stateManager.update(TRACKING_STATES.HAND_DETECTED, GESTURE_TYPES.OPEN_PALM, 1);
      assert.equal(lastPayload.state, TRACKING_STATES.HAND_DETECTED);
      assert.equal(lastPayload.activeGesture, GESTURE_TYPES.OPEN_PALM);
      assert.equal(lastPayload.handsCount, 1);
    });

    test("HandGestureCore instantiates all 8 subsystem components", () => {
      const core = new HandGestureCore();
      assert.ok(core.permissionManager);
      assert.ok(core.processor);
      assert.ok(core.recognitionEngine);
      assert.ok(core.motionController);
      assert.ok(core.physicsController);
      assert.ok(core.interactionController);
      assert.ok(core.stateManager);
      assert.ok(core.trackingService);
      assert.equal(core.isEnabled, false);
    });
  });
});
