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


test("Gemini vision fallback activates when GEMINI_API_KEY is configured and OPENROUTER_API_KEY is absent", async () => {
  let captured;
  const env = { GEMINI_API_KEY: "AIzaSyTestKey1234567890abcdefghijkl" };
  const adapter = createOpenRouterVisionAdapter({
    env,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              description: "A laptop and notebook on a desk.",
              scene: "Study workspace.",
              objects: [{ label: "laptop", confidence: 0.95, box: { xMin: 0.2, yMin: 0.3, xMax: 0.7, yMax: 0.8 } }],
              ocrText: "Code",
              ocrClear: true,
              changesDetected: false,
              changeSummary: "Static scene"
            })
          }
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(adapter.isConfigured(), true);
  const result = await adapter.runFrame({ imageData: image, prompt: "Inspect workspace" });
  assert.equal(captured.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(captured.init.headers["Authorization"], "Bearer AIzaSyTestKey1234567890abcdefghijkl");
  assert.equal(captured.init.headers["HTTP-Referer"], undefined);
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "gemini-1.5-flash");
  assert.equal(result.provider, "gemini");
  assert.equal(result.objects[0].label, "laptop");
  assert.equal(result.outputStatus, "STRUCTURED_MODEL_OUTPUT");
});

test("Gemini vision fallback rejects internal OAuth/session tokens", () => {
  const oauthAdapter = createOpenRouterVisionAdapter({ env: { GEMINI_API_KEY: "ya29.a0AfH6SM..." } });
  assert.equal(oauthAdapter.isConfigured(), false);
  const aqAdapter = createOpenRouterVisionAdapter({ env: { GEMINI_API_KEY: "AQ.SessionToken..." } });
  assert.equal(aqAdapter.isConfigured(), false);
});
