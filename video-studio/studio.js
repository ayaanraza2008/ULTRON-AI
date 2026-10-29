(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const ui = {
    connection: $("#connectionState"), loginPane: $("#loginPane"), loginForm: $("#loginForm"), loginMessage: $("#loginMessage"),
    appShell: $("#appShell"), projectList: $("#projectList"), projectCount: $("#projectCount"), toolChecklist: $("#toolChecklist"),
    engineSummary: $("#engineSummary"), createForm: $("#newProjectForm"), createMessage: $("#createMessage"), referenceFile: $("#referenceFile"),
    projectWorkspace: $("#projectWorkspace"), activeTitle: $("#activeTitle"), activeMeta: $("#activeMeta"), activeStage: $("#activeStage"),
    stageTrack: $("#stageTrack"), referenceSummary: $("#referenceSummary"), referenceTranscript: $("#referenceTranscript"),
    referenceAnalysis: $("#referenceAnalysis"), analyzeReference: $("#analyzeReference"), transcribeReference: $("#transcribeReference"), planButton: $("#generatePlan"),
    conceptList: $("#conceptList"), productionPlan: $("#productionPlan"), planMessage: $("#planMessage"),
    scriptEditor: $("#scriptEditor"), saveScript: $("#saveScript"), sceneList: $("#sceneList"),
    researchButton: $("#runResearch"), researchNote: $("#researchNote"), researchSources: $("#researchSources"),
    searchForm: $("#stockSearchForm"), stockResults: $("#stockResults"), assetFile: $("#assetFile"),
    audioKind: $("#audioKind"), uploadAsset: $("#uploadAsset"), assetLibrary: $("#assetLibrary"), assetCount: $("#assetCount"),
    voiceover: $("#generateVoiceover"), captions: $("#generateCaptions"), captionsLink: $("#downloadCaptions"), audioMessage: $("#audioMessage"),
    approvePlan: $("#approvePlan"), approveRender: $("#approveRender"), renderButton: $("#renderButton"),
    renderProgress: $("#renderProgressBar"), renderMessage: $("#renderMessage"), downloadRender: $("#downloadRender"),
    costEstimate: $("#costEstimate"), costState: $("#costState"), activity: $("#activityLog"),
    refresh: $("#refreshButton"), refreshProject: $("#refreshProject"), deleteProject: $("#deleteProject")
  };
  const state = { project: null, projects: [], tools: null, polling: null, busy: false };
  const api = async (path, options = {}) => {
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch("/api" + path, { credentials: "same-origin", ...options, headers, cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : null;
    if (response.status === 401 && path.startsWith("/studio")) showLogin(true);
    if (!response.ok) throw new Error(payload?.error?.message || "Request failed (" + response.status + ").");
    return payload || {};
  };
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }
  function button(text, className, action) {
    const element = node("button", "button " + (className || "secondary"), text);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }
  function setMessage(element, message, kind = "") {
    element.textContent = message || "";
    element.className = "message" + (kind ? " " + kind : "");
  }
  function setBusy(busy) {
    state.busy = busy;
    document.body.classList.toggle("busy", busy);
  }
  function showLogin(visible) {
    ui.loginPane.hidden = !visible;
    ui.appShell.hidden = visible;
    if (visible) ui.loginForm.querySelector('input[name="email"]').focus();
  }
  function formatTime(seconds) {
    const num = Number(seconds);
    if (!Number.isFinite(num)) return "—";
    if (num < 60) return num.toFixed(num % 1 === 0 ? 0 : 1) + "s";
    return Math.floor(num / 60) + ":" + String(Math.floor(num % 60)).padStart(2, "0");
  }
  function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes))) return "";
    const n = Number(bytes);
    return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }
  function showAssetPreview(asset, project) {
    const url = "/api/studio/projects/" + encodeURIComponent(project.id) + "/assets/" + encodeURIComponent(asset.filename);
    if (asset.kind === "image") {
      const img = node("img", "asset-preview");
      img.src = url; img.alt = asset.title || "Imported still"; img.loading = "lazy";
      return img;
    }
    if (asset.kind === "video") {
      const video = node("video", "asset-preview");
      video.src = url; video.preload = "metadata"; video.muted = true; video.controls = true;
      return video;
    }
    const audio = node("audio", "asset-preview");
    audio.src = url; audio.controls = true;
    return audio;
  }
  async function refreshAll() {
    try {
      const [status, listed] = await Promise.all([api("/studio/status"), api("/studio/projects")]);
      state.tools = status.tools;
      state.projects = listed.projects || [];
      ui.connection.textContent = status.mode === "local-loopback" ? "LOCAL WORKSPACE" : "ULTRON ACCOUNT";
      ui.connection.classList.add("ok");
      ui.engineSummary.textContent = state.tools.modelProviders?.length ? state.tools.modelProviders.map(p => p.name).join(" + ") : "Local templates available";
      renderToolChecklist(status);
      renderProjectList();
      showLogin(false);
      if (state.project) {
        const latest = state.projects.find(p => p.id === state.project.id);
        if (latest) state.project = latest;
        else state.project = null;
      }
      if (!state.project && state.projects.length) state.project = state.projects[0];
      renderProject();
      if (state.project?.stage === "rendering") startPolling();
      else stopPolling();
    } catch (error) {
      ui.connection.textContent = "SESSION REQUIRED";
      ui.connection.classList.remove("ok");
      if (/sign in|account|401/i.test(error.message)) showLogin(true);
      else {
        showLogin(false);
        ui.appShell.hidden = false;
        setMessage(ui.createMessage, error.message, "error");
      }
    }
  }
  function renderToolChecklist(status) {
    ui.toolChecklist.replaceChildren();
    const tools = status.tools || {};
    const checks = [
      ["AI planning", Boolean(tools.modelProviders?.length), tools.modelProviders?.length ? tools.modelProviders.map(p => p.name).join(", ") : "local template fallback"],
      ["FFmpeg renderer", Boolean(tools.ffmpeg?.available), tools.ffmpeg?.version || "install FFmpeg"],
      ["FFprobe analysis", Boolean(tools.ffprobe?.available), tools.ffprobe?.version || "install FFmpeg"],
      ["Reference metadata", Boolean(tools.ytDlp?.available), tools.ytDlp?.version || "optional yt-dlp"],
      ["Stock search", Boolean(tools.pexels || tools.pixabay), "optional Pexels/Pixabay keys"],
      ["Live research", Boolean(tools.research), "optional Tavily key"],
      ["Voiceover", Boolean(tools.voiceover), "VoiceStudio or compatible TTS"],
      ["Transcription", Boolean(tools.transcription), "compatible STT endpoint"]
    ];
    checks.forEach(([name, ready, detail]) => {
      const li = node("li", ready ? "ready" : "", name + " · " + detail);
      ui.toolChecklist.append(li);
    });
  }
  function renderProjectList() {
    ui.projectList.replaceChildren();
    ui.projectCount.textContent = state.projects.length;
    if (!state.projects.length) {
      ui.projectList.append(node("p", "muted tiny", "No projects yet. Create your first board to begin."));
      return;
    }
    state.projects.forEach(project => {
      const b = node("button", project.id === state.project?.id ? "active" : "");
      b.type = "button";
      b.append(node("strong", "", project.title || project.prompt || "Untitled"));
      b.append(node("small", "project-mini-stage", String(project.stage || "idea").replaceAll("_", " ")));
      b.append(node("small", "", new Date(project.updatedAt).toLocaleString()));
      b.addEventListener("click", async () => {
        try {
          const result = await api("/studio/projects/" + encodeURIComponent(project.id));
          state.project = result.project;
          renderProject();
          renderProjectList();
          if (state.project.stage === "rendering") startPolling();
          else stopPolling();
        } catch (error) { alert(error.message); }
      });
      ui.projectList.append(b);
    });
  }
  function renderStages(project) {
    const steps = [
      ["idea", "Brief"], ["reference_analyzed", "Reference"], ["planned", "Plan"], ["plan_approved", "Plan OK"],
      ["assets_ready", "Assets"], ["ready_to_render", "Approved"], ["rendering", "Render"], ["rendered", "Final"]
    ];
    const progress = { idea:0, reference_analyzed:1, planned:2, plan_approved:3, assets_ready:4, ready_to_render:5, rendering:6, rendered:7 };
    const current = progress[project.stage] ?? 0;
    ui.stageTrack.replaceChildren();
    steps.forEach(([key, label], i) => {
      const step = node("div", "stage-step" + (i < current ? " done" : i === current ? " active" : ""));
      step.append(node("small", "", String(i + 1).padStart(2, "0")));
      step.append(node("strong", "", label));
      ui.stageTrack.append(step);
    });
  }
  function renderProject() {
    const p = state.project;
    ui.projectWorkspace.hidden = !p;
    if (!p) { renderProjectList(); return; }
    ui.activeTitle.textContent = p.title || "Untitled production";
    ui.activeMeta.textContent = (p.aspectRatio || "9:16") + " · " + formatTime(p.durationSeconds) + " · " + (p.format || "hybrid").replaceAll("-", " ") + " · " + (p.language || "English");
    ui.activeStage.textContent = String(p.stage || "idea").replaceAll("_", " ");
    renderStages(p);
    renderReference(p);
    renderConcepts(p);
    renderScript(p);
    renderResearch(p);
    renderAssets(p);
    renderCosts(p);
    renderActivity(p);
    ui.approvePlan.disabled = !p.plan || Boolean(p.approvals?.plan);
    ui.approvePlan.textContent = p.approvals?.plan ? "Plan approved ✓" : "Approve plan";
    const hasVisuals = (p.assets || []).some(a => ["video", "image"].includes(a.kind));
    ui.approveRender.disabled = !p.approvals?.plan || !hasVisuals || Boolean(p.approvals?.render) || p.stage === "rendering";
    ui.approveRender.textContent = p.approvals?.render ? "Final render approved ✓" : "Approve final render";
    ui.renderButton.disabled = !p.approvals?.plan || !p.approvals?.render || !hasVisuals || p.stage === "rendering" || p.stage === "rendered";
    ui.renderButton.textContent = p.stage === "rendering" ? "Rendering…" : p.stage === "rendered" ? "Render complete ✓" : "Render final MP4";
    ui.renderProgress.style.width = Math.max(0, Math.min(100, Number(p.renderProgress?.percent) || 0)) + "%";
    setMessage(ui.renderMessage, p.renderError ? "Last render failed: " + p.renderError + ". Check FFmpeg and imported media, then retry." :
      p.stage === "rendering" ? "FFmpeg is processing the approved timeline. This can take a while on a CPU-only laptop." :
      p.stage === "rendered" ? "Your MP4 is ready. Captions are provided as a separate SRT sidecar." : "");
    ui.downloadRender.hidden = p.stage !== "rendered";
    if (p.stage === "rendered") ui.downloadRender.href = "/api/studio/projects/" + encodeURIComponent(p.id) + "/render";
    ui.captionsLink.hidden = !p.captionsFile;
    if (p.captionsFile) ui.captionsLink.href = "/api/studio/projects/" + encodeURIComponent(p.id) + "/captions";
    ui.referenceTranscript.value = p.reference?.transcript || "";
    renderProjectList();
  }
  function renderReference(p) {
    const ref = p.reference || {};
    if (ref.url) ui.referenceSummary.textContent = "Reference: " + ref.platform + " · " + (ref.title || ref.url);
    else if (ref.fileName) ui.referenceSummary.textContent = "Local reference uploaded: " + (ref.title || "clip") + " · " + formatBytes(ref.bytes);
    else ui.referenceSummary.textContent = "No reference attached. Upload a local clip for scene-change detection, or use a URL for limited public metadata.";
    ui.referenceAnalysis.replaceChildren();
    const a = ref.analysis;
    if (!a) return;
    const metrics = [
      ["Analysis depth", a.analysisDepth || "partial"], ["Duration", a.durationSeconds ? formatTime(a.durationSeconds) : "Unknown"],
      ["Dimensions", a.width && a.height ? a.width + " × " + a.height : "Unknown"],
      ["Scene cuts", Array.isArray(a.sceneCutsSeconds) ? a.sceneCutsSeconds.length : "Not measured"],
      ["Cuts / minute", a.pacing?.cutsPerMinute ?? "Unknown"], ["Transcript", a.transcript ? "Provided" : "Missing"]
    ];
    metrics.forEach(([label, value]) => {
      const card = node("div", "metric-card");
      card.append(node("small", "", label), node("strong", "", value));
      ui.referenceAnalysis.append(card);
    });
    (a.notes || []).forEach(note => ui.referenceAnalysis.append(node("p", "muted tiny", note)));
  }
  function renderConcepts(p) {
    ui.conceptList.replaceChildren();
    if (!Array.isArray(p.concepts) || !p.concepts.length) {
      ui.conceptList.append(node("p", "muted tiny", "Generate three concepts to review possible directions."));
    } else {
      p.concepts.forEach((concept, index) => {
        const card = node("article", "concept-card" + (concept.id === p.selectedConceptId ? " selected" : ""));
        card.tabIndex = 0; card.setAttribute("role", "button");
        card.append(node("span", "concept-number", "CONCEPT " + String(index + 1).padStart(2, "0")));
        card.append(node("h4", "", concept.title));
        card.append(node("p", "", concept.logline));
        card.append(node("p", "", "Visuals: " + (concept.style || "—")));
        card.append(node("p", "", "Pacing: " + (concept.pacing || "—")));
        card.append(node("p", "concept-meta", "Assets: " + (concept.approach || "—")));
        card.addEventListener("click", () => {
          p.selectedConceptId = concept.id;
          renderConcepts(p);
          setMessage(ui.planMessage, "Selected concept: " + concept.title + ". Regenerate or edit the script if you want the plan rewritten around this concept.", "success");
        });
        ui.conceptList.append(card);
      });
    }
    ui.productionPlan.replaceChildren();
    if (p.productionPlan) {
      const title = node("h4", "", "Production workflow");
      const ordered = node("ol");
      (p.productionPlan.workflow || []).forEach(item => ordered.append(node("li", "", item)));
      const checksTitle = node("h4", "", "Review checklist");
      checksTitle.style.marginTop = "14px";
      const list = node("ul");
      (p.productionPlan.checks || []).forEach(item => list.append(node("li", "", item)));
      ui.productionPlan.append(title, ordered, checksTitle, list);
    } else ui.productionPlan.append(node("p", "muted tiny", "A plan has not been generated yet."));
  }
  function renderScript(p) {
    if (document.activeElement !== ui.scriptEditor) ui.scriptEditor.value = p.script || "";
    ui.sceneList.replaceChildren();
    (p.scenes || []).forEach(scene => {
      const row = node("article", "scene-row");
      row.append(node("div", "scene-index", String(scene.sceneNumber).padStart(2, "0")));
      const content = node("div");
      content.append(node("h4", "", scene.visualPrompt || "Scene " + scene.sceneNumber));
      content.append(node("p", "", scene.narration || ""));
      content.append(node("p", "muted tiny", "Asset query: " + (scene.searchQuery || "—") + " · Transition: " + (scene.transition || "cut")));
      row.append(content, node("div", "scene-time", formatTime(scene.startSeconds) + " · " + formatTime(scene.durationSeconds)));
      ui.sceneList.append(row);
    });
  }
  function renderResearch(p) {
    const r = p.research || { state: "not_run" };
    ui.researchNote.textContent = r.note || (r.state === "not_run" ? "Click Research brief to run a live search if configured." : "Research state: " + r.state);
    ui.researchSources.replaceChildren();
    (r.sources || []).forEach(source => {
      const item = node("article", "source-item");
      item.append(node("strong", "", source.title || "Source"));
      item.append(node("p", "", source.content || ""));
      const link = node("a", "", "Open source ↗");
      link.href = source.url; link.target = "_blank"; link.rel = "noreferrer noopener";
      item.append(link); ui.researchSources.append(item);
    });
  }
  function renderAssets(p) {
    const assets = p.assets || [];
    ui.assetCount.textContent = assets.length + " assets";
    ui.assetLibrary.replaceChildren();
    if (!assets.length) ui.assetLibrary.append(node("p", "muted tiny", "No imported assets yet. Search stock or upload a local video, still or audio file."));
    assets.forEach(asset => {
      const row = node("div", "asset-item");
      row.append(showAssetPreview(asset, p));
      const metadata = node("div");
      metadata.append(node("strong", "", asset.title || asset.filename));
      metadata.append(node("small", "asset-kind", asset.kind + " · " + asset.provider));
      metadata.append(node("small", "", formatBytes(asset.bytes) + (asset.author ? " · by " + asset.author : "")));
      if (asset.sourcePage && /^https:\/\//i.test(asset.sourcePage)) {
        const link = node("a", "", "Source / creator credit ↗"); link.href = asset.sourcePage; link.target = "_blank"; link.rel = "noreferrer noopener"; metadata.append(link);
      }
      row.append(metadata);
      row.append(node("small", "", asset.selected === false ? "Not selected" : "In timeline"));
      ui.assetLibrary.append(row);
    });
  }
  function renderCosts(p) {
    const cost = p.costEstimate || {};
    ui.costEstimate.replaceChildren();
    const cards = [
      ["Local render", "$0.00", "CPU processing on this machine"],
      ["AI estimate", cost.aiEstimateUsd == null ? "Not priced" : "$" + Number(cost.aiEstimateUsd).toFixed(4), "Uses configured token unit rate"],
      ["Voice estimate", cost.voiceoverEstimateUsd == null ? "Not priced" : "$" + Number(cost.voiceoverEstimateUsd).toFixed(4), "Uses configured TTS character rate"]
    ];
    cards.forEach(([label, value, note]) => {
      const card = node("div", "cost-card");
      card.append(node("small", "", label), node("strong", value === "Not priced" ? "unknown" : "", value), node("small", "", note));
      ui.costEstimate.append(card);
    });
    ui.costState.textContent = cost.pricingComplete ? "ESTIMATE CONFIGURED" : "COST PARTIAL";
  }
  function renderActivity(p) {
    ui.activity.replaceChildren();
    const items = p.activity || [];
    if (!items.length) ui.activity.append(node("p", "muted tiny", "No activity recorded yet."));
    items.slice(0, 30).forEach(item => {
      const row = node("div", "activity-item");
      const content = node("div");
      content.append(node("strong", "", item.label), node("span", "", item.detail || ""));
      const time = node("time", "", item.at ? new Date(item.at).toLocaleTimeString() : "");
      row.append(content, time); ui.activity.append(row);
    });
  }
  async function loadProject(id) {
    const data = await api("/studio/projects/" + encodeURIComponent(id));
    state.project = data.project; renderProject();
    if (state.project.stage === "rendering") startPolling(); else stopPolling();
  }
  async function performProjectAction(path, options, messageElement, successText) {
    if (!state.project) return;
    try {
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + path, options || {});
      if (result.project) state.project = result.project;
      if (result.research && state.project) state.project.research = result.research;
      renderProject();
      if (successText) setMessage(messageElement, successText, "success");
      await refreshAll();
      return result;
    } catch (error) { setMessage(messageElement, error.message, "error"); }
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("The selected file could not be read."));
      reader.onload = () => {
        const value = String(reader.result || "");
        resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
      };
      reader.readAsDataURL(file);
    });
  }
  async function pollProject() {
    if (!state.project || document.hidden || state.busy) return;
    try {
      const data = await api("/studio/projects/" + encodeURIComponent(state.project.id));
      state.project = data.project; renderProject();
      if (state.project.stage !== "rendering") stopPolling();
    } catch {}
  }
  function startPolling() {
    if (state.polling) return;
    state.polling = window.setInterval(pollProject, 2200);
  }
  function stopPolling() {
    if (state.polling) window.clearInterval(state.polling);
    state.polling = null;
  }

  ui.loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(ui.loginForm));
    setMessage(ui.loginMessage, "Signing in…");
    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email, password: data.password })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message || "Sign-in failed.");
      ui.loginForm.reset(); setMessage(ui.loginMessage, "Signed in.", "success");
      await refreshAll();
    } catch (error) { setMessage(ui.loginMessage, error.message, "error"); }
  });
  ui.createForm.addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(ui.createForm);
    const body = {
      prompt: form.get("prompt"), referenceUrl: form.get("referenceUrl"), format: form.get("format"),
      aspectRatio: form.get("aspectRatio"), durationSeconds: Number(form.get("durationSeconds")),
      language: form.get("language"), referenceRightsConfirmed: form.get("referenceRightsConfirmed") === "on"
    };
    const referenceFile = ui.referenceFile.files[0];
    if (referenceFile && referenceFile.size > 8 * 1024 * 1024) {
      setMessage(ui.createMessage, "Reference clip is over the 8 MB UI upload limit. Compress a short sample first.", "error"); return;
    }
    setBusy(true); setMessage(ui.createMessage, "Creating local project…");
    try {
      const result = await api("/studio/projects", { method: "POST", body: JSON.stringify(body) });
      state.project = result.project;
      if (referenceFile) {
        await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/reference/upload", {
          method: "POST", body: JSON.stringify({ filename: referenceFile.name, fileBase64: await fileToBase64(referenceFile) })
        });
        await loadProject(state.project.id);
      }
      ui.createForm.reset(); renderProject(); await refreshAll();
      setMessage(ui.createMessage, "Production board created.", "success");
    } catch (error) { setMessage(ui.createMessage, error.message, "error"); }
    finally { setBusy(false); }
  });
  ui.transcribeReference.addEventListener("click", async () => {
    if (!state.project) return;
    ui.transcribeReference.disabled = true;
    setMessage(ui.planMessage, "Extracting audio locally and requesting transcription…");
    try {
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/reference/transcribe", {
        method: "POST", body: JSON.stringify({ language: state.project.language === "Auto-detect" ? "" : state.project.language })
      });
      state.project = result.project;
      ui.referenceTranscript.value = result.transcript || "";
      renderProject();
      setMessage(ui.planMessage, "Reference transcript created by " + result.provider + ". Review names and wording before using it in a new script.", "success");
      await refreshAll();
    } catch (error) { setMessage(ui.planMessage, error.message, "error"); }
    finally { ui.transcribeReference.disabled = false; }
  });

  ui.analyzeReference.addEventListener("click", async () => {
    if (!state.project) return;
    ui.analyzeReference.disabled = true;
    try {
      const result = await performProjectAction("/reference/analyze", {
        method: "POST", body: JSON.stringify({ transcript: ui.referenceTranscript.value })
      }, ui.planMessage, "Reference analysis saved.");
      if (result?.analysis) renderReference(state.project);
    } finally { ui.analyzeReference.disabled = false; }
  });
  ui.planButton.addEventListener("click", async () => {
    if (!state.project) return;
    ui.planButton.disabled = true; setMessage(ui.planMessage, "Building three concepts and a timed production plan…");
    try {
      await performProjectAction("/plan", { method: "POST", body: "{}" }, ui.planMessage, "Production plan is ready. Select a direction and review before approving.");
    } finally { ui.planButton.disabled = false; }
  });
  ui.saveScript.addEventListener("click", async () => {
    await performProjectAction("/script", { method: "PATCH", body: JSON.stringify({ script: ui.scriptEditor.value }) }, ui.planMessage, "Script edits saved. Plan approval has been reset.");
  });
  ui.approvePlan.addEventListener("click", async () => {
    await performProjectAction("/approve", { method: "POST", body: JSON.stringify({ stage: "plan" }) }, ui.planMessage, "Plan approved. Gather the visuals, audio and captions before final review.");
  });
  ui.approveRender.addEventListener("click", async () => {
    await performProjectAction("/approve", { method: "POST", body: JSON.stringify({ stage: "render" }) }, ui.renderMessage, "Final-render approval recorded.");
  });
  ui.runResearch.addEventListener("click", async () => {
    const result = await performProjectAction("/research", { method: "POST", body: JSON.stringify({}) }, ui.researchNote, "");
    if (result?.research) {
      ui.researchNote.textContent = result.research.note || "Research " + result.research.state;
      renderResearch(state.project);
    }
  });
  ui.searchForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!state.project) return;
    const form = new FormData(ui.searchForm);
    ui.stockResults.replaceChildren(node("p", "muted tiny", "Searching stock providers…"));
    try {
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/assets/search", {
        method: "POST", body: JSON.stringify({ query: form.get("query"), kind: form.get("kind") })
      });
      ui.stockResults.replaceChildren();
      if (!result.results?.length) ui.stockResults.append(node("p", "muted tiny", "No results returned. Check your keys, provider quota or try another query."));
      (result.results || []).forEach(item => {
        const card = node("article", "asset-result");
        if (item.thumbnailUrl && /^https:\/\//i.test(item.thumbnailUrl)) {
          const img = node("img", "asset-thumb"); img.src = item.thumbnailUrl; img.loading = "lazy"; img.alt = item.title || "Stock media preview";
          img.referrerPolicy = "no-referrer"; card.append(img);
        } else card.append(node("div", "asset-thumb-placeholder", item.kind === "video" ? "▶" : "▧"));
        const body = node("div", "asset-result-body");
        body.append(node("h4", "", item.title), node("p", "", item.provider + (item.author ? " · " + item.author : "")));
        const source = node("a", "text-link", "Source / licence ↗"); source.href = item.sourcePage; source.target = "_blank"; source.rel = "noopener noreferrer";
        body.append(source);
        const importButton = button("Import to project", "secondary", async () => {
          importButton.disabled = true; importButton.textContent = "Importing…";
          try {
            const imported = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/assets/" + encodeURIComponent(item.id) + "/import", { method: "POST", body: "{}" });
            state.project = imported.project; renderProject(); await refreshAll();
            importButton.textContent = "Imported ✓";
          } catch (error) { importButton.disabled = false; importButton.textContent = "Retry import"; alert(error.message); }
        });
        importButton.disabled = !item.downloadable;
        body.append(importButton); card.append(body); ui.stockResults.append(card);
      });
    } catch (error) { ui.stockResults.replaceChildren(node("p", "message error", error.message)); }
  });
  ui.uploadAsset.addEventListener("click", async () => {
    if (!state.project) return;
    const file = ui.assetFile.files[0];
    if (!file) { setMessage(ui.audioMessage, "Choose an asset file first.", "error"); return; }
    if (file.size > 8 * 1024 * 1024) { setMessage(ui.audioMessage, "This UI upload is limited to 8 MB per file. Compress the media or use a short clip.", "error"); return; }
    setBusy(true); setMessage(ui.audioMessage, "Importing local media…");
    try {
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/assets/upload", {
        method: "POST", body: JSON.stringify({ filename: file.name, fileBase64: await fileToBase64(file), kind: ui.audioKind.value })
      });
      state.project = result.project; ui.assetFile.value = ""; renderProject(); await refreshAll();
      setMessage(ui.audioMessage, "Imported " + file.name + ".", "success");
    } catch (error) { setMessage(ui.audioMessage, error.message, "error"); }
    finally { setBusy(false); }
  });
  ui.voiceover.addEventListener("click", async () => {
    ui.voiceover.disabled = true; setMessage(ui.audioMessage, "Requesting voiceover…");
    try {
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/voiceover", { method: "POST", body: JSON.stringify({ text: ui.scriptEditor.value }) });
      state.project = result.project; renderProject(); await refreshAll();
      setMessage(ui.audioMessage, "Voiceover asset created. Verify the provider voice and pronunciation before final render.", "success");
    } catch (error) { setMessage(ui.audioMessage, error.message, "error"); }
    finally { ui.voiceover.disabled = false; }
  });
  ui.captions.addEventListener("click", async () => {
    try {
      await performProjectAction("/captions", { method: "POST", body: "{}" }, ui.audioMessage, "Caption sidecar created. Review timing and spelling.");
    } catch {}
  });
  ui.renderButton.addEventListener("click", async () => {
    if (!state.project) return;
    ui.renderButton.disabled = true; setMessage(ui.renderMessage, "Starting FFmpeg job…");
    try {
      const ids = (state.project.assets || []).filter(a => ["image", "video"].includes(a.kind) && a.selected !== false).map(a => a.id);
      const result = await api("/studio/projects/" + encodeURIComponent(state.project.id) + "/render", { method: "POST", body: JSON.stringify({ assetIds: ids }) });
      state.project = result.project; renderProject(); startPolling();
      setMessage(ui.renderMessage, "Render queued. Progress will update here as each segment completes.");
    } catch (error) { setMessage(ui.renderMessage, error.message, "error"); }
    finally { ui.renderButton.disabled = false; }
  });
  ui.deleteProject.addEventListener("click", async () => {
    if (!state.project || !confirm("Delete this project and its local assets? This cannot be undone.")) return;
    try {
      await api("/studio/projects/" + encodeURIComponent(state.project.id), { method: "DELETE" });
      state.project = null; await refreshAll();
    } catch (error) { alert(error.message); }
  });
  ui.refresh.addEventListener("click", refreshAll);
  ui.refreshProject.addEventListener("click", async () => { if (state.project) await loadProject(state.project.id); await refreshAll(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.project?.stage === "rendering") void pollProject(); });
  window.addEventListener("beforeunload", stopPolling);
  refreshAll();
})();
