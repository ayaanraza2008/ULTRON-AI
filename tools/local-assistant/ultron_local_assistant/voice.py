"""Local Windows voice capture and wake-word gating for ULTRON.

Speech is recognized by the installed Windows System.Speech engine. This module
does not upload audio or call any remote service.
"""
from __future__ import annotations

import base64
import os
import platform
import re
import shutil
import subprocess
import unicodedata

_POWERSHELL_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Speech
    $requested = $env:ULTRON_VOICE_LOCALE
    if ($requested -eq 'auto') {
        $preferred = @('en-IN', 'hi-IN', 'en-US', 'en-GB')
    } else {
        $preferred = @($requested)
    }
    $available = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
    $selected = $null
    foreach ($culture in $preferred) {
        $selected = $available | Where-Object { $_.Culture.Name -eq $culture } | Select-Object -First 1
        if ($selected) { break }
    }
    if (-not $selected) {
        [Console]::Error.WriteLine('ULTRON_VOICE_RECOGNIZER_UNAVAILABLE')
        exit 3
    }
    $engine = [System.Speech.Recognition.SpeechRecognitionEngine]::new($selected)
    try {
        $engine.SetInputToDefaultAudioDevice()
        $grammar = [System.Speech.Recognition.DictationGrammar]::new()
        $engine.LoadGrammar($grammar)
        $engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3)
        $engine.BabbleTimeout = [TimeSpan]::FromSeconds(2)
        $engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1)
        $result = $engine.Recognize([TimeSpan]::FromSeconds([int]$env:ULTRON_VOICE_TIMEOUT))
        if ($result -and $result.Text) {
            [Console]::Out.WriteLine('ULTRON_TRANSCRIPT:' + $result.Text)
        }
    } finally {
        $engine.Dispose()
    }
} catch {
    [Console]::Error.WriteLine('ULTRON_VOICE_CAPTURE_FAILED')
    exit 2
}
"""

_LOCALE_RE = re.compile(r"^(?:auto|en-(?:IN|US|GB)|hi-IN)$", re.IGNORECASE)
_TIMEOUT_MIN = 4
_TIMEOUT_MAX = 25


def listen_once(locale: str = "auto", timeout: int = 10) -> str | None:
    """Capture one utterance through installed Windows speech recognition."""
    if platform.system() != "Windows":
        raise RuntimeError("Local microphone recognition is supported only on Windows.")
    if not isinstance(locale, str) or not _LOCALE_RE.fullmatch(locale):
        raise ValueError("Choose locale auto, en-IN, en-US, en-GB, or hi-IN.")
    if isinstance(timeout, bool) or not isinstance(timeout, int) or not (_TIMEOUT_MIN <= timeout <= _TIMEOUT_MAX):
        raise ValueError(f"Voice timeout must be between {_TIMEOUT_MIN} and {_TIMEOUT_MAX} seconds.")
    executable = shutil.which("powershell.exe") or shutil.which("powershell")
    if not executable:
        raise RuntimeError("Windows PowerShell is unavailable.")
    encoded = base64.b64encode(_POWERSHELL_SCRIPT.encode("utf-16le")).decode("ascii")
    environment = os.environ.copy()
    environment["ULTRON_VOICE_LOCALE"] = locale
    environment["ULTRON_VOICE_TIMEOUT"] = str(timeout)
    try:
        result = subprocess.run(
            [executable, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
            stdin=subprocess.DEVNULL, capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=timeout + 12,
            check=False, shell=False, env=environment,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Windows voice recognition exceeded its time limit.") from exc
    except OSError as exc:
        raise RuntimeError("Windows voice recognition could not start.") from exc
    if result.returncode == 3:
        raise RuntimeError("No matching installed Windows speech recognizer was found. Install the selected Windows speech language.")
    if result.returncode != 0:
        raise RuntimeError("Windows voice recognition failed. Check microphone permission and the installed speech language.")
    for line in (result.stdout or "").splitlines():
        if line.startswith("ULTRON_TRANSCRIPT:"):
            transcript = line.partition(":")[2].strip()
            return transcript[:1200] or None
    return None


def wake_command(transcript: str | None) -> str | None:
    """Return text after the exact leading wake word, or None when not addressed."""
    if not isinstance(transcript, str):
        return None
    normalized = unicodedata.normalize("NFKC", transcript).strip()
    match = re.match(r"^ultron\b[\s,.:;!?-]*(.*)$", normalized, re.IGNORECASE)
    if not match:
        return None
    return match.group(1).strip()


def classify_desktop_command(command: str) -> dict[str, str] | None:
    """Map only explicit, fixed phrases to the local desktop allowlist."""
    if not isinstance(command, str):
        return None
    normalized = unicodedata.normalize("NFKC", command).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
    normalized = " ".join(normalized.split())
    if not normalized:
        return None
    app_match = re.fullmatch(
        r"(?:please )?(?:open|launch|start) (?:the )?(notepad|file explorer|explorer|calculator|calc)",
        normalized,
    )
    if app_match:
        target = {"file explorer": "explorer", "calc": "calculator"}.get(app_match.group(1), app_match.group(1))
        return {"kind": "launch", "target": target}
    folder_match = re.fullmatch(
        r"(?:please )?(?:open|show) (?:my )?(desktop|documents|downloads)(?: folder)?",
        normalized,
    )
    if folder_match:
        return {"kind": "open-folder", "target": folder_match.group(1)}
    hinglish = re.fullmatch(
        r"(notepad|file explorer|explorer|calculator|calc|desktop|documents|downloads) (?:kholo|khol do|open karo)",
        normalized,
    )
    if hinglish:
        target = hinglish.group(1)
        if target in {"desktop", "documents", "downloads"}:
            return {"kind": "open-folder", "target": target}
        target = {"file explorer": "explorer", "calc": "calculator"}.get(target, target)
        return {"kind": "launch", "target": target}
    return None


def classify_local_command(command: str) -> dict[str, str] | None:
    """Map small, read-only local assistant intents; all other text goes to chat."""
    if not isinstance(command, str):
        return None
    normalized = unicodedata.normalize("NFKC", command).casefold().strip()
    normalized = re.sub(r"\s+", " ", normalized)
    normalized = re.sub(r"[?.!,;:]+$", "", normalized).strip()
    if not normalized:
        return None

    if normalized in {
        "what time is it", "what time is it now", "tell me the time",
        "what's the time", "time now", "samay kya hua hai",
        "abhi kitne baje hain", "kitne baje hain",
    }:
        return {"kind": "time"}
    if normalized in {
        "what is today's date", "what's today's date", "what is the date",
        "today's date", "date today", "aaj kya date hai", "aaj ki tareekh kya hai",
    }:
        return {"kind": "date"}
    if normalized in {
        "system status", "system health", "pc status", "check my pc",
        "check system health", "how is my pc", "mera pc kaisa hai",
        "system check karo", "pc health batao",
    }:
        return {"kind": "system_health"}

    patterns = (
        r"(?:search|find|research) (?:in )?(?:my )?(?:local )?(?:documents|files)(?: for)? (.+)",
        r"(?:mere )?(?:documents|files) (?:mein|me) (.+) (?:search karo|khojo|dhundo|dhoondo)",
    )
    for pattern in patterns:
        match = re.fullmatch(pattern, normalized)
        if match:
            query = match.group(1).strip()
            if len(query) >= 2 and len(query) <= 500:
                return {"kind": "documents", "query": query}
    return None
