/**
 * ULTRON AI — Spatial Intelligence 3D World Model Viewer
 * Module: public/spatial-viewer.js
 *
 * Implements the interactive 3D scene viewer for Diorama spatial intelligence:
 * - Orbit navigation (drag to rotate, wheel to zoom, shift-drag to pan)
 * - 3D wireframe bounding boxes, floor grid, and architecture planes
 * - Object selection & holographic info HUD
 * - 3D asset export (Wavefront OBJ, GLTF 2.0, Scene JSON)
 * - Integration with ULTRON Eyes camera capture and image upload
 */

export class SpatialWorldModelViewer {
  constructor() {
    this.canvas = null;
    this.ctx = null;
    this.currentScene = null;
    this.activeJobId = null;
    this.selectedObjectId = null;

    // Camera orbit parameters
    this.camera = {
      pitch: 0.35, // radians
      yaw: 0.45,   // radians
      distance: 6.0,
      target: { x: 0, y: 0.8, z: 2.5 }
    };

    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.isShiftDown = false;

    // DOM references
    this.panel = null;
    this.statusText = null;
    this.hwBadge = null;
    this.stageBadge = null;
    this.selectedBox = null;
    this.objName = null;
    this.objPos = null;
    this.objDim = null;
    this.objSupport = null;
    this.exportObjBtn = null;
    this.exportGltfBtn = null;
    this.queryInput = null;
    this.queryBtn = null;
    this.queryAnswer = null;
    this.fileInput = null;
  }

  init() {
    this.panel = document.getElementById("spatial-panel");
    this.canvas = document.getElementById("spatial-canvas");
    if (!this.canvas) return;

    this.ctx = this.canvas.getContext("2d");
    this.statusText = document.getElementById("spatial-status");
    this.hwBadge = document.getElementById("spatial-hw-badge");
    this.stageBadge = document.getElementById("spatial-stage-badge");
    this.selectedBox = document.getElementById("spatial-selected-object");
    this.objName = document.getElementById("spatial-obj-name");
    this.objPos = document.getElementById("spatial-obj-pos");
    this.objDim = document.getElementById("spatial-obj-dim");
    this.objSupport = document.getElementById("spatial-obj-support");
    this.exportObjBtn = document.getElementById("spatial-export-obj");
    this.exportGltfBtn = document.getElementById("spatial-export-gltf");
    this.queryInput = document.getElementById("spatial-query-input");
    this.queryBtn = document.getElementById("spatial-query-btn");
    this.queryAnswer = document.getElementById("spatial-query-answer");
    this.fileInput = document.getElementById("spatial-file-input");

    this._bindEvents();
    this.fetchHardwareStatus();
    this.render();
  }

  _bindEvents() {
    // Canvas drag / orbit
    this.canvas.addEventListener("mousedown", (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener("mouseup", () => {
      this.isDragging = false;
    });

    window.addEventListener("mousemove", (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };

      if (e.shiftKey) {
        this.camera.target.x -= dx * 0.005;
        this.camera.target.y += dy * 0.005;
      } else {
        this.camera.yaw -= dx * 0.008;
        this.camera.pitch = Math.max(-1.4, Math.min(1.4, this.camera.pitch + dy * 0.008));
      }
      this.render();
    });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.camera.distance = Math.max(1.5, Math.min(18.0, this.camera.distance + e.deltaY * 0.005));
      this.render();
    }, { passive: false });

    // Object click selection
    this.canvas.addEventListener("click", (e) => {
      this._handleCanvasClick(e);
    });

    // Preset buttons
    document.getElementById("spatial-view-iso")?.addEventListener("click", () => {
      this.camera.pitch = 0.4;
      this.camera.yaw = 0.5;
      this.camera.distance = 6.0;
      this.render();
    });

    document.getElementById("spatial-view-top")?.addEventListener("click", () => {
      this.camera.pitch = 1.45;
      this.camera.yaw = 0.0;
      this.camera.distance = 7.0;
      this.render();
    });

    // Close button
    document.getElementById("spatial-close")?.addEventListener("click", () => {
      if (this.panel) this.panel.hidden = true;
    });

    // Upload & Capture buttons
    document.getElementById("spatial-upload-btn")?.addEventListener("click", () => {
      this.fileInput?.click();
    });

    this.fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) this.processImageFile(file);
    });

    document.getElementById("spatial-camera-snap-btn")?.addEventListener("click", () => {
      this.captureFromEyesVideo();
    });

    // 3D Export buttons
    this.exportObjBtn?.addEventListener("click", () => this.downloadAsset("obj"));
    this.exportGltfBtn?.addEventListener("click", () => this.downloadAsset("gltf"));

    // Spatial query
    this.queryBtn?.addEventListener("click", () => this.executeSpatialQuery());
    this.queryInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.executeSpatialQuery();
    });
  }

  async fetchHardwareStatus() {
    try {
      const res = await fetch("/api/spatial/status");
      if (!res.ok) return;
      const data = await res.json();
      if (this.hwBadge) {
        const isCuda = data.hardware?.gpu?.hasCuda;
        const mode = data.hardware?.worker?.executionMode || "CPU";
        this.hwBadge.textContent = isCuda
          ? `CUDA GPU · ${data.hardware.gpu.gpuName}`
          : `RYZEN 7 5700U · ${mode}`;
      }
    } catch {}
  }

  async processImageFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      await this.startReconstruction(reader.result);
    };
    reader.readAsDataURL(file);
  }

  captureFromEyesVideo() {
    const video = document.getElementById("eye-video");
    if (!video || !video.videoWidth) {
      alert("Please enable ULTRON Eyes camera first to capture a frame.");
      return;
    }
    const snapCanvas = document.createElement("canvas");
    snapCanvas.width = video.videoWidth;
    snapCanvas.height = video.videoHeight;
    const ctx = snapCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const dataUrl = snapCanvas.toDataURL("image/jpeg", 0.9);
    this.startReconstruction(dataUrl);
  }

  async startReconstruction(imageData) {
    if (this.stageBadge) this.stageBadge.textContent = "QUEUED...";
    if (this.panel) this.panel.hidden = false;

    try {
      const res = await fetch("/api/spatial/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData })
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Spatial job failed: ${err.error?.message || res.statusText}`);
        return;
      }
      const data = await res.json();
      this.activeJobId = data.job?.jobId;
      this._pollJobProgress();
    } catch (e) {
      alert(`Network error: ${e.message}`);
    }
  }

  async _pollJobProgress() {
    if (!this.activeJobId) return;

    try {
      const res = await fetch(`/api/spatial/jobs/${this.activeJobId}`);
      if (!res.ok) return;
      const data = await res.json();
      const job = data.job;

      if (this.stageBadge) {
        this.stageBadge.textContent = `${job.stageLabel} (${job.progress}%)`;
      }

      if (job.status === "COMPLETED" && job.sceneGraph) {
        this.currentScene = job.sceneGraph;
        this.stageBadge.textContent = `RECONSTRUCTED (${job.sceneGraph.objects.length} Objects)`;
        if (this.exportObjBtn) this.exportObjBtn.disabled = false;
        if (this.exportGltfBtn) this.exportGltfBtn.disabled = false;
        if (this.queryInput) this.queryInput.disabled = false;
        if (this.queryBtn) this.queryBtn.disabled = false;
        this.render();
      } else if (job.status === "FAILED") {
        this.stageBadge.textContent = `FAILED: ${job.error?.code}`;
      } else {
        setTimeout(() => this._pollJobProgress(), 400);
      }
    } catch {}
  }

  async executeSpatialQuery() {
    const q = this.queryInput?.value?.trim();
    if (!q || !this.activeJobId) return;

    try {
      const res = await fetch(`/api/spatial/jobs/${this.activeJobId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q })
      });
      const data = await res.json();
      if (this.queryAnswer) {
        this.queryAnswer.hidden = false;
        this.queryAnswer.textContent = data.result?.answer || "No spatial result returned.";
      }
    } catch (err) {
      if (this.queryAnswer) {
        this.queryAnswer.hidden = false;
        this.queryAnswer.textContent = `Error: ${err.message}`;
      }
    }
  }

  downloadAsset(format) {
    if (!this.activeJobId) return;
    window.location.href = `/api/spatial/jobs/${this.activeJobId}/export/${format}`;
  }

  // 3D Rendering Engine
  render() {
    if (!this.ctx || !this.canvas) return;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Clear background (Deep space black)
    this.ctx.fillStyle = "#040810";
    this.ctx.fillRect(0, 0, width, height);

    // Camera transformation matrix
    const cosY = Math.cos(this.camera.yaw);
    const sinY = Math.sin(this.camera.yaw);
    const cosP = Math.cos(this.camera.pitch);
    const sinP = Math.sin(this.camera.pitch);

    const project = (x, y, z) => {
      // Translate relative to target
      let tx = x - this.camera.target.x;
      let ty = y - this.camera.target.y;
      let tz = z - this.camera.target.z;

      // Yaw rotation (around Y)
      let rx = tx * cosY - tz * sinY;
      let rz = tx * sinY + tz * cosY;

      // Pitch rotation (around X)
      let ry = ty * cosP - rz * sinP;
      let rdepth = ty * sinP + rz * cosP + this.camera.distance;

      if (rdepth <= 0.1) return null;

      const fov = 380;
      const sx = (rx / rdepth) * fov + width / 2;
      const sy = (-ry / rdepth) * fov + height / 2;
      return { x: sx, y: sy, depth: rdepth };
    };

    // Draw 3D Floor Grid
    this.ctx.strokeStyle = "rgba(0, 220, 255, 0.15)";
    this.ctx.lineWidth = 1;
    const gridSize = 3.0;
    const gridStep = 0.5;

    for (let gx = -gridSize; gx <= gridSize; gx += gridStep) {
      const p1 = project(gx, 0, 0);
      const p2 = project(gx, 0, 5.0);
      if (p1 && p2) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
    }
    for (let gz = 0; gz <= 5.0; gz += gridStep) {
      const p1 = project(-gridSize, 0, gz);
      const p2 = project(gridSize, 0, gz);
      if (p1 && p2) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
    }

    // Draw Coordinate Axes (Origin: 0, 0, 0)
    const o = project(0, 0, 0);
    const ax = project(0.8, 0, 0);
    const ay = project(0, 0.8, 0);
    const az = project(0, 0, 0.8);

    if (o && ax && ay && az) {
      this._drawLine(o, ax, "#ff4444", 2); // X: Red
      this._drawLine(o, ay, "#00ff88", 2); // Y: Green
      this._drawLine(o, az, "#00aaff", 2); // Z: Blue
    }

    // Render Scene Objects
    if (this.currentScene && Array.isArray(this.currentScene.objects)) {
      for (const obj of this.currentScene.objects) {
        this._renderObject3D(obj, project);
      }
    }
  }

  _renderObject3D(obj, project) {
    const pos = obj.pose3d.position;
    const dims = obj.pose3d.dimensions;
    const isSelected = obj.id === this.selectedObjectId;

    const hx = dims.dx / 2;
    const hy = dims.dy / 2;
    const hz = dims.dz / 2;

    const corners = [
      project(pos.x - hx, pos.y - hy, pos.z - hz),
      project(pos.x + hx, pos.y - hy, pos.z - hz),
      project(pos.x + hx, pos.y - hy, pos.z + hz),
      project(pos.x - hx, pos.y - hy, pos.z + hz),
      project(pos.x - hx, pos.y + hy, pos.z - hz),
      project(pos.x + hx, pos.y + hy, pos.z - hz),
      project(pos.x + hx, pos.y + hy, pos.z + hz),
      project(pos.x - hx, pos.y + hy, pos.z + hz)
    ];

    if (corners.some(c => c === null)) return;

    // Draw Wireframe 3D Box
    const color = isSelected ? "#ffd700" : (obj.category === "electronics" ? "#00e5ff" : "#ff9d00");
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = isSelected ? 2.5 : 1.5;

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0], // bottom
      [4, 5], [5, 6], [6, 7], [7, 4], // top
      [0, 4], [1, 5], [2, 6], [3, 7]  // pillars
    ];

    this.ctx.beginPath();
    for (const [i, j] of edges) {
      this.ctx.moveTo(corners[i].x, corners[i].y);
      this.ctx.lineTo(corners[j].x, corners[j].y);
    }
    this.ctx.stroke();

    // Top Face Tint
    this.ctx.fillStyle = isSelected ? "rgba(255, 215, 0, 0.25)" : "rgba(0, 229, 255, 0.12)";
    this.ctx.beginPath();
    this.ctx.moveTo(corners[4].x, corners[4].y);
    this.ctx.lineTo(corners[5].x, corners[5].y);
    this.ctx.lineTo(corners[6].x, corners[6].y);
    this.ctx.lineTo(corners[7].x, corners[7].y);
    this.ctx.closePath();
    this.ctx.fill();

    // Label tag
    const center = project(pos.x, pos.y + hy + 0.12, pos.z);
    if (center) {
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "11px Inter, system-ui, sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.fillText(`${obj.label} (${pos.z}m)`, center.x, center.y);
    }
  }

  _drawLine(p1, p2, color, width = 1) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = width;
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.ctx.lineTo(p2.x, p2.y);
    this.ctx.stroke();
  }

  _handleCanvasClick(e) {
    if (!this.currentScene || !Array.isArray(this.currentScene.objects)) return;
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Pick closest object
    let closest = null;
    let minD = 40;

    for (const obj of this.currentScene.objects) {
      const pos = obj.pose3d.position;
      // Project center
      const cosY = Math.cos(this.camera.yaw);
      const sinY = Math.sin(this.camera.yaw);
      const cosP = Math.cos(this.camera.pitch);
      const sinP = Math.sin(this.camera.pitch);

      let tx = pos.x - this.camera.target.x;
      let ty = pos.y - this.camera.target.y;
      let tz = pos.z - this.camera.target.z;

      let rx = tx * cosY - tz * sinY;
      let rz = tx * sinY + tz * cosY;
      let ry = ty * cosP - rz * sinP;
      let rdepth = ty * sinP + rz * cosP + this.camera.distance;

      if (rdepth > 0.1) {
        const sx = (rx / rdepth) * 380 + this.canvas.width / 2;
        const sy = (-ry / rdepth) * 380 + this.canvas.height / 2;
        const d = Math.hypot(mouseX - sx, mouseY - sy);
        if (d < minD) {
          minD = d;
          closest = obj;
        }
      }
    }

    if (closest) {
      this.selectedObjectId = closest.id;
      if (this.selectedBox) this.selectedBox.hidden = false;
      if (this.objName) this.objName.textContent = `${closest.label.toUpperCase()} [${closest.id}]`;
      if (this.objPos) this.objPos.textContent = `Pos: X:${closest.pose3d.position.x}m Y:${closest.pose3d.position.y}m Z:${closest.pose3d.position.z}m`;
      if (this.objDim) this.objDim.textContent = `Dim: ${closest.pose3d.dimensions.dx}×${closest.pose3d.dimensions.dy}×${closest.pose3d.dimensions.dz}m`;
      if (this.objSupport) this.objSupport.textContent = `Supported By: ${closest.spatialRelations?.supportedBy || "Floor"}`;
    } else {
      this.selectedObjectId = null;
      if (this.selectedBox) this.selectedBox.hidden = true;
    }
    this.render();
  }
}

export const spatialWorldModelViewer = new SpatialWorldModelViewer();
if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => spatialWorldModelViewer.init());
}
