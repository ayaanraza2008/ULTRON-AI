/**
 * ULTRON AI — Spatial Intelligence Engine
 * Module: spatial/spatial-engine.js
 *
 * Central coordinator for 3D World Modeling with Diorama:
 * - Job creation, progress tracking, and lifecycle management
 * - Strict user isolation and authorization enforcement
 * - AI Brain context formatting and natural language spatial querying
 * - 3D asset export (OBJ, GLTF, JSON)
 */

import crypto from "node:crypto";
import { DioramaSpatialAdapter } from "./diorama-adapter.js";
import { detectHardwareCapabilities } from "./hardware-detector.js";
import { sceneToObj, sceneToGltf } from "./geometry-converter.js";

export const JOB_STATUS = Object.freeze({
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED"
});

export const PIPELINE_STAGES = Object.freeze([
  { id: "queued", label: "Spatial request queued", progress: 5 },
  { id: "backend_selection", label: "Select configured spatial backend", progress: 20 },
  { id: "worker_execution", label: "Execute configured worker or metadata fallback", progress: 65 },
  { id: "geometry_validation", label: "Validate returned geometry and provenance", progress: 90 },
  { id: "completed", label: "Spatial processing finished; inspect inference status", progress: 100 }
]);

const MAX_JOBS_PER_USER = 20;
const MAX_TOTAL_JOBS = 100;
const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export class SpatialIntelligenceEngine {
  constructor(options = {}) {
    this.adapter = options.adapter || new DioramaSpatialAdapter(options);
    this.env = options.env || process.env;
    this.jobs = new Map(); // jobId -> jobRecord
    this.latestUserJob = new Map(); // userId -> jobId
  }

  /**
   * Probes system spatial intelligence readiness and hardware capabilities.
   */
  async getStatus() {
    const hw = await detectHardwareCapabilities(this.env);
    return {
      engine: "ULTRON SPATIAL INTELLIGENCE",
      version: "1.0.0",
      architecture: "Diorama (arXiv:2411.19492 / 3dlg-hcvc)",
      status: hw.worker.executionMode === "CPU_METADATA_FALLBACK"
        ? "DEGRADED_METADATA_ONLY"
        : "CONFIGURED_NOT_LIVE_VERIFIED",
      hardware: hw,
      activeJobsCount: Array.from(this.jobs.values()).filter(j => j.status === JOB_STATUS.PROCESSING).length,
      totalCompletedJobs: Array.from(this.jobs.values()).filter(j => j.status === JOB_STATUS.COMPLETED).length
    };
  }

  /**
   * Submit an image for 3D spatial scene modeling.
   */
  async createJob(userId, imageInput, options = {}) {
    if (!userId || typeof userId !== "string") {
      throw Object.assign(new Error("User authentication required to submit spatial jobs."), { code: "AUTH_REQUIRED" });
    }

    this._evictStaleJobs();

    const userJobs = Array.from(this.jobs.values()).filter(j => j.userId === userId);
    if (userJobs.length >= MAX_JOBS_PER_USER) {
      // Remove oldest completed job for this user
      const oldest = userJobs.filter(j => j.status === JOB_STATUS.COMPLETED || j.status === JOB_STATUS.FAILED)[0];
      if (oldest) this.jobs.delete(oldest.jobId);
    }

    const jobId = "spat-job-" + crypto.randomUUID();
    const jobRecord = {
      jobId,
      userId,
      status: JOB_STATUS.QUEUED,
      stage: PIPELINE_STAGES[0].id,
      progress: 5,
      stageLabel: PIPELINE_STAGES[0].label,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      sceneGraph: null,
      cancelled: false
    };

    this.jobs.set(jobId, jobRecord);
    this.latestUserJob.set(userId, jobId);

    // Asynchronously process the reconstruction job
    this._processJobAsync(jobId, imageInput, options).catch(() => {});

    return {
      jobId,
      status: jobRecord.status,
      progress: jobRecord.progress,
      stageLabel: jobRecord.stageLabel,
      createdAt: jobRecord.createdAt
    };
  }

  async _processJobAsync(jobId, imageInput, options) {
    const job = this.jobs.get(jobId);
    if (!job || job.cancelled) return;

    job.status = JOB_STATUS.PROCESSING;
    job.updatedAt = new Date().toISOString();

    try {
      job.stage = PIPELINE_STAGES[1].id;
      job.stageLabel = PIPELINE_STAGES[1].label;
      job.progress = PIPELINE_STAGES[1].progress;
      job.updatedAt = new Date().toISOString();

      if (job.cancelled) return;

      job.stage = PIPELINE_STAGES[2].id;
      job.stageLabel = PIPELINE_STAGES[2].label;
      job.progress = PIPELINE_STAGES[2].progress;
      job.updatedAt = new Date().toISOString();
      const sceneGraph = await this.adapter.reconstructScene(imageInput, options);

      if (job.cancelled) return;

      job.stage = PIPELINE_STAGES[3].id;
      job.stageLabel = PIPELINE_STAGES[3].label;
      job.progress = PIPELINE_STAGES[3].progress;
      job.updatedAt = new Date().toISOString();
      job.sceneGraph = sceneGraph;
      job.status = JOB_STATUS.COMPLETED;
      job.stage = PIPELINE_STAGES[4].id;
      job.stageLabel = sceneGraph.metadataOnly
        ? "Metadata-only fallback completed; no 3D reconstruction performed"
        : "Worker result validated; inference provenance is reported separately";
      job.progress = 100;
      job.completedAt = new Date().toISOString();
      job.updatedAt = new Date().toISOString();
    } catch (err) {
      if (job.cancelled) return;
      job.status = JOB_STATUS.FAILED;
      job.error = {
        code: err?.code || "SPATIAL_PIPELINE_ERROR",
        message: err?.message || "Spatial reconstruction failed."
      };
      job.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Retrieves a job by ID, strictly enforcing that caller matches job owner.
   */
  getJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (job.userId !== userId) {
      throw Object.assign(new Error("Access to this spatial job is restricted to the job owner."), { code: "FORBIDDEN" });
    }
    return {
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      stageLabel: job.stageLabel,
      progress: job.progress,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      error: job.error,
      sceneGraph: job.sceneGraph ? job.sceneGraph.toJSON() : null
    };
  }

  /**
   * Cancel an active spatial job.
   */
  cancelJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.userId !== userId) {
      throw Object.assign(new Error("Access to this spatial job is restricted to the job owner."), { code: "FORBIDDEN" });
    }
    job.cancelled = true;
    job.status = JOB_STATUS.CANCELLED;
    job.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Permanently delete a spatial job and scrub all associated scene assets.
   */
  deleteJob(jobId, userId) {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    if (job.userId !== userId) {
      throw Object.assign(new Error("Access to this spatial job is restricted to the job owner."), { code: "FORBIDDEN" });
    }
    this.jobs.delete(jobId);
    if (this.latestUserJob.get(userId) === jobId) {
      this.latestUserJob.delete(userId);
    }
    return true;
  }

  /**
   * Export the 3D scene representation into OBJ or GLTF format.
   */
  exportSceneAsset(jobId, userId, format = "json") {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw Object.assign(new Error("Spatial job not found."), { code: "JOB_NOT_FOUND" });
    }
    if (job.userId !== userId) {
      throw Object.assign(new Error("Access to this spatial job is restricted to the job owner."), { code: "FORBIDDEN" });
    }
    if (job.status !== JOB_STATUS.COMPLETED || !job.sceneGraph) {
      throw Object.assign(new Error("Spatial processing has not completed."), { code: "SCENE_NOT_READY" });
    }
    if (job.sceneGraph.metadataOnly) {
      throw Object.assign(new Error("No 3D geometry is available from the metadata-only CPU fallback."), { code: "SCENE_GEOMETRY_UNAVAILABLE" });
    }

    const fmt = String(format || "").toLowerCase().trim();
    if (fmt === "obj") {
      return {
        format: "obj",
        mimeType: "text/plain",
        filename: `${job.sceneGraph.sceneId}.obj`,
        content: sceneToObj(job.sceneGraph)
      };
    }
    if (fmt === "gltf") {
      return {
        format: "gltf",
        mimeType: "application/json",
        filename: `${job.sceneGraph.sceneId}.gltf`,
        content: JSON.stringify(sceneToGltf(job.sceneGraph), null, 2)
      };
    }

    return {
      format: "json",
      mimeType: "application/json",
      filename: `${job.sceneGraph.sceneId}.json`,
      content: JSON.stringify(job.sceneGraph.toJSON(), null, 2)
    };
  }

  /**
   * Query the reconstructed scene with natural language.
   */
  queryScene(jobId, userId, query) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw Object.assign(new Error("Spatial job not found."), { code: "JOB_NOT_FOUND" });
    }
    if (job.userId !== userId) {
      throw Object.assign(new Error("Access to this spatial job is restricted to the job owner."), { code: "FORBIDDEN" });
    }
    if (job.status !== JOB_STATUS.COMPLETED || !job.sceneGraph) {
      throw Object.assign(new Error("3D spatial scene has not completed reconstruction."), { code: "SCENE_NOT_READY" });
    }

    return job.sceneGraph.querySpatial(query);
  }

  /**
   * Returns spatial context for AI Brain reasoning if a spatial query is detected.
   */
  getSpatialBrainContext(userId, prompt = "") {
    const latestJobId = this.latestUserJob.get(userId);
    if (!latestJobId) return null;
    const job = this.jobs.get(latestJobId);
    if (!job || job.status !== JOB_STATUS.COMPLETED || !job.sceneGraph || job.sceneGraph.metadataOnly) return null;

    const text = String(prompt || "").toLowerCase();
    const isSpatialIntent = /\b(room|3d|spatial|objects|table|chair|desk|distance|nearest|dimension|where|layout|furniture)\b/i.test(text);

    if (!isSpatialIntent) return null;

    return {
      sceneId: job.sceneGraph.sceneId,
      summary: job.sceneGraph.toSummaryText(),
      reconstructedAt: job.completedAt
    };
  }

  _evictStaleJobs() {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      const age = now - new Date(job.createdAt).getTime();
      if (age > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
    if (this.jobs.size > MAX_TOTAL_JOBS) {
      const oldest = Array.from(this.jobs.entries())
        .sort((a, b) => new Date(a[1].createdAt).getTime() - new Date(b[1].createdAt).getTime())[0];
      if (oldest) this.jobs.delete(oldest[0]);
    }
  }
}

export const spatialIntelligenceEngine = new SpatialIntelligenceEngine();
