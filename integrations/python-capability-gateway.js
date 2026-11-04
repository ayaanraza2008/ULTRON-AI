/**
 * ULTRON AI — Python Capability Runtime Gateway
 *
 * Provides authenticated, isolated, fault-tolerant RPC communication between
 * the Node.js assistant runtime and the Python Capability Runtime.
 * Strictly adheres to 4-tier permission enforcement, CPU-first operation,
 * bounded timeouts, and zero mandatory daemon requirements.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const GATEWAY_ERROR_CODES = {
  RUNTIME_NOT_FOUND: "PYTHON_RUNTIME_NOT_FOUND",
  TIMEOUT: "PYTHON_RPC_TIMEOUT",
  INVALID_PAYLOAD: "INVALID_RPC_PAYLOAD",
  EXECUTION_FAILED: "PYTHON_EXECUTION_FAILED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  PARSING_ERROR: "RPC_PARSING_ERROR"
};

export class PythonCapabilityGateway {
  constructor(options = {}) {
    this.pythonPath = options.pythonPath || process.env.PYTHON_BIN || "python";
    this.runtimeScript = options.runtimeScript || path.resolve(__dirname, "../system/python-capability-runtime/runtime_entry.py");
    this.defaultTimeoutMs = options.defaultTimeoutMs || 15000;
    this.maxBufferBytes = options.maxBufferBytes || 2 * 1024 * 1024; // 2MB
  }

  /**
   * Probes runtime health and availability.
   */
  async getHealth() {
    try {
      const res = await this.invokeRpc("health", "get_status", {}, { timeoutMs: 5000, isHealthProbe: true });
      return {
        available: true,
        runtime: "Python-Capability-Gateway",
        details: res
      };
    } catch (err) {
      return {
        available: false,
        runtime: "Python-Capability-Gateway",
        error: err.message
      };
    }
  }

  /**
   * Core RPC dispatcher with timeout, memory buffer bounds, and error encapsulation.
   */
  async invokeRpc(capability, method, payload = {}, options = {}) {
    const timeoutMs = options.timeoutMs || this.defaultTimeoutMs;
    const isHealth = Boolean(options.isHealthProbe);

    return new Promise((resolve, reject) => {
      if (!fs.existsSync(this.runtimeScript)) {
        return reject(new Error(`${GATEWAY_ERROR_CODES.RUNTIME_NOT_FOUND}: Cannot locate '${this.runtimeScript}'`));
      }

      const runtimeDir = path.dirname(this.runtimeScript);
      const scriptFile = path.basename(this.runtimeScript);

      const args = isHealth
        ? [scriptFile, "--health"]
        : [scriptFile, "--capability", capability, "--method", method, "--stdin"];

      const proc = spawn(this.pythonPath, args, {
        cwd: runtimeDir,
        windowsHide: true,
        shell: process.platform === "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1",
          PYTHONIOENCODING: "utf-8"
        }
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
        reject(new Error(`${GATEWAY_ERROR_CODES.TIMEOUT}: Call to '${capability}.${method}' exceeded ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on("data", (chunk) => {
        if (stdout.length + chunk.length > this.maxBufferBytes) {
          proc.kill("SIGKILL");
          clearTimeout(timer);
          return reject(new Error("RPC_BUFFER_OVERFLOW: Output exceeded 2MB limit"));
        }
        stdout += chunk.toString("utf8");
      });

      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`${GATEWAY_ERROR_CODES.EXECUTION_FAILED}: Process spawn failed: ${err.message}`));
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        if (code !== 0) {
          let errMsg = stderr.trim() || `Process exited with code ${code}`;
          try {
            const errObj = JSON.parse(stdout.trim());
            if (errObj && errObj.error) {
              errMsg = `${errObj.error.code}: ${errObj.error.message}`;
            }
          } catch (_) {
            // keep raw errMsg
          }
          return reject(new Error(`${GATEWAY_ERROR_CODES.EXECUTION_FAILED}: ${errMsg}`));
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && parsed.success === false) {
            const code = parsed.error?.code || GATEWAY_ERROR_CODES.EXECUTION_FAILED;
            const msg = parsed.error?.message || "Unknown RPC error";
            return reject(new Error(`${code}: ${msg}`));
          }
          resolve(parsed.data !== undefined ? parsed.data : parsed);
        } catch (parseErr) {
          reject(new Error(`${GATEWAY_ERROR_CODES.PARSING_ERROR}: ${parseErr.message} (output: ${stdout.slice(0, 200)})`));
        }
      });

      if (!isHealth) {
        try {
          proc.stdin.write(JSON.stringify(payload), "utf8");
          proc.stdin.end();
        } catch (writeErr) {
          clearTimeout(timer);
          reject(new Error(`${GATEWAY_ERROR_CODES.INVALID_PAYLOAD}: ${writeErr.message}`));
        }
      }
    });
  }

  // --- CEREBRO KNOWLEDGE GRAPH ---
  async cerebroUpsertNode(nodeId, label, content, nodeType = "entity", metadata = {}, userId = "default_user") {
    return await this.invokeRpc("cerebro", "upsert_node", {
      node_id: nodeId,
      label,
      content,
      node_type: nodeType,
      metadata,
      user_id: userId
    });
  }

  async cerebroLinkEntities(sourceId, targetId, relation = "relates_to", weight = 1.0, bidirectional = true, userId = "default_user") {
    return await this.invokeRpc("cerebro", "link_entities", {
      source_id: sourceId,
      target_id: targetId,
      relation,
      weight,
      bidirectional,
      user_id: userId
    });
  }

  async cerebroSemanticQuery(query, topK = 5, userId = "default_user") {
    return await this.invokeRpc("cerebro", "semantic_query", {
      query,
      top_k: topK,
      user_id: userId
    });
  }

  async cerebroMultiHopRecall(startId, targetId = null, maxHops = 3, userId = "default_user") {
    return await this.invokeRpc("cerebro", "multi_hop_recall", {
      start_id: startId,
      target_id: targetId,
      max_hops: maxHops,
      user_id: userId
    });
  }

  async cerebroGetMetrics(userId = "default_user") {
    return await this.invokeRpc("cerebro", "get_metrics", { user_id: userId });
  }

  // --- DESKTOP OS CONTROL ---
  async desktopGetVolume() {
    return await this.invokeRpc("desktop", "get_volume");
  }

  async desktopSetVolume(level) {
    return await this.invokeRpc("desktop", "set_volume", { level });
  }

  async desktopMuteVolume(mute = true) {
    return await this.invokeRpc("desktop", "mute_volume", { mute });
  }

  async desktopGetBrightness() {
    return await this.invokeRpc("desktop", "get_brightness");
  }

  async desktopSetBrightness(level) {
    return await this.invokeRpc("desktop", "set_brightness", { level });
  }

  async desktopGetClipboard() {
    return await this.invokeRpc("desktop", "get_clipboard");
  }

  async desktopSetClipboard(text) {
    return await this.invokeRpc("desktop", "set_clipboard", { text });
  }

  async desktopClearClipboard() {
    return await this.invokeRpc("desktop", "clear_clipboard");
  }

  async desktopListProcesses(topN = 10, sortBy = "memory") {
    return await this.invokeRpc("desktop", "list_processes", { top_n: topN, sort_by: sortBy });
  }

  async desktopKillProcess(pid = null, name = null) {
    return await this.invokeRpc("desktop", "kill_process", { pid, name });
  }

  async desktopFocusWindow(windowTitle) {
    return await this.invokeRpc("desktop", "focus_window", { window_title: windowTitle });
  }

  async desktopScanPurgeTargets() {
    return await this.invokeRpc("desktop", "scan_purge_targets");
  }

  async desktopExecutePurge(dryRun = false) {
    return await this.invokeRpc("desktop", "execute_purge", { dry_run: dryRun });
  }

  async desktopLockWorkstation() {
    return await this.invokeRpc("desktop", "lock_workstation");
  }

  async desktopGetTelemetry() {
    return await this.invokeRpc("desktop", "get_system_telemetry");
  }

  // --- AIRSPACE RECON ---
  async airspaceScanBluetooth(timeoutSec = 5) {
    return await this.invokeRpc("airspace", "scan_bluetooth", { timeout_sec: timeoutSec });
  }

  async airspaceScanWifi() {
    return await this.invokeRpc("airspace", "scan_wifi_airspace");
  }

  // --- NETWORK SENTINEL ---
  async networkScanLocalSubnet() {
    return await this.invokeRpc("network", "scan_local_subnet");
  }

  async networkAuditDnsResolvers(testDomain = "google.com") {
    return await this.invokeRpc("network", "audit_dns_resolvers", { test_domain: testDomain });
  }

  // --- VOICE DSP & SFX ---
  async voiceSynthSfx(sfxType = "repulsor", durationSec = 0.5) {
    return await this.invokeRpc("voice_dsp", "synth_sfx", { sfx_type: sfxType, duration_sec: durationSec });
  }

  async voiceApplyWarp(pitchSemitones = -3.5, formantShift = 0.85) {
    return await this.invokeRpc("voice_dsp", "apply_warp", { pitch_semitones: pitchSemitones, formant_shift: formantShift });
  }

  // --- BIOMETRICS & VISION ---
  async biometricsEnroll(label = "Boss", faceData = null) {
    return await this.invokeRpc("biometrics", "enroll_boss_face", { label, face_data: faceData });
  }

  async biometricsAuthenticate(inputImage = null) {
    return await this.invokeRpc("biometrics", "authenticate_face", { input_image: inputImage });
  }

  async biometricsGetStatus() {
    return await this.invokeRpc("biometrics", "get_status");
  }

  // --- SPATIAL GESTURES ---
  async gesturesList() {
    return await this.invokeRpc("gestures", "list_supported_gestures");
  }

  async gesturesProcessFrame(frameMetadata = {}) {
    return await this.invokeRpc("gestures", "process_gesture_frame", { frame_metadata: frameMetadata });
  }

  // --- IOT SMART HOME ---
  async iotListDevices() {
    return await this.invokeRpc("iot", "list_devices");
  }

  async iotSetDeviceState(deviceKey, state = "ON", brightness = null, color = null) {
    return await this.invokeRpc("iot", "set_device_state", { device_key: deviceKey, state, brightness, color });
  }

  async iotTriggerScene(sceneName = "FOCUS") {
    return await this.invokeRpc("iot", "trigger_scene", { scene_name: sceneName });
  }

  // --- SELF EVOLUTION SANDBOX ---
  async evolutionAnalyzeAST(sourceCode) {
    return await this.invokeRpc("self_evolution", "analyze_source_ast", { source_code: sourceCode });
  }

  async evolutionSynthesizeTool(toolId, name, description, pythonCode, author = "ChiefOfStaff") {
    return await this.invokeRpc("self_evolution", "synthesize_tool", {
      tool_id: toolId,
      name,
      description,
      python_code: pythonCode,
      author
    });
  }

  async evolutionRollbackTool(toolId) {
    return await this.invokeRpc("self_evolution", "rollback_tool", { tool_id: toolId });
  }

  async evolutionListTools() {
    return await this.invokeRpc("self_evolution", "list_tools");
  }
}

export const pythonCapabilityGateway = new PythonCapabilityGateway();
