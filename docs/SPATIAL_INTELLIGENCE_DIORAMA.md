> **Verification boundary (2026-11-03):** This document describes the spatial integration architecture, not proof of live Diorama inference. The CPU fallback validates image payload metadata only and returns no invented room geometry or objects. Remote worker responses are structurally validated but their GPU/model provenance remains unverified. See [ULTRON_STATUS.md](../ULTRON_STATUS.md) for the release acceptance matrix.

# ULTRON SPATIAL INTELLIGENCE — 3D WORLD MODELING ENGINE
## Research Lineage: Diorama (arXiv:2411.19492 / ICCV 2025 Highlight)

**Architecture Designation:** ULTRON Spatial Intelligence  
**Component:** 3D World Modeling Subsystem (`spatial/`)  
**Core Framework:** Diorama: Unleashing Zero-shot Single-view 3D Scene Modeling  
**Official Repository:** `3dlg-hcvc/diorama` (https://github.com/3dlg-hcvc/diorama)  
**Research Publication:** [arXiv:2411.19492](https://arxiv.org/abs/2411.19492) (ICCV 2025 Highlight)  

---

## 1. EXECUTIVE SUMMARY & SUBSYSTEM IDENTITY

The **ULTRON Spatial Intelligence Engine** is a modular, hardware-aware 3D world modeling capability integrated directly into the ULTRON AI architecture. It empowers ULTRON to construct, reason over, query, and visualize holistic 3D indoor scene models from a single RGB image or user-authorized webcam snapshot.

Rather than running a monolithic, fragile Python GPU stack inside the host environment, ULTRON enforces an **isolated multi-backend execution architecture**:

```
[User Snapshot / Upload] 
         │
         ▼
[ULTRON Eyes Gateway] ──► [Spatial Intelligence Engine]
                                │
               ┌────────────────┴────────────────┐
               ▼                                 ▼
   [Diorama Spatial Adapter]          [3D Scene Graph Model]
               │                                 │
     ┌─────────┼─────────┐                       ├─► [AI Brain Reasoning]
     ▼         ▼         ▼                       ├─► [3D Geometry Exporter]
  [Remote   [Local    [CPU Safe                  │   (OBJ / GLTF / JSON)
   GPU       CUDA      Geometric                 │
   Worker]   Worker]   Fallback]                 ▼
                                         [Spatial World Viewer]
                                         (Interactive Canvas HUD)
```

---

## 2. DIORAMA RESEARCH CAPABILITIES INTEGRATED

Diorama decomposes holistic single-view 3D scene reconstruction into 5 verified sub-pipelines:

### A. Open-World Perception & Object Localization
- Uses **GroundingDINO / OWLv2** for open-vocabulary 2D bounding box detection across open-world categories (tables, chairs, monitors, doors, windows, sofas, cabinets, decor).
- Applies **SAM 2 (Segment Anything Model 2)** for pixel-level zero-shot instance segmentation masks.

### B. Scene Depth & Architecture Estimation
- Employs **Metric3D v2** for metric depth map and surface normal estimation.
- Reconstructs room architecture geometry: floor elevation and bounds, wall planes, ceiling bounds, and total room volume.

### C. 3D Shape Retrieval
- Matches 2D segmented visual crops against CAD model repositories (e.g. Objaverse-LVIS) using multi-view embedding models (**DuoduoCLIP**).
- Associates each detected object with a clean, lightweight 3D CAD mesh rather than noisy, uncalibrated point clouds.

### D. 9-DoF Object Pose Estimation
- Predicts 9 Degrees-of-Freedom bounding orientation:
  - 3D translation ($X, Y, Z$) in camera/world metric coordinates.
  - 3D rotation (roll, pitch, yaw) and quaternion.
  - 3D dimensions ($dx, dy, dz$) representing physical width, height, and depth in meters.

### E. Semantic Layout & Physical Collision Optimization
- Applies physical plausibility and contact constraints:
  - Resolves object-object penetrations and floating artifacts.
  - Infers supporting hierarchies (e.g., monitor supportedBy desk, chair on floor).
  - Confines furniture within estimated room boundaries.

---

## 3. HARDWARE-AWARE ISOLATED EXECUTION ARCHITECTURE

### Host Baseline Profile
- **Processor:** AMD Ryzen 7 5700U (8 Cores, 16 Threads, 1.8–4.3 GHz)
- **Graphics:** Integrated AMD Radeon Graphics (Shared VRAM)
- **Host Memory:** 8 GB DDR4 RAM
- **Storage:** 512 GB NVMe SSD
- **Operating System:** Windows

### Why Diorama Cannot Run Directly on Host APU
The full Diorama research pipeline requires:
- PyTorch 2.5.1 + CUDA 12.1
- xFormers & PyTorch3D
- FAISS-GPU (1.7.4)
- Pretrained model checkpoints:
  - SAM 2.1 (`sam2.1_hiera_large.pt` ~890 MB)
  - DINOv2 (`dinov2_vitl14_pretrain.pth` ~1.2 GB)
  - Metric3D v2 (`metric3d_vit_large` ~1.4 GB)
  - DuoduoCLIP (`Four_1to6F_bs1600_LT6.ckpt` ~1.6 GB)
  - Total weights: ~16–20 GB
  - Required VRAM: Minimum 16 GB dedicated NVIDIA GPU.

### Hardware Isolation Strategy
ULTRON strictly isolates execution through three operational modes:

| Mode | Trigger Condition | Execution Path | Fidelity |
|---|---|---|---|
| **`REMOTE_GPU`** | `DIORAMA_REMOTE_ENDPOINT` configured | DNS-pinned HTTPS call via `safePinnedFetch` to remote GPU worker container | Full CUDA 9-DoF + CAD Retrieval |
| **`LOCAL_GPU`** | NVIDIA GPU with CUDA + weights present | Subprocess execution of `spatial/diorama-worker-bridge.py` in dedicated conda/venv | Full CUDA 9-DoF + CAD Retrieval |
| **`CPU_METADATA_FALLBACK`** | AMD APU / No CUDA / No weights | Native Node.js geometric spatial modeler with honest estimation disclaimers | Real 3D Bounding Scene Graph & Querying |

---

## 4. REST API SPECIFICATION

Mounted under `/api/spatial` with mandatory Supabase user authentication:

| Method | Endpoint | Description | Status Code |
|---|---|---|:---:|
| `GET` | `/api/spatial/status` | Reports hardware capabilities, CUDA status, and worker mode | `200` |
| `POST` | `/api/spatial/jobs` | Submits image payload (`image`: base64 data URL) for 3D reconstruction | `202` |
| `GET` | `/api/spatial/jobs/:id` | Polls reconstruction progress (0% -> 100%) and scene graph | `200` |
| `POST` | `/api/spatial/jobs/:id/cancel`| Cancels in-flight reconstruction job | `200` |
| `DELETE`| `/api/spatial/jobs/:id` | Permanently deletes job and scrubs 3D assets | `200` |
| `GET` | `/api/spatial/jobs/:id/export/:format` | Exports scene as `obj`, `gltf`, or `json` | `200` |
| `POST` | `/api/spatial/jobs/:id/query` | Natural language spatial question answering ("Where is the desk?") | `200` |

---

## 5. AI BRAIN & SPATIAL REASONING INTEGRATION

The spatial intelligence engine connects directly with `core/brain-router.js`:
- Queries containing spatial keywords ("room", "3d", "spatial", "where is", "nearest", "table", "chair", "furniture") are classified into complexity tier `spatial_3d`.
- When an active reconstructed scene is available for the user, `SpatialIntelligenceEngine.prototype.getSpatialBrainContext` injects the verified 3D scene graph as ground truth context into the LLM conversation prompt.
- ULTRON answers spatial questions with exact coordinates ($X, Y, Z$), estimated metric dimensions ($W \times H \times D$), and verified physical support relations.

---

## 6. FRONTEND 3D VIEWER: "SPATIAL WORLD MODEL"

Integrated into `public/index.html` and `public/spatial-viewer.js`:
- Accessible from the main capabilities drawer ("Spatial World Model") and from ULTRON Eyes camera view ("3D SPATIAL MODEL").
- Minimal, cyber-hud aesthetic matching ULTRON's Living Energy Core identity.
- Full interactive 3D Canvas:
  - Orbit controls: Left-click drag to rotate (pitch/yaw), scroll wheel to zoom, Shift-drag to pan.
  - Coordinate axes ($X$=Red, $Y$=Green, $Z$=Blue).
  - 3D floor grid and room boundary planes.
  - 3D wireframe bounding boxes with category color-coding.
  - Interactive selection: Click an object to inspect its 3D position, dimensions, category, and support relations.
  - One-click export to standard **Wavefront OBJ** and **GLTF 2.0**.
  - Integrated natural language question bar.

---

## 7. LICENSE AUDIT & ATTRIBUTION

| Component / Submodule | License | Usage in ULTRON AI |
|---|---|---|
| **Diorama** (`3dlg-hcvc/diorama`) | **MIT License** | Architecture, pipeline decomposition, coordinate conventions |
| **Segment Anything 2 (SAM 2)** | **Apache 2.0 License** | Isolated worker segmentation module |
| **GroundingDINO** | **Apache 2.0 License** | Isolated worker open-vocabulary detection module |
| **Metric3D v2** | **Apache 2.0 License** | Metric depth & normal estimation module |
| **DuoduoCLIP** | **MIT License** | Cross-modal CAD shape retrieval module |
| **Objaverse-LVIS** | **ODC-By 1.0 License** | 3D CAD retrieval reference dataset |

---

## 8. SECURITY & PRIVACY CONTROLS

1. **Strict User Isolation:** Spatial jobs and 3D scene graphs are strictly partitioned by Supabase user ID. Cross-user access returns HTTP 403 Forbidden.
2. **No Persistent Surveillance:** Camera frames are ingested only upon explicit user action ("Capture & Reconstruct in 3D" or manual image upload). Video feeds are never stored.
3. **Temporary Asset Scrubbing:** Subprocess worker bridge cleans up temporary input images and output JSON in `finally` blocks immediately upon completion or cancellation.
4. **Permanent Scrubbing Control:** Users can permanently delete jobs and all associated 3D models at any time via `DELETE /api/spatial/jobs/:id`.
5. **No Secret Leakage:** Remote GPU bearer tokens and internal paths are never returned to client responses or logged.
