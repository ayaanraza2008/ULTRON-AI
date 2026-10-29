"""Redacted, opt-in one-time smoke checks for the hosted browser bridge."""
from __future__ import annotations

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
