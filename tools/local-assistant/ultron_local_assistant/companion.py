"""Loopback-only, status-only HTTP companion for a user's Windows PC.

This service deliberately exposes no shell, filesystem, input, screenshot, or
process-control endpoints. It is intended for a local ULTRON client only; a
hosted ULTRON backend cannot reach a PC's loopback interface.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
import platform
import threading
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from typing import Iterable

from .core import app_data_dir, secure_write

STATUS_PATH = "/v1/ultron/status"
DEFAULT_PORT = 8765
MIN_TOKEN_LENGTH = 43  # 32 random bytes encoded as unpadded URL-safe base64.
MAX_ORIGIN_LENGTH = 512


def generate_companion_token() -> str:
    """Generate a high-entropy bearer token; callers must store it privately."""
    import secrets
    return secrets.token_urlsafe(32)


def _device_id(data_dir: Path) -> str:
    data_dir = Path(data_dir)
    if data_dir.is_symlink():
        raise ValueError("Companion data directory must not be a symlink.")
    data_dir.mkdir(parents=True, exist_ok=True)
    identity_file = data_dir / "device-id"
    if identity_file.is_symlink() or (identity_file.exists() and not identity_file.is_file()):
        raise ValueError("Companion device identity file is not a regular file.")
    if identity_file.exists():
        try:
            return str(uuid.UUID(identity_file.read_text(encoding="ascii").strip()))
        except (OSError, UnicodeError, ValueError):
            raise ValueError("Companion device identity file is invalid; remove it and restart.")
    value = str(uuid.uuid4())
    secure_write(identity_file, value + "\n")
    return value


def _validate_local_origin(origin: str) -> bool:
    if not isinstance(origin, str) or not origin or len(origin) > MAX_ORIGIN_LENGTH:
        return False
    try:
        parsed = urlsplit(origin)
        return (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "localhost"}
            and parsed.username is None
            and parsed.password is None
            and parsed.path in {"", "/"}
            and not parsed.query
            and not parsed.fragment
            and parsed.port is not None
        )
    except ValueError:
        return False


class _CompanionHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 8

    def __init__(
        self,
        token: str,
        port: int,
        data_dir: Path,
        allowed_origins: Iterable[str],
        request_limit: int,
    ) -> None:
        self.token = token
        self.device_id = _device_id(data_dir)
        self.device_name = (platform.node() or "Windows PC")[:120]
        self.allowed_origins = frozenset(allowed_origins)
        self.request_limit = request_limit
        self.rate_lock = threading.Lock()
        self.requests_by_ip: dict[str, deque[float]] = defaultdict(deque)
        super().__init__(("127.0.0.1", port), _CompanionRequestHandler)
        self.expected_host = f"127.0.0.1:{self.server_port}"

    def permit_request(self, client_ip: str) -> bool:
        now = time.monotonic()
        with self.rate_lock:
            requests = self.requests_by_ip[client_ip]
            while requests and now - requests[0] >= 60:
                requests.popleft()
            if len(requests) >= self.request_limit:
                return False
            requests.append(now)
            return True


class _CompanionRequestHandler(BaseHTTPRequestHandler):
    server: _CompanionHTTPServer
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: object) -> None:
        # Do not log headers, tokens, query strings, or caller-provided values.
        return

    def _send_json(self, status: int, payload: dict, origin: str | None = None) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def _request_is_local_and_expected(self) -> tuple[bool, str | None]:
        try:
            peer_is_local = ipaddress.ip_address(self.client_address[0]).is_loopback
        except (ValueError, TypeError, IndexError):
            peer_is_local = False
        if not peer_is_local or self.headers.get("Host", "") != self.server.expected_host:
            self._send_json(403, {"error": "request_origin_blocked"})
            return False, None
        origin = self.headers.get("Origin")
        if origin:
            if origin not in self.server.allowed_origins:
                self._send_json(403, {"error": "request_origin_blocked"})
                return False, None
        return True, origin

    def do_OPTIONS(self) -> None:
        valid, origin = self._request_is_local_and_expected()
        if not valid:
            return
        if self.path != STATUS_PATH:
            self._send_json(404, {"error": "not_found"})
            return
        if self.headers.get("Access-Control-Request-Method", "").upper() != "GET":
            self._send_json(405, {"error": "method_not_allowed"}, origin)
            return
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization")
            self.send_header("Access-Control-Max-Age", "300")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self) -> None:
        valid, origin = self._request_is_local_and_expected()
        if not valid:
            return
        if self.path != STATUS_PATH:
            self._send_json(404, {"error": "not_found"}, origin)
            return
        if not self.server.permit_request(self.client_address[0]):
            self._send_json(429, {"error": "rate_limited"}, origin)
            return
        supplied = self.headers.get("Authorization", "")
        prefix = "Bearer "
        candidate = supplied[len(prefix):] if supplied.startswith(prefix) else ""
        if not candidate or not hmac.compare_digest(candidate, self.server.token):
            self._send_json(401, {"error": "unauthorized"}, origin)
            return

        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        self._send_json(200, {
            "protocolVersion": 1,
            "device": {
                "id": self.server.device_id,
                "name": self.server.device_name,
                "platform": platform.system().lower(),
                "paired": True,
                "online": True,
                "lastSeenAt": now,
            },
            "capabilities": ["status"],
        }, origin)


def create_companion_server(
    token: str,
    *,
    port: int = DEFAULT_PORT,
    data_dir: str | Path | None = None,
    allowed_origins: Iterable[str] = (),
    request_limit: int = 60,
) -> ThreadingHTTPServer:
    """Create a server bound only to IPv4 loopback; never accepts a public bind."""
    if not isinstance(token, str) or len(token) < MIN_TOKEN_LENGTH:
        raise ValueError("ULTRON_COMPANION_TOKEN must contain at least 43 characters.")
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("Companion port must be an integer between 0 and 65535.")
    if isinstance(request_limit, bool) or not isinstance(request_limit, int) or not 1 <= request_limit <= 600:
        raise ValueError("Companion request limit must be between 1 and 600 requests per minute.")
    origins = tuple(allowed_origins)
    if any(not _validate_local_origin(origin) for origin in origins):
        raise ValueError("Allowed origins must be exact http://localhost:<port> or http://127.0.0.1:<port> origins.")
    root = Path(data_dir) if data_dir is not None else app_data_dir() / "companion"
    return _CompanionHTTPServer(token, port, root, origins, request_limit)
