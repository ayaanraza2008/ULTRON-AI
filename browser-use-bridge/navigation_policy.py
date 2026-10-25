"""Narrow outbound navigation policy for the ULTRON Browser Use bridge.

Only explicit public HTTPS targets are accepted. Each hostname is resolved once,
validated as globally routable, and pinned into Chromium's resolver rules; all
other hostname lookups fail closed during the browser session.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit
from typing import Callable, Any

URL_RE = re.compile(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s<>\"'`]+")
HOST_RE = re.compile(r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$", re.I)
BLOCKED_SUFFIXES = (".localhost", ".local", ".internal", ".test", ".invalid", ".example")
MAX_TARGETS = 5


def _trim_url(value: str) -> str:
    return value.rstrip(".,;:!?)]}>")


def _validate_hostname(host: str) -> str:
    host = host.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith(BLOCKED_SUFFIXES):
        raise ValueError("Private, local, and reserved hostnames are not allowed.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise ValueError("IP-literal navigation targets are not allowed; use a public HTTPS hostname.")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("The target hostname is invalid.") from exc
    if not HOST_RE.fullmatch(host) or "." not in host:
        raise ValueError("The target must be a valid public DNS hostname.")
    return host


def _public_ipv4_addresses(host: str, resolver: Callable[..., Any]) -> list[str]:
    try:
        records = resolver(host, 443, type=socket.SOCK_STREAM)
    except (OSError, ValueError) as exc:
        raise ValueError("The public target hostname could not be safely resolved.") from exc
    addresses: set[str] = set()
    ipv4: set[str] = set()
    for record in records:
        try:
            raw = str(record[4][0]).split("%", 1)[0]
            address = ipaddress.ip_address(raw)
        except (IndexError, TypeError, ValueError):
            raise ValueError("The target hostname returned an invalid DNS address.")
        mapped = getattr(address, "ipv4_mapped", None)
        if mapped is not None:
            address = mapped
        if not address.is_global:
            raise ValueError("The target hostname resolves to a non-public network address.")
        addresses.add(str(address))
        if address.version == 4:
            ipv4.add(str(address))
    if not addresses or not ipv4:
        raise ValueError("The target must resolve to at least one public IPv4 address.")
    # Pin one verified address for the browser session so later DNS answers do
    # not silently change the target host's network destination.
    return sorted(ipv4)


def resolve_public_https_targets(
    task: str,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> tuple[list[str], dict[str, str]]:
    """Return normalized HTTPS URLs and hostname-to-public-IPv4 pins.

    Browser tasks must carry explicit URLs. Broad unscoped web navigation is
    rejected because prompt instructions alone do not constrain page redirects.
    """
    if not isinstance(task, str) or not task.strip():
        raise ValueError("Include at least one explicit public HTTPS URL in the browser task.")
    raw_urls = [_trim_url(match) for match in URL_RE.findall(task)]
    raw_urls = [value for value in raw_urls if value]
    if not raw_urls:
        raise ValueError("Include at least one explicit public HTTPS URL in the browser task.")
    if len(raw_urls) > MAX_TARGETS:
        raise ValueError(f"At most {MAX_TARGETS} explicit HTTPS targets are allowed per browser task.")

    urls: list[str] = []
    pinned: dict[str, str] = {}
    seen_urls: set[str] = set()
    for raw_url in raw_urls:
        try:
            parsed = urlsplit(raw_url)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("A browser target URL is malformed.") from exc
        if parsed.scheme.lower() != "https":
            raise ValueError("Browser tasks may navigate only to explicit HTTPS URLs.")
        if parsed.username or parsed.password or not parsed.hostname:
            raise ValueError("Browser target URLs may not contain credentials and must include a hostname.")
        if port not in (None, 443):
            raise ValueError("Only the standard HTTPS port 443 is allowed for browser targets.")

        host = _validate_hostname(parsed.hostname)
        if host not in pinned:
            addresses = _public_ipv4_addresses(host, resolver)
            pinned[host] = addresses[0]
        normalized = urlunsplit(("https", host, parsed.path or "/", parsed.query, ""))
        if normalized not in seen_urls:
            seen_urls.add(normalized)
            urls.append(normalized)
    if len(pinned) > MAX_TARGETS:
        raise ValueError(f"At most {MAX_TARGETS} distinct target hosts are allowed per browser task.")
    return urls, pinned


def build_host_resolver_rules(pinned_hosts: dict[str, str]) -> str:
    """Pin the requested public hosts and fail DNS closed for every other name."""
    if not pinned_hosts:
        raise ValueError("At least one public target host is required.")
    rules = [f"MAP {host} {address}" for host, address in sorted(pinned_hosts.items())]
    rules.append("MAP * ~NOTFOUND")
    return ",".join(rules)
