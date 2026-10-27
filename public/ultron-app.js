import { createEnergyCore } from "/ultron-core.js";

const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => Array.from(root.querySelectorAll(selector));
const root = $("#viewContent");
const API_BASE = String(window.ULTRON_API_BASE || "/api").replace(/\/+$/, "");
const navTitles = { home:"Command Center", chat:"AI Chat", voice:"Voice Studio", tasks:"Autonomous Tasks", coding:"Coding Agent", research:"Research", files:"Files & Documents", memory:"Memory", integrations:"Integrations", automation:"Automation", security:"Security & Approvals", system:"System Diagnostics", settings:"Settings" };
const defaultCoreSettings = {quality:"balanced",particles:22000,speed:1,scale:1,glow:1,orbit:1,turbulence:.5,reducedMotion:false};
function readCoreSettings(){try{return {...defaultCoreSettings,...JSON.parse(localStorage.getItem("ultron.core.settings")||"{}")}}catch{return {...defaultCoreSettings}}}
const state = {
  view:"home", session:null, health:null, readiness:null, worker:null, capabilities:null,
  models:[], preferences:null, conversations:[], conversationId:null, chatMessages:[], pendingImages:[],
  tasks:[], memory:[], integrations:[], schedules:[], employeeRoles:[], routines:[],
  core:null, coreState:"idle", coreSettings:readCoreSettings(), chatBusy:false, chatAbort:null,
  authMode:"signin", speechRecognition:null, mediaStream:null, speechActive:false, recorder:null, recordedChunks:[], discardRecording:false, audioContext:null, analyser:null, waveformSource:null, audioFrequency:null, audioFrame:0, ttsObjectUrl:null, speechCapabilities:null, voiceStudioSummary:null,
  currentTask:null, currentTaskProgress:null, forceReducedMotion:false
};
class APIError extends Error { constructor(message,status=0,body=null){super(message);this.name="APIError";this.status=status;this.body=body;} }
function esc(value){return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function safeJson(value){try{return JSON.stringify(value,null,2)}catch{return String(value)}}
function apiUrl(path){return API_BASE+(path.startsWith("/")?path:"/"+path)}
async function api(path,options={}){
  const init={...options,credentials:"same-origin",headers:{Accept:"application/json",...(options.headers||{})}};
  if(init.body!==undefined && typeof init.body!=="string"){init.body=JSON.stringify(init.body);init.headers["Content-Type"]="application/json";}
  const response=await fetch(apiUrl(path),init);
  let data=null;const type=response.headers.get("content-type")||"";
  if(type.includes("application/json")){try{data=await response.json()}catch{data=null}}
  else {try{data=await response.text()}catch{data=null}}
  if(!response.ok){const message=data&&data.error&&data.error.message?data.error.message:"Request failed with HTTP "+response.status;throw new APIError(message,response.status,data)}
  return {data,response};
}
function toast(message,type="info"){const region=$("#toastRegion");if(!region)return;const item=document.createElement("div");item.className="toast "+type;item.textContent=String(message);region.append(item);setTimeout(()=>item.remove(),4200);}
function inlineError(target,message){if(!target)return;const box=document.createElement("div");box.className="error-panel";box.textContent=String(message||"The request could not be completed.");target.replaceChildren(box);}
function inlineNotice(target,message,type="success"){if(!target)return;const box=document.createElement("div");box.className=type==="error"?"error-panel":"success-panel";box.textContent=String(message);target.replaceChildren(box);}
function jsonMarkup(value){return '<pre class="task-detail">'+esc(safeJson(value))+'</pre>';}
function fmtDate(value){if(!value)return "—";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});}
function humanStatus(value){const s=String(value||"unknown").toLowerCase();return s.replace(/[_-]+/g," ");}
function statusClass(value){const s=String(value||"").toLowerCase();if(["completed","complete","success","healthy","ready","enabled","online","ok"].includes(s))return "green";if(["failed","error","blocked","offline","disabled"].includes(s))return "red";if(["running","processing","thinking","configured_unverified"].includes(s))return "purple";return "amber";}
function setCoreState(next){
  state.coreState=next;document.body.dataset.coreState=next;
  const footer=$("#footerCoreState");if(footer)footer.textContent="CORE · "+String(next).toUpperCase();
  if(state.core)state.core.setState(next);
  if(next==="success"){setTimeout(()=>{if(state.coreState==="success")setCoreState("idle")},850)}
}
function updateConnection(healthy,detail){
  const dot=$("#connectionDot"),sideDot=$("#sidebarHealthDot"),conn=$("#connectionText"),side=$("#sidebarHealthText");
  if(dot)dot.className="status-dot "+(healthy?"ok":"bad");if(sideDot)sideDot.className="status-dot "+(healthy?"ok":"bad");
  if(conn)conn.textContent=healthy?"API reachable":"API unavailable";if(side)side.textContent=healthy?"API reachable":"API unavailable";
  const footer=$("#footerStatus");if(footer)footer.textContent=healthy?"API REACHABLE":"API UNAVAILABLE";
  if(detail){const box=$("#globalNotice");box.textContent=detail;box.hidden=false}
}
function updateSessionUi(){
  const user=state.session&&state.session.authenticated;
  const email=state.session&&state.session.email;
  const profile=$("#profileName"),sub=$("#profileSub"),sessionText=$("#footerSession");
  if(profile)profile.textContent=email|| (user?"Authenticated session":"Guest session");
  if(sub)sub.textContent=user?"Account session":"Sign in to sync";
  if(sessionText)sessionText.textContent=user?"SESSION AUTHENTICATED":"SESSION NOT VERIFIED";
  const gate=$("#authGate");
  if(state.session&&state.session.configured===true&&!user)gate.hidden=false;else gate.hidden=true;
  if(state.session&&state.session.configured===false){const notice=$("#globalNotice");notice.textContent="Authentication is not configured on the current API. Sign-in features are unavailable until the server auth configuration is completed.";notice.hidden=false}
}
async function refreshHealth(){
  try{const r=await api("/health");state.health=r.data;updateConnection(true); }
  catch(error){state.health=null;updateConnection(false,"The existing ULTRON API did not respond. The interface remains available, but live operations are disabled until connectivity returns.");}
  try{const r=await api("/session");state.session=r.data;updateSessionUi()}
  catch{state.session={authenticated:false,configured:false};updateSessionUi()}
  if(state.session&&state.session.authenticated){
    try{const r=await api("/runtime/readiness");state.readiness=r.data}catch{}
    try{const r=await api("/worker/status");state.worker=r.data&&r.data.worker?r.data.worker:r.data}catch{}
  }
}
function pageHeading(eyebrow,title,subtitle,actions=""){
  return ['<div class="page-heading"><div><span class="eyebrow">',esc(eyebrow),'</span><h1>',esc(title),'</h1><p>',esc(subtitle),'</p></div><div class="heading-actions">',actions,'</div></div>'].join("");
}
function panel(title,subtitle,body,actions=""){
  return ['<section class="panel"><div class="panel-header"><div><div class="panel-title">',esc(title),'</div><div class="panel-subtitle">',esc(subtitle||""),'</div></div>',actions,'</div><div class="panel-body">',body,'</div></section>'].join("");
}
function emptyState(title,description,actionLabel="",action=""){
  return ['<div class="empty-state"><div class="empty-orb" aria-hidden="true">◈</div><h3>',esc(title),'</h3><p>',esc(description),'</p>',actionLabel?'<button class="secondary-button" data-action="'+esc(action)+'">'+esc(actionLabel)+'</button>':"",'</div>'].join("");
}
function homeMarkup(){
  const apiState=state.health?"API REACHABLE":"CHECKING API";
  const account=state.session&&state.session.authenticated?"AUTHENTICATED":"GUEST / NOT VERIFIED";
  const workerState=state.worker&&state.worker.state?humanStatus(state.worker.state).toUpperCase():"NOT VERIFIED";
  return [
    '<div class="home-layout"><section class="core-stage" aria-labelledby="coreHeading">',
    '<div class="core-stage-head"><div><div class="core-overline">ULTRON SYSTEMS / 01</div><div id="coreHeading" class="core-heading">Living Energy Core</div></div>',
    '<div class="core-stage-controls"><button class="icon-button" data-action="core-controls" title="Core settings" aria-label="Open core settings">⚙</button><button class="icon-button" data-action="toggle-fullscreen" title="Toggle visualization focus" aria-label="Toggle visualization focus">⛶</button></div></div>',
    '<div id="coreViewport" class="core-viewport"></div><div class="core-center-label"><strong>ULTRON AI</strong><span id="coreStateLabel">SYSTEM IDLE</span></div>',
    '<div class="home-actions"><button class="core-action" data-nav="chat"><span>◈</span> Ask ULTRON</button><button class="core-action" data-action="new-task"><span>＋</span> Create task</button><button class="core-action" data-nav="voice"><span>〰</span> Voice studio</button></div>',
    '<div class="core-hint">VISUALIZATION STATE FOLLOWS OBSERVED CLIENT EVENTS</div>',
    '<div class="core-telemetry"><div class="core-telemetry-block"><span class="core-telemetry-label">API LINK</span><span id="coreApiStatus" class="core-telemetry-value">',esc(apiState),'</span><span class="core-telemetry-label">SESSION · ',esc(account),'</span></div>',
    '<div class="core-telemetry-block core-telemetry-right"><span class="core-telemetry-label">TASK WORKER</span><span class="core-telemetry-value">',esc(workerState),'</span><span class="core-telemetry-label">STATE SOURCE · SERVER REPORT</span></div></div></section>',
    '<aside class="home-rail"><section class="rail-card"><div class="rail-heading">SYSTEM LINK <span>01</span></div><div class="rail-status"><span class="status-dot '+(state.health?"ok":"warn")+'"></span><div class="rail-status-copy"><strong>',esc(state.health?"API responding":"API not verified"),'</strong><small>',esc(state.health?"GET /api/health":"Waiting for connection"),'</small></div></div><div class="rail-line"></div>',
    '<div class="rail-metric"><span>Account</span><span>',esc(state.session&&state.session.authenticated?"Authenticated":"Not verified"),'</span></div><div class="rail-metric"><span>Model provider</span><span>',esc(state.readiness&&state.readiness.components?((state.readiness.components.find(x=>x.id==="cloud_model")||{}).state||"Unknown"):"Not verified"),'</span></div><div class="rail-metric"><span>Worker</span><span>',esc(workerState),'</span></div>',
    '<button class="rail-button" data-nav="system">Open diagnostics <span>↗</span></button></section>',
    '<section class="rail-card"><div class="rail-heading">QUICK ACCESS <span>02</span></div>',
    '<button class="rail-button" data-nav="chat">New conversation <span>＋</span></button><button class="rail-button" data-nav="tasks">Task monitor <span>↗</span></button><button class="rail-button" data-nav="research">Research console <span>↗</span></button><button class="rail-button" data-nav="memory">User memory <span>↗</span></button></section>',
    '<section class="rail-card"><div class="rail-heading">TRUST BOUNDARY <span>03</span></div><div class="muted" style="font-size:10px;line-height:1.7">Only verified API responses can change operational labels. Missing credentials, workers, or integrations stay marked unavailable.</div><div class="rail-line"></div><span class="pill purple">No simulated telemetry</span></section></aside></div>'
  ].join("");
}
function chatMarkup(){
  return [
    pageHeading("INTERFACE / 02","AI Chat","A real conversation with the configured ULTRON provider. Provider and session errors remain visible.","<button class=\"secondary-button\" data-action=\"new-chat\">＋ New chat</button>"),
    '<div class="chat-layout"><aside class="panel conversation-panel"><div class="panel-header"><div><div class="panel-title">Conversations</div><div class="panel-subtitle">YOUR ACCOUNT HISTORY</div></div><button class="icon-button" data-action="refresh-conversations" aria-label="Refresh conversations">↻</button></div><div id="conversationList" class="conversation-list"><div class="muted" style="padding:12px;font-size:10px">Loading history…</div></div><button class="conversation-new" data-action="new-chat">＋ Start conversation</button></aside>',
    '<section class="panel chat-panel"><div class="chat-topline"><div><div class="panel-title" id="chatTitle">ULTRON · CONVERSATION</div><div class="panel-subtitle" id="chatSubtitle">RESPONSES COME FROM THE CONFIGURED PROVIDER</div></div><div style="display:flex;gap:7px"><select id="modelSelect" class="input-control" aria-label="Choose model" style="width:150px;padding:7px;font-size:10px"><option value="">Default model</option></select><button class="icon-button" id="stop-chat" data-action="stop-chat" title="Cancel current response" aria-label="Cancel current response" disabled>■</button></div></div>',
    '<div id="chatMessages" class="chat-messages"><div class="chat-welcome"><div class="empty-orb">◈</div><h2>What should we work on?</h2><p>Ask a question, draft code, analyze an image, or plan a task. ULTRON only confirms actions that the API actually completes.</p><div class="suggestion-row"><button class="suggestion-chip" data-suggestion="Explain a difficult concept step by step">Explain a concept</button><button class="suggestion-chip" data-suggestion="Help me review this code for bugs and security issues">Review code</button><button class="suggestion-chip" data-suggestion="Research the latest developments and cite sources">Research topic</button></div></div></div>',
    '<div class="chat-composer-wrap"><div id="attachmentChips" class="attachment-chips"></div><form id="chatForm"><div class="composer-box"><textarea id="chatInput" name="message" rows="1" maxlength="12000" placeholder="Message ULTRON… (Shift + Enter for a new line)" aria-label="Message ULTRON"></textarea><div class="composer-toolbar"><div class="composer-tools"><button type="button" class="composer-tool" data-action="attach-images">＋ Image</button><span class="dim" style="font-size:9px">Max 2 images · 4 MB each</span><input id="imageInput" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></div><button id="sendChat" class="composer-send" type="submit" aria-label="Send message">↑</button></div></div><div class="composer-note">AI output can be incorrect. Review important claims and externally consequential actions.</div></form></div></section></div>'
  ].join("");
}
function tasksMarkup(){
  return [
    pageHeading("AGENT / 03","Autonomous Tasks","Monitor actual task records, approval requirements, and reported progress. Task approval does not authorize arbitrary PC commands.","<button class=\"primary-button\" data-action=\"new-task\">＋ New task</button><button class=\"secondary-button\" data-action=\"refresh-tasks\">↻ Refresh</button>"),
    '<div class="grid-3" style="margin-bottom:17px"><div class="metric-card"><div class="metric-top">TOTAL RECORDS <span>01</span></div><div class="metric-value" id="taskMetricTotal">—</div><div class="metric-note">Returned by /api/tasks</div></div><div class="metric-card"><div class="metric-top">RUNNING <span>02</span></div><div class="metric-value" id="taskMetricRunning">—</div><div class="metric-note">Only from actual task status</div></div><div class="metric-card"><div class="metric-top">NEEDS REVIEW <span>03</span></div><div class="metric-value" id="taskMetricReview">—</div><div class="metric-note">Approval or review status</div></div></div>',
    panel("Task queue","LIVE USER-SCOPED RECORDS",'<div id="taskList" class="list-stack"><div class="muted">Loading tasks…</div></div><div id="taskError" style="margin-top:12px"></div>'),
    '<div id="taskDetail" style="margin-top:17px"></div>'
  ].join("");
}
function voiceMarkup(){
  return [
    pageHeading("AUDIO / 04","Voice Studio","Microphone indicators follow actual browser capture. Wake-word detection and background listening are not claimed unless a genuine compatible component is configured.","<button class=\"secondary-button\" data-action=\"refresh-voice\">↻ Check adapters</button>"),
    '<div class=\"grid-2\"><section class=\"panel\"><div class=\"panel-header\"><div><div class=\"panel-title\">Live voice input</div><div class=\"panel-subtitle\">BROWSER SPEECH · OPTIONAL SERVER TRANSCRIPTION</div></div><span id=\"micStatePill\" class=\"pill\">MICROPHONE OFF</span></div><div class=\"panel-body\"><div class=\"voice-core\"><div id=\"voiceOrb\" class=\"voice-orb\" aria-hidden=\"true\"><span></span></div><div id=\"voiceStateText\" class=\"voice-state-text\">Ready when you are</div><p id=\"voiceStateHelp\" class=\"muted\" style=\"font-size:10px;line-height:1.7;text-align:center\">Click start to request microphone access. The browser confirms when speech recognition starts.</p></div><div class=\"form-actions\" style=\"justify-content:center\"><button id=\"startVoice\" class=\"primary-button\" data-action=\"start-voice\">Start listening</button><button id=\"stopVoice\" class=\"secondary-button\" data-action=\"stop-voice\" disabled>Stop</button></div><div id=\"voiceTranscript\" class=\"voice-transcript\" role=\"status\" aria-live=\"polite\"></div><div class=\"divider\"></div><label class=\"field\"><span>Browser speech language</span><select id=\"voiceLocale\" class=\"input-control\"><option value=\"en-IN\">English (India)</option><option value=\"hi-IN\">Hindi</option><option value=\"en-US\">English (US)</option><option value=\"en-GB\">English (UK)</option></select></label><div class=\"divider\"></div><div class=\"panel-title\">Premium transcription (optional)</div><p class=\"field-help\">Record a short clip, then explicitly stop to send it to the configured server transcription adapter. Audio is not sent while you are recording.</p><div id=\"audioWaveform\" class=\"audio-waveform\" hidden aria-hidden=\"true\"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><div id=\"recordingState\" class=\"field-help\" role=\"status\" aria-live=\"polite\">Not recording.</div><div class=\"form-actions\"><button id=\"startRecording\" class=\"secondary-button\" data-action=\"start-recording\">Record for server transcription</button><button id=\"stopRecording\" class=\"primary-button\" data-action=\"stop-recording\" disabled>Stop & transcribe</button></div><div id=\"serverTranscript\" class=\"voice-transcript\" role=\"status\" aria-live=\"polite\"></div></div></section>
    '<section class=\"panel\"><div class=\"panel-header\"><div><div class=\"panel-title\">Speech output</div><div class=\"panel-subtitle\">BROWSER OR CONFIGURED SERVER SPEECH</div></div><span id=\"ttsState\" class=\"pill\">READY</span></div><div class=\"panel-body\"><label class=\"field\"><span>Text to speak</span><textarea id=\"ttsText\" placeholder=\"Type text to read aloud…\" maxlength=\"5000\">ULTRON voice output is ready when initiated by you.</textarea></label><div class=\"form-grid\" style=\"margin-top:14px\"><label class=\"field\"><span>Output engine</span><select id=\"ttsEngine\" class=\"input-control\"><option value=\"browser\">Browser voice · free fallback</option><option value=\"server\" disabled>Configured server voice · unavailable</option></select></label><label class=\"field\"><span>Speed (browser voice)</span><select id=\"ttsRate\" class=\"input-control\"><option value=\"0.8\">0.8×</option><option value=\"1\" selected>1.0×</option><option value=\"1.15\">1.15×</option><option value=\"1.3\">1.3×</option></select></label></div><label class=\"field\" style=\"margin-top:14px\"><span>Browser voice</span><select id=\"ttsVoice\" class=\"input-control\"><option value=\"\">System default</option></select></label><div class=\"form-actions\"><button class=\"secondary-button\" data-action=\"stop-tts\">Stop audio</button><button class=\"primary-button\" data-action=\"speak\">Speak text ↗</button></div><audio id=\"serverTtsAudio\" class=\"server-tts-audio\" controls hidden aria-label=\"Generated speech audio\"></audio><div class=\"divider\"></div><div id=\"voiceAdapterState\" class=\"muted\" style=\"font-size:10px;line-height:1.7\">Checking authenticated speech adapter status…</div><div class=\"rail-line\"></div><div class=\"error-panel\">Wake word: unavailable until a real wake-word engine is connected. This UI does not simulate always-on listening.</div></div></section></div>
  ].join("");
}
function codingMarkup(){
  return [
    pageHeading("ENGINEERING / 05","Coding Agent","Ask for plans, code generation, or review. The backend explicitly does not execute code or modify your repository.","<span class=\"pill amber\">TEXT ASSISTANCE ONLY</span>"),
    '<div class="grid-2"><section class="panel"><div class="panel-header"><div><div class="panel-title">Coding request</div><div class="panel-subtitle">POST /API/CODING/ASSIST</div></div></div><div class="panel-body"><form id="codingForm" class="workspace-layout"><label class="field"><span>Goal</span><textarea name="task" required maxlength="6000" placeholder="Describe the bug, feature, or code you want reviewed…"></textarea></label><div class="form-grid"><label class="field"><span>Mode</span><select name="mode"><option value="plan">Plan</option><option value="generate">Generate code</option><option value="review">Review code</option></select></label><label class="field"><span>Language</span><input name="language" value="JavaScript" maxlength="80"></label></div><label class="field"><span>Code (optional)</span><textarea name="code" class="code-editor" maxlength="16000" placeholder="Paste code to review or modify…"></textarea></label><div class="form-actions"><button class="primary-button" type="submit">Request coding help ↗</button></div></form></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Response and assumptions</div><div class="panel-subtitle">GENERATED CONTENT IS NOT EXECUTED</div></div></div><div id="codingResult" class="panel-body">'+emptyState("No coding request yet","Your API response, chosen provider, and the backend execution warning will appear here after a successful request.")+'</div></section></div>'
  ].join("");
}
function researchMarkup(){
  return [
    pageHeading("INTELLIGENCE / 06","Research Console","Run the existing research endpoint and preserve the result's source attribution. Search snippets are untrusted and should be verified against linked pages.",""),
    '<section class="panel" style="margin-bottom:17px"><div class="panel-header"><div><div class="panel-title">Research query</div><div class="panel-subtitle">POST /API/RESEARCH</div></div><span class="pill purple">SOURCE ATTRIBUTION</span></div><div class="panel-body"><form id="researchForm"><div class="field"><label for="researchQuery">What do you need to research?</label><textarea id="researchQuery" name="query" maxlength="500" required placeholder="Enter a research question, topic, or comparison…"></textarea></div><div class="form-actions"><button class="primary-button" type="submit">Run research ↗</button></div></form><div id="researchNotice" style="margin-top:12px"></div></div></section><div id="researchResults" class="workspace-layout">'+emptyState("No research run yet","Research results and source links will appear only after the backend responds.")+'</div>'
  ].join("");
}
function filesMarkup(){
  return [
    pageHeading("DOCUMENTS / 07","Files & Documents","The current backend supports bounded, transient text extraction. It does not provide persistent cloud uploads or a durable document library.",""),
    '<div class="grid-2"><section class="panel"><div class="panel-header"><div><div class="panel-title">Extract document text</div><div class="panel-subtitle">TRANSIENT PROCESSING · NO PERSISTENT STORAGE</div></div></div><div class="panel-body"><form id="documentForm" class="workspace-layout"><label class="field"><span>Choose a file</span><input id="documentFile" name="file" type="file" accept=".txt,.md,.csv,.json,.html,.pdf,.docx" required><small class="field-help">Supported: TXT, Markdown, CSV, JSON, HTML, PDF and DOCX. PDF/DOCX limit is 5 MB; other text is limited by the current extraction endpoint.</small></label><div class="form-actions"><button class="primary-button" type="submit">Extract text ↗</button></div></form><div id="documentNotice" style="margin-top:12px"></div></div></section><section class="panel"><div class="panel-header"><div><div class="panel-title">Processing result</div><div class="panel-subtitle">RETURNED BY /API/DOCUMENTS/EXTRACT</div></div></div><div id="documentResult" class="panel-body">'+emptyState("No file processed","Choose a supported file and submit it to the existing extraction API.")+'</div></section></div>',
    '<div style="margin-top:17px" class="error-panel">Privacy boundary: extracted document text is sent to the ULTRON API for this request. This interface does not imply that a persistent file upload or file library exists.</div>'
  ].join("");
}
function memoryMarkup(){
  return [
    pageHeading("PERSONALIZATION / 08","Memory & Knowledge","Manage user-owned memory items returned by the existing API. Only account-scoped records are shown.","<button class=\"primary-button\" data-action=\"new-memory\">＋ Add memory</button><button class=\"secondary-button\" data-action=\"refresh-memory\">↻ Refresh</button>"),
    panel("Saved memory","USER-OWNED RECORDS",'<div id="memoryList" class="list-stack"><div class="muted">Loading memory…</div></div><div id="memoryError" style="margin-top:12px"></div>'),
    '<div class="field-help" style="margin-top:13px">Memory deletion and deactivation use explicit user actions. Memory is untrusted context and does not override system policies.</div>'
  ].join("");
}
function integrationsMarkup(){
  return [
    pageHeading("ECOSYSTEM / 09","Integrations","Live status comes from authenticated backend adapters. Optional or owner-restricted tools may remain unavailable until separately configured.","<button class=\"secondary-button\" data-action=\"refresh-integrations\">↻ Refresh connections</button>"),
    '<div id="integrationSummary" class="grid-3" style="margin-bottom:17px"><div class="metric-card"><div class="metric-top">CATALOG</div><div class="metric-value">—</div><div class="metric-note">Loading returned adapters…</div></div></div>',
    panel("Connected services","STATUS FROM THE EXISTING API",'<div id="integrationList" class="list-stack"><div class="muted">Loading integration catalog…</div></div><div id="integrationError" style="margin-top:12px"></div>')
  ].join("");
}
function automationMarkup(){
  return [
    pageHeading("SCHEDULER / 10","Automation","Schedules are limited to plans, drafts, reviews, and reports. A saved schedule is not proof that the worker is running or that a routine completed.","<button class=\"primary-button\" data-action=\"new-schedule\">＋ New schedule</button><button class=\"secondary-button\" data-action=\"refresh-schedules\">↻ Refresh</button>"),
    '<div id="schedulerStatus" style="margin-bottom:14px"></div>',
    panel("Scheduled routines","USER-OWNED SCHEDULES",'<div id="scheduleList" class="list-stack"><div class="muted">Loading schedules…</div></div><div id="scheduleError" style="margin-top:12px"></div>'),
    '<div class="field-help" style="margin-top:13px">Supported automation is intentionally narrow. The backend explicitly states that scheduled routines do not send, publish, spend, execute commands, or control devices.</div>'
  ].join("");
}
function securityMarkup(){
  return [
    pageHeading("TRUST / 11","Security & Approvals","Review only the security and task data the current API exposes. Sensitive actions stay behind existing authorization and confirmation gates.","<button class=\"secondary-button\" data-action=\"refresh-security\">↻ Refresh</button>"),
    '<div class="grid-2"><div id="securityReadiness">'+panel("Auth & runtime readiness","CONFIGURATION IS NOT LIVE VERIFICATION",'<div class="muted">Loading verified response fields…</div>')+'</div><div id="securityTasks">'+panel("Tasks awaiting review","USER-SCOPED RECORDS",'<div class="muted">Loading actual task records…</div>')+'</div></div>',
    '<div class="error-panel" style="margin-top:17px">Known security limitations remain: two-account RLS isolation still needs live E2E verification; leaked-password protection requires owner-side Supabase configuration; DNS validation does not alone eliminate DNS-rebinding risk. The UI cannot repair or declare these complete.</div>'
  ].join("");
}
function systemMarkup(){
  return [
    pageHeading("OBSERVABILITY / 12","System Diagnostics","Only real API response fields are shown. No fabricated uptime, CPU values, queue lengths, or provider success rates.","<button class=\"secondary-button\" data-action=\"refresh-system\">↻ Refresh diagnostics</button>"),
    '<div id="systemMetrics" class="grid-3" style="margin-bottom:17px"><div class="metric-card"><div class="metric-top">API</div><div class="metric-value">…</div><div class="metric-note">Reading /api/health</div></div></div>',
    '<div class="grid-2"><div id="systemReadiness">'+panel("Runtime readiness","CONFIGURATION SNAPSHOT",'<div class="muted">Loading…</div>')+'</div><div id="systemWorker">'+panel("Task worker","LIVE WORKER STATUS",'<div class="muted">Loading…</div>')+'</div></div>',
    '<div id="systemRaw" style="margin-top:17px"></div>'
  ].join("");
}
function settingsMarkup(){
  return [
    pageHeading("CONTROL / 13","Settings & Models","Change supported account preferences and local visual effects. Provider credentials remain server-side and are never requested here.",""),
    '<div class=\"grid-2\"><section class=\"panel\"><div class=\"panel-header\"><div><div class=\"panel-title\">Assistant preferences</div><div class=\"panel-subtitle\">SAVED TO THE AUTHENTICATED ACCOUNT</div></div></div><div class=\"panel-body\"><form id=\"preferencesForm\" class=\"workspace-layout\"><label class=\"field\"><span>Assistant language / voice locale</span><select name=\"voice_input_locale\"><option value=\"en-IN\">English (India)</option><option value=\"hi-IN\">Hindi (India)</option><option value=\"hinglish\">Hinglish</option></select></label><div class=\"toggle-row\"><div class=\"toggle-copy\"><strong>Voice features enabled</strong><small>Preference only; actual browser/provider availability is still checked at runtime.</small></div><label class=\"switch\"><input name=\"voice_enabled\" type=\"checkbox\"><span></span></label></div><div class=\"toggle-row\"><div class=\"toggle-copy\"><strong>Memory retrieval enabled</strong><small>Allows the backend to retrieve user-approved memory where configured.</small></div><label class=\"switch\"><input name=\"memory_enabled\" type=\"checkbox\"><span></span></label></div><div class=\"form-actions\"><button class=\"primary-button\" type=\"submit\">Save preferences ↗</button></div><div id=\"preferencesNotice\"></div></form></div></section>',
    '<section class="panel"><div class="panel-header"><div><div class="panel-title">Model availability</div><div class="panel-subtitle">SERVER DISCOVERY · NOT A LIVE INFERENCE TEST</div></div><button class="icon-button" data-action="refresh-models" aria-label="Refresh models">↻</button></div><div id="modelList" class="panel-body"><div class="muted">Loading model list…</div></div></section></div>',
    '<section class="panel" style="margin-top:17px"><div class="panel-header"><div><div class="panel-title">Living Energy Core</div><div class="panel-subtitle">PERFORMANCE AND ACCESSIBILITY CONTROLS</div></div><span id="coreRenderBadge" class="pill">RENDERER NOT CHECKED</span></div><div class="panel-body"><form id="coreSettingsForm"><div class="field"><label for="coreQuality">Quality preset</label><select id="coreQuality" name="quality" class="input-control"><option value="eco">Eco · integrated graphics / mobile</option><option value="balanced">Balanced</option><option value="high">High · capable devices</option></select></div><div class="quality-control"><label for="particleDensity">Particle density</label><input id="particleDensity" name="particles" type="range" min="4000" max="60000" step="1000"><output id="particleDensityOutput" for="particleDensity">22,000</output></div><div class="quality-control"><label for="coreSpeed">Animation speed</label><input id="coreSpeed" name="speed" type="range" min="0" max="2" step=".1"><output id="coreSpeedOutput" for="coreSpeed">1.0×</output></div><div class="quality-control"><label for="coreScale">Core scale</label><input id="coreScale" name="scale" type="range" min=".65" max="1.45" step=".05"><output id="coreScaleOutput" for="coreScale">1.00×</output></div><div class="quality-control"><label for="coreGlow">Glow intensity</label><input id="coreGlow" name="glow" type="range" min="0" max="1.5" step=".05"><output id="coreGlowOutput" for="coreGlow">1.00×</output></div><div class="quality-control"><label for="coreOrbit">Orbital intensity</label><input id="coreOrbit" name="orbit" type="range" min="0" max="1.5" step=".05"><output id="coreOrbitOutput" for="coreOrbit">1.00×</output></div><div class="quality-control"><label for="coreTurbulence">Turbulence</label><input id="coreTurbulence" name="turbulence" type="range" min="0" max="1.5" step=".05"><output id="coreTurbulenceOutput" for="coreTurbulence">0.50</output></div><div class="toggle-row"><div class="toggle-copy"><strong>Reduced motion</strong><small>Respect motion sensitivity and reduce continuous movement.</small></div><label class="switch"><input id="coreReducedMotion" name="reducedMotion" type="checkbox"><span></span></label></div><div class="form-actions"><button type="button" class="secondary-button" data-action="reset-core-settings">Reset defaults</button><button type="submit" class="primary-button">Apply visualization settings</button></div><div id="coreSettingsNotice" style="margin-top:12px"></div></form></div></section>',
    '<div class="field-help" style="margin-top:13px">The WebGL core uses a pinned remote Three.js ES module; if the module or WebGL fails, the UI falls back to a simpler canvas visualization. Reduced-motion and lower-quality settings help on integrated GPUs.</div>'
  ].join("");
}
function renderView(view=state.view){
  if(!navTitles[view])view="home";
  if(state.core && view!=="home"){state.core.dispose();state.core=null}
  state.view=view;root.innerHTML=({home:homeMarkup,chat:chatMarkup,voice:voiceMarkup,tasks:tasksMarkup,coding:codingMarkup,research:researchMarkup,files:filesMarkup,memory:memoryMarkup,integrations:integrationsMarkup,automation:automationMarkup,security:securityMarkup,system:systemMarkup,settings:settingsMarkup}[view]||homeMarkup)();
  $("#workspaceTitle").textContent=navTitles[view];
  $$("[data-nav]").forEach(btn=>{if(btn.dataset.nav===view){btn.classList.add("active");btn.setAttribute("aria-current","page")}else{btn.classList.remove("active");btn.removeAttribute("aria-current")}});
  $("#footerCoreState").textContent="CORE · "+state.coreState.toUpperCase();
  document.body.classList.remove("mobile-nav-open");
  if(view==="home")setupCore();
  if(view==="chat")setupChat();
  if(view==="voice")setupVoice();
  if(view==="tasks")loadTasks();
  if(view==="memory")loadMemory();
  if(view==="integrations")loadIntegrations();
  if(view==="automation")loadAutomation();
  if(view==="security")loadSecurity();
  if(view==="system")loadSystem();
  if(view==="settings")loadSettings();
}
async function setupCore(){
  const host=$("#coreViewport");if(!host)return;
  try{
    const instance=await createEnergyCore(host,status=>{
      if(status.available){const badge=$("#coreRenderBadge");if(badge){badge.textContent=status.renderer+" · "+(status.quality||"ready");badge.className="pill green"}}
      else {const badge=$("#coreRenderBadge");if(badge){badge.textContent=status.fallback?"CANVAS FALLBACK":"WEBGL DEGRADED";badge.className="pill amber"}}
      if(status.reason&&state.view==="home"){const label=$("#coreStateLabel");if(label)label.textContent="REDUCED VISUAL MODE";if(status.fallback)$("#coreApiStatus")?.setAttribute("title",status.reason)}
    },state.coreSettings);
    if(host.isConnected&&state.view==="home"){state.core=instance;instance.setState(state.coreState)}
    else instance.dispose();
  }catch{const label=$("#coreStateLabel");if(label)label.textContent="VISUALIZATION UNAVAILABLE"}
}
function setCoreLabel(){const label=$("#coreStateLabel");if(label)label.textContent=state.coreState.replace(/_/g," ").toUpperCase();}
function updateTaskCount(){const el=$("#taskCount");if(!el)return;const running=state.tasks.filter(t=>["running","queued","pending"].includes(String(t.status||"").toLowerCase())).length;el.hidden=!running;el.textContent=String(running);}
function renderChatMessages(){
  const area=$("#chatMessages");if(!area)return;
  if(!state.chatMessages.length){area.innerHTML='<div class="chat-welcome"><div class="empty-orb">◈</div><h2>What should we work on?</h2><p>Ask a question, draft code, analyze an image, or plan a task. ULTRON only confirms actions that the API actually completes.</p><div class="suggestion-row"><button class="suggestion-chip" data-suggestion="Explain a difficult concept step by step">Explain a concept</button><button class="suggestion-chip" data-suggestion="Help me review this code for bugs and security issues">Review code</button><button class="suggestion-chip" data-suggestion="Research the latest developments and cite sources">Research topic</button></div></div>';return}
  area.innerHTML=state.chatMessages.map((m,i)=>messageMarkup(m,i)).join("");
  area.scrollTop=area.scrollHeight;
}
function markdownSafe(raw){
  const text=String(raw??"");const pieces=text.split(/(```[\s\S]*?```)/g);
  return pieces.map(piece=>{
    if(piece.startsWith("\`\`\`")&&piece.endsWith("\`\`\`")){
      const inner=piece.slice(3,-3);const first=inner.indexOf("\n");const language=first>=0?inner.slice(0,first).trim():"";const code=first>=0?inner.slice(first+1):inner;
      return '<pre><code data-language="'+esc(language)+'">'+esc(code)+'</code></pre>';
    }
    let html=esc(piece);
    html=html.replace(/`([^`\n]+)`/g,"<code>$1</code>");
    html=html.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
    html=html.replace(/(^|\n)\s*[-*] (.+)/g,"$1• $2");
    return html.split(/\n{2,}/).map(p=>'<p>'+p.replace(/\n/g,"<br>")+'</p>').join("");
  }).join("");
}
function messageMarkup(message,index){
  const role=message.role==="user"?"user":"assistant";const who=role==="user"?"YOU":"ULTRON";
  return ['<article class="message ',role,'" data-message-index="',index,'"><div class="message-avatar" aria-hidden="true">',role==="user"?"Y":"U",'</div><div class="message-body"><div class="message-meta"><span>',who,'</span><span>·</span><span>',esc(message.timeLabel||"Conversation"),'</span></div><div class="message-text">',markdownSafe(message.content||""),'</div>',role==="assistant"?'<div class="message-actions"><button type="button" data-action="copy-message" data-message-index="'+index+'">Copy response</button></div>':"",'</div></article>'].join("");
}
async function setupChat(){
  renderChatMessages();renderAttachmentChips();
  const area=$("#chatMessages");
  if(state.session&&state.session.authType==="supabase"&&state.session.authenticated){
    try{const r=await api("/conversations");state.conversations=r.data.conversations||[];renderConversationList();if(state.conversationId){await loadConversationMessages(state.conversationId)}}
    catch(error){const list=$("#conversationList");if(list)list.innerHTML='<div class="field-help" style="padding:12px">History is unavailable: '+esc(error.message)+'</div>'}
  }else{renderConversationList();if(area&&!state.chatMessages.length){const hint=document.createElement("p");hint.className="composer-note";hint.textContent="History sync requires an authenticated Supabase account. Chat requests use the existing API session when configured.";area.append(hint)}}
  try{const r=await api("/models");state.models=r.data.models||[];const select=$("#modelSelect");if(select){select.innerHTML='<option value="">Default model</option>'+state.models.map(m=>'<option value="'+esc(typeof m==="string"?m:m.id||m.name)+'">'+esc(typeof m==="string"?m:m.label||m.id||m.name)+'</option>').join("");if(r.data.defaultModel)select.value=r.data.defaultModel}}catch{}
}
function renderConversationList(){
  const list=$("#conversationList");if(!list)return;
  if(!state.session||state.session.authType!=="supabase"||!state.session.authenticated){list.innerHTML='<div class="field-help" style="padding:12px">Sign in with an account to load or save conversation history.</div>';return}
  if(!state.conversations.length){list.innerHTML='<div class="field-help" style="padding:12px">No saved conversations yet.</div>';return}
  list.innerHTML=state.conversations.map(c=>'<button class="conversation-item '+(c.id===state.conversationId?"active":"")+'" data-action="open-conversation" data-id="'+esc(c.id)+'"><strong>'+esc(c.title||"Untitled conversation")+'</strong><small>'+esc(fmtDate(c.updated_at||c.created_at))+'</small></button>').join("");
}
async function loadConversationMessages(id){
  try{const r=await api("/conversations/"+encodeURIComponent(id)+"/messages");state.conversationId=id;state.chatMessages=(r.data.messages||[]).map(m=>({role:m.role==="user"?"user":"assistant",content:typeof m.content==="string"?m.content:safeJson(m.content),timeLabel:fmtDate(m.created_at)}));renderChatMessages();renderConversationList();const current=state.conversations.find(c=>c.id===id);const title=$("#chatTitle");if(title)title.textContent=current?.title||"ULTRON · CONVERSATION"}
  catch(error){toast("Could not load this conversation: "+error.message,"error")}
}
function renderAttachmentChips(){
  const host=$("#attachmentChips");if(!host)return;
  host.innerHTML=state.pendingImages.map((f,i)=>'<span class="pill purple">'+esc(f.name)+' <button class="text-button" type="button" data-action="remove-image" data-index="'+i+'" aria-label="Remove '+esc(f.name)+'">×</button></span>').join("");
}
async function persistMessage(role,content){
  if(!state.session||state.session.authType!=="supabase"||!state.session.authenticated)return;
  if(!state.conversationId){const created=await api("/conversations",{method:"POST",body:{title:String(content||"New conversation").slice(0,70)}});state.conversationId=created.data.conversation.id;state.conversations.unshift(created.data.conversation);}
  await api("/conversations/"+encodeURIComponent(state.conversationId)+"/messages",{method:"POST",body:{role,content}});
}
async function streamChat(messages,model,attachments,onDelta,signal){
  const response=await fetch(apiUrl("/chat"),{method:"POST",credentials:"same-origin",headers:{"Accept":"text/event-stream, application/json","Content-Type":"application/json"},signal,body:JSON.stringify({messages,stream:true,persona:"ultron",...(model?{model}:{}),attachments})});
  if(!response.ok){let body={};try{body=await response.json()}catch{}throw new APIError(body?.error?.message||"Chat request failed with HTTP "+response.status,response.status,body)}
  const reader=response.body?.getReader?.();if(!reader)throw new APIError("Streaming is not supported by this response.",502);
  const decoder=new TextDecoder();let buffer="",full="";
  function consume(line){if(!line.startsWith("data:"))return;const raw=line.slice(5).trim();if(!raw||raw==="[DONE]")return;try{const obj=JSON.parse(raw);if(obj.error)throw new APIError(obj.error.message||"The provider stream failed.",502,obj);if(typeof obj.delta==="string"){full+=obj.delta;onDelta(full)}}catch(error){if(error instanceof APIError)throw error}}
  try{
    while(true){const result=await reader.read();buffer+=decoder.decode(result.value||new Uint8Array(),{stream:!result.done});let idx;while((idx=buffer.indexOf("\n"))>=0){const line=buffer.slice(0,idx).replace(/\r$/,"");buffer=buffer.slice(idx+1);if(line.startsWith("event: provider_error"))continue;consume(line)}if(result.done)break}
    if(buffer.trim())consume(buffer.trim());
  }finally{reader.releaseLock?.()}
  if(!full.trim())throw new APIError("The provider returned an empty response.",502);
  return full;
}
async function sendChat(event){
  event?.preventDefault?.();const input=$("#chatInput");if(!input||state.chatBusy)return;
  const text=input.value.trim();if(!text&&!state.pendingImages.length)return;
  const messageText=text||"Please analyze the attached image.";
  const images=state.pendingImages.map(f=>({name:f.name,dataUrl:f.dataUrl}));
  state.pendingImages=[];renderAttachmentChips();input.value="";input.style.height="auto";
  state.chatMessages.push({role:"user",content:messageText,timeLabel:"Now"});renderChatMessages();
  const assistant={role:"assistant",content:"",timeLabel:"Now"};state.chatMessages.push(assistant);renderChatMessages();
  const streamBtn=$("#stop-chat");const sendBtn=$("#sendChat");state.chatBusy=true;
  if(sendBtn)sendBtn.disabled=true;if(streamBtn)streamBtn.disabled=false;
  const controller=new AbortController();state.chatAbort=controller;setCoreState("thinking");setCoreLabel();
  try{
    try{await persistMessage("user",messageText)}catch(error){if(state.session?.authenticated)toast("Message history could not be saved: "+error.message,"error")}
    const messageList=state.chatMessages.slice(0,-1).map(m=>({role:m.role,content:m.content}));
    const model=$("#modelSelect")?.value||"";
    const answer=await streamChat(messageList,model,images,(full)=>{assistant.content=full;setCoreState("responding");setCoreLabel();const article=$('[data-message-index="'+(state.chatMessages.length-1)+'"]');const body=article?.querySelector(".message-text");if(body)body.innerHTML=markdownSafe(full);const area=$("#chatMessages");if(area)area.scrollTop=area.scrollHeight},controller.signal);
    assistant.content=answer;renderChatMessages();
    try{await persistMessage("assistant",answer);if(state.conversationId){const existing=state.conversations.find(c=>c.id===state.conversationId);if(existing){existing.updated_at=new Date().toISOString()}else{state.conversations.unshift({id:state.conversationId,title:messageText.slice(0,65),updated_at:new Date().toISOString()})}renderConversationList()}}catch(error){toast("The answer returned, but history could not be saved: "+error.message,"error")}
    setCoreState("success");
  }catch(error){
    state.chatMessages.pop();if(error.name==="AbortError"){state.chatMessages.push({role:"assistant",content:"Response cancelled by user.",timeLabel:"Cancelled"});setCoreState("idle")}else{state.chatMessages.push({role:"assistant",content:"**Request failed**\\n\\n"+error.message+"\\n\\nNo successful provider response was received. Check model configuration and API connectivity, then retry.",timeLabel:"Error"});setCoreState(error.status===503?"offline":"error");toast(error.message,"error")}
    renderChatMessages();
  }finally{state.chatBusy=false;state.chatAbort=null;if(sendBtn)sendBtn.disabled=false;if(streamBtn)streamBtn.disabled=true}
}
async function newChat(){
  state.conversationId=null;state.chatMessages=[];state.pendingImages=[];renderView("chat");toast("New conversation ready. A saved record will be created when your first message is sent.","info");
}
async function loadTasks(){
  const list=$("#taskList");if(!list)return;
  try{const r=await api("/tasks");state.tasks=r.data.tasks||[];renderTasks();updateTaskCount()}
  catch(error){inlineError($("#taskError"),error.message);list.innerHTML=emptyState("Tasks unavailable","The API did not return account-scoped task records. Sign in and check database/worker setup.")}
}
function renderTasks(){
  const list=$("#taskList");if(!list)return;
  const total=state.tasks.length,running=state.tasks.filter(t=>["running","queued","pending"].includes(String(t.status||"").toLowerCase())).length,review=state.tasks.filter(t=>/review|approval|awaiting/.test(String(t.status||"").toLowerCase())).length;
  if($("#taskMetricTotal"))$("#taskMetricTotal").textContent=String(total);if($("#taskMetricRunning"))$("#taskMetricRunning").textContent=String(running);if($("#taskMetricReview"))$("#taskMetricReview").textContent=String(review);
  updateTaskCount();
  if(!total){list.innerHTML=emptyState("No task records","Create a research task or a review-only task. The task is not considered complete until an actual result is returned.","Create a task","new-task");return}
  list.innerHTML=state.tasks.map(t=>{
    const status=String(t.status||"unknown");const taskTitle=t.title||t.input?.goal||t.input?.description||t.goal||t.description||"Untitled task";const taskType=String(t.input?.taskType||t.task_type||t.taskType||"manual");const waiting=/waiting_for_permission|awaiting_approval|pending/i.test(status);const cancellable=waiting||/^queued$/i.test(status);const canApprove=["research","employee","autonomous"].includes(taskType);
    return ['<div class=\"list-row\"><div class=\"list-row-main\"><div class=\"list-row-title\">',esc(taskTitle),'</div><div class=\"list-row-meta\">ID ',esc(t.id),' · ',esc(fmtDate(t.updated_at||t.created_at)),' · ',esc(taskType),'</div></div><span class=\"task-state state-',esc(status.toLowerCase().replace(/[^a-z]+/g,"-")),'\">',esc(humanStatus(status).toUpperCase()),'</span><div class=\"list-row-actions\"><button class=\"small-button\" data-action=\"task-detail\" data-id=\"',esc(t.id),'\">Details</button>',waiting&&canApprove?'<button class=\"small-button\" data-action=\"approve-task\" data-id=\"'+esc(t.id)+'\">Review</button>':"",cancellable?'<button class=\"small-button\" data-action=\"cancel-task\" data-id=\"'+esc(t.id)+'\">Cancel</button>':"",'</div></div>'].join("");
  }).join("");
}
function openTaskDialog(){
  openDialog("Create a task","AUTONOMOUS TASKS",[
    '<form id=\"taskCreateForm\" class=\"workspace-layout\"><label class=\"field\"><span>Task title</span><input name=\"title\" maxlength=\"240\" required placeholder=\"What should ULTRON work on?\"></label><label class=\"field\"><span>Objective / details</span><textarea name=\"description\" maxlength=\"12000\" required placeholder=\"Describe the task outcome and constraints…\"></textarea></label><div class=\"form-grid\"><label class=\"field\"><span>Task type</span><select name=\"taskType\"><option value=\"research\">Research task</option><option value=\"autonomous\">Autonomous draft/report</option><option value=\"manual\">Manual plan (not executable)</option></select></label><label class=\"field\"><span>Risk</span><select name=\"risk\"><option value=\"low\">Low</option><option value=\"medium\">Medium</option><option value=\"high\">High</option></select></label></div><div class=\"error-panel\">Task creation stores a real record. Research runs only on the allowlisted worker when configured; autonomous work is limited to draft/report workflows. Manual plans cannot be approved for execution. No task type permits arbitrary PC commands.</div><div class=\"form-actions\"><button type=\"button\" class=\"secondary-button\" data-action=\"close-dialog\">Cancel</button><button class=\"primary-button\" type=\"submit\">Create task record ↗</button></div></form>'
  ].join(""));
}
async function submitTask(event){
  event.preventDefault();const form=event.target;const fd=new FormData(form);const body={title:String(fd.get("title")||"").trim(),description:String(fd.get("description")||"").trim(),taskType:String(fd.get("taskType")||"manual"),risk:String(fd.get("risk")||"low")};
  try{const r=await api("/tasks",{method:"POST",body});closeDialog();toast("Task record created. Execution is not implied.","success");state.tasks.unshift(r.data.task);renderTasks();setCoreState("success");}
  catch(error){inlineError(form.querySelector(".error-panel")||form,error.message);toast("Task could not be created: "+error.message,"error")}
}
async function taskDetail(id){
  const host=$("#taskDetail");if(host)host.innerHTML='<div class="panel"><div class="panel-body muted">Loading task detail…</div></div>';
  try{const [task,progress]=await Promise.allSettled([api("/tasks/"+encodeURIComponent(id)),api("/tasks/"+encodeURIComponent(id)+"/progress")]);const a=task.status==="fulfilled"?task.value.data.task:null;const b=progress.status==="fulfilled"?progress.value.data:null;if(!a&&task.status==="rejected")throw task.reason;state.currentTask=a;state.currentTaskProgress=b;if(!host)return;host.innerHTML=panel(a.title||a.input?.goal||"Task detail","ID "+a.id,'<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(humanStatus(a.status))+'</div><div class="list-row-meta">Created '+esc(fmtDate(a.created_at))+' · Updated '+esc(fmtDate(a.updated_at))+'</div></div><span class="pill '+statusClass(a.status)+'">'+esc(String(a.status||"unknown").toUpperCase())+'</span></div><div class="task-detail">'+esc(a.input?.description||a.input?.goal||"No task description returned.")+'</div>'+(a.error_code?'<div class="error-panel" style="margin-top:10px">Error code: '+esc(a.error_code)+'</div>':'')+'<div class="divider"></div><div class="panel-title">Returned execution/progress payload</div>'+jsonMarkup(b||{notice:progress.status==="rejected"?"Progress endpoint unavailable":"No additional progress payload returned"})+(a.result?'<div class="divider"></div><div class="panel-title">Task result</div><div class="task-detail">'+esc(typeof a.result==="string"?a.result:safeJson(a.result))+'</div>':""))}
  catch(error){if(host)inlineError(host,error.message)}
}
async function approveTask(id){
  const task=state.tasks.find(t=>t.id===id);openDialog("Review and approve task","EXPLICIT AUTHORIZATION",[
    '<p class="muted" style="font-size:11px;line-height:1.8">You are approving this existing task record:</p><div class="task-detail">',esc(task?.title||task?.description||id),'</div><div class="error-panel" style="margin-top:12px">Approval records consent for supported backend workflows only. It does not execute PC commands or arbitrary external actions. Review the task's requested permissions before continuing.</div><div class="form-actions"><button class="secondary-button" data-action="close-dialog" type="button">Keep pending</button><button class="primary-button" data-action="confirm-approve" data-id="',esc(id),'" type="button">Confirm approval</button></div>'
  ].join(""));
}
async function confirmApprove(id){
  try{const r=await api("/tasks/"+encodeURIComponent(id)+"/approve",{method:"POST",body:{confirm:true}});closeDialog();toast(r.data.notice||"Approval recorded by the API. Worker completion is not implied.","success");await loadTasks();setCoreState("success")}
  catch(error){toast("Approval was not recorded: "+error.message,"error")}
}
async function cancelTask(id){
  if(!window.confirm("Cancel this task if the existing backend reports it is cancellable?"))return;
  try{await api("/tasks/"+encodeURIComponent(id)+"/cancel",{method:"POST",body:{}});toast("Cancellation request accepted by the API.","success");await loadTasks()}catch(error){toast("Task could not be cancelled: "+error.message,"error")}
}
async function loadMemory(){
  const list=$("#memoryList");if(!list)return;
  try{const r=await api("/memory");state.memory=r.data.items||[];renderMemory()}
  catch(error){inlineError($("#memoryError"),error.message);list.innerHTML=emptyState("Memory unavailable","Account-scoped memory requires a valid signed-in user and database configuration.")}
}
function renderMemory(){
  const list=$("#memoryList");if(!list)return;
  if(!state.memory.length){list.innerHTML=emptyState("No saved memory","Only real memory records from the signed-in account appear here.","Add memory","new-memory");return}
  list.innerHTML=state.memory.map(m=>['<div class="list-row"><div class="list-row-main"><div class="list-row-title">',esc(m.title),'</div><div class="list-row-meta">',esc(m.kind),' · ',esc(m.is_active?"ACTIVE":"INACTIVE"),' · Updated ',esc(fmtDate(m.updated_at)),'</div><div class="task-detail">',esc(String(m.content||"").slice(0,1500)),String(m.content||"").length>1500?"…":"",'</div></div><div class="list-row-actions"><button class="small-button" data-action="toggle-memory" data-id="',esc(m.id),'" data-active="',m.is_active?"true":"false",'">',m.is_active?"Deactivate":"Activate",'</button><button class="small-button" data-action="delete-memory" data-id="',esc(m.id),'">Delete</button></div></div>'].join("")).join("");
}
function openMemoryDialog(){
  openDialog("Add user-approved memory","PERSONAL KNOWLEDGE",[
    '<form id="memoryCreateForm" class="workspace-layout"><label class="field"><span>Type</span><select name="kind"><option value="preference">Preference</option><option value="project_fact">Project fact</option><option value="profile_note">Profile note</option><option value="document_reference">Document reference</option></select></label><label class="field"><span>Title</span><input name="title" maxlength="240" required></label><label class="field"><span>Content</span><textarea name="content" maxlength="20000" required></textarea></label><div class="field-help">Memory is user-controlled, is treated as untrusted model context, and is limited to this authenticated account.</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Save memory ↗</button></div><div id="memoryCreateError"></div></form>'
  ].join(""));
}
async function createMemory(event){
  event.preventDefault();const fd=new FormData(event.target);const body={kind:String(fd.get("kind")),title:String(fd.get("title")||"").trim(),content:String(fd.get("content")||"").trim()};
  try{const r=await api("/memory",{method:"POST",body});state.memory.unshift(r.data.item);closeDialog();renderMemory();toast("Memory item saved.","success")}
  catch(error){inlineError($("#memoryCreateError"),error.message)}
}
async function toggleMemory(id,active){
  try{const r=await api("/memory/"+encodeURIComponent(id),{method:"PATCH",body:{is_active:!active}});state.memory=state.memory.map(x=>x.id===id?r.data.item:x);renderMemory();toast("Memory state updated.","success")}
  catch(error){toast("Memory update failed: "+error.message,"error")}
}
async function deleteMemory(id){
  if(!window.confirm("Permanently delete this memory item from your account?"))return;
  try{await api("/memory/"+encodeURIComponent(id),{method:"DELETE"});state.memory=state.memory.filter(x=>x.id!==id);renderMemory();toast("Memory item deleted.","success")}
  catch(error){toast("Memory deletion failed: "+error.message,"error")}
}
function openDialog(title,eyebrow,body){$("#dialogTitle").textContent=title;$("#dialogEyebrow").textContent=eyebrow||"ULTRON SYSTEM";$("#dialogBody").innerHTML=body;$("#dialogBackdrop").hidden=false;const first=$("#dialogBody input, #dialogBody textarea, #dialogBody select, #dialogBody button");setTimeout(()=>first?.focus(),20)}
function closeDialog(){$("#dialogBackdrop").hidden=true;$("#dialogBody").replaceChildren()}
async function loadIntegrations(){
  const list=$("#integrationList");if(!list)return;
  const paths=[["catalog","/integrations/catalog"],["voicestudio","/integrations/voicestudio/status"],["geo-sleuth","/integrations/geo-sleuth/status"],["desktop companion","/agent/desktop-companion/status"]];
  const results=await Promise.all(paths.map(async([name,path])=>{try{const r=await api(path);return {name,ok:true,data:r.data}}catch(error){return {name,ok:false,error:error.message,status:error.status}}}));
  state.integrations=results;renderIntegrations();
}
function renderIntegrations(){
  const host=$("#integrationList");if(!host)return;
  const catalog=state.integrations.find(x=>x.name==="catalog");let records=[];
  if(catalog?.ok){const d=catalog.data;records=Array.isArray(d.integrations)?d.integrations:Array.isArray(d.catalog)?d.catalog:Array.isArray(d.providers)?d.providers:[]}
  const other=state.integrations.filter(x=>x.name!=="catalog");
  const markup=records.map(item=>{const name=item.name||item.id||item.label||"Integration";const st=item.state||item.status||(item.configured===true?"configured_unverified":item.enabled===false?"disabled":"unknown");return '<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(name)+'</div><div class="list-row-meta">'+esc(item.description||item.capability||item.note||"Backend catalog item")+'</div></div><span class="pill '+statusClass(st)+'">'+esc(humanStatus(st))+'</span></div>'}).join("");
  const otherMarkup=other.map(x=>'<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(x.name)+'</div><div class="list-row-meta">'+esc(x.ok?"Returned by authenticated status endpoint":"Status endpoint unavailable")+'</div>'+(x.ok?'<div class="task-detail">'+esc(safeJson(x.data))+'</div>':'<div class="field-help">'+esc(x.error)+'</div>')+'</div><span class="pill '+(x.ok?"green":"amber")+'">'+(x.ok?"CHECKED":"UNAVAILABLE")+'</span></div>').join("");
  host.innerHTML=(markup||'<div class="field-help">No integration catalog array was returned. This is not evidence that integrations are connected.</div>')+otherMarkup;
  const summary=$("#integrationSummary");if(summary){const count=records.length;summary.innerHTML=['<div class="metric-card"><div class="metric-top">CATALOG ITEMS</div><div class="metric-value">',count,'</div><div class="metric-note">Returned by existing API</div></div><div class="metric-card"><div class="metric-top">STATUS CHECKS</div><div class="metric-value">',other.filter(x=>x.ok).length,' / ',other.length,'</div><div class="metric-note">Authenticated adapter status endpoints</div></div><div class="metric-card"><div class="metric-top">LIVE INFERENCE</div><div class="metric-value">Not verified</div><div class="metric-note">Configuration and status are not an E2E provider test</div></div>'].join("")}
  const err=$("#integrationError");if(err){const failed=state.integrations.filter(x=>!x.ok);if(failed.length)inlineNotice(err,failed.length+" status endpoint(s) did not respond successfully. Some are owner-restricted or optional and may be unavailable.", "error")}
}
async function loadAutomation(){
  const list=$("#scheduleList");if(!list)return;
  const statusHost=$("#schedulerStatus");
  try{const [schedules,employeeStatus,roles,routines]=await Promise.all([api("/employees/schedules"),api("/employees/status"),api("/employees/roles"),api("/employees/routines")]);state.schedules=schedules.data.schedules||[];state.employeeStatus=employeeStatus.data;state.employeeRoles=roles.data.roles||[];state.routines=routines.data.routines||[];if(statusHost)statusHost.innerHTML='<div class="grid-3"><div class="metric-card"><div class="metric-top">SCHEDULER</div><div class="metric-value" style="font-size:19px">'+esc(state.employeeStatus.schedulerEnabled?"Configured":"Not configured")+'</div><div class="metric-note">Capability returned by API</div></div><div class="metric-card"><div class="metric-top">SCHEDULES</div><div class="metric-value">'+state.schedules.length+'</div><div class="metric-note">Saved user records</div></div><div class="metric-card"><div class="metric-top">EXECUTION MODE</div><div class="metric-value" style="font-size:16px">Drafts / reports</div><div class="metric-note">No arbitrary device control</div></div></div>';renderSchedules()}
  catch(error){inlineError($("#scheduleError"),error.message);list.innerHTML=emptyState("Schedules unavailable","A valid Supabase session, database migration, and employee schedule APIs are required.");if(statusHost)statusHost.innerHTML='<div class="error-panel">Could not verify scheduler state: '+esc(error.message)+'</div>'}
}
function renderSchedules(){
  const list=$("#scheduleList");if(!list)return;
  if(!state.schedules.length){list.innerHTML=emptyState("No schedules saved","Create a user-owned routine schedule. Actual runs still depend on a configured server-side worker.","New schedule","new-schedule");return}
  list.innerHTML=state.schedules.map(s=>'<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(s.goal||"Scheduled routine")+'</div><div class="list-row-meta">'+esc(s.role_id)+' · '+esc(s.routine_id)+' · every '+esc(s.interval_minutes)+' min · next '+esc(fmtDate(s.next_run_at))+'</div><div class="list-row-meta">Last run: '+esc(fmtDate(s.last_run_at))+'</div></div><span class="pill '+(s.enabled?"green":"amber")+'">'+(s.enabled?"ENABLED":"PAUSED")+'</span><div class="list-row-actions"><button class="small-button" data-action="run-schedule" data-id="'+esc(s.id)+'">Run now</button></div></div>').join("");
}
function openScheduleDialog(){
  const roles=state.employeeRoles||[];const routines=state.routines||[];
  openDialog("Create scheduled routine","DRAFTS AND REPORTS ONLY",[
    '<form id="scheduleForm" class="workspace-layout"><label class="field"><span>Role</span><select id="scheduleRole" name="role" required>',roles.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label||x.name||x.id)+'</option>').join(""),'</select></label><label class="field"><span>Routine</span><select id="scheduleRoutine" name="routineId" required>',routines.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.title||x.id)+'</option>').join(""),'</select></label><label class="field"><span>Goal</span><textarea name="goal" required maxlength="2000" placeholder="Describe the output this routine should prepare…"></textarea></label><label class="field"><span>Context (optional)</span><textarea name="context" maxlength="4000"></textarea></label><label class="field"><span>Interval (minutes; 60–10080)</span><input name="intervalMinutes" type="number" min="60" max="10080" step="1" value="1440" required></label><div class="error-panel">Saving a schedule does not prove that it will run. The backend must report scheduler and worker readiness.</div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-dialog">Cancel</button><button class="primary-button" type="submit">Save schedule ↗</button></div><div id="scheduleCreateError"></div></form>'
  ].join(""));
  $("#scheduleRole")?.addEventListener("change",async e=>{try{const r=await api("/employees/routines?role="+encodeURIComponent(e.target.value));const select=$("#scheduleRoutine");select.innerHTML=(r.data.routines||[]).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.title||x.id)+'</option>').join("")}catch(error){toast(error.message,"error")}});
}
async function createSchedule(event){
  event.preventDefault();const fd=new FormData(event.target);const body={role:String(fd.get("role")),routineId:String(fd.get("routineId")),goal:String(fd.get("goal")||"").trim(),context:String(fd.get("context")||"").trim(),intervalMinutes:Number(fd.get("intervalMinutes"))};
  try{const r=await api("/employees/schedules",{method:"POST",body});state.schedules.unshift(r.data.schedule);closeDialog();renderSchedules();toast(r.data.notice||"Schedule saved; worker run is not implied.","success")}
  catch(error){inlineError($("#scheduleCreateError"),error.message)}
}
async function runSchedule(id){
  if(!window.confirm("Request a run for this scheduled routine? The backend executes draft/report workflows only."))return;
  try{const r=await api("/employees/schedules/"+encodeURIComponent(id)+"/run",{method:"POST",body:{}});toast(r.data.notice||"Run request returned from the backend.","success");await loadAutomation()}
  catch(error){toast("Routine could not be run: "+error.message,"error")}
}
async function loadSecurity(){
  const [readiness,tasks]=await Promise.allSettled([api("/runtime/readiness"),api("/tasks")]);
  const rHost=$("#securityReadiness"),tHost=$("#securityTasks");
  if(rHost){const data=readiness.status==="fulfilled"?readiness.value.data:null;rHost.innerHTML=panel("Auth & runtime readiness","CONFIGURATION IS NOT LIVE VERIFICATION",data?renderReadinessRows(data):'<div class="error-panel">'+esc(readiness.reason.message)+'</div>')}
  if(tHost){state.tasks=tasks.status==="fulfilled"?(tasks.value.data.tasks||[]):[];const pending=state.tasks.filter(t=>/waiting_for_permission|pending|awaiting_approval|review/i.test(String(t.status||"")));tHost.innerHTML=panel("Tasks awaiting review","USER-SCOPED RECORDS",pending.length?'<div class="list-stack">'+pending.map(t=>{const canApprove=["research","employee","autonomous"].includes(t.input?.taskType)&&["allowlisted_worker","employee_worker"].includes(t.input?.executionMode);return '<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(t.title||t.input?.goal||"Task")+'</div><div class="list-row-meta">'+esc(humanStatus(t.status))+'</div></div>'+(canApprove?'<button class="small-button" data-action="approve-task" data-id="'+esc(t.id)+'">Review</button>':'<span class="pill amber">PLAN ONLY</span>')+'</div>'}).join("")+'</div>':emptyState("No pending approvals","No tasks with a waiting-for-permission or review status were returned."))}
}
function renderReadinessRows(data){
  const components=Array.isArray(data.components)?data.components:[];
  if(!components.length)return '<div class="task-detail">'+esc(safeJson(data))+'</div>';
  return '<div class="list-stack">'+components.map(c=>'<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(c.label||c.id)+'</div><div class="list-row-meta">'+esc(c.note||c.requiredEnv?.join(", ")||"")+'</div></div><span class="pill '+statusClass(c.state)+'">'+esc(humanStatus(c.state))+'</span></div>').join("")+'</div>';
}
async function loadSystem(){
  const [health,readiness,worker,capabilities]=await Promise.allSettled([api("/health"),api("/runtime/readiness"),api("/worker/status"),api("/capabilities")]);
  const metric=$("#systemMetrics");
  if(metric){metric.innerHTML=['<div class="metric-card"><div class="metric-top">API HEALTH</div><div class="metric-value" style="font-size:19px">',health.status==="fulfilled"?"Responding":"Unavailable",'</div><div class="metric-note">GET /api/health · ',health.status==="fulfilled"?"successful response":"request failed",'</div></div><div class="metric-card"><div class="metric-top">AUTH SESSION</div><div class="metric-value" style="font-size:19px">',state.session?.authenticated?"Authenticated":"Not verified",'</div><div class="metric-note">GET /api/session</div></div><div class="metric-card"><div class="metric-top">TASK WORKER</div><div class="metric-value" style="font-size:19px">',worker.status==="fulfilled"?esc(worker.value.data.worker?.state||worker.value.data.state||"Returned"):"Unavailable",'</div><div class="metric-note">No progress inferred from configuration</div></div>'].join("")}
  const rHost=$("#systemReadiness"),wHost=$("#systemWorker");
  if(rHost)rHost.innerHTML=panel("Runtime readiness","GET /API/RUNTIME/READINESS",readiness.status==="fulfilled"?renderReadinessRows(readiness.value.data):'<div class="error-panel">'+esc(readiness.reason.message)+'</div>');
  if(wHost)wHost.innerHTML=panel("Task worker","GET /API/WORKER/STATUS",worker.status==="fulfilled"?jsonMarkup(worker.value.data):'<div class="error-panel">'+esc(worker.reason.message)+'</div>');
  const raw=$("#systemRaw");if(raw)raw.innerHTML=panel("Capability snapshot","NO SECRETS SHOULD BE RETURNED",capabilities.status==="fulfilled"?jsonMarkup(capabilities.value.data):'<div class="error-panel">'+esc(capabilities.reason.message)+'</div>');
  if(health.status==="fulfilled"){state.health=health.value.data;updateConnection(true)}else updateConnection(false);
  if(readiness.status==="fulfilled")state.readiness=readiness.value.data;if(worker.status==="fulfilled")state.worker=worker.value.data.worker||worker.value.data;
}
async function loadSettings(){
  const [models,prefs]=await Promise.allSettled([api("/models"),api("/preferences")]);
  if(models.status==="fulfilled"){state.models=models.value.data.models||[];const host=$("#modelList");if(host){const items=state.models.map(m=>'<div class="list-row"><div class="list-row-main"><div class="list-row-title">'+esc(typeof m==="string"?m:m.name||m.id||"Model")+'</div><div class="list-row-meta">'+esc(typeof m==="object"?(m.provider||m.description||"Listed by model discovery"):"Listed by /api/models")+'</div></div><span class="pill purple">DISCOVERED</span></div>').join("");host.innerHTML=items||emptyState("No models returned","Model discovery did not return configured model IDs.")}}else{$("#modelList").innerHTML='<div class="error-panel">'+esc(models.reason.message)+'</div>'}
  const form=$("#preferencesForm");
  if(prefs.status==="fulfilled"){
    state.preferences=prefs.value.data.preferences||{};const p=state.preferences;
    if(form){form.elements.voice_input_locale.value=p.voice_input_locale||"en-IN";form.elements.voice_enabled.checked=p.voice_enabled!==false;form.elements.memory_enabled.checked=p.memory_enabled!==false}
  }else if(form){inlineNotice($("#preferencesNotice"),"Account preferences unavailable: "+prefs.reason.message,"error")}
  loadCoreSettingsIntoForm();
}
function loadCoreSettingsIntoForm(){
  const s=state.coreSettings;const form=$("#coreSettingsForm");if(!form)return;
  for(const name of ["quality","particles","speed","scale","glow","orbit","turbulence"]){if(form.elements[name])form.elements[name].value=s[name]}
  form.elements.reducedMotion.checked=Boolean(s.reducedMotion||state.forceReducedMotion);
  updateCoreOutputs();
}
function updateCoreOutputs(){
  const vals={particleDensityOutput:(Number($("#particleDensity")?.value)||0).toLocaleString(),coreSpeedOutput:(Number($("#coreSpeed")?.value)||0).toFixed(1)+"×",coreScaleOutput:(Number($("#coreScale")?.value)||0).toFixed(2)+"×",coreGlowOutput:(Number($("#coreGlow")?.value)||0).toFixed(2)+"×",coreOrbitOutput:(Number($("#coreOrbit")?.value)||0).toFixed(2)+"×",coreTurbulenceOutput:(Number($("#coreTurbulence")?.value)||0).toFixed(2)};
  Object.entries(vals).forEach(([id,value])=>{const el=$("#"+id);if(el)el.textContent=value});
}
function applyCoreSettings(form){
  const fd=new FormData(form);const s={quality:String(fd.get("quality")||"balanced"),particles:Number(fd.get("particles")||22000),speed:Number(fd.get("speed")||0),scale:Number(fd.get("scale")||1),glow:Number(fd.get("glow")||0),orbit:Number(fd.get("orbit")||0),turbulence:Number(fd.get("turbulence")||0),reducedMotion:form.elements.reducedMotion.checked};
  state.coreSettings=s;try{localStorage.setItem("ultron.core.settings",JSON.stringify(s))}catch{}
  state.forceReducedMotion=s.reducedMotion;document.documentElement.classList.toggle("manual-reduced-motion",s.reducedMotion);
  state.core?.setOptions(s);if($("#coreSettingsNotice"))inlineNotice($("#coreSettingsNotice"),"Visualization preferences applied. If particle density changes require a rebuild on this renderer, reopen the command center to apply them.","success");
  toast("Core settings saved on this browser.","success");
}
function openCoreDialog(){
  const s=state.coreSettings;
  openDialog("Living Energy Core","VISUALIZATION CONTROLS",[
    '<form id="quickCoreForm" class="workspace-layout"><label class="field"><span>Quality preset</span><select name="quality"><option value="eco" '+(s.quality==="eco"?"selected":"")+'>Eco</option><option value="balanced" '+(s.quality==="balanced"?"selected":"")+'>Balanced</option><option value="high" '+(s.quality==="high"?"selected":"")+'>High</option></select></label><label class="field"><span>Particle density</span><input name="particles" type="range" min="4000" max="60000" step="1000" value="'+esc(s.particles)+'"></label><label class="field"><span>Speed</span><input name="speed" type="range" min="0" max="2" step=".1" value="'+esc(s.speed)+'"></label><label class="field"><span>Glow</span><input name="glow" type="range" min="0" max="1.5" step=".05" value="'+esc(s.glow)+'"></label><label class="field"><span>Orbit intensity</span><input name="orbit" type="range" min="0" max="1.5" step=".05" value="'+esc(s.orbit)+'"></label><div class="toggle-row"><div class="toggle-copy"><strong>Reduced motion</strong><small>Minimize continuous movement.</small></div><label class="switch"><input name="reducedMotion" type="checkbox" '+(s.reducedMotion?"checked":"")+'><span></span></label></div><div class="form-actions"><button type="button" class="secondary-button" data-action="close-dialog">Close</button><button type="submit" class="primary-button">Apply controls</button></div></form>'
  ].join(""));
}
async function savePreferences(event){
  event.preventDefault();const form=event.target;const body={voice_input_locale:String(form.elements.voice_input_locale.value),voice_enabled:form.elements.voice_enabled.checked,memory_enabled:form.elements.memory_enabled.checked};
  try{const r=await api("/preferences",{method:"PUT",body});state.preferences=r.data.preferences;inlineNotice($("#preferencesNotice"),"Preferences saved by the API.","success");toast("Preferences updated.","success")}
  catch(error){inlineNotice($("#preferencesNotice"),"Preferences were not saved: "+error.message,"error")}
}
function renderVoiceAdapterSummary(){
  const label=$("#voiceAdapterState");if(!label)return;
  const speech=state.speechCapabilities;const parts=[];
  if(speech){parts.push("Browser speech: browser capability");parts.push("Server TTS: "+(speech.premiumTtsConfigured?"configured (inference not yet tested)":"not configured"));parts.push("Server STT: "+(speech.premiumSttConfigured?"configured (transcription not yet tested)":"not configured"))}
  else parts.push("Speech provider configuration: not verified");
  if(state.voiceStudioSummary)parts.push("VoiceStudio: "+state.voiceStudioSummary);
  label.textContent=parts.join(" · ");
}
function setupVoice(){
  const locale=$("#voiceLocale");if(locale&&state.preferences?.voice_input_locale)locale.value=state.preferences.voice_input_locale==="hinglish"?"en-IN":state.preferences.voice_input_locale;
  if("speechSynthesis" in window){
    const populate=()=>{const select=$("#ttsVoice");if(!select)return;const voices=window.speechSynthesis.getVoices();const prior=select.value;select.innerHTML='<option value="">System default</option>'+voices.map((v,i)=>'<option value="'+i+'">'+esc(v.name+" ("+v.lang+")")+'</option>').join("");select.value=prior};
    populate();window.speechSynthesis.onvoiceschanged=populate;
  }
  const recognition=window.SpeechRecognition||window.webkitSpeechRecognition;const start=$("#startVoice"),help=$("#voiceStateHelp");
  if(!recognition){if(start)start.disabled=true;if(help)help.textContent="This browser does not expose SpeechRecognition. Use the explicit server-recording option if the transcription adapter is configured, or send text in Chat."}
  api("/capabilities").then(r=>{
    state.speechCapabilities=r.data?.providers?.speech||{};
    const serverOption=$("#ttsEngine option[value='server']");
    if(serverOption){serverOption.disabled=!state.speechCapabilities.premiumTtsConfigured;serverOption.textContent=state.speechCapabilities.premiumTtsConfigured?"Configured server voice":"Server voice · not configured"}
    renderVoiceAdapterSummary();
  }).catch(()=>{state.speechCapabilities=null;renderVoiceAdapterSummary()});
  api("/integrations/voicestudio/status").then(r=>{state.voiceStudioSummary="status returned";renderVoiceAdapterSummary()}).catch(e=>{state.voiceStudioSummary="unavailable or owner-restricted ("+e.message+")";renderVoiceAdapterSummary()});
}
function startVoice(){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){toast("Browser speech recognition is not supported here.","error");return}
  if(state.speechRecognition){try{state.speechRecognition.stop()}catch{}state.speechRecognition=null}
  const recognition=new Recognition();recognition.lang=$("#voiceLocale")?.value||"en-IN";recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1;state.speechRecognition=recognition;state.speechActive=false;
  recognition.onstart=()=>{state.speechActive=true;setCoreState("listening");$("#micStatePill").textContent="MICROPHONE ACTIVE";$("#micStatePill").className="pill red";$("#voiceStateText").textContent="Listening";$("#voiceOrb").classList.add("active");$("#voiceStateHelp").textContent="The browser reports an active speech recognition session. Click Stop or wait for the session to end." ;$("#startVoice").disabled=true;$("#stopVoice").disabled=false};
  recognition.onresult=(event)=>{let finalText="",interim="";for(let i=event.resultIndex;i<event.results.length;i++){const text=event.results[i][0]?.transcript||"";if(event.results[i].isFinal)finalText+=text;else interim+=text}$("#voiceTranscript").textContent=finalText||interim;if(finalText){const chatLink=document.createElement("button");chatLink.className="small-button";chatLink.textContent="Send transcript to chat";chatLink.dataset.action="transcript-to-chat";chatLink.dataset.text=finalText;$("#voiceTranscript").append(document.createTextNode(" "));$("#voiceTranscript").append(chatLink)}};
  recognition.onerror=(event)=>{toast("Speech recognition error: "+(event.error||"unknown"),"error");finishVoice()};
  recognition.onend=()=>finishVoice();
  try{recognition.start()}catch(error){toast("Could not start speech recognition: "+error.message,"error");finishVoice()}
}
function finishVoice(){
  state.speechActive=false;$("#micStatePill")&&($("#micStatePill").textContent="MICROPHONE OFF");$("#micStatePill")&&($("#micStatePill").className="pill");$("#voiceStateText")&&($("#voiceStateText").textContent="Session ended");$("#voiceOrb")&&$("#voiceOrb").classList.remove("active");$("#startVoice")&&($("#startVoice").disabled=false);$("#stopVoice")&&($("#stopVoice").disabled=true);state.speechRecognition=null;if(state.coreState==="listening")setCoreState("idle");
}
function stopVoice(){if(state.speechRecognition){try{state.speechRecognition.stop()}catch{} }finishVoice()}
function speakText(){
  if(!("speechSynthesis" in window)){toast("Browser speech synthesis is not available.","error");return}
  const text=$("#ttsText")?.value.trim();if(!text){toast("Enter text to speak first.","error");return}
  window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);const voiceIndex=$("#ttsVoice")?.value;const voices=window.speechSynthesis.getVoices();if(voiceIndex!==undefined&&voiceIndex!==""&&voices[Number(voiceIndex)])utterance.voice=voices[Number(voiceIndex)];utterance.rate=Number($("#ttsRate")?.value)||1;utterance.onstart=()=>{$("#ttsState").textContent="SPEAKING";setCoreState("responding")};utterance.onend=()=>{$("#ttsState").textContent="READY";setCoreState("idle")};utterance.onerror=()=>{$("#ttsState").textContent="ERROR";setCoreState("error")};window.speechSynthesis.speak(utterance);
}
async function refreshVoiceStatus(){setupVoice();toast("Speech adapter status check requested.","info")}
async function submitCoding(event){
  event.preventDefault();const form=event.target;const fd=new FormData(form);const body={task:String(fd.get("task")||"").trim(),language:String(fd.get("language")||"unspecified"),code:String(fd.get("code")||""),mode:String(fd.get("mode")||"plan")};const result=$("#codingResult");result.innerHTML='<div class="muted">Requesting the configured coding-assistance provider…</div>';setCoreState("thinking");
  try{const r=await api("/coding/assist",{method:"POST",body});const data=r.data;result.innerHTML='<div class="pill purple">'+esc(data.provider||"Provider not returned")+' · '+esc(data.model||"Model not returned")+'</div><div class="message-text" style="margin-top:15px">'+markdownSafe(data.answer||"")+'</div><div class="error-panel" style="margin-top:14px">'+esc(data.notice||"The backend reports execution status: not executed.")+'</div>';setCoreState("success")}
  catch(error){result.innerHTML='<div class="error-panel">'+esc(error.message)+'</div>';setCoreState("error")}
}
async function submitResearch(event){
  event.preventDefault();const query=String(new FormData(event.target).get("query")||"").trim();const host=$("#researchResults");host.innerHTML='<div class="muted">Research request in progress. No results are displayed until the API returns.</div>';$("#researchNotice").replaceChildren();setCoreState("thinking");
  try{const r=await api("/research",{method:"POST",body:{query}});const data=r.data;const results=Array.isArray(data.results)?data.results:[];$("#researchNotice").innerHTML='<div class="success-panel">Provider: '+esc(data.provider||"not identified")+'. '+esc(data.notice||"Source verification is still required.")+'</div>';host.innerHTML=results.length?results.map((item,i)=>'<article class="source-card"><div class="panel-subtitle">SOURCE '+String(i+1).padStart(2,"0")+'</div><h3>'+esc(item.title||item.name||"Untitled source")+'</h3><p>'+esc(item.content||item.snippet||item.description||"No snippet returned.")+'</p>'+(item.url&&/^https?:\\/\\//i.test(item.url)?'<a href="'+esc(item.url)+'" target="_blank" rel="noopener noreferrer">Open source ↗</a>':'<span class="field-help">No safe source URL returned.</span>')+'</article>').join(""):emptyState("No sources returned","The research API completed but returned no result records.");setCoreState("success")}
  catch(error){inlineError($("#researchNotice"),error.message);setCoreState("error")}
}
async function submitDocument(event){
  event.preventDefault();const file=$("#documentFile")?.files?.[0];if(!file)return;const result=$("#documentResult");result.innerHTML='<div class="muted">Reading and sending the selected file to the transient extraction endpoint…</div>';const ext=file.name.split(".").pop().toLowerCase();const allowed=["txt","md","csv","json","html","pdf","docx"];if(!allowed.includes(ext)){inlineError($("#documentNotice"),"Unsupported extension.");return}if(file.size>5_000_000){inlineError($("#documentNotice"),"File exceeds 5 MB. Choose a smaller file.");return}
  try{
    let body={filename:file.name,format:ext};
    if(["pdf","docx"].includes(ext)){body.fileBase64=await fileToBase64(file)}else{body.content=await file.text();if(body.content.length>1_000_000)throw new Error("Text content exceeds the 1 MB extraction request limit.")}
    const r=await api("/documents/extract",{method:"POST",body});const data=r.data;result.innerHTML='<div class="success-panel">Extraction response received for '+esc(file.name)+'. This was transient processing, not persistent storage.</div><div class="task-detail">'+esc(typeof data.text==="string"?data.text:typeof data.content==="string"?data.content:safeJson(data))+'</div>';
    $("#documentNotice").replaceChildren();setCoreState("success");
  }catch(error){inlineError($("#documentNotice"),error.message);result.innerHTML=emptyState("Extraction did not complete","No success is claimed until the API returns a valid extraction response.");setCoreState("error")}
}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read selected file."));reader.onload=()=>{const value=String(reader.result||"");const comma=value.indexOf(",");resolve(comma>=0?value.slice(comma+1):"")};reader.readAsDataURL(file)})}
function addImages(files){
  const list=Array.from(files||[]);if(state.pendingImages.length+list.length>2){toast("Attach no more than two images per message.","error");return}
  Promise.all(list.map(file=>new Promise((resolve,reject)=>{if(file.size>4*1024*1024){reject(new Error(file.name+" exceeds 4 MB."));return}if(!/^image\\/(jpeg|png|webp|gif)$/i.test(file.type)){reject(new Error(file.name+" is not a supported image."));return}const reader=new FileReader();reader.onload=()=>resolve({name:file.name,dataUrl:String(reader.result)});reader.onerror=()=>reject(new Error("Could not read "+file.name));reader.readAsDataURL(file)}))).then(images=>{state.pendingImages.push(...images);renderAttachmentChips()}).catch(error=>toast(error.message,"error"))
}
async function submitAuth(event){
  event.preventDefault();const email=$("#authEmail").value.trim(),password=$("#authPassword").value;const submit=$("#authSubmit"),message=$("#authMessage");submit.disabled=true;message.textContent="Contacting the existing authentication endpoint…";
  try{
    const endpoint=state.authMode==="signup"?"/auth/signup":"/auth/signin";const r=await api(endpoint,{method:"POST",body:{email,password}});
    if(state.authMode==="signup"&&r.response.status===202){message.textContent=r.data.message||"Check your email to confirm the account, then sign in.";return}
    if(r.data.authenticated){message.textContent="Authentication succeeded. Refreshing session…";await refreshHealth();if(state.session?.authenticated){$("#authGate").hidden=true;toast("Signed in.","success");await postAuthRefresh()}else{message.textContent="The endpoint returned success, but the session could not yet be verified.";}}
    else message.textContent=r.data.message||"The authentication endpoint did not confirm a session.";
  }catch(error){message.textContent=error.message}
  finally{submit.disabled=false}
}
async function postAuthRefresh(){if(state.session?.authenticated){try{const r=await api("/runtime/readiness");state.readiness=r.data}catch{}try{const r=await api("/worker/status");state.worker=r.data.worker||r.data}catch{}}updateSessionUi();renderView(state.view)}
async function recoverPassword(){
  const email=$("#authEmail").value.trim();if(!email){$("#authMessage").textContent="Enter your account email first.";$("#authEmail").focus();return}
  try{const r=await api("/auth/recovery",{method:"POST",body:{email}});$("#authMessage").textContent=r.data.message||"If an account exists, recovery instructions will be sent."}
  catch(error){$("#authMessage").textContent=error.message}
}
async function signOut(){
  try{await api("/auth/signout",{method:"POST",body:{}})}catch{}
  try{await api("/logout",{method:"POST",body:{}})}catch{}
  state.session={authenticated:false,configured:true};state.conversationId=null;state.chatMessages=[];state.conversations=[];state.tasks=[];state.memory=[];updateSessionUi();toast("Signed out of the current API session.","info");renderView("home");
}
async function loadCurrentView(){if(state.view==="home")renderView("home");else renderView(state.view)}
function commandItems(query=""){
  const all=Object.entries(navTitles).map(([id,title])=>({id,title,detail:"Open workspace",icon:id==="home"?"⌘":id==="chat"?"◈":id==="voice"?"〰":"↗"})).concat([{id:"new-task",title:"Create task",detail:"Create a real task record",icon:"＋"},{id:"new-chat",title:"New conversation",detail:"Start a new chat",icon:"＋"},{id:"core-controls",title:"Core settings",detail:"Adjust visualization",icon:"⚙"},{id:"signout",title:"Sign out",detail:"End the current API session",icon:"↗"}]);
  const q=query.toLowerCase().trim();return all.filter(x=>!q||(x.title+" "+x.detail).toLowerCase().includes(q));
}
function renderCommandResults(query=""){
  const host=$("#commandResults");if(!host)return;const items=commandItems(query);host.innerHTML=items.length?items.map((item,i)=>'<button class="command-result '+(i===0?"selected":"")+'" data-command="'+esc(item.id)+'"><span>'+esc(item.icon)+'</span><span><strong>'+esc(item.title)+'</strong><small>'+esc(item.detail)+'</small></span></button>').join(""):'<div class="field-help" style="padding:16px">No matching command.</div>';
}
function openCommandPalette(){$("#commandBackdrop").hidden=false;$("#commandSearch").value="";renderCommandResults();setTimeout(()=>$("#commandSearch").focus(),10)}
function closeCommandPalette(){$("#commandBackdrop").hidden=true}
async function runAction(action,id,button){
  switch(action){
    case "new-chat":await newChat();break;
    case "new-task":openTaskDialog();break;
    case "task-detail":await taskDetail(id);break;
    case "approve-task":approveTask(id);break;
    case "confirm-approve":await confirmApprove(id);break;
    case "cancel-task":await cancelTask(id);break;
    case "refresh-tasks":await loadTasks();break;
    case "new-memory":openMemoryDialog();break;
    case "refresh-memory":await loadMemory();break;
    case "toggle-memory":await toggleMemory(id,button.dataset.active==="true");break;
    case "delete-memory":await deleteMemory(id);break;
    case "refresh-conversations":await setupChat();break;
    case "open-conversation":await loadConversationMessages(id);break;
    case "send-chat":await sendChat();break;
    case "stop-chat":state.chatAbort?.abort();break;
    case "attach-images":$("#imageInput")?.click();break;
    case "remove-image":state.pendingImages.splice(Number(button.dataset.index),1);renderAttachmentChips();break;
    case "start-voice":startVoice();break;
    case "stop-voice":stopVoice();break;
    case "speak":speakText();break;
    case "stop-tts":if("speechSynthesis"in window)window.speechSynthesis.cancel();$("#ttsState")&&($("#ttsState").textContent="STOPPED");break;
    case "refresh-voice":await refreshVoiceStatus();break;
    case "transcript-to-chat":{const t=button.dataset.text||"";await goChatWithText(t);break}
    case "refresh-integrations":await loadIntegrations();break;
    case "new-schedule":if(!state.employeeRoles.length)await loadAutomation();openScheduleDialog();break;
    case "refresh-schedules":await loadAutomation();break;
    case "run-schedule":await runSchedule(id);break;
    case "refresh-security":await loadSecurity();break;
    case "refresh-system":await loadSystem();break;
    case "refresh-models":await loadSettings();break;
    case "core-controls":openCoreDialog();break;
    case "reset-core-settings":state.coreSettings={...defaultCoreSettings};state.core?.setOptions(state.coreSettings);try{localStorage.removeItem("ultron.core.settings")}catch{}loadCoreSettingsIntoForm();toast("Core settings reset.","info");break;
    case "close-dialog":closeDialog();break;
    case "toggle-fullscreen":{const el=$("#coreViewport");if(el?.requestFullscreen)el.requestFullscreen().catch(()=>toast("Fullscreen is unavailable in this browser.","error"));break}
    case "open-settings":renderView("settings");break;
    case "signout":await signOut();break;
    case "retry-health":await refreshHealth();toast(state.health?"API responded.":"API remains unavailable.",state.health?"success":"error");break;
    case "copy-message":{const index=Number(button.dataset.messageIndex);const m=state.chatMessages[index];if(m)navigator.clipboard?.writeText(m.content).then(()=>toast("Response copied.","success")).catch(()=>toast("Clipboard access was denied.","error"));break}
    default:break;
  }
}
async function goChatWithText(text){renderView("chat");setTimeout(()=>{const input=$("#chatInput");if(input){input.value=text;input.focus();sendChat()}},80)}
document.addEventListener("click",async event=>{
  const nav=event.target.closest("[data-nav]");if(nav){event.preventDefault();renderView(nav.dataset.nav);return}
  const suggestion=event.target.closest("[data-suggestion]");if(suggestion){const input=$("#chatInput");if(input){input.value=suggestion.dataset.suggestion;input.focus()}return}
  const command=event.target.closest("[data-command]");if(command){const id=command.dataset.command;closeCommandPalette();if(navTitles[id])renderView(id);else runAction(id,command.dataset.id,command);return}
  const action=event.target.closest("[data-action]");if(action){event.preventDefault();await runAction(action.dataset.action,action.dataset.id,action);return}
  const mode=event.target.closest("[data-auth-mode]");if(mode){state.authMode=mode.dataset.authMode;$$("[data-auth-mode]").forEach(x=>{const active=x.dataset.authMode===state.authMode;x.classList.toggle("active",active);x.setAttribute("aria-selected",String(active))});$("#authSubmit").innerHTML=state.authMode==="signup"?'Create account <span>↗</span>':'Sign in securely <span>↗</span>';$("#authPassword").autocomplete=state.authMode==="signup"?"new-password":"current-password";$("#authMessage").textContent="";return}
});
document.addEventListener("submit",async event=>{
  if(event.target.id==="authForm"){await submitAuth(event);return}
  if(event.target.id==="chatForm"){await sendChat(event);return}
  if(event.target.id==="taskCreateForm"){await submitTask(event);return}
  if(event.target.id==="memoryCreateForm"){await createMemory(event);return}
  if(event.target.id==="codingForm"){await submitCoding(event);return}
  if(event.target.id==="researchForm"){await submitResearch(event);return}
  if(event.target.id==="documentForm"){await submitDocument(event);return}
  if(event.target.id==="preferencesForm"){await savePreferences(event);return}
  if(event.target.id==="coreSettingsForm"){event.preventDefault();applyCoreSettings(event.target);return}
  if(event.target.id==="quickCoreForm"){event.preventDefault();const form=event.target;const fd=new FormData(form);state.coreSettings={...state.coreSettings,quality:String(fd.get("quality")),particles:Number(fd.get("particles")),speed:Number(fd.get("speed")),glow:Number(fd.get("glow")),orbit:Number(fd.get("orbit")),reducedMotion:form.elements.reducedMotion.checked};state.core?.setOptions(state.coreSettings);try{localStorage.setItem("ultron.core.settings",JSON.stringify(state.coreSettings))}catch{}document.documentElement.classList.toggle("manual-reduced-motion",state.coreSettings.reducedMotion);closeDialog();toast("Core controls applied.","success");return}
  if(event.target.id==="scheduleForm"){await createSchedule(event);return}
});
document.addEventListener("input",event=>{
  if(event.target.id==="chatInput"){event.target.style.height="auto";event.target.style.height=Math.min(event.target.scrollHeight,180)+"px"}
  if(["particleDensity","coreSpeed","coreScale","coreGlow","coreOrbit","coreTurbulence"].includes(event.target.id))updateCoreOutputs();
  if(event.target.id==="commandSearch")renderCommandResults(event.target.value);
});
document.addEventListener("keydown",event=>{
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();openCommandPalette();return}
  if(event.key==="Escape"){if(!$("#commandBackdrop").hidden)closeCommandPalette();if(!$("#dialogBackdrop").hidden)closeDialog();document.body.classList.remove("mobile-nav-open")}
  if(event.target.id==="chatInput"&&event.key==="Enter"&&!event.shiftKey){event.preventDefault();sendChat(event)}
  if($("#commandBackdrop")&&!$("#commandBackdrop").hidden&&["ArrowDown","ArrowUp","Enter"].includes(event.key)){const buttons=$$(".command-result");if(!buttons.length)return;let idx=buttons.findIndex(b=>b.classList.contains("selected"));if(event.key==="ArrowDown")idx=(idx+1)%buttons.length;if(event.key==="ArrowUp")idx=(idx-1+buttons.length)%buttons.length;if(event.key==="Enter"){buttons[Math.max(0,idx)].click();return}buttons.forEach((b,i)=>b.classList.toggle("selected",i===idx));buttons[Math.max(0,idx)].scrollIntoView({block:"nearest"})}
});
$("#sidebarToggle").addEventListener("click",()=>{document.body.classList.toggle("sidebar-collapsed");$("#sidebarToggle").setAttribute("aria-label",document.body.classList.contains("sidebar-collapsed")?"Expand navigation":"Collapse navigation")});
$("#mobileMenu").addEventListener("click",()=>document.body.classList.toggle("mobile-nav-open"));
$("#profileButton").addEventListener("click",()=>{if(state.session?.authenticated)openDialog("Account session","AUTHENTICATED SESSION",'<p class="muted" style="font-size:11px;line-height:1.7">'+esc(state.session.email||"Signed-in account")+'</p><div class="form-actions"><button class="secondary-button" data-action="close-dialog" type="button">Close</button><button class="danger-button" data-action="signout" type="button">Sign out</button></div>');else if(state.session?.configured)$("#authGate").hidden=false;else toast("The current API has not confirmed a configured authentication flow.","error")});
$("#quickSettings").addEventListener("click",()=>renderView("settings"));
$("#commandPaletteButton").addEventListener("click",openCommandPalette);
$("#commandPaletteButton").addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openCommandPalette()}});
$("#forgotPassword").addEventListener("click",recoverPassword);
$("#dialogClose").addEventListener("click",closeDialog);
$("#dialogBackdrop").addEventListener("click",event=>{if(event.target.id==="dialogBackdrop")closeDialog()});
$("#commandBackdrop").addEventListener("click",event=>{if(event.target.id==="commandBackdrop")closeCommandPalette()});
$("#imageInput").addEventListener("change",event=>{addImages(event.target.files);event.target.value=""});
$("#reducedMotionToggle").addEventListener("click",()=>{state.forceReducedMotion=!state.forceReducedMotion;state.coreSettings.reducedMotion=state.forceReducedMotion;state.core?.setOptions(state.coreSettings);document.documentElement.classList.toggle("manual-reduced-motion",state.forceReducedMotion);$("#reducedMotionToggle").setAttribute("aria-pressed",String(state.forceReducedMotion));$("#reducedMotionToggle").textContent="Motion: "+(state.forceReducedMotion?"Reduced":"Auto");try{localStorage.setItem("ultron.core.settings",JSON.stringify(state.coreSettings))}catch{}});
document.addEventListener("visibilitychange",()=>{if(document.hidden&&state.speechRecognition){try{state.speechRecognition.stop()}catch{}}});
window.addEventListener("beforeunload",()=>{state.core?.dispose();state.chatAbort?.abort();if(state.speechRecognition){try{state.speechRecognition.stop()}catch{}}if("speechSynthesis"in window)window.speechSynthesis.cancel()});
function showAuthMessage(){if(state.session&&state.session.configured===true&&!state.session.authenticated){$("#authGate").hidden=false}}
async function init(){
  document.documentElement.classList.toggle("manual-reduced-motion",Boolean(state.coreSettings.reducedMotion));$("#reducedMotionToggle").setAttribute("aria-pressed",String(state.coreSettings.reducedMotion));$("#reducedMotionToggle").textContent="Motion: "+(state.coreSettings.reducedMotion?"Reduced":"Auto");
  renderView("home");await refreshHealth();showAuthMessage();if(state.session?.authenticated)await postAuthRefresh();setCoreLabel();
}
init().catch(error=>{updateConnection(false,"Initialization error: "+error.message);root.innerHTML=emptyState("ULTRON could not initialize","Reload the interface or check browser compatibility.");});
