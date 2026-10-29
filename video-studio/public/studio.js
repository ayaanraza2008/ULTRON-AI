(() => {
  "use strict";
  const $ = selector => document.querySelector(selector);
  const ui = {
    createPanel: $("#create-panel"), createForm: $("#create-form"), createBtn: $("#create-btn"),
    workspace: $("#workspace"), projectList: $("#project-list"), projectCount: $("#project-count"),
    statProjects: $("#stat-projects"), statSpend: $("#stat-spend"), modelStatus: $("#model-status"),
    activeTitle: $("#active-title"), activeBrief: $("#active-brief"), projectStatus: $("#project-status"),
    progressText: $("#progress-text"), progressBar: $("#progress-bar"), pipeline: $("#pipeline"),
    concepts: $("#concepts"), budget: $("#budget-box"), planNotes: $("#plan-notes"),
    scenes: $("#scenes"), tools: $("#tools-used"), assets: $("#asset-list"), events: $("#event-list"),
    referenceAnalysis: $("#reference-analysis"), approvalMessage: $("#approval-message"),
    rightsCheck: $("#rights-check"), approveBtn: $("#approve-btn"), renderBtn: $("#render-btn"),
    renderResult: $("#render-result"), toast: $("#toast")
  };
  const STAGES = ["concepts", "production_plan", "research", "assets", "voiceover", "edit", "approval", "render", "complete"];
  const STAGE_LABELS = { concepts: "Concepts", production_plan: "Plan", research: "Research", assets: "Assets", voiceover: "Voiceover", edit: "Captions/edit", approval: "Approval", render: "Render", complete: "Complete" };
  let activeId = null, activeProject = null, poller = null, toastTimer = null, loading = false;
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[ch]);
  function showToast(message) {
    ui.toast.textContent = message; ui.toast.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 3800);
  }
  async function api(url, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };
    if (init.body && typeof init.body !== "string" && !(init.body instanceof Blob)) init.body = JSON.stringify(init.body);
    if (init.body && typeof init.body === "string" && !init.headers["Content-Type"]) init.headers["Content-Type"] = "application/json";
    const response = await fetch(url, init);
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data && data.error && data.error.message || "Request failed (" + response.status + ").");
    return data;
  }
  async function uploadFile(file, kind, sceneId) {
    if (!activeId || !file) return;
    const url = "/api/projects/" + activeId + "/assets/upload?kind=" + encodeURIComponent(kind) + (sceneId ? "&sceneId=" + encodeURIComponent(sceneId) : "");
    await api(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": file.name.slice(0, 180) }, body: file });
    showToast("Uploaded " + file.name);
    await refreshActive();
    if (kind === "reference") {
      try { await api("/api/projects/" + activeId + "/reference/analyze", { method: "POST", body: {} }); showToast("Reference analysis queued. Regenerate the plan when it completes."); }
      catch (e) { showToast(e.message); }
    }
  }
  function setActive(id) {
    activeId = id; activeProject = null;
    ui.createPanel.classList.add("hidden"); ui.workspace.classList.remove("hidden");
    ui.renderResult.classList.add("hidden"); ui.rightsCheck.checked = false;
    if (poller) clearInterval(poller);
    refreshActive();
    refreshProjects();
    poller = setInterval(refreshActive, 2500);
  }
  function statusLabel(project) {
    if (!project) return "LOADING";
    return String(project.status || "queued").replace(/_/g, " ").toUpperCase();
  }
  async function refreshProjects() {
    try {
      const data = await api("/api/projects");
      const projects = data.projects || [];
      ui.projectCount.textContent = String(projects.length);
      ui.statProjects.textContent = String(projects.length);
      ui.statSpend.textContent = "$" + projects.reduce((sum, p) => sum + Number(p.trackedSpendUsd || 0), 0).toFixed(2);
      ui.projectList.innerHTML = projects.length ? projects.map(p => '<button class="project-link ' + (p.id === activeId ? "selected" : "") + '" data-project="' + escapeHtml(p.id) + '" title="' + escapeHtml(p.title) + '">' + escapeHtml(p.title) + '</button>').join("") : '<div class="empty-small">No productions yet.<br>Create your first video above.</div>';
    } catch (error) { ui.projectList.innerHTML = '<div class="empty-small">Could not load projects: ' + escapeHtml(error.message) + "</div>"; }
  }
  async function refreshActive() {
    if (!activeId || loading) return;
    loading = true;
    try {
      const data = await api("/api/projects/" + activeId);
      if (activeId !== data.project.id) return;
      const unchanged = Boolean(activeProject && activeProject.updatedAt === data.project.updatedAt);
      activeProject = data.project;
      if (!unchanged) renderProject(data.project, data.budget || {});
      await refreshProjects();
    } catch (error) {
      if (error.message.toLowerCase().includes("not found")) {
        activeId = null; if (poller) clearInterval(poller); showToast("Project not found.");
      } else console.warn("Video Studio refresh:", error.message);
    } finally { loading = false; }
  }
  function renderPipeline(project) {
    const current = STAGES.indexOf(project.stage);
    ui.pipeline.innerHTML = STAGES.map((stage, index) => '<div class="stage ' + (index < current || project.status === "complete" ? "done" : index === current ? "active" : "") + '">' + escapeHtml(STAGE_LABELS[stage]) + "</div>").join("");
    const progress = Math.max(0, Math.min(100, Number(project.progress) || 0));
    ui.progressText.textContent = progress + "%"; ui.progressBar.style.width = progress + "%";
  }
  function renderProject(project, budget) {
    ui.activeTitle.textContent = project.title || "Untitled production";
    ui.activeBrief.textContent = project.brief || "";
    ui.projectStatus.textContent = statusLabel(project);
    renderPipeline(project); renderConcepts(project); renderPlan(project, budget); renderScenes(project);
    renderAudit(project); renderReference(project); renderApproval(project);
    ui.renderResult.classList.toggle("hidden", !(project.status === "complete" && project.renderFile));
    if (project.status === "complete" && project.renderFile) {
      const url = "/api/projects/" + project.id + "/renders/" + encodeURIComponent(project.renderFile);
      ui.renderResult.innerHTML = '<div class="panel-heading"><div><span class="step-tag">RENDER COMPLETE</span><h3>Your video is ready</h3></div><a href="' + url + '" download>Download MP4 ↗</a></div><video controls preload="metadata" src="' + url + '"></video>' + (project.captionsFile ? '<p><a href="/api/projects/' + project.id + '/assets/' + encodeURIComponent(project.captionsFile) + '" download>Download SRT captions</a></p>' : "");
    }
    ui.modelStatus.textContent = project.toolsUsed && project.toolsUsed.includes("OpenRouter") ? "AI PLANNER READY" : "LOCAL-FIRST MODE";
  }
  function renderConcepts(project) {
    const concepts = project.concepts || [];
    if (!concepts.length) { ui.concepts.innerHTML = '<div class="skeleton">Planning concepts…</div>'; return; }
    ui.concepts.innerHTML = concepts.map(c => {
      const chosen = c.id === project.selectedConceptId;
      return '<article class="concept-card ' + (chosen ? "chosen" : "") + '"><span class="tag">' + (chosen ? "Selected concept" : "Alternative") + '</span><h4>' + escapeHtml(c.title) + '</h4><p>' + escapeHtml(c.angle) + '</p><p class="hook">' + escapeHtml(c.hook) + '</p><p><b>Visuals</b><br>' + escapeHtml(c.visualStyle) + '</p><p><b>Pacing</b><br>' + escapeHtml(c.pacing) + '</p><p><b>Sound</b><br>' + escapeHtml(c.musicMood) + '</p><p><b>Rough cost</b><br>' + escapeHtml(c.estimatedCostUsd || "Provider-dependent; not metered") + '</p><button class="' + (chosen ? "secondary-button" : "ghost-button") + '" data-concept="' + escapeHtml(c.id) + '">' + (chosen ? "Selected" : "Use this concept") + '</button></article>';
    }).join("");
  }
  function renderPlan(project, budget) {
    const plan = project.productionPlan || {};
    ui.budget.innerHTML = '<div class="budget-main">$0 local tools</div><small>' + escapeHtml(plan.budgetEstimate || budget.note || "Actual hosted API charges are not measured by the studio.") + '</small><small>Tracked spend: $' + Number(project.trackedSpendUsd || 0).toFixed(2) + ' · Provider charges are not automatically metered.</small>';
    const questions = Array.isArray(plan.researchQuestions) ? plan.researchQuestions : [];
    const notes = Array.isArray(plan.productionNotes) ? plan.productionNotes : [];
    const research = project.researchResults || null;
    ui.planNotes.innerHTML = '<b>Draft script</b><p>' + escapeHtml(plan.script || "Planning…") + '</p>' +
      (questions.length ? '<b>Research to verify</b><ul>' + questions.map(x => "<li>" + escapeHtml(x) + "</li>").join("") + '</ul>' : "") +
      (notes.length ? '<b>Production notes</b><ul>' + notes.map(x => "<li>" + escapeHtml(x) + "</li>").join("") + "</ul>" : "") +
      (research ? '<div class="research-summary"><b>Research summary</b><p>' + escapeHtml(research.answer || research.note || "Sources found.") + '</p><small>' + escapeHtml(research.note || "") + '</small><ul>' + (research.sources || []).map(s => '<li><a href="' + escapeHtml(s.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.title || s.url) + '</a><br><small>' + escapeHtml(s.snippet || "") + '</small></li>').join("") + '</ul></div>' : '<p class="muted">Live source research is optional. Use “Research the brief” after adding TAVILY_API_KEY.</p>');
  }
  function renderScenes(project) {
    const scenes = project.scenes || [];
    const panelHeading = document.querySelector(".scenes-panel .panel-heading");
    if (panelHeading && !$("#save-scenes")) {
      const button = document.createElement("button"); button.id = "save-scenes"; button.className = "ghost-button small"; button.textContent = "Save scene edits";
      const upload = panelHeading.querySelector(".upload-button"); panelHeading.insertBefore(button, upload || null);
      button.addEventListener("click", saveScenes);
    }
    if (!scenes.length) { ui.scenes.innerHTML = '<div class="skeleton">Scenes will appear after planning completes.</div>'; return; }
    ui.scenes.innerHTML = scenes.map((s, i) => {
      const candidates = Array.isArray(s.assetCandidates) ? s.assetCandidates : [];
      const asset = (project.assets || []).find(a => a.filename === s.assetFile);
      return '<article class="scene-card" data-scene-card="' + escapeHtml(s.id) + '">' +
        '<div class="scene-head"><div class="scene-number">' + String(i + 1).padStart(2, "0") + '</div><div><h4>' + escapeHtml(s.title) + '</h4><small>' + Number(s.durationSeconds || 0) + ' seconds · ' + escapeHtml(s.mediaType || project.sourceMode) + '</small></div><span class="scene-status">' + escapeHtml(asset ? "ASSET READY" : s.status || "NEEDS ASSET") + '</span></div>' +
        '<div class="scene-body"><div class="scene-fields"><div><label>VISUAL DIRECTION</label><textarea data-scene="' + escapeHtml(s.id) + '" data-field="visual">' + escapeHtml(s.visual) + '</textarea></div><div><label>NARRATION / SCRIPT</label><textarea data-scene="' + escapeHtml(s.id) + '" data-field="narration">' + escapeHtml(s.narration) + '</textarea></div></div>' +
        '<div class="scene-actions"><input class="search-query" data-query="' + escapeHtml(s.id) + '" value="' + escapeHtml(s.searchQuery || s.visual || "") + '" aria-label="Stock search query"><button class="secondary-button" data-search="' + escapeHtml(s.id) + '">Find ' + (project.sourceMode === "images" ? "images" : "footage") + '</button><label class="upload-button">Upload asset <input type="file" data-upload-scene="' + escapeHtml(s.id) + '" accept="video/*,image/*" hidden></label>' +
        (asset ? '<span class="muted">' + escapeHtml(asset.name) + ' · ' + Math.ceil(Number(asset.bytes || 0) / 1024) + ' KB</span>' : "") + '</div>' +
        (candidates.length ? (candidates.some(c => c.provider === "pexels") ? '<p class="muted">Stock search via <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>. Review the creator/source page for licensing and attribution.</p>' : "") + '<div class="asset-candidates">' + candidates.map(c => '<div class="candidate"><img loading="lazy" src="' + escapeHtml(c.previewUrl || "") + '" alt=""><div class="candidate-info"><b>' + escapeHtml(c.title) + '</b><small>' + escapeHtml(c.creator || c.provider) + ' · ' + escapeHtml(c.license || "License not identified") + '</small><a href="' + escapeHtml(c.pageUrl || "#") + '" target="_blank" rel="noopener noreferrer">Source / license ↗</a><br><button class="secondary-button" data-import="' + escapeHtml(c.id) + '" data-import-scene="' + escapeHtml(s.id) + '">Use this asset</button></div></div>').join("") + '</div>' : "") +
        '</div></article>';
    }).join("");
  }
  function renderAudit(project) {
    const tools = project.toolsUsed || [], assets = project.assets || [], events = project.events || [];
    ui.tools.innerHTML = tools.length ? [...new Set(tools)].map(t => '<span>' + escapeHtml(t) + '</span>').join("") : '<span>Awaiting tool usage</span>';
    ui.assets.innerHTML = assets.length ? assets.slice().reverse().map(a => '<div class="asset-row"><b>' + escapeHtml(a.name || a.filename) + '</b><small>' + escapeHtml(a.kind) + ' · ' + escapeHtml(a.provider || "local") + ' · ' + (Number(a.bytes || 0) ? Math.ceil(Number(a.bytes) / 1024) + " KB" : "Generated text") + (a.license ? " · " + escapeHtml(a.license) : "") + '</small>' + (a.sourceUrl ? '<small><a href="' + escapeHtml(a.sourceUrl) + '" target="_blank" rel="noopener noreferrer">Source page ↗</a></small>' : "") + '</div>').join("") : '<div class="muted">No assets imported yet.</div>';
    ui.events.innerHTML = events.length ? events.slice().reverse().slice(0, 12).map(e => '<div class="event-row"><span class="' + (e.level === "error" ? "event-level" : "") + '">' + escapeHtml(e.message) + '</span><small>' + escapeHtml(e.stage) + ' · ' + escapeHtml(new Date(e.at).toLocaleTimeString()) + '</small></div>').join("") : '<div class="muted">Activity will appear here.</div>';
  }
  function renderReference(project) {
    const r = project.referenceAnalysis;
    if (!r) { ui.referenceAnalysis.classList.add("hidden"); return; }
    ui.referenceAnalysis.classList.remove("hidden");
    ui.referenceAnalysis.innerHTML = '<b>Reference notes: </b>' + escapeHtml(r.title || r.source || "Reference") + '<br>' + escapeHtml(r.styleNotes || "") +
      (r.warning ? '<br><span class="event-level">' + escapeHtml(r.warning) + '</span>' : "") +
      (r.durationSeconds ? '<br>Detected duration: ' + Number(r.durationSeconds) + ' seconds' : "") +
      (r.transcriptAvailable ? '<br><details><summary>Available transcript</summary><p>' + escapeHtml(r.transcript || "") + '</p></details>' : '<br>Transcript: ' + (r.source === "remote_url" ? "not available from source subtitles" : "not extracted"));
  }
  function renderApproval(project) {
    const missing = (project.scenes || []).filter(s => !s.assetFile || !(project.assets || []).some(a => a.filename === s.assetFile && a.sceneId === s.id));
    ui.approveBtn.disabled = missing.length > 0;
    ui.approveBtn.textContent = project.approved ? "Approved ✓" : "Approve production";
    ui.renderBtn.disabled = !project.approved || !ui.rightsCheck.checked || project.status === "rendering";
    ui.approvalMessage.textContent = missing.length ? missing.length + " scene(s) still need media assets." : project.approved ? "Approved at " + new Date(project.approvedAt).toLocaleString() + ". Check rights confirmation to enable rendering." : "All scenes have assets. Confirm rights and approve to unlock render.";
    if (project.approved) ui.approvalMessage.textContent = "Production approved. Check the rights confirmation again to enable rendering.";
  }
  async function saveScenes() {
    if (!activeProject) return;
    const scenes = activeProject.scenes.map(scene => {
      const visual = document.querySelector('[data-scene="' + scene.id + '"][data-field="visual"]');
      const narration = document.querySelector('[data-scene="' + scene.id + '"][data-field="narration"]');
      const query = document.querySelector("[data-query=\"" + scene.id + "\"]");
      return { ...scene, visual: visual ? visual.value : scene.visual, narration: narration ? narration.value : scene.narration, searchQuery: query ? query.value : scene.searchQuery };
    });
    try { await api("/api/projects/" + activeId + "/scenes", { method: "POST", body: { scenes } }); showToast("Scene edits saved. Approval reset."); await refreshActive(); }
    catch (error) { showToast(error.message); }
  }
  async function createProject(event) {
    event.preventDefault();
    const brief = $("#brief").value.trim();
    const payload = { brief, title: $("#title").value.trim(), referenceUrl: $("#reference-url").value.trim(), durationSeconds: Number($("#duration").value), format: $("#format").value, sourceMode: $("#source-mode").value };
    ui.createBtn.disabled = true; ui.createBtn.textContent = "Creating…";
    try {
      const result = await api("/api/projects", { method: "POST", body: payload });
      showToast("Production created. Concepts are being prepared.");
      setActive(result.project.id);
    } catch (error) { showToast(error.message); }
    finally { ui.createBtn.disabled = false; ui.createBtn.innerHTML = 'Create production <span>↗</span>'; }
  }
  async function searchAssets(sceneId) {
    if (!activeProject) return;
    const input = document.querySelector("[data-query=\"" + sceneId + "\"]");
    const scene = activeProject.scenes.find(s => s.id === sceneId);
    const query = input && input.value.trim() || scene && (scene.searchQuery || scene.visual) || "";
    if (!query) return showToast("Enter a visual search phrase first.");
    try { await api("/api/projects/" + activeId + "/assets/search", { method: "POST", body: { sceneId, query } }); showToast("Asset search complete."); await refreshActive(); }
    catch (error) { showToast(error.message); }
  }
  async function importAsset(sceneId, candidateId) {
    try { await api("/api/projects/" + activeId + "/assets/import", { method: "POST", body: { sceneId, candidateId } }); showToast("Asset imported into the project."); await refreshActive(); }
    catch (error) { showToast(error.message); }
  }
  async function postAction(path, body, message) {
    try { await api("/api/projects/" + activeId + "/" + path, { method: "POST", body: body || {} }); if (message) showToast(message); await refreshActive(); }
    catch (error) { showToast(error.message); }
  }
  async function chooseConcept(id) {
    try {
      await api("/api/projects/" + activeId + "/concepts/select", { method: "POST", body: { conceptId: id } });
      await api("/api/projects/" + activeId + "/plan", { method: "POST", body: { conceptId: id } });
      showToast("Concept selected. A matching scene plan is being generated."); await refreshActive();
    } catch (error) { showToast(error.message); }
  }
  async function renderNow() {
    if (!ui.rightsCheck.checked) return showToast("Confirm the media and music rights first.");
    try {
      await api("/api/projects/" + activeId + "/render", { method: "POST", body: { burnCaptions: Boolean(activeProject && activeProject.captionsFile) } });
      showToast("Render queued. Progress will update automatically."); await refreshActive();
    } catch (error) { showToast(error.message); }
  }
  async function approveNow() {
    if (!ui.rightsCheck.checked) return showToast("Tick the rights-review checkbox before approval.");
    await postAction("approve", { approved: true }, "Production approved. Final render is unlocked.");
  }
  ui.createForm.addEventListener("submit", createProject);
  $("#new-project-shortcut").addEventListener("click", () => { activeId = null; if (poller) clearInterval(poller); ui.workspace.classList.add("hidden"); ui.createPanel.classList.remove("hidden"); $("#brief").focus(); });
  $("#back-new").addEventListener("click", () => { activeId = null; if (poller) clearInterval(poller); ui.workspace.classList.add("hidden"); ui.createPanel.classList.remove("hidden"); });
  $("#refresh-btn").addEventListener("click", () => { refreshProjects(); refreshActive(); });
  ui.projectList.addEventListener("click", e => { const button = e.target.closest("[data-project]"); if (button) setActive(button.dataset.project); });
  ui.concepts.addEventListener("click", e => { const button = e.target.closest("[data-concept]"); if (button && button.dataset.concept !== (activeProject && activeProject.selectedConceptId)) chooseConcept(button.dataset.concept); });
  ui.scenes.addEventListener("click", e => {
    const search = e.target.closest("[data-search]"); if (search) return searchAssets(search.dataset.search);
    const imp = e.target.closest("[data-import]"); if (imp) return importAsset(imp.dataset.importScene, imp.dataset.import);
  });
  ui.scenes.addEventListener("change", e => {
    const file = e.target.closest("[data-upload-scene]");
    if (file && file.files && file.files[0]) uploadFile(file.files[0], "asset", file.dataset.uploadScene).catch(error => showToast(error.message));
  });
  ui.rightsCheck.addEventListener("change", () => { if (activeProject) renderApproval(activeProject); });
  ui.approveBtn.addEventListener("click", approveNow);
  ui.renderBtn.addEventListener("click", renderNow);
  $("#regenerate-plan").addEventListener("click", () => postAction("plan", { conceptId: activeProject && activeProject.selectedConceptId }, "Plan regeneration queued."));
  $("#make-voice").addEventListener("click", () => postAction("voiceover", {}, "Local voiceover queued."));
  $("#make-captions").addEventListener("click", () => postAction("captions", {}, "SRT caption generation requested."));
  $("#research-btn").addEventListener("click", () => postAction("research", {}, "Live web research requested."));
  $("#reference-file").addEventListener("change", e => { if (e.target.files[0]) uploadFile(e.target.files[0], "reference").catch(error => showToast(error.message)); e.target.value = ""; });
  $("#voice-file").addEventListener("change", e => { if (e.target.files[0]) uploadFile(e.target.files[0], "voiceover").catch(error => showToast(error.message)); e.target.value = ""; });
  $("#music-file").addEventListener("change", e => { if (e.target.files[0]) uploadFile(e.target.files[0], "music").catch(error => showToast(error.message)); e.target.value = ""; });
  api("/api/health").then(data => { ui.modelStatus.textContent = data.tools && data.tools.modelConfigured ? "AI PLANNER READY" : "LOCAL-FIRST MODE"; }).catch(() => { ui.modelStatus.textContent = "LOCAL STUDIO"; });
  refreshProjects();
})();
