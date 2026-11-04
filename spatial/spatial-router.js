/**
 * ULTRON AI — Spatial Intelligence REST API Router
 * Module: spatial/spatial-router.js
 *
 * Exposes REST endpoints for the Diorama 3D World Modeling Engine:
 * - Hardware capabilities & pipeline status
 * - 3D scene reconstruction job lifecycle
 * - 3D asset export (Wavefront OBJ, GLTF 2.0, Scene JSON)
 * - Natural language spatial queries & user data isolation
 */

import express from "express";
import { spatialIntelligenceEngine } from "./spatial-engine.js";

export function createSpatialRouter({
  requireSupabaseUser,
  engine = spatialIntelligenceEngine,
  logger = console
} = {}) {
  if (typeof requireSupabaseUser !== "function") {
    throw new TypeError("createSpatialRouter requires the authenticated Supabase user middleware.");
  }

  const router = express.Router();

  // Status & Hardware Capabilities
  router.get("/spatial/status", requireSupabaseUser, async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const status = await engine.getStatus();
      res.json(status);
    } catch (err) {
      logger.error?.("Failed to probe spatial status", { error: err.message });
      res.status(500).json({ error: { code: "STATUS_CHECK_FAILED", message: err.message } });
    }
  });

  // Submit image for 3D scene reconstruction
  router.post("/spatial/jobs", requireSupabaseUser, express.json({ limit: "10mb" }), async (req, res) => {
    const userId = req.supabaseUser?.id;
    const imageInput = req.body?.image || req.body?.imageData;
    const options = typeof req.body?.options === "object" && req.body.options !== null ? req.body.options : {};

    if (!imageInput) {
      return res.status(400).json({
        error: {
          code: "IMAGE_REQUIRED",
          message: "Provide a base64 image data URL in the 'image' field."
        }
      });
    }

    try {
      const job = await engine.createJob(userId, imageInput, options);
      res.status(202).json({
        status: "accepted",
        job
      });
    } catch (err) {
      const status = err?.code === "IMAGE_TOO_LARGE" ? 413 : 400;
      res.status(status).json({
        error: {
          code: err?.code || "JOB_CREATION_FAILED",
          message: err?.message || "Failed to create spatial reconstruction job."
        }
      });
    }
  });

  // Check job progress and retrieve scene graph
  router.get("/spatial/jobs/:id", requireSupabaseUser, (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const userId = req.supabaseUser?.id;
    const jobId = req.params.id;

    try {
      const job = engine.getJob(jobId, userId);
      if (!job) {
        return res.status(404).json({
          error: { code: "JOB_NOT_FOUND", message: `Spatial job ${jobId} not found.` }
        });
      }
      res.json({ status: "ok", job });
    } catch (err) {
      const statusCode = err?.code === "FORBIDDEN" ? 403 : 500;
      res.status(statusCode).json({
        error: { code: err?.code || "JOB_RETRIEVAL_FAILED", message: err?.message }
      });
    }
  });

  // Cancel an active job
  router.post("/spatial/jobs/:id/cancel", requireSupabaseUser, (req, res) => {
    const userId = req.supabaseUser?.id;
    const jobId = req.params.id;

    try {
      const cancelled = engine.cancelJob(jobId, userId);
      if (!cancelled) {
        return res.status(404).json({
          error: { code: "JOB_NOT_FOUND", message: `Spatial job ${jobId} not found.` }
        });
      }
      res.json({ status: "ok", cancelled: true });
    } catch (err) {
      const statusCode = err?.code === "FORBIDDEN" ? 403 : 500;
      res.status(statusCode).json({
        error: { code: err?.code || "JOB_CANCEL_FAILED", message: err?.message }
      });
    }
  });

  // Delete job and scrub 3D assets
  router.delete("/spatial/jobs/:id", requireSupabaseUser, (req, res) => {
    const userId = req.supabaseUser?.id;
    const jobId = req.params.id;

    try {
      const deleted = engine.deleteJob(jobId, userId);
      if (!deleted) {
        return res.status(404).json({
          error: { code: "JOB_NOT_FOUND", message: `Spatial job ${jobId} not found.` }
        });
      }
      res.json({ status: "ok", deleted: true });
    } catch (err) {
      const statusCode = err?.code === "FORBIDDEN" ? 403 : 500;
      res.status(statusCode).json({
        error: { code: err?.code || "JOB_DELETE_FAILED", message: err?.message }
      });
    }
  });

  // Export 3D asset (OBJ, GLTF, JSON)
  router.get("/spatial/jobs/:id/export/:format", requireSupabaseUser, (req, res) => {
    const userId = req.supabaseUser?.id;
    const jobId = req.params.id;
    const format = req.params.format;

    try {
      const asset = engine.exportSceneAsset(jobId, userId, format);
      res.setHeader("Content-Type", asset.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${asset.filename}"`);
      res.send(asset.content);
    } catch (err) {
      const statusCode = err?.code === "FORBIDDEN" ? 403
        : err?.code === "JOB_NOT_FOUND" ? 404
        : err?.code === "SCENE_NOT_READY" || err?.code === "SCENE_GEOMETRY_UNAVAILABLE" ? 409 : 500;
      res.status(statusCode).json({
        error: { code: err?.code || "EXPORT_FAILED", message: err?.message }
      });
    }
  });

  // Query reconstructed 3D scene
  router.post("/spatial/jobs/:id/query", requireSupabaseUser, express.json(), (req, res) => {
    const userId = req.supabaseUser?.id;
    const jobId = req.params.id;
    const query = typeof req.body?.query === "string" ? req.body.query : "";

    if (!query.trim()) {
      return res.status(400).json({
        error: { code: "QUERY_REQUIRED", message: "Provide a natural language spatial query string." }
      });
    }

    try {
      const answer = engine.queryScene(jobId, userId, query);
      res.json({ status: "ok", query, result: answer });
    } catch (err) {
      const statusCode = err?.code === "FORBIDDEN" ? 403
        : err?.code === "JOB_NOT_FOUND" ? 404
        : err?.code === "SCENE_NOT_READY" ? 409 : 500;
      res.status(statusCode).json({
        error: { code: err?.code || "QUERY_FAILED", message: err?.message }
      });
    }
  });

  return router;
}
