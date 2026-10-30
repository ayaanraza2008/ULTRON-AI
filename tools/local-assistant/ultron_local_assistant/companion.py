"""Loopback-only, status-only HTTP companion for a user's Windows PC.

This service deliberately exposes no shell, filesystem, input, screenshot, or
process-control endpoints. It is intended for a local ULTRON client only; a
hosted ULTRON backend cannot reach a PC's loopback interface.
"""
from __future__ import annotations

import hmac
import http.client
import ipaddress
import json
import os
import platform
import socket
import ssl
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
MAX_CONCURRENT_REQUESTS = 16
REQUEST_TIMEOUT_SECONDS = 5.0


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
        self.max_concurrent_requests = MAX_CONCURRENT_REQUESTS
        self.request_slots = threading.BoundedSemaphore(self.max_concurrent_requests)
        self.rate_lock = threading.Lock()
        self.requests_by_ip: dict[str, deque[float]] = defaultdict(deque)
        super().__init__(("127.0.0.1", port), _CompanionRequestHandler)
        self.expected_host = f"127.0.0.1:{self.server_port}"

    def process_request(self, request, client_address) -> None:
        # Bound handler threads before parsing attacker-controlled request headers.
        if not self.request_slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address) -> None:
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

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

    def setup(self) -> None:
        # A local client must not hold a handler thread indefinitely with a
        # partial request line or slow headers.
        self.request.settimeout(REQUEST_TIMEOUT_SECONDS)
        super().setup()

    def log_message(self, _format: str, *_args: object) -> None:
        # Do not log headers, tokens, query strings, or caller-provided values.
        return

    def _send_json(self, status: int, payload: dict, origin: str | None = None) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Connection", "close")
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
        self.close_connection = True
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
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


CLOUD_HEARTBEAT_INTERVAL_SECONDS = 30
CLOUD_REQUEST_TIMEOUT_SECONDS = 10
CLOUD_MAX_RESPONSE_BYTES = 64 * 1024
DEVICE_CREDENTIALS_FILE = "device-credentials.json"
PAIRING_CODE_PATTERN = __import__("re").compile(r"^[A-Za-z0-9_-]{32}$")
DEVICE_TOKEN_PATTERN = __import__("re").compile(r"^[A-Za-z0-9_-]{43}$")
LOCAL_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".test", ".invalid", ".example")


def _validated_cloud_server_url(value: str):
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise ValueError("Provide a valid public HTTPS ULTRON server URL.")
    try:
        parsed = urlsplit(value.strip())
        host = (parsed.hostname or "").rstrip(".").lower()
        port = parsed.port
    except ValueError as exc:
        raise ValueError("The ULTRON server URL is malformed.") from exc
    if (
        parsed.scheme != "https"
        or not host
        or "." not in host
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and port != 443)
        or host == "localhost"
        or any(host.endswith(suffix) for suffix in LOCAL_HOST_SUFFIXES)
    ):
        raise ValueError("The companion accepts only a public HTTPS server origin on port 443.")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is not None:
        raise ValueError("Use the public HTTPS hostname from your ULTRON server, not an IP address.")
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("The ULTRON server hostname is invalid.") from exc
    return f"https://{ascii_host}"


def _resolve_public_addresses(host: str, resolver=socket.getaddrinfo) -> list[str]:
    try:
        answers = resolver(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ConnectionError("Could not resolve the ULTRON server hostname.") from exc
    addresses = []
    for answer in answers or ():
        try:
            address = str(answer[4][0]).split("%", 1)[0]
            parsed = ipaddress.ip_address(address)
        except (IndexError, TypeError, ValueError):
            continue
        if not parsed.is_global:
            raise ValueError("The ULTRON server hostname resolved to a private or reserved address; request blocked.")
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ConnectionError("The ULTRON server hostname returned no public IP addresses.")
    return addresses


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname: str, address: str, timeout: float, context):
        super().__init__(hostname, port=443, timeout=timeout, context=context)
        self._pinned_address = address

    def connect(self):
        raw = socket.create_connection((self._pinned_address, 443), timeout=self.timeout)
        try:
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise


def _cloud_json_request(server_url: str, route: str, payload: dict, bearer_token: str | None = None,
                        *, resolver=socket.getaddrinfo, connection_factory=None) -> dict:
    origin = _validated_cloud_server_url(server_url)
    parsed = urlsplit(origin)
    addresses = _resolve_public_addresses(parsed.hostname, resolver=resolver)
    errors = []
    for address in addresses:
        connection = None
        try:
            if connection_factory is None:
                connection = _PinnedHTTPSConnection(
                    parsed.hostname, address, CLOUD_REQUEST_TIMEOUT_SECONDS, ssl.create_default_context()
                )
            else:
                connection = connection_factory(parsed.hostname, address, CLOUD_REQUEST_TIMEOUT_SECONDS)
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Connection": "close"
            }
            if bearer_token:
                headers["Authorization"] = "Bearer " + bearer_token
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            connection.request("POST", route, body=body, headers=headers)
            response = connection.getresponse()
            if response.status < 200 or response.status >= 300:
                # Never follow redirects: credentials must not be forwarded to a new host.
                response.read(CLOUD_MAX_RESPONSE_BYTES + 1)
                raise RuntimeError(f"ULTRON server rejected the companion request (HTTP {response.status}).")
            declared = response.getheader("Content-Length")
            if declared:
                try:
                    if int(declared) > CLOUD_MAX_RESPONSE_BYTES:
                        raise ValueError("ULTRON server response exceeded the safe size limit.")
                except ValueError as exc:
                    if "exceeded" in str(exc):
                        raise
            raw = response.read(CLOUD_MAX_RESPONSE_BYTES + 1)
            if len(raw) > CLOUD_MAX_RESPONSE_BYTES:
                raise ValueError("ULTRON server response exceeded the safe size limit.")
            try:
                data = json.loads(raw.decode("utf-8"))
            except (UnicodeError, json.JSONDecodeError) as exc:
                raise ValueError("ULTRON server returned an invalid JSON response.") from exc
            if not isinstance(data, dict):
                raise ValueError("ULTRON server returned an unexpected response.")
            return data
        except RuntimeError:
            raise
        except (OSError, ssl.SSLError, http.client.HTTPException, TimeoutError) as exc:
            errors.append(type(exc).__name__)
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass
    raise ConnectionError("Could not establish a verified HTTPS connection to ULTRON.")


def _credential_file(data_dir: str | Path | None = None) -> Path:
    root = Path(data_dir) if data_dir is not None else app_data_dir() / "companion"
    if root.is_symlink():
        raise ValueError("Companion credential directory must not be a symlink.")
    root.mkdir(parents=True, exist_ok=True)
    path = root / DEVICE_CREDENTIALS_FILE
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError("Companion credential file must be a regular file.")
    return path


def _save_device_credentials(server_url: str, device_id: str, device_token: str,
                             data_dir: str | Path | None = None) -> Path:
    if not DEVICE_TOKEN_PATTERN.fullmatch(device_token):
        raise ValueError("ULTRON returned an invalid paired-device token.")
    path = _credential_file(data_dir)
    record = {
        "protocolVersion": 1,
        "serverUrl": _validated_cloud_server_url(server_url),
        "deviceId": str(uuid.UUID(device_id)),
        "deviceToken": device_token,
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds")
    }
    secure_write(path, json.dumps(record, separators=(",", ":")) + "\n")
    return path


def _load_device_credentials(data_dir: str | Path | None = None) -> dict:
    path = _credential_file(data_dir)
    if not path.exists():
        raise FileNotFoundError("This PC is not paired yet. Run ultron-local companion pair first.")
    if path.stat().st_size > 4096:
        raise ValueError("The local companion credential file is unexpectedly large.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("The local companion credential file is invalid.") from exc
    if (
        not isinstance(value, dict)
        or value.get("protocolVersion") != 1
        or not isinstance(value.get("deviceId"), str)
        or not isinstance(value.get("deviceToken"), str)
        or not DEVICE_TOKEN_PATTERN.fullmatch(value["deviceToken"])
    ):
        raise ValueError("The local companion credential file is incomplete or unsupported.")
    value["serverUrl"] = _validated_cloud_server_url(value.get("serverUrl", ""))
    try:
        value["deviceId"] = str(uuid.UUID(value["deviceId"]))
    except ValueError as exc:
        raise ValueError("The local companion device ID is invalid.") from exc
    return value


def pair_companion(server_url: str, pairing_code: str, *, data_dir: str | Path | None = None,
                   request_impl=None) -> dict:
    if not isinstance(pairing_code, str) or not PAIRING_CODE_PATTERN.fullmatch(pairing_code.strip()):
        raise ValueError("Enter the 32-character one-time pairing code shown by ULTRON.")
    origin = _validated_cloud_server_url(server_url)
    root = Path(data_dir) if data_dir is not None else app_data_dir() / "companion"
    device_id = _device_id(root)
    requester = request_impl or _cloud_json_request
    result = requester(origin, "/api/desktop-companion/pair", {
        "pairingCode": pairing_code.strip(),
        "deviceId": device_id,
        "deviceName": (platform.node() or "Windows PC")[:120]
    })
    token = result.get("deviceToken") if isinstance(result, dict) else None
    if not isinstance(token, str) or not DEVICE_TOKEN_PATTERN.fullmatch(token):
        raise ValueError("ULTRON did not return a valid device token; pairing was not saved.")
    if result.get("deviceId") != device_id or result.get("platform") != "windows":
        raise ValueError("ULTRON returned a device identity that does not match this PC.")
    path = _save_device_credentials(origin, device_id, token, root)
    return {"paired": True, "deviceId": device_id, "deviceName": result.get("deviceName") or "Windows PC",
            "credentialFile": str(path), "heartbeatIntervalSeconds": CLOUD_HEARTBEAT_INTERVAL_SECONDS}


def send_companion_heartbeat(*, data_dir: str | Path | None = None, request_impl=None) -> dict:
    credentials = _load_device_credentials(data_dir)
    requester = request_impl or _cloud_json_request
    result = requester(
        credentials["serverUrl"], "/api/desktop-companion/heartbeat",
        {"deviceId": credentials["deviceId"]}, bearer_token=credentials["deviceToken"]
    )
    if result.get("status") != "online":
        raise RuntimeError("ULTRON did not confirm this companion heartbeat.")
    return {"status": "online", "deviceId": credentials["deviceId"],
            "nextHeartbeatSeconds": CLOUD_HEARTBEAT_INTERVAL_SECONDS}
