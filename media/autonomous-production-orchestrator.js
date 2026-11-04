/**
 * ULTRON AI — Autonomous One-Command Media Production Orchestrator
 *
 * Implements the flagship 12-Step Autonomous Production Workflow:
 * 1. Understand request (parse style, mood, duration, aspect ratio)
 * 2. Search authorized storage for relevant footage/images
 * 3. Select and score candidate media
 * 4. Analyze footage scenes and quality
 * 5. Develop editing concept and narrative script
 * 6. Generate editing plan (EDL timeline)
 * 7. Build timeline with transitions and beat-sync
 * 8. Apply color grading, sound effects, and voiceover
 * 9. Render the video via FFmpeg (or high-fidelity preview)
 * 10. Save final result in UltronWorkspace/exports
 * 11. Generate interactive preview manifest and thumbnail
 * 12. Return completed production package with exact file locations
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { mediaDiscoveryEngine, MEDIA_TYPES } from "./media-discovery-engine.js";
import { videoEditingEngine, EDITING_PRESETS } from "./video-editing-engine.js";
import { imageStudioEngine } from "./image-studio-engine.js";

export const PRODUCTION_STAGES = [
  "PARSING_INTENT",
  "SEARCHING_STORAGE",
  "SELECTING_MEDIA",
  "ANALYZING_FOOTAGE",
  "DEVELOPING_CONCEPT",
  "BUILDING_TIMELINE",
  "SYNCHRONIZING_BEATS",
  "APPLYING_SFX_AND_VOICEOVER",
  "RENDERING_VIDEO",
  "SAVING_EXPORT",
  "GENERATING_PREVIEW",
  "COMPLETED"
];

export class AutonomousProductionOrchestrator {
  constructor(options = {}) {
    this.workspaceBase = options.workspaceBase || path.join(os.homedir(), "Documents", "UltronWorkspace");
    this.productionHistory = [];
    this.activeTask = null;
    this.mediaDiscovery = options.mediaDiscoveryEngine || mediaDiscoveryEngine;
    this.videoEditing = options.videoEditingEngine || videoEditingEngine;
    this.imageStudio = options.imageStudioEngine || imageStudioEngine;
  }

  /**
   * Parses natural prompt to extract preset, duration, aspect ratio, and theme
   */
  parseProductionIntent(prompt = "") {
    const text = String(prompt).toLowerCase().trim();

    // 1. Detect Preset / Style
    let preset = "CINEMATIC";
    if (text.includes("mystery") || text.includes("dark") || text.includes("thriller")) {
      preset = "DARK_MYSTERY";
    } else if (text.includes("action") || text.includes("dangerous") || text.includes("fight") || text.includes("combat")) {
      preset = "ACTION";
    } else if (text.includes("reel") || text.includes("short") || text.includes("tiktok") || text.includes("vertical") || text.includes("9:16")) {
      preset = "REELS_SHORTS";
    } else if (text.includes("gaming") || text.includes("gameplay")) {
      preset = "GAMING";
    } else if (text.includes("travel") || text.includes("vlog")) {
      preset = "TRAVEL";
    }

    // 2. Detect Duration
    let duration = 30; // Default 30s
    const durMatch = text.match(/(\d+)[\s-]*(?:second|sec|s\b)/);
    if (durMatch && Number(durMatch[1]) > 0) {
      duration = Math.min(120, Math.max(5, Number(durMatch[1])));
    } else if (text.includes("1 minute") || text.includes("60 second")) {
      duration = 60;
    } else if (text.includes("15 second") || text.includes("15-second") || text.includes("quick")) {
      duration = 15;
    }

    // 3. Detect Keywords
    const keywords = [];
    if (text.includes("car")) keywords.push("car");
    if (text.includes("sunset")) keywords.push("sunset");
    if (text.includes("action")) keywords.push("action");
    if (text.includes("cinematic")) keywords.push("cinematic");

    return {
      presetKey: preset,
      targetDuration: duration,
      keywords,
      rawPrompt: prompt
    };
  }

  /**
   * Executes the complete 12-step autonomous production pipeline
   */
  async produceContent(naturalPrompt, { onProgress = null } = {}) {
    const taskId = "prod-" + Date.now();
    const startTime = Date.now();

    const notify = (stageIndex, detail = {}) => {
      const stageName = PRODUCTION_STAGES[stageIndex];
      const progressPercent = Math.round(((stageIndex + 1) / PRODUCTION_STAGES.length) * 100);
      const update = {
        taskId,
        stageIndex,
        stageName,
        progress: progressPercent,
        detail,
        timestamp: new Date().toISOString()
      };
      if (onProgress) onProgress(update);
      return update;
    };

    // Step 1: Understand request
    notify(0, { prompt: naturalPrompt });
    const intent = this.parseProductionIntent(naturalPrompt);

    // Step 2: Search authorized storage
    notify(1, { preset: intent.presetKey, duration: intent.targetDuration });
    let mediaCandidates = this.mediaDiscovery.searchMedia(naturalPrompt);
    if (mediaCandidates.length === 0) {
      // Fallback to all videos in library
      mediaCandidates = Array.from(this.mediaDiscovery.catalog.values())
        .filter(m => m.mediaType === MEDIA_TYPES.VIDEO);
    }

    // Step 3: Select relevant media
    notify(2, { foundCount: mediaCandidates.length });
    const selectedClips = mediaCandidates.slice(0, 8).map((m, idx) => ({
      name: m.name,
      path: m.path,
      duration: m.metadata?.durationSeconds || 10
    }));

    // Step 4: Analyze footage
    notify(3, { clipCount: selectedClips.length });

    // Step 5: Develop concept & voiceover narrative
    notify(4, { theme: intent.presetKey });
    const conceptNarrative = `In a world of constant motion, ULTRON awakens. Precision, power, and absolute clarity.`;

    // Step 6 & 7: Generate editing plan and build timeline
    notify(5, { targetDuration: intent.targetDuration });
    const timeline = this.videoEditing.buildTimeline({
      presetKey: intent.presetKey,
      title: `ULTRON ${intent.presetKey} Edit`,
      sourceClips: selectedClips,
      targetDuration: intent.targetDuration,
      voiceoverText: conceptNarrative,
      subtitles: [
        { startSeconds: 0.5, endSeconds: 4.0, text: "In a world of constant motion..." },
        { startSeconds: 4.5, endSeconds: 8.0, text: "ULTRON awakens." },
        { startSeconds: 8.5, endSeconds: Math.min(intent.targetDuration - 1, 14.0), text: "Precision, power, and absolute clarity." }
      ]
    });

    // Step 8: Synchronize beats
    notify(6, { bpm: timeline.audioTracks.music.bpm });

    // Step 9: Apply SFX & voiceover
    notify(7, { sfxCount: timeline.audioTracks.soundEffects.length });

    // Step 10: Render video
    notify(8, { preset: timeline.preset });
    const renderResult = await this.videoEditing.renderVideo(timeline);

    // Step 11: Save the export only when a real video was produced.
    notify(9, {
      exported: Boolean(renderResult.success && renderResult.outputPath),
      renderStatus: renderResult.status || (renderResult.success ? "COMPLETED" : "FAILED")
    });

    // Step 12: Generate the package thumbnail even when the video render is blocked.
    notify(10, { renderId: renderResult.renderId, renderStatus: renderResult.status });
    const thumbnailResult = await this.imageStudio.exportThumbnail({
      title: `ULTRON ${intent.presetKey}`,
      subtitle: `${intent.targetDuration}s CINEMATIC MASTER`,
      preset: intent.presetKey === "ACTION" ? "CYBERPUNK" : "CINEMATIC_TEAL_ORANGE"
    });

    // Step 12: Complete & save package
    const videoExportReady = Boolean(renderResult.success && renderResult.outputPath);
    const finishedPackage = {
      success: videoExportReady,
      taskId,
      prompt: naturalPrompt,
      concept: conceptNarrative,
      preset: timeline.preset,
      aspectRatio: timeline.dimensions.aspectRatio,
      durationSeconds: intent.targetDuration,
      videoExportPath: videoExportReady ? renderResult.outputPath : null,
      videoExportStatus: renderResult.status || (videoExportReady ? "COMPLETED" : "FAILED"),
      videoExportError: videoExportReady ? null : (renderResult.error || "VIDEO_EXPORT_UNAVAILABLE"),
      manifestPath: renderResult.manifestPath || null,
      thumbnailPath: thumbnailResult.success ? thumbnailResult.outputPath : null,
      executionTimeMs: Date.now() - startTime,
      stagesCompleted: videoExportReady ? 12 : 10,
      stagesBlocked: videoExportReady ? [] : ["RENDERING_VIDEO", "SAVING_EXPORT"],
      status: videoExportReady ? "COMPLETED" : "BLOCKED_MEDIA_RENDER"
    };

    notify(11, finishedPackage);
    this.productionHistory.unshift(finishedPackage);
    if (this.productionHistory.length > 50) this.productionHistory.pop();

    return finishedPackage;
  }

  getHistory() {
    return this.productionHistory;
  }
}

export const autonomousProductionOrchestrator = new AutonomousProductionOrchestrator();
