import test from "node:test";
import assert from "node:assert/strict";
import { createOpenRouterVisionAdapter } from "../vision/openrouter-vision-adapter.js";

const image="data:image/png;base64,aGVsbG8=";

test("OpenRouter vision adapter requires a server-side key",async()=>{
 const adapter=createOpenRouterVisionAdapter({env:{}});
 assert.equal(adapter.isConfigured(),false);
 await assert.rejects(adapter.runFrame({imageData:image}),e=>e.code==="OPENROUTER_API_KEY_REQUIRED");
});

test("OpenRouter vision adapter sends image only to safe free-model route and parses model result",async()=>{
 let captured;
 const env={OPENROUTER_API_KEY:"test-server-key",OPENROUTER_BASE_URL:"https://openrouter.ai/api/v1",ULTRON_VISION_MODELS:"openrouter/free,paid/model"};
 const adapter=createOpenRouterVisionAdapter({env,fetchImpl:async(url,init)=>{
  captured={url,init};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
   description:"A keyboard is visible.",scene:"A keyboard is visible.",
   objects:[{label:"keyboard",confidence:0.8,box:{xMin:0.1,yMin:0.2,xMax:0.8,yMax:0.7}}],
   ocrText:"",ocrClear:false,changesDetected:null,changeSummary:""
  })}}]}),{status:200,headers:{"content-type":"application/json"}});
 }});
 assert.equal(adapter.isConfigured(),true);
 const result=await adapter.runFrame({imageData:image,prompt:"What is on the desk?"});
 assert.equal(captured.url,"https://openrouter.ai/api/v1/chat/completions");
 const body=JSON.parse(captured.init.body);
 assert.equal(body.model,"openrouter/free");
 assert.equal(body.messages[1].content[1].image_url.url,image);
 assert.equal(result.provider,"openrouter");
 assert.equal(result.objects[0].label,"keyboard");
 assert.equal(result.outputStatus,"STRUCTURED_MODEL_OUTPUT");
 assert.equal(result.coordinateSemantics,"Model-estimated normalized image coordinates; not calibrated physical measurements.");
});

test("OpenRouter vision adapter refuses non-OpenRouter endpoints and paid-only model IDs",()=>{
 const badHost=createOpenRouterVisionAdapter({env:{OPENROUTER_API_KEY:"test",OPENROUTER_BASE_URL:"https://example.com"}});
 assert.equal(badHost.isConfigured(),false);
 const paid=createOpenRouterVisionAdapter({env:{OPENROUTER_API_KEY:"test",ULTRON_VISION_MODELS:"provider/paid-model"}});
 assert.equal(paid.isConfigured(),false);
});
