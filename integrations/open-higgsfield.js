import { isPublicNetworkHost, safePinnedFetch, safeServiceBase } from "../network-safety.js";

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PROMPT_CHARS = 8_000;
const MAX_MEDIA_URL_CHARS = 2_048;
const MAX_REQUEST_ID_CHARS = 180;
const PAID_CONFIRMATION = "I explicitly approve this OpenHiggsfield generation and authorize use of my configured provider credits.";

const MODELS = [
  { id: "soul-cinema", label: "Soul Cinema", surface: "image", kind: "soul", path: "higgsfield-ai/soul/cinema", roles: {} },
  { id: "soul-2", label: "Soul 2", surface: "image", kind: "soul", path: "higgsfield-ai/soul/v2/standard", roles: {} },
  { id: "seedance-2.5", label: "Seedance 2.5", surface: "video", kind: "seedance", path: "bytedance/seedance-2.5", roles: { start: 1, end: 1, reference: 30, video: 10, audio: 10 } },
  { id: "seedance-2.5-edit", label: "Seedance 2.5 Edit", surface: "video", kind: "seedance-edit", path: "bytedance/seedance-2.5/video-edit", roles: { video: 1, reference: 30, audio: 10 } },
  { id: "seedance-2.5-extend", label: "Seedance 2.5 Extend", surface: "video", kind: "seedance-extend", path: "bytedance/seedance-2.5/video-extend", roles: { video: 1, reference: 30, audio: 10 } },
  { id: "seedance-2", label: "Seedance 2.0", surface: "video", kind: "seedance", path: "bytedance/seedance-2.0", roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 } },
  { id: "seedance-2-fast", label: "Seedance 2.0 Fast", surface: "video", kind: "seedance", path: "bytedance/seedance-2.0/fast", roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 } },
  { id: "seedance-2-mini", label: "Seedance 2.0 Mini", surface: "video", kind: "seedance", path: "bytedance/seedance-2.0/mini", roles: { start: 1, end: 1, reference: 9, video: 3, audio: 3 } },
  { id: "kling-3-turbo", label: "Kling 3.0 Turbo", surface: "video", kind: "kling-turbo", path: "kling-video/v3.0-turbo", roles: { start: 1 } },
  { id: "kling-3-std", label: "Kling 3.0 Standard", surface: "video", kind: "kling-3", path: "kling-video/v3.0/std", roles: { start: 1, end: 1 } },
  { id: "kling-3-pro", label: "Kling 3.0 Pro", surface: "video", kind: "kling-3", path: "kling-video/v3.0/pro", roles: { start: 1, end: 1 } },
  { id: "kling-3-4k", label: "Kling 3.0 4K", surface: "video", kind: "kling-3", path: "kling-video/v3.0/4k", roles: { start: 1, end: 1 } },
  { id: "kling-3-motion-std", label: "Kling 3.0 Motion Control", surface: "video", kind: "motion", path: "kling-video/v3/motion-control/std", roles: { start: 1, video: 1 } },
  { id: "kling-3-motion-pro", label: "Kling 3.0 Motion Control Pro", surface: "video", kind: "motion", path: "kling-video/v3/motion-control/pro", roles: { start: 1, video: 1 } },
  { id: "flux-2", label: "Flux 2", surface: "image", kind: "generic-image", path: "flux-2-pro", roles: { reference: 8 } },
  { id: "grok-imagine-2", label: "Grok Imagine 2.0", surface: "image", kind: "generic-image", path: "xai/grok-imagine-image-2.0", roles: { reference: 8 } },
  { id: "ideogram-4", label: "Ideogram 4.0", surface: "image", kind: "generic-image", path: "ideogram/v4.0", roles: { reference: 8 } },
  { id: "recraft-4.1", label: "Recraft 4.1", surface: "image", kind: "generic-image", path: "recraft/v4.1/text-to-image", roles: { reference: 8 } },
  { id: "qwen-image-3", label: "Qwen Image 3", surface: "image", kind: "generic-image", path: "alibaba/qwen-image-3/text-to-image", roles: { reference: 8 } },
  { id: "z-image-turbo", label: "Z-Image Turbo", surface: "image", kind: "generic-image", path: "z-image/turbo", roles: { reference: 8 } },
  { id: "wan-3", label: "Wan 3.0", surface: "video", kind: "generic-video", path: "alibaba/wan-3.0/text-to-video", imagePath: "alibaba/wan-3.0/image-to-video", roles: { start: 1 } },
  { id: "wan-3-prime", label: "Wan 3.0 Prime", surface: "video", kind: "generic-video", path: "alibaba/wan-3.0-prime/text-to-video", imagePath: "alibaba/wan-3.0-prime/image-to-video", roles: { start: 1 } },
  { id: "wan-2.7", label: "Wan 2.7", surface: "video", kind: "generic-video", path: "wan/v2.7/text-to-video", imagePath: "wan/v2.7/image-to-video", roles: { start: 1 } },
  { id: "wan-2.6", label: "Wan 2.6", surface: "video", kind: "generic-video", path: "wan/v2.6/text-to-video", imagePath: "wan/v2.6/image-to-video", roles: { start: 1 } },
  { id: "flux-3", label: "Flux 3", surface: "video", kind: "generic-video", path: "blackforestlabs/flux-3/text-to-video", imagePath: "blackforestlabs/flux-3/image-to-video", roles: { start: 1 } },
  { id: "minimax-h3", label: "MiniMax H3", surface: "video", kind: "generic-video", path: "minimax/h3/text-to-video", imagePath: "minimax/h3/image-to-video", roles: { start: 1 } },
  { id: "minimax-hailuo-2.3", label: "MiniMax Hailuo 2.3", surface: "video", kind: "generic-video", path: "minimax/hailuo-2.3/standard/text-to-video", imagePath: "minimax/hailuo-2.3/standard/image-to-video", roles: { start: 1 } },
  { id: "happy-horse-1", label: "Happy Horse 1.0", surface: "video", kind: "generic-video", path: "alibaba/happy-horse/text-to-video", imagePath: "alibaba/happy-horse/image-to-video", roles: { start: 1 } },
  { id: "happy-horse-1.1", label: "Happy Horse 1.1", surface: "video", kind: "generic-video", path: "alibaba/happy-horse/v1.1/text-to-video", imagePath: "alibaba/happy-horse/v1.1/image-to-video", roles: { start: 1 } },
  { id: "kling-2.6", label: "Kling 2.6", surface: "video", kind: "generic-video", path: "kling-video/v2.6/pro/text-to-video", imagePath: "kling-video/v2.6/pro/image-to-video", roles: { start: 1 } },
  { id: "kling-2.5", label: "Kling 2.5", surface: "video", kind: "image-video", path: "kling-video/v2.5-turbo/standard/image-to-video", roles: { start: 1 } },
  { id: "kling-o3", label: "Kling O3", surface: "video", kind: "first-last", path: "kling-video/o3/first-last-frame", roles: { start: 1, end: 1 } },
  { id: "kling-o1", label: "Kling O1 (Omni)", surface: "video", kind: "first-last", path: "kling-video/omni/first-last-frame", roles: { start: 1, end: 1 } },
  { id: "ltx-2.5-fast", label: "LTX 2.5 Fast", surface: "video", kind: "generic-video", path: "lightricks/ltx-2.5/text-to-video/fast", imagePath: "lightricks/ltx-2.5/image-to-video/fast", roles: { start: 1 } },
  { id: "ltx-2.5-pro", label: "LTX 2.5 Pro", surface: "video", kind: "generic-video", path: "lightricks/ltx-2.5/text-to-video/pro", imagePath: "lightricks/ltx-2.5/image-to-video/pro", roles: { start: 1 } },
  { id: "grok-imagine-video-1.5", label: "Grok Imagine Video 1.5", surface: "video", kind: "reference-video", path: "xai/grok-imagine-video/v1.5/reference-to-video", roles: { reference: 8, video: 3 } },
  { id: "pixverse-6", label: "PixVerse 6", surface: "video", kind: "generic-video", path: "pixverse/v6/text-to-video", imagePath: "pixverse/v6/image-to-video", roles: { start: 1 } },
  { id: "dop", label: "DoP", surface: "video", kind: "image-video", path: "higgsfield-ai/dop/lite", roles: { start: 1 } }
];

const MODEL_BY_ID = new Map(MODELS.map(model => [model.id, model]));

function bounded(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function configFor(env = process.env, userId = "") {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const base = safeServiceBase(bounded(env.HF_API_BASE_URL, 1000));
  const rawKey = bounded(env.OPEN_HIGGSFIELD_API_KEY, 500);
  const keyValid = /^[A-Za-z0-9_-]{1,120}:[A-Za-z0-9._~!$&'()*+,;=%-]{8,360}$/.test(rawKey);
  const enabled = env.ULTRON_OPEN_HIGGSFIELD_ENABLED === "true";
  const ownerAuthorized = Boolean(ownerId && userId && ownerId === userId);
  const configured = Boolean(enabled && base && keyValid && ownerId);
  return { ownerId, base, apiKey: keyValid ? rawKey : "", enabled, ownerAuthorized, configured };
}

export function getOpenHiggsfieldReadiness(env = process.env, userId = "") {
  const config = configFor(env, userId);
  return {
    configured: config.configured,
    ownerAuthorized: config.ownerAuthorized,
    state: !config.enabled ? "disabled_by_config" : !config.base || !config.apiKey || !config.ownerId ? "missing_configuration" : !config.ownerAuthorized ? "owner_only" : "configured_unverified",
    requiredEnv: ["ULTRON_OPEN_HIGGSFIELD_ENABLED=true", "HF_API_BASE_URL", "OPEN_HIGGSFIELD_API_KEY", "ULTRON_INTEGRATION_OWNER_USER_ID"],
    optionalEnv: [],
    modelCount: MODELS.length,
    endpoint: config.base || null,
    note: !config.enabled
      ? "OpenHiggsfield generation is disabled by default. Enable it only after setting the API endpoint, server-side id:secret platform key, and exact owner UUID."
      : !config.configured
        ? "OpenHiggsfield needs a safe HTTPS API base URL, a server-side platform key in id:secret format, and ULTRON_OPEN_HIGGSFIELD_ENABLED=true."
        : !config.ownerAuthorized
          ? "Configured OpenHiggsfield credentials are restricted to the configured ULTRON owner account."
          : "The endpoint/key format is configured, but provider authentication, model availability, account credits, billing and generated-media quality are not live-verified. Generation requires per-request paid-use confirmation."
  };
}

export function listOpenHiggsfieldModels() {
  return MODELS.map(({ id, label, surface, roles }) => ({
    id,
    label,
    surface,
    mediaRoles: Object.keys(roles)
  }));
}

function requireOwner(config, userId) {
  if (!config.ownerId) throw fail("INTEGRATION_OWNER_NOT_CONFIGURED", "Set ULTRON_INTEGRATION_OWNER_USER_ID before using shared OpenHiggsfield credentials.", 503);
  if (!userId) throw fail("AUTH_REQUIRED", "Sign in before using OpenHiggsfield.", 401);
  if (!config.ownerAuthorized) throw fail("INTEGRATION_OWNER_ONLY", "OpenHiggsfield is restricted to the configured ULTRON owner account.", 403);
  if (!config.enabled || !config.base || !config.apiKey) throw fail("OPEN_HIGGSFIELD_NOT_CONFIGURED", "OpenHiggsfield is disabled or missing its endpoint/platform key configuration.", 503);
}

function validatePublicMediaUrl(value) {
  const raw = bounded(value, MAX_MEDIA_URL_CHARS);
  let url;
  try { url = new URL(raw); } catch { throw fail("OPEN_HIGGSFIELD_MEDIA_URL_INVALID", "Media inputs must be public HTTPS URLs."); }
  if (url.protocol !== "https:" || url.username || url.password || !isPublicNetworkHost(url.hostname) || url.href.length > MAX_MEDIA_URL_CHARS) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_URL_INVALID", "Media inputs must be public HTTPS URLs without embedded credentials.");
  }
  return url.toString();
}

function parseMedia(value, model) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  const allowedRoles = new Set(Object.keys(model.roles));
  for (const role of ["start", "end", "reference", "video", "audio"]) {
    const raw = input[role];
    if (raw === undefined) continue;
    if (!allowedRoles.has(role)) throw fail("OPEN_HIGGSFIELD_MEDIA_ROLE_UNSUPPORTED", "This model does not accept " + role + " media.");
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length > model.roles[role]) throw fail("OPEN_HIGGSFIELD_MEDIA_COUNT_INVALID", "Too many " + role + " media inputs for this model.");
    output[role] = list.map(item => validatePublicMediaUrl(typeof item === "string" ? item : item?.url));
  }
  if (model.surface === "video" && ["kling-3-motion-std", "kling-3-motion-pro"].includes(model.id) && (!output.start?.length || !output.video?.length)) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_REQUIRED", "Motion Control requires a start-image URL and a source-video URL.");
  }
  if (["kling-o1", "kling-o3"].includes(model.id) && !output.start?.length) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_REQUIRED", "This model requires a first-frame image URL.");
  }
  if (["kling-2.5", "dop"].includes(model.id) && !output.start?.length) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_REQUIRED", "This model requires a start-image URL.");
  }
  if (["seedance-2.5-edit", "seedance-2.5-extend"].includes(model.id) && !output.video?.length) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_REQUIRED", "This model requires a source-video URL.");
  }
  if (model.id === "grok-imagine-video-1.5" && !output.reference?.length && !output.video?.length) {
    throw fail("OPEN_HIGGSFIELD_MEDIA_REQUIRED", "This model requires at least one reference image or source-video URL.");
  }
  return output;
}

function parseSettings(value, surface, model) {
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw fail("OPEN_HIGGSFIELD_SETTINGS_INVALID", "settings must be a JSON object.");
  const allowed = new Set(["aspectRatio", "resolution", "duration", "sound", "cfgScale", "multiShots", "keepOriginalSound", "characterOrientation", "batchSize", "enhancePrompt", "generateAudio", "outputFormat"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw fail("OPEN_HIGGSFIELD_SETTING_UNSUPPORTED", "Unsupported setting: " + key);
  const clean = {};
  if (value.aspectRatio !== undefined) {
    const allowedRatios = surface === "image" ? ["auto", "1:1", "4:3", "3:4", "16:9", "9:16"] : ["16:9", "9:16", "1:1"];
    if (!allowedRatios.includes(value.aspectRatio)) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "Unsupported aspect ratio for this model.");
    clean.aspectRatio = value.aspectRatio;
  }
  if (value.resolution !== undefined) {
    if (!["480p", "720p", "1080p", "1k", "2k", "4k"].includes(value.resolution)) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "Unsupported resolution.");
    clean.resolution = value.resolution;
  }
  if (value.duration !== undefined) {
    if (!Number.isFinite(value.duration) || value.duration < 3 || value.duration > 30) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "duration must be between 3 and 30 seconds.");
    clean.duration = value.duration;
  }
  for (const key of ["sound", "multiShots", "keepOriginalSound", "enhancePrompt", "generateAudio"]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean") throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", key + " must be boolean.");
      clean[key] = value[key];
    }
  }
  if (value.cfgScale !== undefined) {
    if (!Number.isFinite(value.cfgScale) || value.cfgScale < 0 || value.cfgScale > 1) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "cfgScale must be between 0 and 1.");
    clean.cfgScale = value.cfgScale;
  }
  if (value.characterOrientation !== undefined) {
    if (!["video", "image"].includes(value.characterOrientation)) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "characterOrientation must be video or image.");
    clean.characterOrientation = value.characterOrientation;
  }
  if (value.batchSize !== undefined) {
    if (model.kind !== "soul" || ![1, 4].includes(value.batchSize)) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "batchSize is supported only for Soul models and must be 1 or 4.");
    clean.batchSize = value.batchSize;
  }
  if (value.outputFormat !== undefined) {
    if (!["mp4", "mov"].includes(value.outputFormat)) throw fail("OPEN_HIGGSFIELD_SETTING_INVALID", "outputFormat must be mp4 or mov.");
    clean.outputFormat = value.outputFormat;
  }
  return clean;
}

function first(media, role) {
  return media[role]?.[0];
}

function baseBody(prompt, settings) {
  return {
    prompt,
    ...(settings.aspectRatio ? { aspect_ratio: settings.aspectRatio } : {}),
    ...(settings.resolution ? { resolution: settings.resolution } : {}),
    ...(settings.duration !== undefined ? { duration: settings.duration } : {})
  };
}

function mapGeneration(model, prompt, media, settings) {
  const start = first(media, "start");
  const end = first(media, "end");
  const refs = media.reference || [];
  const videos = media.video || [];
  const audios = media.audio || [];
  if (model.kind === "soul") {
    return { path: model.path, body: { prompt, batch_size: settings.batchSize || 1, resolution: settings.resolution || "720p", aspect_ratio: settings.aspectRatio || "1:1", enhance_prompt: settings.enhancePrompt === true } };
  }
  if (model.kind === "kling-turbo") {
    return { path: start ? model.path + "/image-to-video" : model.path + "/text-to-video", body: { prompt, duration: settings.duration || 5, resolution: settings.resolution || "720p", ...(start ? { image_url: start } : { aspect_ratio: settings.aspectRatio || "16:9" }) } };
  }
  if (model.kind === "kling-3") {
    const body = { prompt, sound: settings.sound === false ? "off" : "on", duration: settings.duration || 5, cfg_scale: settings.cfgScale ?? 0.5, multi_shots: settings.multiShots === true };
    if (start) return { path: model.path + "/image-to-video", body: { ...body, image_url: start, ...(end ? { last_image_url: end } : {}) } };
    return { path: model.path + "/text-to-video", body: { ...body, aspect_ratio: settings.aspectRatio || "16:9" } };
  }
  if (model.kind === "motion") {
    return { path: model.path, body: { prompt, image_url: start, video_url: first(media, "video"), keep_original_sound: settings.keepOriginalSound === false ? "no" : "yes", character_orientation: settings.characterOrientation || "video" } };
  }
  if (model.kind === "seedance") {
    const common = { prompt, resolution: settings.resolution || "720p", generate_audio: settings.generateAudio !== false, ...(settings.duration !== undefined ? { duration: settings.duration } : {}), ...(settings.outputFormat ? { output_format: settings.outputFormat } : {}) };
    if (start) return { path: model.path + "/image-to-video", body: { ...common, image_url: start, ...(end ? { end_image_url: end } : {}) } };
    if (refs.length || videos.length || audios.length) return { path: model.path + "/reference-to-video", body: { ...common, aspect_ratio: settings.aspectRatio || "16:9", ...(refs.length ? { image_urls: refs } : {}), ...(videos.length ? { video_urls: videos } : {}), ...(audios.length ? { audio_urls: audios } : {}) } };
    return { path: model.path + "/text-to-video", body: { ...common, aspect_ratio: settings.aspectRatio || "16:9" } };
  }
  if (model.kind === "seedance-edit" || model.kind === "seedance-extend") {
    return { path: model.path, body: { ...baseBody(prompt, settings), resolution: settings.resolution || "720p", generate_audio: settings.generateAudio !== false, output_format: settings.outputFormat || "mp4", video_url: first(media, "video"), ...(refs.length ? { image_urls: refs } : {}), ...(videos.length > 1 ? { video_urls: videos.slice(1) } : {}), ...(audios.length ? { audio_urls: audios } : {}) } };
  }
  if (model.kind === "image-video") {
    return { path: model.path, body: { ...baseBody(prompt, settings), image_url: start } };
  }
  if (model.kind === "first-last") {
    return { path: model.path, body: { ...baseBody(prompt, settings), first_frame_url: start, ...(end ? { last_frame_url: end } : {}) } };
  }
  if (model.kind === "reference-video") {
    return { path: model.path, body: { ...baseBody(prompt, settings), ...(refs.length ? { image_urls: refs } : {}), ...(videos.length ? { video_urls: videos } : {}) } };
  }
  if (model.kind === "generic-image") {
    return { path: model.path, body: { ...baseBody(prompt, settings), ...(refs.length ? { image_urls: refs } : {}) } };
  }
  if (model.kind === "generic-video") {
    const path = start && model.imagePath ? model.imagePath : model.path;
    return { path, body: { ...baseBody(prompt, settings), ...(start ? { image_url: start } : {}) } };
  }
  throw fail("OPEN_HIGGSFIELD_MODEL_UNSUPPORTED", "The selected model is not supported by ULTRON's allowlisted request mapper.");
}

async function readLimitedText(response) {
  const contentLength = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel?.(); } catch {}
    throw fail("OPEN_HIGGSFIELD_RESPONSE_TOO_LARGE", "OpenHiggsfield response exceeded ULTRON's size limit.", 502);
  }
  const reader = response.body?.getReader?.();
  if (!reader) throw fail("OPEN_HIGGSFIELD_RESPONSE_UNSAFE", "OpenHiggsfield response could not be size-limited safely.", 502);
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        throw fail("OPEN_HIGGSFIELD_RESPONSE_TOO_LARGE", "OpenHiggsfield response exceeded ULTRON's size limit.", 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

async function requestProvider(config, path, { method = "GET", body, fetchImpl = safePinnedFetch } = {}) {
  const response = await fetchImpl(config.base + path, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: "Key " + config.apiKey,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30_000)
  });
  const raw = await readLimitedText(response);
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw fail("OPEN_HIGGSFIELD_INVALID_RESPONSE", "OpenHiggsfield returned invalid JSON.", 502); }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : response.status === 401 || response.status === 403 ? 502 : 400;
    const code = response.status === 429 ? "OPEN_HIGGSFIELD_RATE_LIMITED" : response.status === 401 || response.status === 403 ? "OPEN_HIGGSFIELD_AUTH_FAILED" : "OPEN_HIGGSFIELD_REQUEST_FAILED";
    throw fail(code, response.status === 429 ? "OpenHiggsfield rate limit reached." : response.status === 401 || response.status === 403 ? "OpenHiggsfield rejected the configured key or access to this model." : "OpenHiggsfield could not process the request.", status);
  }
  return payload;
}

function safeResultUrl(value) {
  if (typeof value !== "string" || value.length > MAX_MEDIA_URL_CHARS) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !isPublicNetworkHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function mapStatus(payload, requestId) {
  const images = Array.isArray(payload?.images) ? payload.images.slice(0, 8).map(item => safeResultUrl(item?.url)).filter(Boolean) : [];
  const videoUrl = safeResultUrl(payload?.video?.url);
  return {
    provider: "open-higgsfield",
    requestId: bounded(payload?.request_id, MAX_REQUEST_ID_CHARS) || requestId,
    status: bounded(payload?.status, 40) || "unknown",
    ...(images.length ? { images } : {}),
    ...(videoUrl ? { video: videoUrl } : {}),
    ...(payload?.error !== undefined ? { errorPresent: true } : {})
  };
}

export async function runOpenHiggsfieldAction({
  env = process.env,
  fetchImpl = safePinnedFetch,
  userId = "",
  action = "readiness",
  model: modelId,
  prompt,
  media,
  settings,
  requestId,
  approvePaidGeneration = false,
  confirmationText = "",
  userPrompt = ""
} = {}) {
  if (action === "catalog") {
    return { provider: "open-higgsfield", modelCount: MODELS.length, models: listOpenHiggsfieldModels(), execution: "static_allowlisted_catalog_only" };
  }
  const config = configFor(env, userId);
  if (action === "readiness") return getOpenHiggsfieldReadiness(env, userId);
  requireOwner(config, userId);
  if (action === "generate") {
    const model = MODEL_BY_ID.get(bounded(modelId, 120));
    if (!model) throw fail("OPEN_HIGGSFIELD_MODEL_INVALID", "Choose one of ULTRON's allowlisted OpenHiggsfield models.");
    const cleanPrompt = bounded(prompt, MAX_PROMPT_CHARS);
    if (cleanPrompt.length < 2) throw fail("OPEN_HIGGSFIELD_PROMPT_REQUIRED", "A generation prompt is required.");
    if (approvePaidGeneration !== true || bounded(confirmationText, 300) !== PAID_CONFIRMATION || !/\b(approve|authorize|confirm)\b[\s\S]{0,100}\b(credits?|paid|billable|generation)\b/i.test(userPrompt)) {
      return {
        state: "approval_required",
        provider: "open-higgsfield",
        model: model.id,
        execution: "not_started",
        requiresUserConfirmation: true,
        confirmationText: PAID_CONFIRMATION,
        message: "No generation was submitted. OpenHiggsfield can consume provider credits; ask explicitly to approve the paid generation before retrying."
      };
    }
    const cleanMedia = parseMedia(media, model);
    const cleanSettings = parseSettings(settings, model.surface, model);
    const mapped = mapGeneration(model, cleanPrompt, cleanMedia, cleanSettings);
    const apiPath = "/" + mapped.path.split("/").map(segment => encodeURIComponent(segment)).join("/");
    const payload = await requestProvider(config, apiPath, { method: "POST", body: mapped.body, fetchImpl });
    const id = bounded(payload?.request_id, MAX_REQUEST_ID_CHARS);
    if (!id || !/^[A-Za-z0-9._:-]{1,180}$/.test(id) || id.includes("..")) {
      throw fail("OPEN_HIGGSFIELD_INVALID_RESPONSE", "OpenHiggsfield did not return a valid request_id.", 502);
    }
    return {
      state: "queued",
      provider: "open-higgsfield",
      model: model.id,
      requestId: id,
      status: bounded(payload?.status, 40) || "queued",
      statusAction: "Call openhiggsfield with action=status and this requestId.",
      notice: "The job was accepted by the upstream provider. Actual cost is not estimated or capped by this adapter; check your provider account's pricing and credit balance."
    };
  }
  if (action === "status") {
    const id = bounded(requestId, MAX_REQUEST_ID_CHARS);
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(id) || id.includes("..")) throw fail("OPEN_HIGGSFIELD_REQUEST_ID_INVALID", "requestId is invalid.");
    const payload = await requestProvider(config, "/requests/" + encodeURIComponent(id) + "/status", { fetchImpl });
    return { state: "status_available", ...mapStatus(payload, id) };
  }
  throw fail("OPEN_HIGGSFIELD_ACTION_INVALID", "Supported actions are catalog, readiness, generate and status.");
}

export const OPEN_HIGGSFIELD_PAID_CONFIRMATION = PAID_CONFIRMATION;
