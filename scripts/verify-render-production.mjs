const BACKEND_URL = "https://ultron-ai-core.onrender.com";
const FRONTEND_URL = "https://ultron-core-interface.onrender.com";

async function checkRoute(label, url, options = {}) {
  try {
    const start = Date.now();
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options
    });
    const duration = Date.now() - start;
    const contentType = res.headers.get("content-type") || "";
    let bodyText = "";
    try {
      bodyText = await res.text();
    } catch {}

    let json = null;
    if (contentType.includes("json")) {
      try { json = JSON.parse(bodyText); } catch {}
    }

    return {
      label,
      url,
      status: res.status,
      ok: res.ok,
      durationMs: duration,
      contentType,
      bodyPreview: bodyText.slice(0, 160).replace(/\r?\n/g, " "),
      json
    };
  } catch (err) {
    return {
      label,
      url,
      status: 0,
      ok: false,
      error: err.message
    };
  }
}

async function runAudit() {
  console.log("=== ULTRON PRODUCTION CLOUD INFRASTRUCTURE AUDIT ===");

  console.log("\n--- [A] Testing Backend Service (ultron-ai-core) ---");
  const bHealth = await checkRoute("Backend Health", `${BACKEND_URL}/api/health`);
  console.log("Backend Health:", bHealth.status, bHealth.bodyPreview);

  const bAuth = await checkRoute("Backend Auth Status", `${BACKEND_URL}/api/auth/status`);
  console.log("Backend Auth Status:", bAuth.status, bAuth.bodyPreview);

  const bChat = await checkRoute("Backend Chat (unauthenticated)", `${BACKEND_URL}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] })
  });
  console.log("Backend Chat (unauthenticated):", bChat.status, bChat.bodyPreview);

  const bVoice = await checkRoute("Backend Voice Speech Synthesize", `${BACKEND_URL}/api/jarvis/voice/tts`, {
    method: "POST",
    body: JSON.stringify({ text: "Ultron online" })
  });
  console.log("Backend Voice Endpoint:", bVoice.status, bVoice.bodyPreview);

  const bDevice = await checkRoute("Backend Remote Task Endpoint", `${BACKEND_URL}/api/remote/task`, {
    method: "POST",
    body: JSON.stringify({ action: "CHECK_STORAGE_AND_RUNNABILITY" })
  });
  console.log("Backend Remote Task:", bDevice.status, bDevice.bodyPreview);

  console.log("\n--- [B] Testing Frontend Interface Proxy (ultron-core-interface) ---");
  const fHealth = await checkRoute("Frontend /healthz", `${FRONTEND_URL}/healthz`);
  console.log("Frontend /healthz:", fHealth.status, fHealth.bodyPreview);

  const fRoot = await checkRoute("Frontend Root (/)", `${FRONTEND_URL}/`);
  console.log("Frontend Root (/):", fRoot.status, fRoot.bodyPreview);

  const fStyles = await checkRoute("Frontend /styles.css", `${FRONTEND_URL}/styles.css`);
  console.log("Frontend /styles.css:", fStyles.status, fStyles.bodyPreview);

  const fApp = await checkRoute("Frontend /app.js", `${FRONTEND_URL}/app.js`);
  console.log("Frontend /app.js:", fApp.status, fApp.bodyPreview);

  const fManifest = await checkRoute("Frontend /manifest.webmanifest", `${FRONTEND_URL}/manifest.webmanifest`);
  console.log("Frontend /manifest.webmanifest:", fManifest.status, fManifest.bodyPreview);

  const fApiProxy = await checkRoute("Frontend -> Backend API Proxy (/api/health)", `${FRONTEND_URL}/api/health`);
  console.log("Frontend API Proxy (/api/health):", fApiProxy.status, fApiProxy.bodyPreview);

  console.log("\n=== CLOUD INFRASTRUCTURE AUDIT COMPLETE ===");
}

runAudit().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
