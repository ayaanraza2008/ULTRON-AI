import test from "node:test";
import assert from "node:assert/strict";
import { UltronVision } from "../vision/ultron-vision.js";
const VALID_PNG_BASE64="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("UltronVision validates image data URLs and rejects invalid input",()=>{
 const vision=new UltronVision();
 const meta=vision.inspectImageMetadata(VALID_PNG_BASE64);
 assert.equal(meta.mimeType,"image/png");assert.ok(meta.byteLength>0);
 assert.throws(()=>vision.inspectImageMetadata("https://example.com/photo.jpg"),e=>e.code==="INVALID_IMAGE_ENCODING");
 assert.throws(()=>vision.inspectImageMetadata("data:application/pdf;base64,12345"),e=>e.code==="INVALID_IMAGE_ENCODING");
 assert.throws(()=>vision.inspectImageMetadata("data:image/bmp;base64,12345"),e=>e.code==="UNSUPPORTED_IMAGE_FORMAT");
 assert.throws(()=>vision.inspectImageMetadata("data:image/png;base64,@@@="),e=>e.code==="INVALID_IMAGE_ENCODING");
});
test("UltronVision fails closed when image understanding has no real provider",async()=>{
 await assert.rejects(new UltronVision({multimodalRunner:false}).understandImage(VALID_PNG_BASE64,"Inspect this image."),e=>e.code==="VISION_PROVIDER_REQUIRED");
});
test("UltronVision returns provider-supplied analysis without inventing confidence",async()=>{
 const vision=new UltronVision({multimodalRunner:async(image,prompt,meta)=>{
  assert.equal(image,VALID_PNG_BASE64);assert.equal(prompt,"What is shown?");assert.equal(meta.mimeType,"image/png");
  return {description:"The image contains a red square.",model:"test-vision-model"};
 }});
 const result=await vision.understandImage(VALID_PNG_BASE64,"What is shown?");
 assert.equal(result.inferenceStatus,"LIVE_INFERENCE");assert.equal(result.description,"The image contains a red square.");
 assert.equal(result.result.model,"test-vision-model");assert.equal(Object.hasOwn(result,"confidence"),false);
});
test("UltronVision fails closed when object detection has no real provider",async()=>{
 await assert.rejects(new UltronVision({ objectDetector: false }).detectObjects(VALID_PNG_BASE64),e=>e.code==="VISION_PROVIDER_REQUIRED");
});
test("UltronVision validates provider-returned normalized detections",async()=>{
 const vision=new UltronVision({objectDetector:async()=>({objects:[
  {label:"keyboard",confidence:0.87,box:{xMin:0.1,yMin:0.2,xMax:0.9,yMax:0.8}},
  {label:"invalid-box",confidence:0.99,box:{xMin:0.9,yMin:0.2,xMax:0.1,yMax:0.8}}
 ]})});
 const result=await vision.detectObjects(VALID_PNG_BASE64);
 assert.equal(result.inferenceStatus,"LIVE_INFERENCE");assert.equal(result.objectCount,1);
 assert.equal(result.objects[0].label,"keyboard");assert.equal(result.objects[0].confidence,0.87);
});
test("UltronVision labels video output as metadata-only until real frames are analysed",()=>{
 const result=new UltronVision().analyzeVideo({durationSec:12,fps:30});
 assert.equal(result.totalFrames,360);assert.ok(result.keyframeCount>=4);
 assert.equal(result.keyframeSchedule[0].frameNumber,0);assert.equal(result.analysisStatus,"METADATA_ONLY");
 assert.equal(result.temporalAnalysisPerformed,false);assert.equal(result.sceneChanges,null);
});
test("UltronVision OBJ parsing reports geometry only, not unverified manifold integrity",()=>{
 const sampleObj=`
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 6 7 8
`;
 const result=new UltronVision().process3DAsset(sampleObj,"obj");
 assert.equal(result.vertexCount,8);assert.equal(result.faceCount,2);
 assert.equal(result.boundingVolume,1);assert.deepEqual(result.vertexCentroid,{x:0.5,y:0.5,z:0.5});
 assert.equal(result.integrity,"geometry_parsed_topology_unverified");assert.equal(result.topologyVerified,false);
 assert.throws(()=>new UltronVision().process3DAsset("mesh","gltf"),e=>e.code==="UNSUPPORTED_3D_FORMAT");
});


test("UltronVision reconstruct3DSpatialScene creates a spatial job cleanly", async () => {
  const vision = new UltronVision();
  const validPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const job = await vision.reconstruct3DSpatialScene(validPng, { userId: "vision-test-user" });
  assert.ok(job.jobId.startsWith("spat-job-"));
  assert.ok(["QUEUED", "PROCESSING"].includes(job.status));
});
