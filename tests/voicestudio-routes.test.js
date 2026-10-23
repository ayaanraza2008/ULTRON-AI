import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createIntegrationRouter } from '../integrations/router.js';

async function serve(env, fetchImpl, run) {
 const app = express(); app.use(express.json({ limit: '20mb' }));
 app.use('/api', createIntegrationRouter({ env, fetchImpl, requireSupabaseUser: (_req,_res,next)=>next() }));
 const server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
 try { await run('http://127.0.0.1:'+server.address().port); } finally { await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve())); }
}

test('VoiceStudio speech returns base64 audio from the fixed provider endpoint', async () => {
 let seen;
 await serve({VOICESTUDIO_BASE_URL:'https://voice.example',VOICESTUDIO_API_KEY:'test-token'}, async (url, options) => { seen={url,options}; return new Response(new Uint8Array([1,2,3]),{status:200,headers:{'Content-Type':'audio/mpeg'}}); }, async base => {
  const response=await fetch(base+'/api/integrations/voicestudio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'Hello',voice:'default'})});
  assert.equal(response.status,200); const body=await response.json(); assert.equal(body.audioBase64,'AQID'); assert.equal(seen.url,'https://voice.example/v1/audio/speech'); assert.equal(seen.options.headers.Authorization,'Bearer test-token');
 });
});

test('VoiceStudio refuses missing configuration and malformed audio', async () => {
 await serve({}, async()=>{throw new Error('unexpected upstream call');}, async base=>{
  const missing=await fetch(base+'/api/integrations/voicestudio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input:'Hello'})}); assert.equal(missing.status,503);
 });
 await serve({VOICESTUDIO_BASE_URL:'https://voice.example'}, async()=>{throw new Error('unexpected upstream call');}, async base=>{
  const bad=await fetch(base+'/api/integrations/voicestudio/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({audioBase64:'AQID',mimeType:'text/plain'})}); assert.equal(bad.status,400);
 });
});
