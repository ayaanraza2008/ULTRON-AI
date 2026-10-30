import json
import os
import socket
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ultron_local_assistant.companion import (
    STATUS_PATH,
    create_companion_server,
    generate_companion_token,
    CloudHTTPError,
    _cloud_json_request,
    pair_companion,
    send_companion_heartbeat,
    _load_device_credentials,
    _resolve_public_addresses,
    _validated_cloud_server_url,
)

TOKEN = "test-" + ("x" * 48)


class CompanionServerTests(unittest.TestCase):
    def start_server(self, **kwargs):
        temp_dir = tempfile.TemporaryDirectory()
        data_dir = kwargs.pop("data_dir", Path(temp_dir.name))
        server = create_companion_server(TOKEN, port=0, data_dir=data_dir, **kwargs)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(temp_dir.cleanup)
        self.addCleanup(server.server_close)
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.shutdown)
        self.assertEqual(server.server_address[0], "127.0.0.1")
        return server, f"http://127.0.0.1:{server.server_port}"

    def request(self, url, *, token=TOKEN, headers=None, method="GET"):
        request_headers = dict(headers or {})
        if token is not None:
            request_headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(url, headers=request_headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, response.headers, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.headers, error.read()

    def test_loopback_status_is_authenticated_and_exposes_no_control_capabilities(self):
        server, base = self.start_server()
        status, headers, body = self.request(base + STATUS_PATH)
        payload = json.loads(body)
        self.assertEqual(status, 200)
        self.assertEqual(payload["protocolVersion"], 1)
        self.assertTrue(payload["device"]["paired"])
        self.assertTrue(payload["device"]["online"])
        self.assertEqual(payload["device"]["platform"], __import__("platform").system().lower())
        self.assertEqual(payload["capabilities"], ["status"])
        self.assertEqual(headers.get("Cache-Control"), "no-store")
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertEqual(headers.get("Connection"), "close")
        self.assertNotIn(TOKEN, body.decode("utf-8"))
        self.assertFalse(any("command" in item or "file" in item for item in payload["capabilities"]))

    def test_bad_or_missing_bearer_token_is_rejected(self):
        server, base = self.start_server()
        status, _, body = self.request(base + STATUS_PATH, token=None)
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(body), {"error": "unauthorized"})
        status, _, _ = self.request(base + STATUS_PATH, token="wrong-token")
        self.assertEqual(status, 401)

    def test_host_header_must_match_the_loopback_listener(self):
        server, base = self.start_server()
        status, _, body = self.request(
            base + STATUS_PATH,
            headers={"Host": "attacker.example"},
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body), {"error": "request_origin_blocked"})

    def test_browser_origin_requires_an_exact_local_allowlist_entry(self):
        server, base = self.start_server()
        status, _, _ = self.request(
            base + STATUS_PATH,
            headers={"Origin": "http://localhost:5173"},
        )
        self.assertEqual(status, 403)

        server, base = self.start_server(allowed_origins=("http://localhost:5173",))
        status, headers, _ = self.request(
            base + STATUS_PATH,
            headers={"Origin": "http://localhost:5173"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Origin"), "http://localhost:5173")

    def test_exact_origin_preflight_is_limited_to_get_and_authorization(self):
        server, base = self.start_server(allowed_origins=("http://127.0.0.1:5173",))
        status, headers, _ = self.request(
            base + STATUS_PATH,
            token=None,
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization",
            },
            method="OPTIONS",
        )
        self.assertEqual(status, 204)
        self.assertEqual(headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS")
        self.assertEqual(headers.get("Access-Control-Allow-Headers"), "Authorization")

        status, _, _ = self.request(
            base + STATUS_PATH,
            token=None,
            headers={
                "Origin": "http://127.0.0.1:5173",
                "Access-Control-Request-Method": "POST",
            },
            method="OPTIONS",
        )
        self.assertEqual(status, 405)

    def test_only_the_exact_status_route_is_available(self):
        server, base = self.start_server()
        status, _, body = self.request(base + STATUS_PATH + "?include=processes")
        self.assertEqual(status, 404)
        self.assertEqual(json.loads(body), {"error": "not_found"})
        status, _, _ = self.request(base + "/v1/ultron/execute")
        self.assertEqual(status, 404)

    def test_request_rate_limit_is_enforced(self):
        server, base = self.start_server(request_limit=1)
        first, _, _ = self.request(base + STATUS_PATH, token="wrong-token")
        second, _, body = self.request(base + STATUS_PATH)
        self.assertEqual(first, 401)
        self.assertEqual(second, 429)
        self.assertEqual(json.loads(body), {"error": "rate_limited"})

    def test_device_id_is_stable_across_companion_restarts(self):
        with tempfile.TemporaryDirectory() as root:
            first, _ = self.start_server(data_dir=Path(root) / "companion")
            first_id = first.device_id
            second, _ = self.start_server(data_dir=Path(root) / "companion")
            self.assertEqual(second.device_id, first_id)

    def test_public_origins_short_tokens_and_invalid_limits_are_rejected(self):
        with self.assertRaises(ValueError):
            create_companion_server("short")
        with self.assertRaises(ValueError):
            create_companion_server(TOKEN, allowed_origins=("https://example.com",))
        with self.assertRaises(ValueError):
            create_companion_server(TOKEN, request_limit=0)

    def test_concurrent_request_handlers_are_bounded_before_header_parsing(self):
        server, _ = self.start_server()
        acquired = [server.request_slots.acquire(blocking=False) for _ in range(server.max_concurrent_requests)]
        self.assertTrue(all(acquired))
        self.assertFalse(server.request_slots.acquire(blocking=False))
        client, rejected_socket = socket.socketpair()
        try:
            server.process_request(rejected_socket, ("127.0.0.1", 12345))
            self.assertEqual(client.recv(1), b"")
        finally:
            client.close()
            for _ in acquired:
                server.request_slots.release()


    def test_cloud_server_url_must_be_a_public_https_origin(self):
        self.assertEqual(_validated_cloud_server_url("https://ultron.example.com/"), "https://ultron.example.com")
        for value in (
            "http://ultron.example.com",
            "https://localhost",
            "https://pc.local",
            "https://ultron.example.com:8443",
            "https://user:password@ultron.example.com",
            "https://ultron.example.com/api",
            "https://ultron.example.com?next=other",
            "https://192.0.2.10",
        ):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    _validated_cloud_server_url(value)

    def test_cloud_dns_rejects_mixed_public_and_private_answers(self):
        def resolver(_host, _port, type=None):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.168.1.10", 443)),
            ]
        with self.assertRaisesRegex(ValueError, "private or reserved"):
            _resolve_public_addresses("ultron.example.com", resolver=resolver)

    def test_cloud_dns_returns_only_validated_public_addresses(self):
        def resolver(_host, _port, type=None):
            return [
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
                (socket.AF_INET6, socket.SOCK_STREAM, 6, "", ("2001:4860:4860::8888", 443, 0, 0)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443)),
            ]
        self.assertEqual(
            _resolve_public_addresses("ultron.example.com", resolver=resolver),
            ["8.8.8.8", "2001:4860:4860::8888"]
        )

    def test_pairing_saves_a_valid_token_privately_without_printing_it(self):
        with tempfile.TemporaryDirectory() as root:
            device_token = "T" * 43
            seen = {}
            def request(server_url, route, payload, bearer_token=None):
                seen.update(server_url=server_url, route=route, payload=payload, bearer_token=bearer_token)
                return {
                    "deviceId": payload["deviceId"],
                    "deviceName": "Ayaan-PC",
                    "platform": "windows",
                    "deviceToken": device_token
                }
            result = pair_companion(
                "https://ultron.example.com", "P" * 32,
                data_dir=Path(root) / "companion", request_impl=request
            )
            self.assertTrue(result["paired"])
            self.assertEqual(result["deviceId"], seen["payload"]["deviceId"])
            self.assertEqual(seen["server_url"], "https://ultron.example.com")
            self.assertEqual(seen["route"], "/api/desktop-companion/pair")
            self.assertEqual(seen["payload"]["pairingCode"], "P" * 32)
            self.assertIsNone(seen["bearer_token"])
            saved = _load_device_credentials(Path(root) / "companion")
            self.assertEqual(saved["deviceToken"], device_token)
            self.assertEqual(saved["serverUrl"], "https://ultron.example.com")
            self.assertEqual(Path(result["credentialFile"]).name, "device-credentials.json")
            self.assertNotIn(device_token, json.dumps(result))

    def test_pairing_rejects_a_bad_server_token_before_persisting_credentials(self):
        with tempfile.TemporaryDirectory() as root:
            def request(*_args, **_kwargs):
                return {"deviceId": "22222222-2222-4222-8222-222222222222", "platform": "windows", "deviceToken": "short"}
            with self.assertRaisesRegex(ValueError, "valid device token"):
                pair_companion(
                    "https://ultron.example.com", "P" * 32,
                    data_dir=Path(root) / "companion", request_impl=request
                )
            self.assertFalse((Path(root) / "companion" / "device-credentials.json").exists())

    def test_pairing_rejects_invalid_one_time_code_before_any_network(self):
        calls = []
        with self.assertRaisesRegex(ValueError, "32-character"):
            pair_companion(
                "https://ultron.example.com", "not-a-code",
                request_impl=lambda *args, **kwargs: calls.append((args, kwargs))
            )
        self.assertEqual(calls, [])

    def test_heartbeat_uses_the_paired_token_and_returns_only_status(self):
        with tempfile.TemporaryDirectory() as root:
            pair_companion(
                "https://ultron.example.com", "P" * 32,
                data_dir=Path(root) / "companion",
                request_impl=lambda _url, _route, payload, bearer_token=None: {
                    "deviceId": payload["deviceId"], "deviceName": "Ayaan-PC",
                    "platform": "windows", "deviceToken": "T" * 43
                }
            )
            seen = {}
            def request(server_url, route, payload, bearer_token=None):
                seen.update(server_url=server_url, route=route, payload=payload, bearer_token=bearer_token)
                return {"status": "online"}
            result = send_companion_heartbeat(data_dir=Path(root) / "companion", request_impl=request)
            self.assertEqual(result["status"], "online")
            self.assertEqual(seen["route"], "/api/desktop-companion/heartbeat")
            self.assertEqual(seen["payload"]["deviceId"], result["deviceId"])
            self.assertEqual(seen["bearer_token"], "T" * 43)
            self.assertNotIn("deviceToken", json.dumps(result))

    def test_heartbeat_treats_revocation_as_a_failed_connection(self):
        with tempfile.TemporaryDirectory() as root:
            pair_companion(
                "https://ultron.example.com", "P" * 32,
                data_dir=Path(root) / "companion",
                request_impl=lambda _url, _route, payload, bearer_token=None: {
                    "deviceId": payload["deviceId"], "deviceName": "Ayaan-PC",
                    "platform": "windows", "deviceToken": "T" * 43
                }
            )
            with self.assertRaisesRegex(RuntimeError, "did not confirm"):
                send_companion_heartbeat(
                    data_dir=Path(root) / "companion",
                    request_impl=lambda *_args, **_kwargs: {"status": "revoked"}
                )


    def test_cloud_request_pins_the_connection_to_a_validated_public_address(self):
        requests = []
        class Response:
            status = 200
            def getheader(self, name):
                return str(len(b'{"status":"online"}')) if name == "Content-Length" else None
            def read(self, limit):
                return b'{"status":"online"}'
        class Connection:
            def request(self, method, route, *, body, headers):
                requests.append((method, route, json.loads(body), headers))
            def getresponse(self):
                return Response()
            def close(self):
                pass
        def resolver(host, port, type=None):
            self.assertEqual(host, "ultron.example.com")
            self.assertEqual(port, 443)
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        created = []
        def connection_factory(host, address, timeout):
            created.append((host, address, timeout))
            return Connection()
        result = _cloud_json_request(
            "https://ultron.example.com", "/api/desktop-companion/heartbeat",
            {"deviceId": "22222222-2222-4222-8222-222222222222"},
            bearer_token="T" * 43, resolver=resolver, connection_factory=connection_factory
        )
        self.assertEqual(result, {"status": "online"})
        self.assertEqual(created[0][0:2], ("ultron.example.com", "8.8.8.8"))
        self.assertEqual(requests[0][0:2], ("POST", "/api/desktop-companion/heartbeat"))
        self.assertEqual(requests[0][3]["Authorization"], "Bearer " + ("T" * 43))
        self.assertEqual(requests[0][3]["Connection"], "close")

    def test_cloud_request_does_not_follow_redirects_to_unvalidated_hosts(self):
        requests = []
        class Response:
            status = 302
            def getheader(self, name):
                return "https://attacker.example/steal" if name == "Location" else None
            def read(self, limit):
                return b""
        class Connection:
            def request(self, method, route, *, body, headers):
                requests.append((route, headers))
            def getresponse(self):
                return Response()
            def close(self):
                pass
        with self.assertRaises(CloudHTTPError) as caught:
            _cloud_json_request(
                "https://ultron.example.com", "/api/desktop-companion/heartbeat",
                {"deviceId": "22222222-2222-4222-8222-222222222222"},
                bearer_token="T" * 43,
                resolver=lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))],
                connection_factory=lambda *_args: Connection()
            )
        self.assertEqual(caught.exception.status, 302)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0][1]["Authorization"], "Bearer " + ("T" * 43))

    def test_cloud_request_rejects_private_dns_answers_before_connecting(self):
        calls = []
        def resolver(*_args, **_kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.4", 443))]
        with self.assertRaisesRegex(ValueError, "private or reserved"):
            _cloud_json_request(
                "https://ultron.example.com", "/api/desktop-companion/pair",
                {"pairingCode": "P" * 32}, resolver=resolver,
                connection_factory=lambda *_args: calls.append(True)
            )
        self.assertEqual(calls, [])

    def test_cloud_request_rejects_oversized_response(self):
        class Response:
            status = 200
            def getheader(self, name):
                return str(CLOUD_MAX_RESPONSE_BYTES + 1) if name == "Content-Length" else None
            def read(self, limit):
                raise AssertionError("oversized declared response must be rejected before reading")
        class Connection:
            def request(self, *_args, **_kwargs):
                pass
            def getresponse(self):
                return Response()
            def close(self):
                pass
        from ultron_local_assistant.companion import CLOUD_MAX_RESPONSE_BYTES
        with self.assertRaisesRegex(ValueError, "exceeded the safe size limit"):
            _cloud_json_request(
                "https://ultron.example.com", "/api/desktop-companion/heartbeat", {},
                resolver=lambda *_args, **_kwargs: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))],
                connection_factory=lambda *_args: Connection()
            )

    def test_revoked_http_token_is_reported_as_an_authorization_failure(self):
        with tempfile.TemporaryDirectory() as root:
            pair_companion(
                "https://ultron.example.com", "P" * 32,
                data_dir=Path(root) / "companion",
                request_impl=lambda _url, _route, payload, bearer_token=None: {
                    "deviceId": payload["deviceId"], "deviceName": "Ayaan-PC",
                    "platform": "windows", "deviceToken": "T" * 43
                }
            )
            with self.assertRaisesRegex(PermissionError, "no longer authorized"):
                send_companion_heartbeat(
                    data_dir=Path(root) / "companion",
                    request_impl=lambda *_args, **_kwargs: (_ for _ in ()).throw(CloudHTTPError(401))
                )

    def test_generated_token_has_sufficient_entropy_length(self):
        self.assertGreaterEqual(len(generate_companion_token()), 43)



    def test_malformed_persisted_device_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "device-id").write_text("not-a-uuid\n", encoding="ascii")
            with self.assertRaisesRegex(ValueError, "identity file is invalid"):
                create_companion_server(TOKEN, port=0, data_dir=Path(root))

    def test_symlinked_device_identity_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            target = directory / "external-device-id"
            target.write_text("00000000-0000-4000-8000-000000000001\n", encoding="ascii")
            identity = directory / "device-id"
            try:
                identity.symlink_to(target)
            except (OSError, NotImplementedError) as error:
                self.skipTest(
                    "This OS/filesystem does not permit symlink creation: "
                    + type(error).__name__
                )
            with self.assertRaisesRegex(ValueError, "identity file is not a regular file"):
                create_companion_server(TOKEN, port=0, data_dir=directory)


    def test_windows_junction_or_reparse_identity_path_is_rejected(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from ultron_local_assistant.companion import _is_symlink_or_junction

        with tempfile.TemporaryDirectory() as root:
            identity = Path(root) / "device-id"
            identity.write_text("00000000-0000-4000-8000-000000000001\n", encoding="ascii")
            # Path.is_junction() exists on newer Python versions; create=True keeps
            # this policy test compatible with the project's Python 3.10 minimum.
            with patch.object(Path, "is_symlink", return_value=False):
                with patch.object(Path, "is_junction", create=True, return_value=True):
                    self.assertTrue(_is_symlink_or_junction(identity))
                with patch.object(Path, "is_junction", create=True, return_value=False):
                    with patch.object(
                        Path, "lstat",
                        return_value=SimpleNamespace(st_file_attributes=0x400)
                    ):
                        self.assertTrue(_is_symlink_or_junction(identity))


    def test_symlinked_paired_credential_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "companion"
            directory.mkdir()
            outside = Path(root) / "outside-credentials.json"
            outside.write_text("{}", encoding="utf-8")
            credential_file = directory / "device-credentials.json"
            try:
                credential_file.symlink_to(outside)
            except (OSError, NotImplementedError) as error:
                self.skipTest(
                    "This OS/filesystem does not permit symlink creation: "
                    + type(error).__name__
                )
            with self.assertRaisesRegex(ValueError, "credential file must be a regular file"):
                _load_device_credentials(directory)

    def test_reparse_point_paired_credential_file_is_rejected(self):
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "companion"
            directory.mkdir()
            credential_file = directory / "device-credentials.json"
            with patch(
                "ultron_local_assistant.companion._is_symlink_or_junction",
                side_effect=lambda candidate: Path(candidate) == credential_file
            ):
                with self.assertRaisesRegex(ValueError, "credential file must be a regular file"):
                    _load_device_credentials(directory)

if __name__ == "__main__":
    unittest.main()
