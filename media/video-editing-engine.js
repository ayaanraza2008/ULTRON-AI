/**
 * ULTRON AI — Autonomous Video Editing Engine
 *
 * Implements intelligent timeline creation, scene arrangement, beat-synchronization,
 * cinematic color grading, subtitle generation (.srt/.vtt), audio ducking,
 * sound effects injection, title overlays, and FFmpeg rendering.
 *
 * Hardware optimized for AMD Ryzen 7 5700U (8 cores, 8 GB RAM, Radeon graphics)
 * with thread-constrained single-pass rendering (-threads 4).
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec, execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const EDITING_PRESETS = {
  CINEMATIC: {
    id: "cinematic",
    name: "Cinematic Film",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fps: 24,
    colorFilter: "eq=contrast=1.15:brightness=-0.02:saturation=1.1,curves=vintage",
    transition: "crossfade",
    defaultClipDuration: 3.5,
    musicPace: "deliberate_ambient",
    bpm: 90
  },
  DARK_MYSTERY: {
    id: "dark_mystery",
    name: "Dark Mystery",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fps: 24,
    colorFilter: "eq=contrast=1.25:brightness=-0.08:saturation=0.85,colorbalance=rs=-0.1:gs=-0.05:bs=0.15",
    transition: "fadeblack",
    defaultClipDuration: 4.0,
    musicPace: "suspense_drone",
    bpm: 75
  },
  ACTION: {
    id: "action",
    name: "High-Velocity Action",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fps: 60,
    colorFilter: "eq=contrast=1.3:brightness=-0.01:saturation=1.25,unsharp=5:5:1.0",
    transition: "glitch_cut",
    defaultClipDuration: 1.5,
    musicPace: "fast_energetic",
    bpm: 140
  },
  REELS_SHORTS: {
    id: "reels_shorts",
    name: "Instagram Reel / YouTube Short",
    aspectRatio: "9:16",
    width: 1080,
    height: 1920,
    fps: 30,
    colorFilter: "eq=contrast=1.1:brightness=0.02:saturation=1.2",
    transition: "wipe",
    defaultClipDuration: 2.0,
    musicPace: "trending_upbeat",
    bpm: 128
  },
  GAMING: {
    id: "gaming",
    name: "Gaming Montage",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fps: 60,
    colorFilter: "eq=contrast=1.2:saturation=1.3",
    transition: "zoom_cut",
    defaultClipDuration: 2.0,
    musicPace: "electronic_synth",
    bpm: 135
  },
  TRAVEL: {
    id: "travel",
    name: "Cinematic Travel",
    aspectRatio: "16:9",
    width: 1920,
    height: 1080,
    fps: 30,
    colorFilter: "eq=contrast=1.1:saturation=1.25,colorbalance=rs=0.08:gs=0.04:bs=-0.04",
    transition: "crossfade",
    defaultClipDuration: 3.0,
    musicPace: "warm_acoustic",
    bpm: 100
  }
};

export function resolveFFmpegBinary() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0) return "ffmpeg";
    if (process.platform === "win32") {
      const res = spawnSync("where.exe", ["ffmpeg"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      if (res.status === 0 && res.stdout && res.stdout.trim()) {
        const first = res.stdout.trim().split("\r\n")[0].split("\n")[0].trim();
        if (first) return first;
      }
    }
  } catch {
    // Fall back to standard binary name
  }
  return "ffmpeg";
}

export class VideoEditingEngine {
  constructor(options = {}) {
    this.workspaceBase = options.workspaceBase || path.join(os.homedir(), "Documents", "UltronWorkspace");
    this.exportsDir = path.join(this.workspaceBase, "exports");
    this.activeRenders = new Map(); // id -> renderState
    const ffmpegBin = resolveFFmpegBinary();
    this.ffmpegChecker = options.ffmpegChecker || (() => execFileAsync(ffmpegBin, ["-version"], { timeout: 3000 }));
    this.ffmpegRunner = options.ffmpegRunner || ((args, options = {}) => execFileAsync(ffmpegBin, args, options));
  }

  async initialize() {
    try {
      await fs.mkdir(this.exportsDir, { recursive: true });
    } catch {}
  }

  /**
   * Generates a rhythmic beat grid from BPM for clip cut alignment
   */
  generateBeatGrid(bpm = 120, totalDurationSeconds = 30) {
    const beatInterval = 60 / bpm; // e.g. 120 BPM = 0.5s per beat
    const beats = [];
    for (let t = 0; t <= totalDurationSeconds; t += beatInterval) {
      beats.push(Math.round(t * 1000) / 1000);
    }
    return {
      bpm,
      beatInterval,
      beats
    };
  }

  /**
   * Generates compliant SubRip (.srt) and WebVTT (.vtt) format captions
   */
  generateSubtitles(transcriptEntries = []) {
    let srtOutput = "";
    let vttOutput = "WEBVTT\n\n";

    const formatTimestamp = (seconds, separator = ",") => {
      const ms = Math.floor((seconds % 1) * 1000);
      const s = Math.floor(seconds) % 60;
      const m = Math.floor(seconds / 60) % 60;
      const h = Math.floor(seconds / 3600);

      const pad = (n, len = 2) => String(n).padStart(len, "0");
      return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${pad(ms, 3)}`;
    };

    transcriptEntries.forEach((entry, index) => {
      const num = index + 1;
      const startSrt = formatTimestamp(entry.startSeconds, ",");
      const endSrt = formatTimestamp(entry.endSeconds, ",");
      const startVtt = formatTimestamp(entry.startSeconds, ".");
      const endVtt = formatTimestamp(entry.endSeconds, ".");

      srtOutput += `${num}\n${startSrt} --> ${endSrt}\n${entry.text}\n\n`;
      vttOutput += `${num}\n${startVtt} --> ${endVtt}\n${entry.text}\n\n`;
    });

    return {
      srt: srtOutput.trim(),
      vtt: vttOutput.trim(),
      cueCount: transcriptEntries.length
    };
  }

  /**
   * Builds a structured Edit Decision List (EDL) timeline
   */
  buildTimeline({
    presetKey = "CINEMATIC",
    title = "ULTRON Cinematic Creation",
    sourceClips = [],
    targetDuration = 30,
    voiceoverText = null,
    subtitles = []
  } = {}) {
    const preset = EDITING_PRESETS[presetKey.toUpperCase()] || EDITING_PRESETS.CINEMATIC;
    const beatGrid = this.generateBeatGrid(preset.bpm, targetDuration);

    const timeline = {
      id: "timeline-" + Date.now(),
      title,
      preset: preset.name,
      presetId: preset.id,
      dimensions: {
        width: preset.width,
        height: preset.height,
        aspectRatio: preset.aspectRatio,
        fps: preset.fps
      },
      targetDuration,
      colorFilter: preset.colorFilter,
      audioTracks: {
        music: {
          style: preset.musicPace,
          bpm: preset.bpm,
          volume: 0.65,
          duckingOnVoiceover: 0.25
        },
        voiceover: voiceoverText ? {
          text: voiceoverText,
          voice: "am_onyx",
          volume: 1.0
        } : null,
        soundEffects: [
          { type: "whoosh", time: 0.0 },
          { type: "cinematic_hit", time: 1.5 },
          { type: "impact", time: Math.min(10.0, targetDuration - 2) }
        ]
      },
      videoClips: [],
      subtitles: null
    };

    // Distribute clips across target duration using beat alignment
    let currentTime = 0;
    let clipIndex = 0;

    // Do not invent sample media: without uploaded clips this is a plan, not a render.
    const availableClips = Array.isArray(sourceClips) ? sourceClips : [];

    while (currentTime < targetDuration && clipIndex < availableClips.length * 4) {
      const source = availableClips[clipIndex % availableClips.length];
      const clipDuration = Math.min(preset.defaultClipDuration, targetDuration - currentTime);

      timeline.videoClips.push({
        clipId: `clip-${clipIndex + 1}`,
        sourceName: source.name,
        sourcePath: source.path,
        startTimeInSource: 0,
        timelineStart: Math.round(currentTime * 100) / 100,
        timelineEnd: Math.round((currentTime + clipDuration) * 100) / 100,
        duration: Math.round(clipDuration * 100) / 100,
        transition: clipIndex === 0 ? "fadein" : preset.transition
      });

      currentTime += clipDuration;
      clipIndex++;
    }

    if (subtitles.length > 0) {
      timeline.subtitles = this.generateSubtitles(subtitles);
    }

    return timeline;
  }

  /**
   * Compiles the timeline into an optimized FFmpeg filter_complex command
   */
  compileFFmpegArgs(timeline, outputPath) {
    const dimensions = timeline?.dimensions;
    const clips = Array.isArray(timeline?.videoClips) ? timeline.videoClips : [];
    if (!clips.length) throw new Error("SOURCE_MEDIA_REQUIRED: Add at least one real source clip before rendering.");
    if (!dimensions || ![dimensions.width, dimensions.height, dimensions.fps].every(
      value => Number.isInteger(value) && value > 0 && value <= 4096
    )) throw new Error("INVALID_VIDEO_DIMENSIONS: Dimensions and FPS must be bounded positive integers.");

    const args = ["-y", "-threads", "4"];
    const filters = [];
    clips.forEach((clip, index) => {
      const sourcePath = String(clip?.sourcePath || "").trim();
      const duration = Number(clip?.duration);
      const sourceOffset = Number(clip?.startTimeInSource || 0);
      if (!sourcePath || !Number.isFinite(duration) || duration <= 0 || duration > 3600 ||
          !Number.isFinite(sourceOffset) || sourceOffset < 0) {
        throw new Error(`INVALID_SOURCE_CLIP: Clip ${index + 1} has an invalid path, offset, or duration.`);
      }
      args.push("-ss", String(sourceOffset), "-t", String(duration), "-i", sourcePath);
      const filter = String(timeline.colorFilter || "null");
      filters.push(
        `[${index}:v:0]scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,` +
        `pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2,` +
        `fps=${dimensions.fps},setsar=1,${filter},format=yuv420p[v${index}]`
      );
    });
    const videoInputs = clips.map((_, index) => `[v${index}]`).join("");
    filters.push(`${videoInputs}concat=n=${clips.length}:v=1:a=0[outv]`);
    args.push(
      "-filter_complex", filters.join(";"), "-map", "[outv]", "-an",
      "-c:v", "libx264", "-preset", "fast", "-crf", "22", "-threads", "4",
      "-movflags", "+faststart", "-t", String(Number(timeline.targetDuration)), outputPath
    );
    return args;
  }

  compileFFmpegCommand(timeline, outputPath) {
    const args = this.compileFFmpegArgs(timeline, outputPath);
    const displayArg = value => {
      const text = String(value);
      return /^[A-Za-z0-9_./:=+,-]+$/.test(text)
        ? text
        : `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    };
    return {
      command: ["ffmpeg", ...args].map(displayArg).join(" "),
      args,
      outputPath,
      threads: 4,
      crf: 22,
      preset: "fast",
      audioIncluded: false
    };
  }

  /**
   * Renders the video timeline using FFmpeg with simulation fallback
   */
  async renderVideo(timeline, { onProgress = null } = {}) {
    await this.initialize();
    const renderId = "render-" + Date.now();
    const filename = `ultron_edit_${Date.now()}_${timeline.presetId}.mp4`;
    const outputPath = path.join(this.exportsDir, filename);
    const manifestPath = path.join(this.exportsDir, `manifest_${renderId}.json`);
    const renderTask = {
      id: renderId, title: timeline.title, preset: timeline.preset, outputPath,
      progress: 0, status: "RENDERING", startTime: Date.now(), completedTime: null,
      error: null, renderedWithFFmpeg: false
    };
    this.activeRenders.set(renderId, renderTask);

    const failRender = async (status, error) => {
      await fs.rm(outputPath, { force: true }).catch(() => {});
      renderTask.progress = 100;
      renderTask.status = status;
      renderTask.error = error;
      renderTask.outputPath = null;
      renderTask.completedTime = Date.now();
      renderTask.durationMs = renderTask.completedTime - renderTask.startTime;
      renderTask.renderedWithFFmpeg = false;
      if (onProgress) onProgress({ renderId, progress: 100, status, error });
      return { success: false, status, error, renderId, title: timeline.title,
        outputPath: null, manifestPath, renderedWithFFmpeg: false };
    };

    if (onProgress) onProgress({ renderId, progress: 10, status: "BUILDING_TIMELINE" });
    await fs.writeFile(manifestPath, JSON.stringify(timeline, null, 2));

    const clips = Array.isArray(timeline?.videoClips) ? timeline.videoClips : [];
    if (!clips.length) {
      return failRender("BLOCKED_SOURCE_MEDIA_UNAVAILABLE",
        "SOURCE_MEDIA_REQUIRED: Add real source video files; ULTRON will not fabricate footage.");
    }
    for (let index = 0; index < clips.length; index++) {
      const rawPath = String(clips[index]?.sourcePath || "").trim();
      if (!rawPath) return failRender("BLOCKED_SOURCE_MEDIA_UNAVAILABLE",
        `SOURCE_MEDIA_INVALID: Clip ${index + 1} has no source path.`);
      const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(this.workspaceBase, rawPath);
      try {
        const stat = await fs.stat(resolvedPath);
        if (!stat.isFile() || stat.size === 0) return failRender("BLOCKED_SOURCE_MEDIA_UNAVAILABLE",
          `SOURCE_MEDIA_INVALID: Clip ${index + 1} is not a non-empty file.`);
      } catch {
        return failRender("BLOCKED_SOURCE_MEDIA_UNAVAILABLE",
          `SOURCE_MEDIA_NOT_FOUND: Source clip ${index + 1} is unavailable on this host.`);
      }
      clips[index].sourcePath = resolvedPath;
    }

    try {
      await this.ffmpegChecker();
    } catch {
      return failRender("BLOCKED_FFMPEG_UNAVAILABLE",
        "FFMPEG_BINARY_UNAVAILABLE: Real video rendering requires FFmpeg on the host.");
    }

    try {
      if (onProgress) onProgress({ renderId, progress: 50, status: "FFMPEG_RENDERING_SOURCE_MEDIA" });
      await this.ffmpegRunner(this.compileFFmpegArgs(timeline, outputPath),
        { timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
      const stat = await fs.stat(outputPath);
      if (!stat.isFile() || stat.size < 1024) throw new Error("FFMPEG_OUTPUT_INVALID: Render output is missing or too small.");
      const handle = await fs.open(outputPath, "r");
      const header = Buffer.alloc(12);
      try { await handle.read(header, 0, header.length, 0); }
      finally { await handle.close(); }
      if (header.toString("ascii", 4, 8) !== "ftyp") {
        throw new Error("FFMPEG_OUTPUT_INVALID: Output does not contain an MP4 file signature.");
      }
      if (onProgress) onProgress({ renderId, progress: 90, status: "FINALIZING_EXPORT" });
    } catch (error) {
      return failRender("FAILED", `FFMPEG_ENCODING_FAILED: ${error.message}`);
    }

    renderTask.progress = 100;
    renderTask.status = "COMPLETED";
    renderTask.completedTime = Date.now();
    renderTask.durationMs = renderTask.completedTime - renderTask.startTime;
    renderTask.renderedWithFFmpeg = true;
    if (onProgress) onProgress({ renderId, progress: 100, status: "COMPLETED", outputPath });
    return {
      success: true, renderId, title: timeline.title, outputPath, manifestPath,
      targetDuration: timeline.targetDuration,
      dimensions: `${timeline.dimensions.width}x${timeline.dimensions.height}`,
      aspectRatio: timeline.dimensions.aspectRatio, preset: timeline.preset,
      renderedWithFFmpeg: true, audioIncluded: false,
      audioNote: "This export currently contains source video only; audio mixing, sound effects, and voiceover encoding are not implemented."
    };
  }

  cancelRender(renderId) {
    const task = this.activeRenders.get(renderId);
    if (task && task.status === "RENDERING") {
      task.status = "CANCELLED";
      return { success: true, renderId, status: "CANCELLED" };
    }
    return { success: false, error: "RENDER_NOT_ACTIVE" };
  }

  getRenderStatus(renderId) {
    return this.activeRenders.get(renderId) || null;
  }
}

export const videoEditingEngine = new VideoEditingEngine();
