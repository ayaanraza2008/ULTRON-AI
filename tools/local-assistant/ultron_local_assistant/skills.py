"""Review and install Markdown-only skills from GitHub without running repository code."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .core import app_data_dir, secure_write

REPO_RE = re.compile(r"^(?:https://github\.com/)?([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?/?$")
MAX_FILES = 4000
MAX_TOTAL_BYTES = 25 * 1024 * 1024
MAX_FILE_BYTES = 1 * 1024 * 1024
SUSPICIOUS_PATTERNS = [
    (re.compile(r"\b(?:curl|wget|invoke-webrequest)\b", re.I), "network-download command"),
    (re.compile(r"\b(?:rm\s+-rf|format\s+[a-z]:|diskpart|shutdown|reboot)\b", re.I), "destructive system command"),
    (re.compile(r"\b(?:eval|exec)\s*\(", re.I), "dynamic code execution"),
    (re.compile(r"\b(?:api[_ -]?key|access[_ -]?token|client[_ -]?secret)\b", re.I), "credential-handling instructions"),
    (re.compile(r"ignore (?:all )?(?:previous|prior) instructions", re.I), "prompt-injection-style instruction"),
]


def normalize_github_repo(value: str) -> tuple[str, str]:
    match = REPO_RE.fullmatch((value or "").strip())
    if not match:
        raise ValueError("Use a repository identifier like owner/repo or an https://github.com/owner/repo URL.")
    owner, repository = match.groups()
    if owner in {".", ".."} or repository in {".", ".."} or ".." in owner or ".." in repository:
        raise ValueError("Invalid GitHub repository path.")
    return owner, repository


def scan_skill_text(content: str) -> list[str]:
    warnings = []
    for pattern, label in SUSPICIOUS_PATTERNS:
        if pattern.search(content):
            warnings.append(label)
    return warnings


def _clone_repo(repository: str, destination: Path) -> tuple[str, str]:
    owner, name = normalize_github_repo(repository)
    git = shutil.which("git")
    if not git:
        raise RuntimeError("Git is required for reviewing online skills. Install Git, then retry.")
    hooks_dir = destination.parent / "empty-git-hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    url = f"https://github.com/{owner}/{name}.git"
    try:
        result = subprocess.run(
            [git, "-c", f"core.hooksPath={hooks_dir}", "clone", "--depth=1", "--filter=blob:limit=1m",
             "--no-tags", "--single-branch", "--", url, str(destination)],
            capture_output=True, text=True, timeout=90, check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("GitHub skill repository clone timed out after 90 seconds.") from exc
    if result.returncode != 0:
        # Do not echo the remote repository's full output; it is untrusted and may include control sequences.
        raise RuntimeError("Could not clone the requested public GitHub repository. Check the owner/repo and network connection.")
    return owner, name


def _find_skill_files(repo_dir: Path) -> tuple[list[tuple[Path, str]], list[str]]:
    skills: list[tuple[Path, str]] = []
    warnings: list[str] = []
    file_count = 0
    total_size = 0
    for current, dirs, files in os.walk(repo_dir, followlinks=False):
        dirs[:] = [d for d in dirs if d != ".git" and not d.startswith(".") and not (Path(current) / d).is_symlink()]
        for name in files:
            candidate = Path(current) / name
            if candidate.is_symlink():
                warnings.append(f"Skipped symlink: {candidate.relative_to(repo_dir).as_posix()}")
                continue
            file_count += 1
            if file_count > MAX_FILES:
                raise RuntimeError(f"Repository has more than {MAX_FILES} files; refusing to review.")
            try:
                size = candidate.stat().st_size
            except OSError:
                continue
            total_size += size
            if total_size > MAX_TOTAL_BYTES:
                raise RuntimeError(f"Repository checkout exceeds the {MAX_TOTAL_BYTES // (1024 * 1024)} MB review limit.")
            if name.lower() != "skill.md":
                continue
            if size < 1 or size > MAX_FILE_BYTES:
                warnings.append(f"Skipped oversized/empty skill file: {candidate.relative_to(repo_dir).as_posix()}")
                continue
            try:
                content = candidate.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                warnings.append(f"Skipped unreadable skill file: {candidate.relative_to(repo_dir).as_posix()}")
                continue
            skills.append((candidate, content))
            for warning in scan_skill_text(content):
                warnings.append(f"{candidate.relative_to(repo_dir).as_posix()}: {warning}")
    return skills, warnings


def review_skill_repository(repository: str) -> dict[str, Any]:
    owner, name = normalize_github_repo(repository)
    with tempfile.TemporaryDirectory(prefix="ultron-skill-review-") as temp:
        root = Path(temp)
        clone_dir = root / "repo"
        _clone_repo(f"{owner}/{name}", clone_dir)
        found, warnings = _find_skill_files(clone_dir)
        return {
            "repository": f"{owner}/{name}",
            "skill_count": len(found),
            "skills": [
                {"path": path.relative_to(clone_dir).as_posix(), "characters": len(content), "sha256": hashlib.sha256(content.encode()).hexdigest()}
                for path, content in found[:100]
            ],
            "warnings": warnings[:100],
            "code_execution": "disabled; only SKILL.md text may be installed",
        }


def install_skill_repository(repository: str, *, confirm: bool = False, expected_hashes: dict[str, str] | None = None) -> dict[str, Any]:
    if not confirm:
        raise PermissionError("Skill installation requires an explicit typed confirmation.")
    owner, name = normalize_github_repo(repository)
    with tempfile.TemporaryDirectory(prefix="ultron-skill-install-") as temp:
        root = Path(temp)
        clone_dir = root / "repo"
        _clone_repo(f"{owner}/{name}", clone_dir)
        found, warnings = _find_skill_files(clone_dir)
        if not found:
            raise RuntimeError("No SKILL.md files were found; nothing was installed.")
        selected = found[:100]
        if expected_hashes is not None:
            actual = {
                path.relative_to(clone_dir).as_posix(): hashlib.sha256(content.encode()).hexdigest()
                for path, content in selected
            }
            if actual != expected_hashes:
                raise RuntimeError("The repository's SKILL.md content changed after review; nothing was installed. Review it again.")
        install_root = app_data_dir() / "skills" / f"{owner}--{name}"
        # Preflight every destination before writing any files to avoid partial installs.
        destinations = []
        for source, content in selected:
            relative = source.relative_to(clone_dir)
            destination = install_root / relative.parent / "SKILL.md"
            metadata_path = destination.with_suffix(".metadata.json")
            if destination.exists() or destination.is_symlink() or metadata_path.exists() or metadata_path.is_symlink():
                raise FileExistsError(f"Skill already exists at {destination}. Remove it manually before reinstalling.")
            destinations.append((source, content, destination, metadata_path))
        installed = []
        for source, content, destination, metadata_path in destinations:
            relative = source.relative_to(clone_dir)
            secure_write(destination, content)
            metadata = {
                "repository": f"{owner}/{name}",
                "source_path": relative.as_posix(),
                "installed_at": datetime.now(timezone.utc).isoformat(),
                "sha256": hashlib.sha256(content.encode()).hexdigest(),
                "warnings": scan_skill_text(content),
                "executable_files_installed": False,
            }
            secure_write(metadata_path, json.dumps(metadata, indent=2))
            installed.append({"path": str(destination), "source_path": relative.as_posix()})
        return {"repository": f"{owner}/{name}", "installed": installed, "warnings": warnings[:100],
                "note": "Only Markdown instructions were copied. Repository scripts and binaries were not installed or executed."}


def list_installed_skills() -> list[dict[str, str]]:
    root = app_data_dir() / "skills"
    if not root.is_dir():
        return []
    result = []
    for path in root.rglob("SKILL.md"):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        result.append({"name": path.parent.name, "path": str(path), "preview": content[:180].replace("\n", " ")})
    return sorted(result, key=lambda item: item["name"].lower())
