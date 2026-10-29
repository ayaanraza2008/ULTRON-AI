import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const VIDEO_STAGES = Object.freeze([
  "concepts", "production_plan", "research", "assets", "voiceover", "edit", "approval", "render", "complete"
]);
export const VIDEO_FORMATS = Object.freeze({
  landscape: { width: 1280, height: 720, label: "16:9 · YouTube" },
  portrait: { width: 720, height: 1280, label: "9:16 · Shorts / Reels / TikTok" },
  square: { width: 1080, height: 1080, label: "1:1 · Square" }
});
const REFERENCE_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
  "www.instagram.com", "instagram.com", "instagr.am",
  "www.tiktok.com", "tiktok.com", "vm.tiktok.com",
  "vimeo.com", "www.vimeo.com", "facebook.com", "www.facebook.com"
]);
const FILE_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".ogv", ".avi", ".jpg", ".jpeg", ".png", ".webp", ".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".srt"]);

export function validateReferenceUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: true, url: null };
  if (raw.length > 2048) return { ok: false, error: "Reference URL is too long." };
  let url;
  try { url = new URL(raw.trim()); } catch { return { ok: false, error: "Enter a valid reference URL." }; }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      url.search.length > 1500 || url.hash.length > 500 || !REFERENCE_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, error: "Use a public HTTPS YouTube, Instagram, TikTok, Vimeo, or Facebook video URL without credentials or a custom port." };
  }
  return { ok: true, url: url.toString() };
}

export function validateProjectInput(input = {}) {
  const brief = typeof input.brief === "string" ? input.brief.trim() : "";
  if (brief.length < 8 || brief.length > 4000) return { ok: false, error: "Describe the video in 8–4,000 characters." };
  const reference = validateReferenceUrl(input.referenceUrl || "");
  if (!reference.ok) return reference;
  const format = VIDEO_FORMATS[input.format] ? input.format : "landscape";
  const durationSeconds = Number(input.durationSeconds ?? 60);
  if (!Number.isInteger(durationSeconds) || durationSeconds < 10 || durationSeconds > 180) {
    return { ok: false, error: "Duration must be a whole number from 10 to 180 seconds." };
  }
  const sourceMode = input.sourceMode === "images" ? "images" : "motion";
  return {
    ok: true,
    value: {
      title: (typeof input.title === "string" && input.title.trim() ? input.title.trim() : brief).replace(/[\r\n\t]+/g, " ").slice(0, 100),
      brief, referenceUrl: reference.url, format, durationSeconds, sourceMode
    }
  };
}

export function newProject(input, now = new Date().toISOString()) {
  const validation = validateProjectInput(input);
  if (!validation.ok) throw Object.assign(new Error(validation.error), { code: "VIDEO_PROJECT_INVALID", status: 400 });
  const v = validation.value;
  return {
    id: crypto.randomUUID(), title: v.title, brief: v.brief, referenceUrl: v.referenceUrl,
    format: v.format, durationSeconds: v.durationSeconds, sourceMode: v.sourceMode,
    status: "queued", stage: "concepts", progress: 0, concepts: [], selectedConceptId: null,
    productionPlan: null, scenes: [], assets: [], referenceAnalysis: null, voiceoverFile: null,
    musicFile: null, captionsFile: null, renderFile: null, approved: false, approvedAt: null,
    trackedSpendUsd: 0, toolsUsed: [],
    events: [{ at: now, stage: "concepts", level: "info", message: "Project created. No media has been rendered yet." }],
    createdAt: now, updatedAt: now
  };
}

export function safeAssetFilename(value) {
  const name = typeof value === "string" ? path.basename(value) : "";
  if (!/^[0-9a-f-]{36}\.(mp4|mov|m4v|webm|mkv|ogv|avi|jpg|jpeg|png|webp|wav|mp3|m4a|aac|ogg|flac|srt)$/i.test(name)) return null;
  return FILE_EXTENSIONS.has(path.extname(name).toLowerCase()) ? name : null;
}
export function safeProjectId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? [h, m, r].map(n => String(n).padStart(2, "0")).join(":") : [m, r].map(n => String(n).padStart(2, "0")).join(":");
}

export function makeFallbackConcepts(project) {
  return [
    { id: "concept-1", title: "Cinematic story", angle: "An emotionally driven mini-story with a strong opening hook and memorable final image.", hook: "Open on the most visually intriguing moment, then reveal why it matters.", visualStyle: "Deep contrast, deliberate camera movement, natural textures, restrained typography.", pacing: "Slow opening, faster middle montage, calm final beat.", musicMood: "Minimal cinematic pulse; use licensed or user-supplied music.", estimatedCostUsd: "Local editing is $0; hosted model usage depends on provider terms." },
    { id: "concept-2", title: "Fast visual explainer", angle: "A clear explainer that turns the idea into three concrete visual beats.", hook: "Lead with the biggest question, then make each scene answer it.", visualStyle: "Clean compositions, bold captions, motion cutaways, consistent palette.", pacing: "Short cuts every 2–4 seconds and a slower conclusion.", musicMood: "Light rhythm; use licensed or user-supplied music.", estimatedCostUsd: "Local editing is $0; hosted model usage depends on provider terms." },
    { id: "concept-3", title: "Atmospheric montage", angle: "A mood-first visual essay built around imagery, sound, and concise narration.", hook: "Start with an unusual close-up and a short curiosity-building line.", visualStyle: "Atmospheric light, slow push-ins, match cuts, subtle texture.", pacing: "Measured opening, rising montage, quiet ending.", musicMood: "Ambient and restrained; use licensed or user-supplied music.", estimatedCostUsd: "Local editing is $0; hosted model usage depends on provider terms." }
  ].map(c => ({ ...c, briefSummary: project.brief.slice(0, 90) }));
}

export function makeFallbackScenes(project, concept = null) {
  const total = project.durationSeconds, count = Math.max(4, Math.min(12, Math.ceil(total / 8)));
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const beats = [
    ["Opening hook", "Open with a striking image and a curiosity-building line."],
    ["Set the context", "Show the setting and explain why the subject matters."],
    ["The key idea", "Make the main idea concrete with a clear visual example."],
    ["A closer look", "Move closer, change angle, or reveal a useful detail."],
    ["Build momentum", "Use a quicker visual sequence to develop the idea."],
    ["The reveal", "Show the most satisfying, surprising, or important point."],
    ["What it means", "Connect the visual evidence to a practical takeaway."],
    ["Closing image", "End on a resolved thought and memorable image."]
  ];
  return Array.from({ length: count }, (_, i) => {
    const durationSeconds = base + (remainder-- > 0 ? 1 : 0), beat = beats[Math.min(i, beats.length - 1)];
    return {
      id: "scene-" + (i + 1), title: beat[0], durationSeconds,
      narration: i === 0 ? "Here is the idea behind " + project.title + "." : i === count - 1 ? "That is the point to take with you." : beat[1],
      visual: beat[1], searchQuery: project.brief.slice(0, 100),
      mediaType: project.sourceMode === "images" ? "image" : "video",
      transition: i === 0 ? "fade" : i === count - 1 ? "fade" : "crossfade", status: "needs_asset"
    };
  }).map((scene, i) => ({ ...scene, title: concept && i === 0 ? concept.title + " — " + scene.title : scene.title }));
}

export function normalizeScenes(scenes, project) {
  if (!Array.isArray(scenes) || scenes.length < 2 || scenes.length > 30) return null;
  const clean = [];
  let sum = 0;
  for (let i = 0; i < scenes.length; i++) {
    const raw = scenes[i] || {}, durationSeconds = Number(raw.durationSeconds);
    if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) return null;
    sum += durationSeconds;
    clean.push({
      id: "scene-" + (i + 1), title: String(raw.title || "Scene " + (i + 1)).trim().slice(0, 100),
      durationSeconds, narration: String(raw.narration || "").trim().slice(0, 2500),
      visual: String(raw.visual || "").trim().slice(0, 600),
      searchQuery: String(raw.searchQuery || raw.visual || project.brief).trim().slice(0, 160),
      mediaType: project.sourceMode === "images" ? "image" : (raw.mediaType === "image" ? "image" : "video"),
      transition: ["fade", "crossfade", "cut", "zoom"].includes(raw.transition) ? raw.transition : "crossfade",
      status: "needs_asset"
    });
  }
  if (Math.abs(sum - project.durationSeconds) > Math.max(3, project.durationSeconds * 0.15)) return null;
  return clean;
}

export function buildSrt(scenes) {
  let time = 0;
  const chunks = [];
  const timestamp = seconds => {
    const n = Math.max(0, Math.floor(seconds * 1000));
    const h = String(Math.floor(n / 3600000)).padStart(2, "0");
    const m = String(Math.floor((n % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((n % 60000) / 1000)).padStart(2, "0");
    return h + ":" + m + ":" + s + "," + String(n % 1000).padStart(3, "0");
  };
  for (const scene of scenes) {
    const narration = String(scene.narration || "").trim();
    const pieces = narration.split(/(?<=[.!?])\s+/).filter(Boolean);
    const lines = pieces.length ? pieces : (narration ? [narration] : []);
    const each = Math.max(1, Number(scene.durationSeconds) / Math.max(1, lines.length));
    for (let i = 0; i < lines.length; i++) {
      chunks.push((chunks.length + 1) + "\n" + timestamp(time + i * each) + " --> " + timestamp(time + (i + 1) * each) + "\n" + lines[i].slice(0, 220) + "\n");
    }
    time += Number(scene.durationSeconds) || 0;
  }
  return chunks.join("\n");
}

export function estimateBudget(project) {
  return {
    currency: "USD", trackedSpendUsd: Number(project.trackedSpendUsd || 0), localToolsEstimateUsd: 0,
    note: "Local FFmpeg and operating-system speech tools do not meter usage. Hosted model/API charges and quotas are provider-dependent and are not reported as actual spend here. Verify third-party licenses and terms before production."
  };
}

export function createProjectStore(dataDir = path.resolve(process.cwd(), ".runtime", "video-studio")) {
  const locks = new Map();
  async function ensureProjectDir(id) {
    const valid = safeProjectId(id);
    if (!valid) throw Object.assign(new Error("Project ID is invalid."), { status: 400, code: "VIDEO_PROJECT_ID_INVALID" });
    const dir = path.join(dataDir, valid);
    await fs.mkdir(path.join(dir, "assets"), { recursive: true });
    await fs.mkdir(path.join(dir, "renders"), { recursive: true });
    return dir;
  }
  async function save(project) {
    const dir = await ensureProjectDir(project.id);
    project.updatedAt = new Date().toISOString();
    const target = path.join(dir, "project.json"), temp = target + "." + crypto.randomUUID() + ".tmp";
    await fs.writeFile(temp, JSON.stringify(project, null, 2), { mode: 0o600 });
    await fs.rename(temp, target);
    return project;
  }
  async function get(id) {
    if (!safeProjectId(id)) return null;
    try { return JSON.parse(await fs.readFile(path.join(dataDir, id, "project.json"), "utf8")); }
    catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }
  return {
    dataDir,
    async create(input) { const project = newProject(input); await save(project); return project; },
    get,
    async list() {
      await fs.mkdir(dataDir, { recursive: true });
      const entries = await fs.readdir(dataDir, { withFileTypes: true }), projects = [];
      for (const entry of entries.filter(item => item.isDirectory()).slice(0, 200)) {
        const project = await get(entry.name);
        if (project) projects.push(project);
      }
      return projects.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async update(id, updater) {
      if (!safeProjectId(id)) throw Object.assign(new Error("Project ID is invalid."), { status: 400, code: "VIDEO_PROJECT_ID_INVALID" });
      const previous = locks.get(id) || Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        const project = await get(id);
        if (!project) throw Object.assign(new Error("Project was not found."), { status: 404, code: "VIDEO_PROJECT_NOT_FOUND" });
        const result = typeof updater === "function" ? await updater(project) : { ...project, ...updater };
        return save(result);
      });
      locks.set(id, next);
      try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
    },
    async assetPath(id, filename) {
      const valid = safeProjectId(id), name = safeAssetFilename(filename);
      if (!valid || !name) throw Object.assign(new Error("Asset path is invalid."), { status: 400, code: "VIDEO_ASSET_PATH_INVALID" });
      const dir = await ensureProjectDir(valid);
      return path.join(dir, "assets", name);
    },
    async renderPath(id, filename) {
      const valid = safeProjectId(id), name = typeof filename === "string" && /^[0-9a-f-]{36}\.(mp4|srt|jpg|json)$/i.test(filename) ? filename : null;
      if (!valid || !name) throw Object.assign(new Error("Render path is invalid."), { status: 400, code: "VIDEO_RENDER_PATH_INVALID" });
      const dir = await ensureProjectDir(valid);
      return path.join(dir, "renders", name);
    },
    async projectDir(id) { return ensureProjectDir(id); }
  };
}
