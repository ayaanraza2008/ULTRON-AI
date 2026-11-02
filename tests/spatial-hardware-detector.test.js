import test from "node:test";
import assert from "node:assert/strict";
import { detectHardwareCapabilities, checkModelWeights, EXECUTION_MODES } from "../spatial/hardware-detector.js";

test("hardware-detector reports CPU-safe metadata fallback when CUDA is absent", async () => {
  const mockProbe = async () => ({ hasCuda: false, gpuName: null, vramMb: 0 });
  const result = await detectHardwareCapabilities({}, { probeCuda: mockProbe });

  assert.ok(result.host.cpuCores >= 1);
  assert.ok(result.host.totalRamMb > 0);
  assert.equal(result.gpu.hasCuda, false);
  assert.equal(result.worker.executionMode, EXECUTION_MODES.CPU_METADATA_FALLBACK);
  assert.equal(result.capabilities.canReconstruct3D, true);
  assert.equal(result.capabilities.highFidelityMeshRetrieval, false);
});

test("hardware-detector switches to REMOTE_GPU when DIORAMA_REMOTE_ENDPOINT is provided", async () => {
  const env = {
    DIORAMA_REMOTE_ENDPOINT: "https://gpu-worker.example.internal:8443",
    DIORAMA_REMOTE_TOKEN: "test-token-12345"
  };
  const mockProbe = async () => ({ hasCuda: false, gpuName: null, vramMb: 0 });
  const result = await detectHardwareCapabilities(env, { probeCuda: mockProbe });

  assert.equal(result.worker.executionMode, EXECUTION_MODES.REMOTE_GPU);
  assert.equal(result.worker.remoteTokenConfigured, true);
  assert.equal(result.capabilities.highFidelityMeshRetrieval, true);
});

test("checkModelWeights flags missing files cleanly without crashing", () => {
  const result = checkModelWeights("/non/existent/path/weights");
  assert.equal(result.configured, false);
  assert.equal(result.allWeightsPresent, false);
  assert.ok(result.missingWeights.length >= 4);
});
