"""Manually confirmed, allowlisted local Windows desktop shortcuts.

This module intentionally exposes no HTTP endpoint and accepts no arbitrary
commands, executable paths, folder paths, or process-control instructions.
"""
from __future__ import annotations

import json
import os
import platform
import stat
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .core import app_data_dir, secure_write

AUDIT_FILENAME = "desktop-actions.jsonl"
MAX_AUDIT_BYTES = 512 * 1024
_AUDIT_LOCK = threading.Lock()

_APPLICATIONS: dict[str, tuple[str, tuple[str, ...]]] = {
    "notepad": ("notepad.exe", ()),
    "explorer": ("explorer.exe", ()),
    "calculator": (
        "explorer.exe",
        (r"shell:AppsFolder\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",),
    ),
}
_FOLDERS: dict[str, str] = {
    "desktop": "shell:Desktop",
    "documents": "shell:Personal",
    "downloads": "shell:Downloads",
}


def list_desktop_actions() -> dict[str, Any]:
    """Return the fixed action catalog without probing or launching anything."""
    return {
        "platform_supported": platform.system() == "Windows",
        "applications": list(_APPLICATIONS),
        "folders": list(_FOLDERS),
        "execution": "interactive_confirmation_required",
        "remote_control": False,
        "limitations": [
            "fixed application and standard-folder allowlists only",
            "no arbitrary shell, path, file, clipboard, screenshot, keyboard, or mouse access",
            "local CLI only; the HTTP companion remains status-only",
        ],
    }


def _require_windows() -> None:
    if platform.system() != "Windows":
        raise RuntimeError("Local desktop shortcuts are supported only on Windows.")


def _windows_executable(name: str) -> str:
    """Resolve one fixed executable under the active Windows installation."""
    windows_dir = os.environ.get("WINDIR") or os.environ.get("SystemRoot")
    if not windows_dir:
        raise RuntimeError("The Windows installation directory is unavailable.")

    root = Path(windows_dir).expanduser()
    if root.is_symlink():
        raise RuntimeError("The Windows installation directory must not be a symbolic link.")
    try:
        resolved_root = root.resolve(strict=True)
        system32 = resolved_root / "System32"
        if system32.is_symlink() or not system32.is_dir():
            raise RuntimeError("The Windows System32 directory is unavailable or linked.")
        resolved_system32 = system32.resolve(strict=True)
        executable = system32 / name
        if executable.is_symlink():
            raise RuntimeError("The allowlisted Windows executable must not be a symbolic link.")
        resolved_executable = executable.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("The allowlisted Windows executable is unavailable.") from exc

    if (
        not resolved_executable.is_file()
        or not resolved_executable.is_relative_to(resolved_system32)
    ):
        raise RuntimeError("The allowlisted Windows executable is not a regular System32 file.")
    return str(resolved_executable)


def _append_audit(
    action: str,
    target: str,
    outcome: str,
    *,
    process_id: int | None = None,
    error_code: str | None = None,
) -> None:
    """Write a bounded JSONL record without user paths, arguments, or file data."""
    with _AUDIT_LOCK:
        directory = Path(app_data_dir()).expanduser()
        directory.mkdir(parents=True, exist_ok=True)
        if directory.is_symlink() or not directory.is_dir():
            raise RuntimeError("The private desktop action audit directory is not a regular directory.")

        audit_path = directory / AUDIT_FILENAME
        existing = ""
        if audit_path.is_symlink():
            raise RuntimeError("The desktop action audit file must not be a symbolic link.")
        if audit_path.exists():
            info = audit_path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_AUDIT_BYTES:
                raise RuntimeError("The desktop action audit file is not a bounded regular file.")
            try:
                existing = audit_path.read_text(encoding="utf-8")
                for line in existing.splitlines():
                    if not isinstance(json.loads(line), dict):
                        raise ValueError("The desktop action audit file contains an invalid record.")
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise RuntimeError("The desktop action audit file cannot be read safely.") from exc
            if existing and not existing.endswith("\n"):
                raise RuntimeError("The desktop action audit file is incomplete; refusing to append.")

        record: dict[str, Any] = {
            "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "action": action,
            "target": target,
            "outcome": outcome,
        }
        if process_id is not None:
            record["process_id"] = int(process_id)
        if error_code:
            record["error_code"] = "".join(ch for ch in error_code if ch.isalnum() or ch in "_-")[:64]

        updated = existing + json.dumps(record, separators=(",", ":"), ensure_ascii=True) + "\n"
        if len(updated.encode("utf-8")) > MAX_AUDIT_BYTES:
            raise RuntimeError("The desktop action audit is full; archive it before starting another action.")
        secure_write(audit_path, updated)


def _start_fixed_target(
    *,
    action: str,
    target: str,
    executable_name: str,
    arguments: tuple[str, ...],
    confirm: bool,
) -> dict[str, Any]:
    _require_windows()
    if confirm is not True:
        raise PermissionError("Starting a Windows desktop action requires explicit interactive confirmation.")

    executable = _windows_executable(executable_name)
    argv = [executable, *arguments]

    # Record the user's approval before requesting process creation. If the audit
    # file cannot be safely written, the action is not launched.
    _append_audit(action, target, "approved")
    creation_flags = (
        getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
        | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
    )
    try:
        child = subprocess.Popen(
            argv,
            shell=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            creationflags=creation_flags,
        )
    except OSError as exc:
        _append_audit(action, target, "launch_failed", error_code=type(exc).__name__)
        raise RuntimeError(f"Windows could not start the allowlisted target '{target}'.") from exc

    process_id = getattr(child, "pid", None)
    audit_status = "complete"
    try:
        _append_audit(action, target, "process_start_requested", process_id=process_id)
    except (OSError, RuntimeError, ValueError):
        # The approval record already exists. Do not pretend the launch did not
        # happen merely because the final audit update failed.
        audit_status = "approval_recorded; final_status_write_failed"

    return {
        "status": "process_start_requested",
        "action": action,
        "target": target,
        "process_id": process_id,
        "audit_status": audit_status,
        "note": "Windows accepted a process-start request; application readiness was not verified.",
    }


def launch_application(application: str, *, confirm: bool = False) -> dict[str, Any]:
    """Start one fixed Windows application after a fresh user confirmation."""
    if not isinstance(application, str) or application not in _APPLICATIONS:
        raise ValueError("Choose one of the allowlisted applications: notepad, explorer, calculator.")
    executable_name, arguments = _APPLICATIONS[application]
    return _start_fixed_target(
        action="launch_application",
        target=application,
        executable_name=executable_name,
        arguments=arguments,
        confirm=confirm,
    )


def open_known_folder(folder: str, *, confirm: bool = False) -> dict[str, Any]:
    """Open one fixed Windows Shell folder; arbitrary filesystem paths are rejected."""
    if not isinstance(folder, str) or folder not in _FOLDERS:
        raise ValueError("Choose one of the allowlisted folders: desktop, documents, downloads.")
    return _start_fixed_target(
        action="open_known_folder",
        target=folder,
        executable_name="explorer.exe",
        arguments=(_FOLDERS[folder],),
        confirm=confirm,
    )
