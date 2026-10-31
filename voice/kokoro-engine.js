/**
 * ULTRON AI — Kokoro TTS Engine Bridge
 *
 * Implements native CPU-based Kokoro-82M text-to-speech with the
 * auditioned 'am_onyx' voice profile: deep, dark, mysterious, authoritative,
 * and calm. Provides non-blocking execution, base64 audio streaming,
 * local speaker playback, immediate interruption, and caching.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.dirname(__dirname);
const KOKORO_SCRIPT = path.join(ROOT_DIR, "voice", "kokoro-service.py");
const AUDIO_CACHE_DIR = path.join(ROOT_DIR, "public", "voice");

function resolvePythonBinary() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "C:\\Users\\Ali Raza Zaidi\\AppData\\Local";
    return path.join(localAppData, "Microsoft", "WindowsApps", "python.exe");
  }
  return "python3";
}

export class KokoroEngine {
  constructor(options = {}) {
    this.defaultVoice = options.voice || "am_onyx";
    this.defaultSpeed = options.speed ?? 0.95;
    this.pythonPath = options.pythonPath || resolvePythonBinary();
    this.currentProcess = null;
    this.isSpeaking = false;
    this.audioHistory = [];
    this.initialized = false;
  }

  async initialize() {
    try {
      await fs.mkdir(AUDIO_CACHE_DIR, { recursive: true });
      this.initialized = true;
      return { success: true, voice: this.defaultVoice, speed: this.defaultSpeed };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Immediately aborts any ongoing speech synthesis or audio playback.
   */
  interrupt() {
    this.isSpeaking = false;
    if (this.currentProcess) {
      try {
        this.currentProcess.kill("SIGTERM");
      } catch {}
      this.currentProcess = null;
    }
    return { action: "AUDIO_INTERRUPTED", timestamp: new Date().toISOString() };
  }

  /**
   * Synthesize text to WAV audio with Kokoro am_onyx.
   * Returns base64 data URL, duration, and sample rate.
   */
  async synthesize(text, options = {}) {
    const rawText = String(text || "").trim();
    if (!rawText) {
      throw new Error("No text provided for Kokoro synthesis.");
    }

    // Sanitize text for clean consonant pronunciation
    const sanitized = rawText
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/[[\]()#*_~]/g, "")
      .replace(/"/g, "'")
      .replace(/\s+/g, " ")
      .trim();

    if (!sanitized) {
      throw new Error("Sanitized text is empty.");
    }

    const voice = options.voice || this.defaultVoice;
    const speed = typeof options.speed === "number" ? options.speed : this.defaultSpeed;
    const playLocally = Boolean(options.play);

    return new Promise((resolve, reject) => {
      const args = [
        KOKORO_SCRIPT,
        "--text", sanitized,
        "--voice", voice,
        "--speed", String(speed),
        "--json"
      ];
      if (playLocally) {
        args.push("--play");
      }

      const proc = spawn(this.pythonPath, args, {
        cwd: ROOT_DIR,
        stdio: ["ignore", "pipe", "pipe"]
      });

      this.currentProcess = proc;
      this.isSpeaking = true;

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", chunk => {
        stdout += chunk.toString();
      });

      proc.stderr.on("data", chunk => {
        stderr += chunk.toString();
      });

      proc.on("error", err => {
        this.isSpeaking = false;
        this.currentProcess = null;
        reject(new Error(`Failed to execute Kokoro synthesizer: ${err.message}`));
      });

      proc.on("close", code => {
        this.isSpeaking = false;
        this.currentProcess = null;

        if (code !== 0) {
          return reject(new Error(`Kokoro synthesis failed (exit code ${code}): ${stderr || stdout}`));
        }

        try {
          const jsonOut = JSON.parse(stdout.trim());
          if (!jsonOut.success) {
            return reject(new Error(`Kokoro synthesis error: ${jsonOut.error}`));
          }

          const record = {
            id: "kokoro-" + Date.now(),
            text: sanitized.slice(0, 160),
            voice,
            speed,
            durationSec: jsonOut.durationSec,
            generationTimeSec: jsonOut.generationTimeSec,
            sampleRate: jsonOut.sampleRate,
            dataUrl: jsonOut.dataUrl,
            timestamp: new Date().toISOString()
          };

          this.audioHistory.push(record);
          if (this.audioHistory.length > 50) this.audioHistory.shift();

          resolve(record);
        } catch (parseErr) {
          reject(new Error(`Failed to parse Kokoro JSON output: ${parseErr.message} (Raw: ${stdout.slice(0, 200)})`));
        }
      });
    });
  }

  getAudioHistory(limit = 20) {
    return this.audioHistory.slice(-limit);
  }
}

export const kokoroEngine = new KokoroEngine();
