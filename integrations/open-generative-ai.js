import { safePinnedFetch, safeServiceBase, isPublicNetworkHost } from "../network-safety.js";

const BASE_URL = "https://api.muapi.ai";
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_PROMPT_CHARS = 8_000;
const MAX_URL_CHARS = 2_048;
const MAX_REQUEST_ID = 180;
const PAID_CONFIRMATION = "I explicitly approve this MuAPI image/video generation and authorize use of my configured MuAPI credits.";

const MODELS = [
  { id: "nano-banana", label: "Nano Banana", media: "image-edit", path: "nano-banana", inputField: "image_url", settings: ["aspect_ratio"], ratios: ["1:1","3:4","4:3","9:16","16:9","3:2","2:3","5:4","4:5","21:9"] },
  { id: "nano-banana-pro", label: "Nano Banana Pro", media: "image-edit", path: "nano-banana-pro", inputField: "image_url", settings: ["aspect_ratio","resolution"], ratios: ["1:1","3:4","4:3","9:16","16:9","3:2","2:3","5:4","4:5","21:9"], resolutions: ["1k","2k","4k"] },
  { id: "flux-schnell", label: "Flux Schnell", media: "image", path: "flux-schnell-image", settings: ["width","height","num_images"] },
  { id: "flux-dev", label: "Flux Dev", media: "image", path: "flux-dev", settings: ["width","height","num_images"] },
  { id: "minimax-image-01", label: "MiniMax Image 01", media: "image", path: "minimax-image-01", settings: ["aspect_ratio","num_images"], ratios: ["1:1","2:3","3:2","3:4","4:3","9:16","16:9"] },
  { id: "gpt-image-2", label: "GPT Image 2", media: "image", path: "gpt-image-2-text-to-image", settings: ["aspect_ratio","resolution"], ratios: ["auto","1:1","16:9","9:16","4:3","3:4"], resolutions: ["1K","2K","4K"] },
  { id: "gpt-image-2.5", label: "GPT Image 2.5", media: "image", path: "gpt-image-2.5-flare-text-to-image", settings: ["aspect_ratio","resolution"], ratios: ["auto","1:1","16:9","9:16","4:3","3:4"], resolutions: ["1K","2K","4K"] },
  { id: "gpt-image-2.5-edit", label: "GPT Image 2.5 Edit", media: "image-edit", path: "gpt-image-2.5-flare-image-to-image", inputField: "image_url", settings: ["aspect_ratio","resolution"], ratios: ["auto","1:1","16:9","9:16","4:3","3:4"], resolutions: ["1K","2K","4K"] },
  { id: "gpt4o-text-to-image", label: "GPT-4o Text to Image", media: "image", path: "gpt4o-text-to-image", settings: ["aspect_ratio","num_images"], ratios: ["1:1","2:3","3:2"] },
  { id: "gpt4o-image-to-image", label: "GPT-4o Image Edit", media: "image-edit", path: "gpt4o-image-to-image", inputField: "image_url", settings: ["aspect_ratio"], ratios: ["1:1","2:3","3:2"] },
  { id: "google-imagen4", label: "Google Imagen 4", media: "image", path: "google-imagen4", settings: ["aspect_ratio","num_images"], ratios: ["16:9","9:16","1:1","4:3","3:4"] },
  { id: "google-imagen4-fast", label: "Google Imagen 4 Fast", media: "image", path: "google-imagen4-fast", settings: ["aspect_ratio","num_images"], ratios: ["16:9","9:16","1:1","4:3","3:4"] },
  { id: "google-imagen4-ultra", label: "Google Imagen 4 Ultra", media: "image", path: "google-imagen4-ultra", settings: ["aspect_ratio"], ratios: ["16:9","9:16","1:1","4:3","3:4"] },
  { id: "ideogram-v3-t2i", label: "Ideogram V3", media: "image", path: "ideogram-v3-t2i", settings: ["aspect_ratio","num_images","style","render_speed"], ratios: ["1:1","3:4","4:3","9:16","16:9"], styles: ["Auto","General","Realistic","Design"], renderSpeeds: ["Turbo","Balanced","Quality"] },
  { id: "qwen2-1-text-to-image", label: "Qwen 2.1 Text to Image", media: "image", path: "qwen2-1-text-to-image", settings: ["aspect_ratio"], ratios: ["1:1","3:4","4:3","9:16","16:9"] },
  { id: "qwen2-1-image-to-image", label: "Qwen 2.1 Image Edit", media: "image-edit", path: "qwen2-1-image-to-image", inputField: "image_url", settings: ["aspect_ratio"], ratios: ["1:1","3:4","4:3","9:16","16:9"] },
  { id: "veo3.1-text-to-video", label: "Veo 3.1 Text to Video", media: "video", path: "veo3.1-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p","4k"] },
  { id: "veo3.1-fast-text-to-video", label: "Veo 3.1 Fast", media: "video", path: "veo3.1-fast-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p"] },
  { id: "veo3.1-image-to-video", label: "Veo 3.1 Image to Video", media: "image-video", path: "veo3.1-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p","4k"] },
  { id: "veo3.1-reference-to-video", label: "Veo 3.1 Reference Video", media: "reference-video", path: "veo3.1-reference-to-video", inputField: "images_list", maxImages: 3, settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p"] },
  { id: "seedance-2.5-text-to-video", label: "Seedance 2.5 Text to Video", media: "video", path: "seedance-2.5-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["480p","720p","1080p","4k"] },
  { id: "seedance-2.5-image-to-video", label: "Seedance 2.5 Image to Video", media: "image-video", path: "seedance-2.5-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["480p","720p","1080p","4k"] },
  { id: "seedance-2.5-omni-reference-to-video", label: "Seedance 2.5 Reference Video", media: "reference-video", path: "seedance-2.5-omni-reference-to-video", inputField: "images_list", maxImages: 9, settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["480p","720p","1080p","4k"] },
  { id: "kling-v3.0-pro-text-to-video", label: "Kling 3 Pro", media: "video", path: "kling-v3.0-pro-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p","4k"] },
  { id: "kling-v3.0-pro-image-to-video", label: "Kling 3 Pro Image to Video", media: "image-video", path: "kling-v3.0-pro-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p","4k"] },
  { id: "wan3.0-text-to-video", label: "Wan 3 Text to Video", media: "video", path: "wan3.0-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "wan3.0-image-to-video", label: "Wan 3 Image to Video", media: "image-video", path: "wan3.0-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "wan3.0-reference-to-video", label: "Wan 3 Reference Video", media: "reference-video", path: "wan3.0-reference-to-video", inputField: "images_list", maxImages: 4, settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "wan2.7-video-edit", label: "Wan 2.7 Video Edit", media: "video-edit", path: "wan2.7-video-edit", inputField: "video_url", settings: ["duration","resolution"] , resolutions: ["720p","1080p"] },
  { id: "wan2.7-video-extend", label: "Wan 2.7 Video Extend", media: "video-extend", path: "wan2.7-video-extend", inputField: "video_url", settings: ["duration","resolution"], resolutions: ["720p","1080p"] },
  { id: "ltx-2.5-text-to-video", label: "LTX 2.5 Text to Video", media: "video", path: "ltx-2.5-text-to-video", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "ltx-2.5-image-to-video", label: "LTX 2.5 Image to Video", media: "image-video", path: "ltx-2.5-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "pixverse-v6-t2v", label: "PixVerse 6 Text to Video", media: "video", path: "pixverse-v6-t2v", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["540p","720p","1080p"] },
  { id: "pixverse-v6-i2v", label: "PixVerse 6 Image to Video", media: "image-video", path: "pixverse-v6-i2v", inputField: "image_url", settings: ["aspect_ratio","duration","resolution","generate_audio"], ratios: ["16:9","9:16","1:1"], resolutions: ["540p","720p","1080p"] },
  { id: "openai-sora-2-text-to-video", label: "Sora 2 Text to Video", media: "video", path: "openai-sora-2-text-to-video", settings: ["aspect_ratio","duration","resolution"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "openai-sora-2-image-to-video", label: "Sora 2 Image to Video", media: "image-video", path: "openai-sora-2-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution"], ratios: ["16:9","9:16","1:1"], resolutions: ["720p","1080p"] },
  { id: "minimax-h3-max-text-to-video", label: "MiniMax H3 Max", media: "video", path: "minimax-h3-max-text-to-video", settings: ["aspect_ratio","duration","resolution"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p"] },
  { id: "minimax-h3-max-image-to-video", label: "MiniMax H3 Max Image to Video", media: "image-video", path: "minimax-h3-max-image-to-video", inputField: "image_url", settings: ["aspect_ratio","duration","resolution"], ratios: ["16:9","9:16"], resolutions: ["720p","1080p"] }
];
const MODEL_BY_ID = new Map(MODELS.map(model => [model.id, model]));
const ALLOWED_SETTING_KEYS = new Set(["aspectRatio","resolution","width","height","num_images","quality","strength","seed","negative_prompt","generate_audio","style","render_speed","duration"]);

function bounded(value, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function fail(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function configFor(env = process.env, userId = "") {
  const ownerId = bounded(env.ULTRON_INTEGRATION_OWNER_USER_ID, 100);
  const enabled = env.ULTRON_OPEN_GENERATIVE_AI_ENABLED === "true";
  const apiKey = bounded(env.MUAPI_API_KEY, 1000);
  const configured = Boolean(enabled && apiKey && ownerId);
  return { ownerId, enabled, apiKey, configured, ownerAuthorized: Boolean(ownerId && userId && ownerId === userId) };
}
export function listOpenGenerativeAIModels() {
  return MODELS.map(({id,label,media})=>({id,label,media}));
}
export function getOpenGenerativeAIReadiness(env = process.env, userId = "") {
  const c=configFor(env,userId);
  return {
    configured:c.configured,
    ownerAuthorized:c.ownerAuthorized,
    state:!c.enabled?"disabled_by_config":!c.apiKey||!c.ownerId?"missing_configuration":!c.ownerAuthorized?"owner_only":"configured_unverified",
    requiredEnv:["ULTRON_OPEN_GENERATIVE_AI_ENABLED=true","MUAPI_API_KEY","ULTRON_INTEGRATION_OWNER_USER_ID"],
    modelCount:MODELS.length,
    endpoint:BASE_URL,
    note:!c.enabled
      ?"Open Generative AI/MuAPI is disabled by default."
      :!c.configured
        ?"Provide a server-side MUAPI_API_KEY and ULTRON_INTEGRATION_OWNER_USER_ID, then explicitly enable the adapter."
        :!c.ownerAuthorized
          ?"MuAPI credentials are restricted to the configured ULTRON owner account."
          :"Credentials are configured, but MuAPI account access, live model entitlement, credit balance, generation and output quality remain unverified. Every generation requires per-request paid-use approval; the adapter does not estimate or cap provider cost."
  };
}
function requireOwner(c,userId) {
  if(!c.ownerId) throw fail("INTEGRATION_OWNER_NOT_CONFIGURED","Set ULTRON_INTEGRATION_OWNER_USER_ID before enabling MuAPI.",503);
  if(!userId) throw fail("AUTH_REQUIRED","Sign in before using Open Generative AI.",401);
  if(!c.ownerAuthorized) throw fail("INTEGRATION_OWNER_ONLY","MuAPI credentials are restricted to the configured ULTRON owner account.",403);
  if(!c.configured) throw fail("OPEN_GENERATIVE_AI_NOT_CONFIGURED","MuAPI image/video generation is disabled or missing its server-side key.",503);
}
function validatePublicUrl(value) {
  const raw=bounded(value,MAX_URL_CHARS);
  let u;
  try{u=new URL(raw);}catch{throw fail("MUAPI_MEDIA_URL_INVALID","Media inputs must be public HTTPS URLs.");}
  if(u.protocol!=="https:"||u.username||u.password||!isPublicNetworkHost(u.hostname)) throw fail("MUAPI_MEDIA_URL_INVALID","Media inputs must be public HTTPS URLs without embedded credentials.");
  return u.toString();
}
function validateSettings(value,model) {
  if(value===undefined||value===null)return {};
  if(!value||typeof value!=="object"||Array.isArray(value))throw fail("MUAPI_SETTINGS_INVALID","settings must be a JSON object.");
  const allowed=new Set(model.settings);
  for(const key of Object.keys(value)){
    if(!ALLOWED_SETTING_KEYS.has(key)||!allowed.has(key)) throw fail("MUAPI_SETTING_UNSUPPORTED","Setting "+key+" is not supported by the selected model.");
  }
  const out={};
  if(value.aspectRatio!==undefined) {
    if(!model.ratios?.includes(value.aspectRatio))throw fail("MUAPI_SETTING_INVALID","Unsupported aspect ratio for this model.");
    out.aspect_ratio=value.aspectRatio;
  }
  if(value.resolution!==undefined) {
    if(!model.resolutions?.includes(value.resolution))throw fail("MUAPI_SETTING_INVALID","Unsupported resolution for this model.");
    out.resolution=value.resolution;
  }
  for(const key of ["width","height"]) if(value[key]!==undefined){
    if(!Number.isInteger(value[key])||value[key]<256||value[key]>2048||value[key]%64!==0)throw fail("MUAPI_SETTING_INVALID",key+" must be a multiple of 64 between 256 and 2048.");
    out[key]=value[key];
  }
  if(value.num_images!==undefined){
    if(!Number.isInteger(value.num_images)||value.num_images<1||value.num_images>2)throw fail("MUAPI_SETTING_INVALID","num_images must be 1 or 2 to limit accidental spend.");
    out.num_images=value.num_images;
  }
  if(value.duration!==undefined){
    if(!Number.isFinite(value.duration)||value.duration<3||value.duration>15)throw fail("MUAPI_SETTING_INVALID","duration must be between 3 and 15 seconds.");
    out.duration=value.duration;
  }
  if(value.quality!==undefined){
    if(!["standard","high","hd"].includes(value.quality))throw fail("MUAPI_SETTING_INVALID","Unsupported quality option.");
    out.quality=value.quality;
  }
  if(value.strength!==undefined){
    if(!Number.isFinite(value.strength)||value.strength<0||value.strength>1)throw fail("MUAPI_SETTING_INVALID","strength must be between 0 and 1.");
    out.strength=value.strength;
  }
  if(value.seed!==undefined){
    if(!Number.isInteger(value.seed)||value.seed<0||value.seed>2147483647)throw fail("MUAPI_SETTING_INVALID","seed must be a non-negative 32-bit integer.");
    out.seed=value.seed;
  }
  if(value.negative_prompt!==undefined){
    if(typeof value.negative_prompt!=="string"||value.negative_prompt.length>1500)throw fail("MUAPI_SETTING_INVALID","negative_prompt must be at most 1500 characters.");
    out.negative_prompt=value.negative_prompt;
  }
  if(value.generate_audio!==undefined){
    if(typeof value.generate_audio!=="boolean")throw fail("MUAPI_SETTING_INVALID","generate_audio must be boolean.");
    out.generate_audio=value.generate_audio;
  }
  if(value.style!==undefined){
    if(!model.styles?.includes(value.style))throw fail("MUAPI_SETTING_INVALID","Unsupported style.");
    out.style=value.style;
  }
  if(value.render_speed!==undefined){
    if(!model.renderSpeeds?.includes(value.render_speed))throw fail("MUAPI_SETTING_INVALID","Unsupported render speed.");
    out.render_speed=value.render_speed;
  }
  return out;
}
function buildPayload(model,prompt,media={},settings={}) {
  const body={...settings};
  if(model.media!=="video-extend"&&model.media!=="video-edit"&&model.media!=="image-edit") body.prompt=prompt;
  else if(prompt) body.prompt=prompt;
  const images=Array.isArray(media.imageUrls)?media.imageUrls:media.imageUrl?[media.imageUrl]:[];
  const videos=Array.isArray(media.videoUrls)?media.videoUrls:media.videoUrl?[media.videoUrl]:[];
  const audios=Array.isArray(media.audioUrls)?media.audioUrls:media.audioUrl?[media.audioUrl]:[];
  if(model.media==="image-edit"){
    const url=media.imageUrl||(images[0]);
    if(!url)throw fail("MUAPI_MEDIA_REQUIRED","This model requires a source image URL.");
    if(model.inputField==="images_list")body.images_list=[url,...images.filter(x=>x!==url)].slice(0,model.maxImages||1);
    else body[model.inputField||"image_url"]=url;
  } else if(model.media==="image-video"){
    if(!images.length)throw fail("MUAPI_MEDIA_REQUIRED","This model requires a source image URL.");
    body[model.inputField||"image_url"]=images[0];
  } else if(model.media==="reference-video"){
    if(!images.length)throw fail("MUAPI_MEDIA_REQUIRED","This model requires at least one reference image URL.");
    body[model.inputField||"images_list"]=images.slice(0,model.maxImages||4);
  } else if(model.media==="video-edit"||model.media==="video-extend"){
    if(!videos.length)throw fail("MUAPI_MEDIA_REQUIRED","This model requires a source video URL.");
    body[model.inputField||"video_url"]=videos[0];
  }
  if(audios.length){
    if(audios.length>3)throw fail("MUAPI_MEDIA_COUNT_INVALID","At most three audio reference URLs are allowed.");
    body.audios_list=audios;
  }
  return body;
}
async function readLimitedText(response) {
  const declared=Number(response.headers?.get?.("content-length"));
  if(Number.isFinite(declared)&&declared>MAX_RESPONSE_BYTES){try{await response.body?.cancel?.();}catch{} throw fail("MUAPI_RESPONSE_TOO_LARGE","MuAPI response exceeded ULTRON's size limit.",502);}
  const reader=response.body?.getReader?.();
  if(!reader)throw fail("MUAPI_RESPONSE_UNSAFE","MuAPI response could not be size-limited safely.",502);
  const decoder=new TextDecoder();let size=0,text="";
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_RESPONSE_BYTES){try{await reader.cancel();}catch{}throw fail("MUAPI_RESPONSE_TOO_LARGE","MuAPI response exceeded ULTRON's size limit.",502);}text+=decoder.decode(value,{stream:true});}
    return text+decoder.decode();
  }finally{try{reader.releaseLock();}catch{}}
}
async function requestJson(config,path,{method="GET",body,fetchImpl=safePinnedFetch}={}) {
  const response=await fetchImpl(BASE_URL+path,{
    method,
    headers:{"Accept":"application/json","x-api-key":config.apiKey,...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    redirect:"error",
    signal:AbortSignal.timeout(30_000)
  });
  const raw=await readLimitedText(response);
  let payload;try{payload=raw?JSON.parse(raw):{};}catch{throw fail("MUAPI_INVALID_RESPONSE","MuAPI returned invalid JSON.",502);}
  if(!response.ok){
    if(response.status===401||response.status===403)throw fail("MUAPI_AUTH_FAILED","MuAPI rejected the configured API key or requested endpoint.",502);
    if(response.status===429)throw fail("MUAPI_RATE_LIMITED","MuAPI rate limit reached.",429);
    throw fail("MUAPI_REQUEST_FAILED","MuAPI could not process the request (HTTP "+response.status+").",response.status>=500?502:400);
  }
  return payload;
}
function safeOutputUrl(value) {
  if(typeof value!=="string"||value.length>MAX_URL_CHARS)return null;
  try{const u=new URL(value);if(u.protocol!=="https:"||u.username||u.password||!isPublicNetworkHost(u.hostname))return null;return u.toString();}catch{return null;}
}
function safeRequestId(value) {
  const id=bounded(value,MAX_REQUEST_ID);
  if(!/^[A-Za-z0-9._:-]{1,180}$/.test(id)||id.includes(".."))throw fail("MUAPI_REQUEST_ID_INVALID","MuAPI request ID is invalid.");
  return id;
}
function safeStatusPayload(payload,requestId) {
  const status=bounded(payload?.status,40).toLowerCase();
  if(!["queued","pending","processing","running","completed","succeeded","success","failed","error","canceled","cancelled"].includes(status))throw fail("MUAPI_STATUS_INVALID","MuAPI returned an unknown generation status.",502);
  const raw=payload?.outputs||payload?.output?.urls||payload?.output?.images||[];
  const candidate=Array.isArray(raw)?raw:[raw];
  const urls=candidate.map(x=>typeof x==="string"?x:x?.url).map(safeOutputUrl).filter(Boolean).slice(0,8);
  const url=safeOutputUrl(payload?.url||payload?.output?.url);
  if(url&&!urls.includes(url))urls.unshift(url);
  return {
    provider:"open-generative-ai-muapi",
    requestId,
    status:status==="success"?"completed":status==="cancelled"?"canceled":status,
    ...(urls.length?{outputs:urls}:{}),
    ...(payload?.cost?.refunded===true?{refunded:true}:{}),
    ...(Number.isFinite(payload?.cost?.amount_credits)&&payload.cost.amount_credits>=0?{reportedCredits:payload.cost.amount_credits}:{}),
    ...(status==="failed"||status==="error"?{error:"MuAPI reported that the generation failed. Inspect the provider account for safe diagnostic details."}:{})
  };
}
export const OPEN_GENERATIVE_AI_PAID_CONFIRMATION=PAID_CONFIRMATION;
export function getOpenGenerativeAIReadiness(env=process.env,userId=""){
  const c=configFor(env,userId);
  return {configured:c.configured,ownerAuthorized:c.ownerAuthorized,state:!c.enabled?"disabled_by_config":!c.apiKey||!c.ownerId?"missing_configuration":!c.ownerAuthorized?"owner_only":"configured_unverified",requiredEnv:["ULTRON_OPEN_GENERATIVE_AI_ENABLED=true","MUAPI_API_KEY","ULTRON_INTEGRATION_OWNER_USER_ID"],modelCount:MODELS.length,endpoint:BASE_URL,note:!c.enabled?"MuAPI media integration is disabled by default.":!c.configured?"Provide a server-side MUAPI_API_KEY and the ULTRON integration owner UUID.":!c.ownerAuthorized?"MuAPI credentials are restricted to the configured owner.":"MuAPI credentials are present, but account entitlement, current billing, model access, generation and output quality are not live-verified. Every generation requires explicit approval; actual provider cost is not estimated/capped."};
}
export function listOpenGenerativeAIModels(){return MODELS.map(({id,label,media})=>({id,label,media}));}
export async function runOpenGenerativeAIAction({env=process.env,fetchImpl=safePinnedFetch,userId="",action="readiness",model:modelId,prompt="",media={},settings={},requestId="",approvePaidGeneration=false,confirmationText="",userPrompt=""}={}) {
 if(action==="catalog")return {provider:"open-generative-ai-muapi",modelCount:MODELS.length,models:listOpenGenerativeAIModels(),capabilities:["text-to-image","image-to-image using supplied public image URLs","text-to-video","image-to-video","reference-image-to-video","video-edit and extension for allowlisted models","bounded generation status polling"],execution:"static_model_catalog_only"};
 const config=configFor(env,userId);
 if(action==="readiness")return getOpenGenerativeAIReadiness(env,userId);
 requireOwner(config,userId);
 if(action==="models")return {provider:"open-generative-ai-muapi",models:listOpenGenerativeAIModels(),modelCount:MODELS.length};
 if(action==="generate"){
   const model=MODEL_BY_ID.get(bounded(modelId,160));
   if(!model)throw fail("MUAPI_MODEL_INVALID","Choose a model from ULTRON's fixed allowlisted MuAPI catalog.");
   const cleanPrompt=bounded(prompt,MAX_PROMPT_CHARS);
   if(model.media!=="video-edit"&&model.media!=="video-extend"&&cleanPrompt.length<2)throw fail("MUAPI_PROMPT_REQUIRED","A generation prompt is required for this model.");
   if(cleanPrompt.length===1)throw fail("MUAPI_PROMPT_INVALID","Prompt must be at least two characters.");
   if(approvePaidGeneration!==true||bounded(confirmationText,300)!==PAID_CONFIRMATION||!/\b(approve|authorize|confirm|run|generate)\b[\s\S]{0,120}\b(credits?|paid|billable|image|video|generation|muapi|provider)\b/i.test(userPrompt)){
     return {state:"approval_required",provider:"open-generative-ai-muapi",model:model.id,execution:"not_started",requiresUserConfirmation:true,confirmationText:PAID_CONFIRMATION,message:"No generation was submitted. MuAPI model calls may consume credits; explicitly approve the image/video generation before retrying."};
   }
   const cleanSettings=validateSettings(settings,model);
   const cleanMedia={};
   if(media?.imageUrl)cleanMedia.imageUrl=validatePublicUrl(media.imageUrl);
   if(media?.imageUrls!==undefined){
     if(!Array.isArray(media.imageUrls)||media.imageUrls.length<1||media.imageUrls.length>9)throw fail("MUAPI_MEDIA_COUNT_INVALID","imageUrls must contain 1-9 URLs.");
     cleanMedia.imageUrls=media.imageUrls.map(validatePublicUrl);
   }
   if(media?.videoUrl)cleanMedia.videoUrl=validatePublicUrl(media.videoUrl);
   if(media?.videoUrls!==undefined){
     if(!Array.isArray(media.videoUrls)||media.videoUrls.length<1||media.videoUrls.length>3)throw fail("MUAPI_MEDIA_COUNT_INVALID","videoUrls must contain 1-3 URLs.");
     cleanMedia.videoUrls=media.videoUrls.map(validatePublicUrl);
   }
   if(media?.audioUrls!==undefined){
     if(!Array.isArray(media.audioUrls)||media.audioUrls.length<1||media.audioUrls.length>3)throw fail("MUAPI_MEDIA_COUNT_INVALID","audioUrls must contain 1-3 URLs.");
     cleanMedia.audioUrls=media.audioUrls.map(validatePublicUrl);
   }
   const payload=buildPayload(model,cleanPrompt,cleanMedia,cleanSettings);
   const submission=await requestJson(config,"/api/v1/"+model.path.split("/").map(encodeURIComponent).join("/"),{method:"POST",body:payload,fetchImpl});
   const rawId=submission?.request_id||submission?.id;
   if(!rawId){
     const direct=safeStatusPayload({...submission,status:submission?.status||"completed"}, "direct-result");
     if(direct.status==="completed"&&direct.outputs?.length)return {state:"completed",model:model.id,...direct};
     throw fail("MUAPI_INVALID_RESPONSE","MuAPI did not return a request ID or a validated direct result.",502);
   }
   const id=safeRequestId(rawId);
   const status=bounded(submission?.status,40).toLowerCase();
   if(["completed","succeeded","success"].includes(status)){
     return {state:"completed",model:model.id,...safeStatusPayload(submission,id)};
   }
   return {state:"queued",provider:"open-generative-ai-muapi",model:model.id,requestId:id,status:["queued","pending","processing","running"].includes(status)?status:"queued",statusAction:"Poll the request using action=status and this requestId.",notice:"The job was queued. Actual cost and output quality remain subject to the upstream provider; this adapter does not estimate or cap credits."};
 }
 if(action==="status"){
   const id=safeRequestId(requestId);
   const result=await requestJson(config,"/api/v1/predictions/"+encodeURIComponent(id)+"/result",{fetchImpl});
   return {state:"status_available",...safeStatusPayload(result,id)};
 }
 throw fail("MUAPI_ACTION_INVALID","Supported actions are catalog, readiness, models, generate and status.");
}
