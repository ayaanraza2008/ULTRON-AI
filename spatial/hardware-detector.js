/**
 * ULTRON AI — Spatial Intelligence Hardware Detector
 * Module: spatial/hardware-detector.js
 *
 * Hardware-aware capability detection for Diorama 3D World Modeling.
 * Probes CPU, host RAM, GPU architecture, CUDA availability, isolated
 * Python environment, and optional remote GPU endpoints.
 *
 * Designed to safely run on resource-bounded systems (e.g. AMD Ryzen 7 5700U,
 * integrated Radeon GPU, 8 GB RAM) without assuming CUDA is present.
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const EXECUTION_MODES = Object.freeze({
  LOCAL_GPU: "LOCAL_GPU",
  REMOTE_GPU: "REMOTE_GPU",
  CPU_METADATA_FALLBACK: "CPU_METADATA_FALLBACK",
  UNAVAILABLE: "UNAVAILABLE"
});

export const REQUIRED_MODEL_WEIGHTS = Object.freeze([
  { id: "sam2", filename: "sam2.1_hiera_large.pt", description: "Segment Anything 2.1 (SAM2) large checkpoint", sizeApproxMb: 890 },
  { id: "dinov2", filename: "dinov2_vitl14_pretrain.pth", description: "DINOv2 ViT-L/14 feature extractor", sizeApproxMb: 1200 },
  { id: "metric3d", filename: "metric3d_vit_large", description: "Metric3D v2 metric depth estimation", sizeApproxMb: 1400 },
  { id: "duoduo_clip", filename: "Four_1to6F_bs1600_LT6.ckpt", description: "DuoduoCLIP 3D shape retrieval checkpoint", sizeApproxMb: 1600 }
]);

/**
 * Checks whether NVIDIA CUDA tools or drivers are executable on this machine.
 * Returns false quickly on systems without NVIDIA GPUs (e.g. AMD Ryzen + Radeon).
 */
async function probeNvidiaCuda(timeoutMs = 1200) {
  try {
    const isWindows = process.platform === "win32";
    const binary = isWindows ? "nvidia-smi.exe" : "nvidia-smi";
    const { stdout } = await execFileAsync(binary, ["--query-gpu=name,memory.total", "--format=csv,noheader"], {
      timeout: timeoutMs,
      windowsHide: true
    });
    const line = stdout.trim().split("\n")[0] || "";
    if (!line) return { hasCuda: false, gpuName: null, vramMb: 0 };
    const parts = line.split(",").map(s => s.trim());
    const gpuName = parts[0] || "NVIDIA GPU";
    const vramMb = parseInt(parts[1] || "0", 10) || 0;
    return { hasCuda: true, gpuName, vramMb };
  } catch {
    return { hasCuda: false, gpuName: null, vramMb: 0 };
  }
}

/**
 * Verifies which required Diorama model weights are present on disk.
 */
export function checkModelWeights(weightsDir) {
  if (!weightsDir || typeof weightsDir !== "string" || !fs.existsSync(weightsDir)) {
    return {
      configured: false,
      weightsDir: weightsDir || null,
      presentWeights: [],
      missingWeights: REQUIRED_MODEL_WEIGHTS.map(w => w.filename),
      allWeightsPresent: false
    };
  }

  const presentWeights = [];
  const missingWeights = [];

  for (const weight of REQUIRED_MODEL_WEIGHTS) {
    const targetPath = path.join(weightsDir, weight.filename);
    if (fs.existsSync(targetPath)) {
      presentWeights.push(weight.filename);
    } else {
      missingWeights.push(weight.filename);
    }
  }

  return {
    configured: true,
    weightsDir,
    presentWeights,
    missingWeights,
    allWeightsPresent: missingWeights.length === 0
  };
}

/**
 * Inspect host hardware capabilities and decide the safe execution mode.
 */
export async function detectHardwareCapabilities(env = process.env, options = {}) {
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model || "Unknown CPU";
  const cpuCores = cpus.length;
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  const totalRamMb = Math.round(totalRamBytes / (1024 * 1024));
  const freeRamMb = Math.round(freeRamBytes / (1024 * 1024));

  // AMD Radeon / Integrated GPU detection hint from CPU model
  const isAmdApu = /Ryzen.*Radeon/i.test(cpuModel) || /AMD.*with Radeon/i.test(cpuModel) || /5700U/i.test(cpuModel);

  // Probe CUDA
  const probeFn = options.probeCuda || probeNvidiaCuda;
  const cudaProbe = await probeFn(options.cudaProbeTimeoutMs || 800);

  // Weights check
  const weightsDir = env.DIORAMA_WEIGHTS_DIR || path.resolve(process.cwd(), "weights", "diorama");
  const weightsStatus = checkModelWeights(weightsDir);

  // Remote GPU Endpoint check
  const remoteEndpoint = typeof env.DIORAMA_REMOTE_ENDPOINT === "string" ? env.DIORAMA_REMOTE_ENDPOINT.trim() : null;
  const hasRemoteEndpoint = Boolean(remoteEndpoint && /^https?:\/\//i.test(remoteEndpoint));
  const remoteTokenConfigured = Boolean(typeof env.DIORAMA_REMOTE_TOKEN === "string" && env.DIORAMA_REMOTE_TOKEN.trim());

  // Python isolated binary check
  const pythonBin = typeof env.DIORAMA_PYTHON_BIN === "string" ? env.DIORAMA_PYTHON_BIN.trim() : null;
  const hasIsolatedPython = Boolean(pythonBin && fs.existsSync(pythonBin));

  // Determine Execution Mode
  let executionMode = EXECUTION_MODES.CPU_METADATA_FALLBACK;
  let statusMessage = "Running in CPU-safe mode. Lightweight 3D geometry & spatial relationships active.";

  if (hasRemoteEndpoint) {
    executionMode = EXECUTION_MODES.REMOTE_GPU;
    statusMessage = "Remote GPU Diorama worker endpoint configured for high-fidelity 3D scene reconstruction.";
  } else if (cudaProbe.hasCuda && weightsStatus.allWeightsPresent && hasIsolatedPython) {
    executionMode = EXECUTION_MODES.LOCAL_GPU;
    statusMessage = "Local CUDA GPU accelerated Diorama pipeline available.";
  } else if (isAmdApu && !cudaProbe.hasCuda) {
    executionMode = EXECUTION_MODES.CPU_METADATA_FALLBACK;
    statusMessage = "Host is AMD Ryzen APU with integrated graphics. Full CUDA pipeline offline; CPU geometric fallback active.";
  }

  return {
    host: {
      platform: process.platform,
      arch: process.arch,
      cpuModel,
      cpuCores,
      totalRamMb,
      freeRamMb,
      isAmdApu
    },
    gpu: {
      hasCuda: cudaProbe.hasCuda,
      gpuName: cudaProbe.gpuName || (isAmdApu ? "Integrated AMD Radeon Graphics" : "None / Unaccelerated"),
      vramMb: cudaProbe.vramMb,
      cudaAccelerated: cudaProbe.hasCuda
    },
    weights: weightsStatus,
    worker: {
      pythonBin,
      hasIsolatedPython,
      remoteEndpoint: remoteEndpoint ? remoteEndpoint.replace(/\/\/.*@/, "//") : null,
      remoteTokenConfigured,
      executionMode,
      statusMessage
    },
    capabilities: {
      canReconstruct3D: true, // CPU fallback or GPU
      highFidelityMeshRetrieval: executionMode === EXECUTION_MODES.LOCAL_GPU || executionMode === EXECUTION_MODES.REMOTE_GPU,
      semanticLayoutOptimization: true,
      architecturalPlanes: true,
      spatialQuerying: true,
      exportFormats: ["obj", "gltf", "json"]
    }
  };
}
