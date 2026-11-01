/**
 * ULTRON AI — Multimodal Vision Gateway
 * Vision claims are produced only by explicitly injected inference adapters.
 * No image descriptions, detections, scene changes or topology claims are fabricated.
 */
import crypto from "node:crypto";
import { ImageStudioEngine } from "../media/image-studio-engine.js";
import { VideoEditingEngine } from "../media/video-editing-engine.js";
import { openRouterVisionMultimodalRunner, openRouterVisionObjectDetector } from "./openrouter-vision-adapter.js";

export const VISION_SUPPORTED_FORMATS=["image/png","image/jpeg","image/webp","image/gif"];
const DEFAULT_MAX_IMAGE_BYTES=5*1024*1024;
function visionError(code,message){return Object.assign(new Error(message),{code});}
function boundedText(value,max=8000){return typeof value==="string"?value.trim().slice(0,max):"";}
function validBox(box){
 if(!box||typeof box!=="object")return false;
 const values=[box.xMin,box.yMin,box.xMax,box.yMax];
 return values.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&box.xMin<box.xMax&&box.yMin<box.yMax;
}
export class UltronVision{
 constructor(options={}){
  this.imageStudio=options.imageStudio||new ImageStudioEngine();
  this.videoEditor=options.videoEditor||new VideoEditingEngine();
  this.multimodalRunner=typeof options.multimodalRunner==="function"?options.multimodalRunner:
    options.multimodalRunner===false?null:openRouterVisionMultimodalRunner;
  this.objectDetector=typeof options.objectDetector==="function"?options.objectDetector:
    options.objectDetector===false?null:openRouterVisionObjectDetector;
  this.maxImageBytes=Math.max(65536,Math.min(10*1024*1024,Number(options.maxImageBytes)||DEFAULT_MAX_IMAGE_BYTES));
  this.analysisHistory=[];
 }
 inspectImageMetadata(imageData){
  if(typeof imageData!=="string")throw visionError("INVALID_IMAGE_INPUT","Expected a base64 image data URL.");
  const match=/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(imageData);
  if(!match)throw visionError("INVALID_IMAGE_ENCODING","Expected a valid base64 image data URL.");
  const mimeType=match[1].toLowerCase();
  if(!VISION_SUPPORTED_FORMATS.includes(mimeType))throw visionError("UNSUPPORTED_IMAGE_FORMAT","The supplied image format is not supported.");
  const encoded=match[2];
  if(encoded.length%4!==0)throw visionError("INVALID_IMAGE_ENCODING","The image data is not canonical base64.");
  const bytes=Buffer.from(encoded,"base64");
  if(!bytes.length||bytes.toString("base64")!==encoded)throw visionError("INVALID_IMAGE_ENCODING","The image data is not valid canonical base64.");
  if(bytes.byteLength>this.maxImageBytes)throw visionError("IMAGE_TOO_LARGE",`Image exceeds the configured ${this.maxImageBytes} byte limit.`);
  return {mimeType,byteLength:bytes.byteLength,dataUrlPrefix:match[0].slice(0,match[0].indexOf(",")+1)};
 }
 async understandImage(imageData,prompt="Describe the contents of this image.",options={}){
  const meta=this.inspectImageMetadata(imageData);
  const query=boundedText(prompt,2000)||"Describe the image.";
  const runner=typeof options.multimodalRunner==="function"?options.multimodalRunner:this.multimodalRunner;
  if(typeof runner!=="function")throw visionError("VISION_PROVIDER_REQUIRED","No live multimodal vision provider is connected. Configure and inject a verified vision runner before analysing images.");
  const providerResult=await runner(imageData,query,meta);
  if(providerResult==null||(typeof providerResult!=="object"&&typeof providerResult!=="string"))throw visionError("INVALID_VISION_PROVIDER_RESPONSE","The vision provider returned an invalid response.");
  const description=typeof providerResult==="string"?boundedText(providerResult):boundedText(providerResult.description||providerResult.text||providerResult.content);
  const record={id:"vis-"+Date.now()+"-"+crypto.randomBytes(3).toString("hex"),mimeType:meta.mimeType,byteLength:meta.byteLength,
   query,provider:boundedText(options.providerName,100)||"configured-vision-provider",inferenceStatus:"LIVE_INFERENCE",
   result:providerResult,timestamp:new Date().toISOString()};
  if(description)record.description=description;
  this.analysisHistory.push(record);if(this.analysisHistory.length>50)this.analysisHistory.shift();
  return record;
 }
 async detectObjects(imageData,options={}){
  const meta=this.inspectImageMetadata(imageData);
  const detector=typeof options.objectDetector==="function"?options.objectDetector:this.objectDetector;
  if(typeof detector!=="function")throw visionError("VISION_PROVIDER_REQUIRED","No live object-detection provider is connected. Synthetic detections are disabled.");
  const providerResult=await detector(imageData,meta);
  const rawObjects=Array.isArray(providerResult)?providerResult:providerResult&&Array.isArray(providerResult.objects)?providerResult.objects:null;
  if(!rawObjects)throw visionError("INVALID_VISION_PROVIDER_RESPONSE","The object detector did not return an objects array.");
  const objects=rawObjects.slice(0,100).flatMap((item,index)=>{
   if(!item||typeof item!=="object"||!validBox(item.box))return [];
   const label=boundedText(item.label,100);if(!label)return [];
   const confidence=Number.isFinite(item.confidence)&&item.confidence>=0&&item.confidence<=1?item.confidence:undefined;
   return [{id:boundedText(item.id,100)||"provider-object-"+(index+1),label,
    ...(item.category?{category:boundedText(item.category,80)}:{}),...(confidence!==undefined?{confidence}:{}),
    box:{xMin:item.box.xMin,yMin:item.box.yMin,xMax:item.box.xMax,yMax:item.box.yMax}}];
  });
  return {imageMeta:meta,objectCount:objects.length,objects,inferenceStatus:"LIVE_INFERENCE",
   provider:boundedText(options.providerName,100)||"configured-object-detector",timestamp:new Date().toISOString()};
 }
 analyzeVideo(videoMeta={}){
  const durationSec=Number(videoMeta.durationSec),fps=Number(videoMeta.fps);
  if(!Number.isFinite(durationSec)||durationSec<=0||durationSec>3600||!Number.isFinite(fps)||fps<1||fps>120)
   throw visionError("INVALID_VIDEO_METADATA","Provide duration from 0–3600 seconds and FPS from 1–120.");
  const totalFrames=Math.floor(durationSec*fps),intervalSec=Math.max(1,durationSec/4),keyframeSchedule=[];
  for(let time=0;time<durationSec;time+=intervalSec)keyframeSchedule.push({timestampSec:Number(time.toFixed(2)),frameNumber:Math.min(totalFrames-1,Math.floor(time*fps))});
  return {durationSec,fps,totalFrames,keyframeCount:keyframeSchedule.length,keyframeSchedule,analysisStatus:"METADATA_ONLY",
   temporalAnalysisPerformed:false,sceneChanges:null,activityAnalysis:null,
   note:"Metadata-derived keyframe schedule only. Scene changes and activity require actual video frames and a configured video inference adapter.",
   analyzedAt:new Date().toISOString()};
 }
 process3DAsset(assetContent,format="obj"){
  const text=String(assetContent||"").trim();if(!text)throw visionError("EMPTY_3D_ASSET","Empty 3D asset data.");
  const normalizedFormat=String(format).toLowerCase();
  if(!["obj","stl"].includes(normalizedFormat))throw visionError("UNSUPPORTED_3D_FORMAT","Only OBJ and ASCII STL geometry parsing are supported; GLTF topology validation is not implemented here.");
  const vertices=[],faces=[];
  if(normalizedFormat==="obj"){
   for(const line of text.split("\n")){
    const parts=line.trim().split(/\s+/);
    if(parts[0]==="v"){const values=parts.slice(1,4).map(Number);if(values.length===3&&values.every(Number.isFinite))vertices.push({x:values[0],y:values[1],z:values[2]});}
    else if(parts[0]==="f"){const indices=parts.slice(1).map(v=>Number.parseInt(v.split("/")[0],10));if(indices.length>=3&&indices.every(Number.isSafeInteger))faces.push(indices);}
   }
  }else{
   const matches=text.match(/vertex\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/gi)||[];
   for(const item of matches){const values=item.replace(/^vertex\s+/i,"").trim().split(/\s+/).map(Number);if(values.length===3&&values.every(Number.isFinite))vertices.push({x:values[0],y:values[1],z:values[2]});}
  }
  if(!vertices.length)throw visionError("INVALID_3D_GEOMETRY",`No valid vertices could be parsed from ${normalizedFormat.toUpperCase()}.`);
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity,sumX=0,sumY=0,sumZ=0;
  for(const v of vertices){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);sumX+=v.x;sumY+=v.y;sumZ+=v.z;}
  const n=vertices.length,vertexCentroid={x:Number((sumX/n).toFixed(3)),y:Number((sumY/n).toFixed(3)),z:Number((sumZ/n).toFixed(3))};
  const dimensions={dx:Number((maxX-minX).toFixed(3)),dy:Number((maxY-minY).toFixed(3)),dz:Number((maxZ-minZ).toFixed(3))};
  return {format:normalizedFormat,vertexCount:n,faceCount:faces.length,boundingBox:{min:{x:minX,y:minY,z:minZ},max:{x:maxX,y:maxY,z:maxZ}},
   dimensions,boundingVolume:Number((dimensions.dx*dimensions.dy*dimensions.dz).toFixed(4)),vertexCentroid,
   integrity:"geometry_parsed_topology_unverified",topologyVerified:false,processedAt:new Date().toISOString()};
 }
}
export const ultronVision=new UltronVision();
