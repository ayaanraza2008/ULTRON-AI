/**
 * ULTRON AI — High-Performance 3D Particle Swarm Simulation Engine
 * Module: public/particle-swarm-engine.js
 *
 * Implements a massive 20,000+ particle purple and crimson singularity core.
 * Adheres strictly to:
 * - Zero Garbage Collection (no new Vector3/Color inside loop)
 * - Math Over Logic (continuous harmonic toroidal shaping)
 * - Real-time parameter controls (expansion, chaos, twist)
 * - Finite numerical stability guards
 */

/**
 * The core particle update function body.
 * Evaluates per-particle state for massive 3D swarms (20,000+ units).
 *
 * @param {number} i - Particle index (0 to count-1)
 * @param {number} count - Total particle count (e.g. 20000)
 * @param {THREE.Vector3} target - Write-only target vector
 * @param {THREE.Color} color - Write-only color object
 * @param {number} time - Global simulation time in seconds
 * @param {object} THREE - Three.js library reference
 * @param {Function} addControl - UI slider helper
 * @param {Function} setInfo - HUD title/description updater (i === 0)
 * @param {Function} annotate - 3D label annotator (i === 0)
 */
export function updateParticleSwarm(i, count, target, color, time, THREE, addControl, setInfo, annotate) {
  const expansion = addControl("expansion", "Core Expansion", 1.0, 3.5, 2.2);
  const chaos = addControl("chaos", "Quantum Chaos", 0.0, 2.0, 0.45);
  const twistSpeed = addControl("twist", "Vortex Twist", 0.1, 3.0, 0.85);

  const u = i / count;
  const phi = i * 2.399963229728653;
  const theta = phi + time * twistSpeed * 0.2;

  const waveA = Math.sin(time * 1.5 + phi * 3.0 + u * 12.0);
  const waveB = Math.cos(time * 0.9 - phi * 2.0);
  const waveC = Math.sin(theta * 4.0 + time * 2.2);

  const majorR = expansion * (1.1 + 0.18 * Math.sin(time * 1.4) + 0.08 * waveA);
  const minorR = (0.55 + 0.15 * waveB + chaos * 0.2 * waveC);
  const omega = u * 25.132741228718345 + time * 1.1;

  const cosOmega = Math.cos(omega);
  const sinOmega = Math.sin(omega);
  const ringDistance = majorR + minorR * cosOmega;

  const x = ringDistance * Math.cos(theta);
  const y = minorR * sinOmega * 1.4 + 0.22 * Math.sin(phi * 2.0 + time * 1.8);
  const z = ringDistance * Math.sin(theta);

  const coreRatio = Math.sin(u * Math.PI);
  const pull = 1.0 - 0.28 * coreRatio;

  target.set(x * pull, y * pull, z * pull);

  const colorFlow = 0.5 + 0.5 * Math.sin(phi * 0.12 + time * 0.75 + u * 8.0);
  const hue = 0.76 + colorFlow * 0.22;
  const saturation = 0.95;
  const lightness = 0.42 + 0.28 * (0.5 + 0.5 * Math.sin(i * 0.04 + time * 3.0));

  color.setHSL(hue, saturation, lightness);

  if (i === 0) {
    setInfo("ULTRON Core Singularity", "20,000 Particle Purple & Crimson Swarm");
    annotate("singularity", target, "ENERGY CORE");
  }
}

/**
 * Raw standalone code string of the particle function body for direct evaluation
 */
export const PARTICLE_FUNCTION_BODY = `
const expansion = addControl("expansion", "Core Expansion", 1.0, 3.5, 2.2);
const chaos = addControl("chaos", "Quantum Chaos", 0.0, 2.0, 0.45);
const twistSpeed = addControl("twist", "Vortex Twist", 0.1, 3.0, 0.85);

const u = i / count;
const phi = i * 2.399963229728653;
const theta = phi + time * twistSpeed * 0.2;

const waveA = Math.sin(time * 1.5 + phi * 3.0 + u * 12.0);
const waveB = Math.cos(time * 0.9 - phi * 2.0);
const waveC = Math.sin(theta * 4.0 + time * 2.2);

const majorR = expansion * (1.1 + 0.18 * Math.sin(time * 1.4) + 0.08 * waveA);
const minorR = (0.55 + 0.15 * waveB + chaos * 0.2 * waveC);
const omega = u * 25.132741228718345 + time * 1.1;

const cosOmega = Math.cos(omega);
const sinOmega = Math.sin(omega);
const ringDistance = majorR + minorR * cosOmega;

const x = ringDistance * Math.cos(theta);
const y = minorR * sinOmega * 1.4 + 0.22 * Math.sin(phi * 2.0 + time * 1.8);
const z = ringDistance * Math.sin(theta);

const coreRatio = Math.sin(u * Math.PI);
const pull = 1.0 - 0.28 * coreRatio;

target.set(x * pull, y * pull, z * pull);

const colorFlow = 0.5 + 0.5 * Math.sin(phi * 0.12 + time * 0.75 + u * 8.0);
const hue = 0.76 + colorFlow * 0.22;
const saturation = 0.95;
const lightness = 0.42 + 0.28 * (0.5 + 0.5 * Math.sin(i * 0.04 + time * 3.0));

color.setHSL(hue, saturation, lightness);

if (i === 0) {
  setInfo("ULTRON Core Singularity", "20,000 Particle Purple & Crimson Swarm");
  annotate("singularity", target, "ENERGY CORE");
}
`.trim();
