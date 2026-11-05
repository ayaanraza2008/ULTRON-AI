"""Redacted, opt-in one-time smoke checks for the hosted browser bridge."""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Mapping

SMOKE_ENV = "ULTRON_RUN_BROWSER_SMOKE"
SMOKE_TASK = (
    "Open https://example.com and report the document title and main heading. "
    "Use only this exact public page; do not click links or interact with controls."
)


def browser_smoke_enabled(env: Mapping[str, str]) -> bool:
    """Enable only for the explicitly opted-in deployment; default stays off."""
    return env.get(SMOKE_ENV) == "YES"


def summarize_browser_smoke(result: Any) -> dict[str, Any]:
    """Return safe status metadata only; never log the page text or credentials."""
    if not isinstance(result, dict):
        return {"status": "failed", "reason": "INVALID_RESULT"}
    if result.get("status") != "completed":
        return {"status": "failed", "reason": "NAVIGATION_NOT_COMPLETED"}
    content = result.get("result")
    allowed_hosts = result.get("allowedHosts")
    if not isinstance(content, str) or not content.strip():
        return {"status": "failed", "reason": "EMPTY_RESULT"}
    if not isinstance(allowed_hosts, list) or "example.com" not in allowed_hosts:
        return {"status": "failed", "reason": "TARGET_NOT_ATTESTED"}
    model = result.get("model")
    provider = result.get("provider")
    safe_model = model[:160] if isinstance(model, str) else "unknown"
    safe_provider = provider[:80] if isinstance(provider, str) else "unknown"
    return {
        "status": "passed",
        "targetHost": "example.com",
        "provider": safe_provider,
        "model": safe_model,
        "resultLength": min(len(content.strip()), 12000),
    }


def configure_browser_logging() -> None:
    """Redact request/page details by suppressing verbose third-party browser logs."""
    logging.getLogger("browser_use").setLevel(logging.WARNING)
    logging.getLogger("bubus").setLevel(logging.WARNING)


def browser_readiness_status(
    configured: bool,
    runtime_status: Mapping[str, Any],
    smoke_status: Mapping[str, Any],
) -> dict[str, Any]:
    """Expose readiness only when every enabled startup gate has passed."""
    runtime_ready = runtime_status.get("ready") is True
    smoke_enabled = smoke_status.get("enabled") is True
    smoke_state = str(smoke_status.get("status") or "not_run")[:40]
    smoke_ready = not smoke_enabled or smoke_state == "passed"
    ready = configured is True and runtime_ready and smoke_ready

    if not configured:
        reason = "MODEL_GATEWAY_NOT_CONFIGURED"
    elif not runtime_ready:
        reason = str(runtime_status.get("reason") or "BROWSER_RUNTIME_NOT_READY")[:80]
    elif not smoke_ready:
        reason = "STARTUP_SMOKE_" + smoke_state.upper()
    else:
        reason = None

    return {
        "ready": ready,
        "browserRuntimeReady": runtime_ready,
        "startupSmokeEnabled": smoke_enabled,
        "startupSmokeStatus": smoke_state,
        "startupSmokeReason": str(smoke_status.get("reason") or "")[:80] or None,
        "reason": reason,
    }

def browser_runtime_status() -> dict[str, Any]:
    """Ensure Chromium is present, then launch it once to verify the runtime."""
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as playwright:
            executable = Path(playwright.chromium.executable_path)
            if not executable.is_file():
                if os.getenv("ULTRON_BROWSER_AUTO_INSTALL", "YES").strip().upper() != "YES":
                    return {"ready": False, "reason": "CHROMIUM_EXECUTABLE_MISSING"}
                try:
                    install = subprocess.run(
                        [sys.executable, "-m", "playwright", "install", "chromium"],
                        capture_output=True,
                        text=True,
                        timeout=240,
                        check=False,
                    )
                except subprocess.TimeoutExpired:
                    return {"ready": False, "reason": "CHROMIUM_INSTALL_TIMEOUT"}
                if install.returncode != 0:
                    return {"ready": False, "reason": "CHROMIUM_INSTALL_FAILED"}
                if not executable.is_file():
                    return {"ready": False, "reason": "CHROMIUM_EXECUTABLE_MISSING_AFTER_INSTALL"}

            browser = playwright.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            try:
                browser.close()
            finally:
                browser = None
        return {"ready": True, "engine": "chromium"}
    except Exception as exc:
        return {"ready": False, "reason": type(exc).__name__[:80]}
